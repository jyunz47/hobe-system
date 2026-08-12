// 「自訂時段＋時數帳」的資料層測試（2026-08-10，補課三刀第 3 刀）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 最在意的四條：
//  ① 拆成兩場補足時，補到一半的人不可以被當成「補完了」（舊算法「名單含他」會讓剩下的時數安靜消失）
//  ② 不拆、照預設排一場的結果必須跟第 3 刀之前一模一樣（分母＝預設值，才不會全系統的帳都變）
//  ③ 欠課消帳也要看時數：先上完的那半堂不可以提前把整筆欠課消掉
//  ④ 老師撞課要抓得出來——在這之前空檔判斷只看教室，老師從頭到尾沒被檢查過

// 週二兩門課：國二數學班（團班 19:00–20:30、90 分、李老師）與 小天家教（一對一 19:00–21:00、
// 120 分、李老師）；週四 國二數學B班（19:00–20:30、李老師）拿來測老師撞課。
// 2026-08-11＝週二、2026-08-13＝週四、2026-08-18＝下週二
function resetCustom() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' },
                  { id: 3, name: '小美', grade: '國二' }, { id: 6, name: '小天', grade: '國二' }],
    enrollments: [
      ...[1, 2, 3].map(sid => ({ studentId: sid, courseId: 7, periodId: yearPeriodId('summer') })),
      { studentId: 6, courseId: 20, periodId: yearPeriodId('summer') },
      { studentId: 1, courseId: 8, periodId: yearPeriodId('summer') },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }],
    courses: [
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 8, name: '國二數學B班', type: '團班', room: '108', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 20, name: '小天家教', type: '一對一', room: '208', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '21:00' }], phases: [] } },
    ],
    absences: [
      { id: 1, occId: 'sys:7:2026-08-11:0', courseId: 7, date: new Date(2026, 7, 11, 19, 0).toISOString(),
        teacherAbsent: false, noShow: [], makeupSkip: [],
        leave: [{ studentId: 1, name: '小明', timing: 'A' }, { studentId: 2, name: '小華', timing: 'A' },
                { studentId: 3, name: '小美', timing: 'A' }] },
      { id: 2, occId: 'sys:20:2026-08-11:0', courseId: 20, date: new Date(2026, 7, 11, 19, 0).toISOString(),
        teacherAbsent: false, noShow: [], makeupSkip: [],
        leave: [{ studentId: 6, name: '小天', timing: 'A' }] },
    ],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';
  makeupList = sysAbsenceEvents();
  slotPicker = { ev: null, mode: null, date: null, time: null, room: null, avail: null,
    branch: '北投', students: null, recId: null, join: null, custom: null };
  spAvailCache = {};   // 各列逐日展開的快取；不清會讓下一個測試讀到上一個的課表
}

function tutorEv() { return makeupList.find(e => e.id === 'sys:20:2026-08-11:0'); }
function groupEv() { return makeupList.find(e => e.id === 'sys:7:2026-08-11:0'); }

// 幫某幾個人排一場 mins 分鐘的補課
function arrangeMins(ev, students, dayStr, hhmm, mins, room) {
  const s = new Date(dayStr + 'T' + hhmm + ':00');
  const e = new Date(s.getTime() + mins * 60000);
  saveMakeupScheduled(ev, s, e, room || '208', null, '補課', students);
}

function occsOn(y, m, d) {
  return expandCoursesForRange(new Date(y, m - 1, d, 0, 0), new Date(y, m - 1, d, 23, 59));
}

// ────────────────────────────────────────────────────────
suite('該補幾分鐘：分母＝系統原本就會給的那一場長度', () => {

  test('團班砍半、家教維持原長', () => {
    resetCustom();
    assertEq(mkOwedMins(groupEv()), 45);    // 90 分的團班 → 45
    assertEq(mkOwedMins(tutorEv()), 120);   // 120 分的家教 → 120
  });

  test('calcMakeupDur：練習課原長、砍半不低於 30 分、調課不砍半', () => {
    assertEq(calcMakeupDur({ durMins: 120, type: 'practice' }, 'makeup'), 120);
    assertEq(calcMakeupDur({ durMins: 90, type: 'pair' }, 'makeup'), 45);
    assertEq(calcMakeupDur({ durMins: 50, type: 'group' }, 'makeup'), 30);   // floor(25) 會低於下限
    assertEq(calcMakeupDur({ durMins: 90, type: 'group' }, 'reschedule'), 90);
  });

  test('調課的分母是整堂原長（不砍半）', () => {
    resetCustom();
    driveData.absences[0].resched = true;
    driveData.absences[0].leave = [];
    makeupList = sysAbsenceEvents();
    assertEq(mkOwedMins(groupEv()), 90);
  });
});

// ────────────────────────────────────────────────────────
suite('拆成兩場補足：補到一半不算補完', () => {

  test('120 分家教只排 60 分 → 還在待安排，卡片講得出還差多少', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-08-18', '18:00', 60);
    assertEqDeep(mkPendingNames(tutorEv()), ['小天']);
    assertEq(mkStatusOf(tutorEv(), new Date(2026, 7, 12)), 'pending');
    const p = mkProgressTxt(tutorEv(), '小天');
    assertEq(p.done, 60);
    assertEq(p.left, 60);
  });

  test('再排 60 分 → 補滿，移出待安排', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-08-18', '18:00', 60);
    arrangeMins(tutorEv(), ['小天'], '2026-08-25', '18:00', 60);
    assertEqDeep(mkPendingNames(tutorEv()), []);
    assertEq(mkStatusOf(tutorEv(), new Date(2026, 7, 12)), 'scheduled');
  });

  test('一次排滿 120 分 → 直接補完（不拆的路徑沒變）', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-08-18', '18:00', 120);
    assertEqDeep(mkPendingNames(tutorEv()), []);
  });

  test('排超過該補的時數也算補完（多補不倒扣）', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-08-18', '18:00', 150);
    assertEqDeep(mkPendingNames(tutorEv()), []);
  });

  test('團班照預設排一場 45 分 → 補完（第 3 刀之前的行為原封不動）', () => {
    resetCustom();
    arrangeMins(groupEv(), ['小明'], '2026-08-14', '17:00', 45);
    assertEqDeep(mkPendingNames(groupEv()), ['小華', '小美']);
    assertEq(mkProgressTxt(groupEv(), '小明').left, 0);
  });

  test('團班只排 30 分 → 那個人還差 15 分，仍在待安排', () => {
    resetCustom();
    arrangeMins(groupEv(), ['小明'], '2026-08-14', '17:00', 30);
    assertEqDeep(mkPendingNames(groupEv()), ['小明', '小華', '小美']);
    assertEq(mkProgressTxt(groupEv(), '小明').left, 15);
  });

  test('兩場分給不同人 → 各自的帳分開算，不互相灌水', () => {
    resetCustom();
    arrangeMins(groupEv(), ['小明'], '2026-08-14', '17:00', 45);
    arrangeMins(groupEv(), ['小華'], '2026-08-15', '10:00', 20);
    assertEq(mkProgressTxt(groupEv(), '小明').left, 0);
    assertEq(mkProgressTxt(groupEv(), '小華').left, 25);
    assertEq(mkProgressTxt(groupEv(), '小美').done, 0);
  });

  test('決定不補課的人不進待安排（時數沒補也一樣）', () => {
    resetCustom();
    driveData.absences[1].makeupSkip = ['小天'];
    makeupList = sysAbsenceEvents();
    assertEqDeep(mkPendingNames(tutorEv()), []);
  });

  test('老師請假沒有個別名單 → 不走時數帳，排了就算安排', () => {
    resetCustom();
    driveData.absences[1].leave = [];
    driveData.absences[1].teacherAbsent = true;
    makeupList = sysAbsenceEvents();
    arrangeMins(tutorEv(), [], '2026-08-18', '18:00', 30);
    assertEq(mkStatusOf(tutorEv(), new Date(2026, 7, 12)), 'scheduled');
  });
});

// ────────────────────────────────────────────────────────
suite('併班補課一律算補滿（第 2 刀語意不變）', () => {

  test('併進比較短的一堂也算補完，不會硬生生欠一截', () => {
    resetCustom();
    // 小天欠 120 分，週四那堂國二數學B班只有 90 分
    const host = occsOn(2026, 8, 13).find(o => o.courseId === 8);
    saveMakeupJoin(tutorEv(), host, ['小天']);
    assertEqDeep(mkPendingNames(tutorEv()), []);
    assertEq(mkProgressTxt(tutorEv(), '小天').done, 120);
  });
});

// ────────────────────────────────────────────────────────
suite('欠課消帳也看時數（學生統計）', () => {

  test('拆兩場、只上完第一場 → 欠課還在', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-07-20', '18:00', 60);   // 已過去＝上完
    arrangeMins(tutorEv(), ['小天'], '2026-08-25', '18:00', 60);   // 還沒到
    assertFalse(mkMadeUpBy(tutorEv(), '小天', new Date(2026, 7, 12)), '只補了一半就被當成補完了');
    assertEq(getStudentStats(6, 'summer').owed, 1);
  });

  test('兩場都上完 → 欠課消掉', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-07-20', '18:00', 60);
    arrangeMins(tutorEv(), ['小天'], '2026-07-21', '18:00', 60);
    assertTrue(mkMadeUpBy(tutorEv(), '小天', new Date(2026, 7, 12)), '兩場都上完了該消欠課');
    assertEq(getStudentStats(6, 'summer').owed, 0);
  });

  test('一次補滿一場、已上完 → 欠課消掉（舊資料形狀照樣認）', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-07-20', '18:00', 120);
    assertEq(getStudentStats(6, 'summer').owed, 0);
  });
});

// ────────────────────────────────────────────────────────
suite('老師有沒有空（第 3 刀補的漏洞）', () => {

  test('同一位老師同時段有別的課 → 抓得出來', () => {
    resetCustom();
    const thu = occsOn(2026, 8, 13);
    const busy = mkTeacherBusyAt(tutorEv(), thu,
      new Date(2026, 7, 13, 19, 0), new Date(2026, 7, 13, 20, 0));
    assertEq(busy.length, 1);
    assertEq(busy[0].origTitle, '國二數學B班');
  });

  test('時間沒重疊 → 有空', () => {
    resetCustom();
    const thu = occsOn(2026, 8, 13);
    assertEq(mkTeacherBusyAt(tutorEv(), thu,
      new Date(2026, 7, 13, 21, 0), new Date(2026, 7, 13, 22, 0)).length, 0);
  });

  test('那堂整堂請假／調課 → 老師其實有空，不算撞課', () => {
    resetCustom();
    driveData.absences.push({ id: 3, occId: 'sys:8:2026-08-13:0', courseId: 8,
      date: new Date(2026, 7, 13, 19, 0).toISOString(),
      teacherAbsent: true, noShow: [], makeupSkip: [], leave: [] });
    const thu = occsOn(2026, 8, 13);
    assertEq(mkTeacherBusyAt(tutorEv(), thu,
      new Date(2026, 7, 13, 19, 0), new Date(2026, 7, 13, 20, 0)).length, 0);
  });

  test('沒有老師資料的課堂不當作撞課（舊資料常缺，寧可漏報不要誤報）', () => {
    resetCustom();
    const thu = occsOn(2026, 8, 13).map(o => ({ ...o, teacher: '', courseId: null }));
    assertEq(mkTeacherBusyAt(tutorEv(), thu,
      new Date(2026, 7, 13, 19, 0), new Date(2026, 7, 13, 20, 0)).length, 0);
  });
});

// ────────────────────────────────────────────────────────
suite('自訂時段：預設值、快速填入、風險清單', () => {

  // 自訂時段那幾支吃 slotPicker 狀態，這裡直接擺好（真身由 openSlotPicker 設）
  function pickerOn(ev, dayStr, students) {
    const [y, m, d] = dayStr.split('-').map(Number);
    slotPicker = { ev, mode: 'makeup', date: dayStr, time: null, room: null,
      avail: occsOn(y, m, d), branch: '北投', students: students || null,
      recId: null, join: null, custom: null };
  }

  test('時長預設＝還差幾分鐘（已排 60 分 → 預設 60）', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-08-18', '18:00', 60);
    pickerOn(tutorEv(), '2026-08-25', ['小天']);
    assertEq(spRemainMins(), 60);
  });

  test('一場都還沒排 → 預設＝整份該補的時數', () => {
    resetCustom();
    pickerOn(tutorEv(), '2026-08-18', ['小天']);
    assertEq(spRemainMins(), 120);
  });

  test('多人一起排時取最欠的那位', () => {
    resetCustom();
    arrangeMins(groupEv(), ['小明'], '2026-08-14', '17:00', 30);   // 小明還差 15
    pickerOn(groupEv(), '2026-08-19', ['小明', '小華']);            // 小華還差 45
    assertEq(spRemainMins(), 45);
  });

  test('改期既有那場：它自己的時數不算進已補，預設不會變 0', () => {
    resetCustom();
    arrangeMins(tutorEv(), ['小天'], '2026-08-18', '18:00', 120);
    pickerOn(tutorEv(), '2026-08-25', ['小天']);
    slotPicker.recId = getMakeupsFor('sys:20:2026-08-11:0')[0].id;
    assertEq(spRemainMins(), 120);
  });

  test('快速填入：貼在自己下次上課的前、後各一個', () => {
    resetCustom();
    pickerOn(tutorEv(), '2026-08-18', ['小天']);   // 那天 19:00–21:00 有小天家教
    const opts = spAdjacentOptions(60, '2026-08-18');
    assertEq(opts.length, 2);
    assertEq(opts[0].sub, '18:00–19:00');
    assertEq(opts[1].sub, '21:00–22:00');
    assertEq(opts[0].room, '208');
  });

  test('那天沒有同一門課 → 沒有快速填入（不亂猜別門課的前後）', () => {
    resetCustom();
    pickerOn(tutorEv(), '2026-08-13', ['小天']);   // 週四沒有小天家教
    assertEq(spAdjacentOptions(60, '2026-08-13').length, 0);
  });

  test('風險清單：撞老師、撞教室各報一條', () => {
    resetCustom();
    pickerOn(tutorEv(), '2026-08-13', ['小天']);   // 週四 19:00–20:30 國二數學B班・李老師・108
    const issues = spCustomIssues({ date: '2026-08-13', h: 19, mi: 0, dur: 60, room: '108' }, 0);
    assertEq(issues.length, 2);
    assertTrue(issues.some(t => t.includes('李老師')), '沒報老師撞課：' + issues.join('｜'));
    assertTrue(issues.some(t => t.includes('108')), '沒報教室撞課：' + issues.join('｜'));
  });

  test('乾淨的組合 → 一條警告都沒有', () => {
    resetCustom();
    pickerOn(tutorEv(), '2026-08-13', ['小天']);
    assertEqDeep(spCustomIssues({ date: '2026-08-13', h: 13, mi: 0, dur: 60, room: '309' }, 0), []);
  });

  test('超出營業時間會報（暑假平日 12:30–21:30）', () => {
    resetCustom();
    pickerOn(tutorEv(), '2026-08-13', ['小天']);
    const late = spCustomIssues({ date: '2026-08-13', h: 21, mi: 0, dur: 60, room: '309' }, 0);
    assertTrue(late.some(t => t.includes('營業時間')), '收班後沒報：' + late.join('｜'));
    const early = spCustomIssues({ date: '2026-08-13', h: 11, mi: 0, dur: 60, room: '309' }, 0);
    assertTrue(early.some(t => t.includes('營業時間')), '開門前沒報：' + early.join('｜'));
  });

  test('人數超過教室上限會報（108 現在 8 人）', () => {
    resetCustom();
    pickerOn(groupEv(), '2026-08-13', ['小明', '小華', '小美']);
    assertFalse(spCustomIssues({ date: '2026-08-13', h: 13, mi: 0, dur: 45, room: '108' }, 0).some(t => t.includes('坐得下')),
      '3 人不該超過 108 的上限');
    assertEq(spCustomIssues({ date: '2026-08-13', h: 13, mi: 0, dur: 45, room: '小教室' }, 0).length, 0);
  });

  test('時長 0 或負數擋在確認之前', () => {
    resetCustom();
    pickerOn(tutorEv(), '2026-08-13', ['小天']);
    assertEq(spCustomIssues({ date: '2026-08-13', h: 13, mi: 0, dur: 0, room: '309' }, 0).length, 1);
  });
});

// ────────────────────────────────────────────────────────
// 老闆 2026-08-10 回報：排大教室、位子明明夠，卻被硬提醒「這時段已有課」。
// 原因是教室衝突用一律「有課就算撞」判斷，但大教室本來就同時擺好幾桌家教＋一堂練習課。
suite('教室警告要照各教室自己的規則（不能一律有課就算撞）', () => {

  function pickerOn(ev, dayStr, students) {
    const [y, m, d] = dayStr.split('-').map(Number);
    slotPicker = { ev, mode: 'makeup', date: dayStr, time: null, room: null,
      avail: occsOn(y, m, d), branch: '北投', students: students || null,
      recId: null, join: null, custom: null };
  }
  // 週四 15:00–17:00 大教室練習課（n 人）＋ 幾桌一對一家教
  function addBigRoom(practiceStudents, tutorTables) {
    const sid = 100;
    driveData.studentList.push(...practiceStudents.map((_, i) => ({ id: sid + i, name: '練' + i, grade: '國二' })));
    driveData.courses.push({ id: 30, name: '週四練習課', type: '練習課', room: '大教室', status: '開課中',
      teacherIds: [], schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '15:00', end: '17:00' }], phases: [] } });
    practiceStudents.forEach((_, i) => driveData.enrollments.push(
      { studentId: sid + i, courseId: 30, periodId: yearPeriodId('summer') }));
    for (let t = 0; t < tutorTables; t++) {
      const id = 40 + t, stu = 200 + t;
      driveData.studentList.push({ id: stu, name: '桌' + t, grade: '國二' });
      driveData.courses.push({ id, name: '桌' + t + '家教', type: '一對一', room: '大教室', status: '開課中',
        teacherIds: [], schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '15:00', end: '17:00' }], phases: [] } });
      driveData.enrollments.push({ studentId: stu, courseId: id, periodId: yearPeriodId('summer') });
    }
    makeupList = sysAbsenceEvents();
  }

  test('大教室還有空桌 → 不該警告（老闆回報的那個假警報）', () => {
    resetCustom();
    addBigRoom(['a', 'b', 'c'], 2);            // 練習課 3 人 → 上限 6 桌，已用 2 桌
    pickerOn(tutorEv(), '2026-08-13', ['小天']);
    assertEqDeep(spCustomIssues({ date: '2026-08-13', h: 15, mi: 0, dur: 60, room: '大教室' }, 0), []);
  });

  test('大教室家教桌真的滿了才警告', () => {
    resetCustom();
    addBigRoom(['a', 'b', 'c'], 6);            // 上限 6 桌，已用 6 桌
    pickerOn(tutorEv(), '2026-08-13', ['小天']);
    const issues = spCustomIssues({ date: '2026-08-13', h: 15, mi: 0, dur: 60, room: '大教室' }, 0);
    assertEq(issues.length, 1);
    assertTrue(issues[0].includes('家教桌已滿'), '訊息不對：' + issues[0]);
  });

  test('練習課人多時上限降到 4 桌', () => {
    resetCustom();
    addBigRoom(new Array(15).fill('x'), 4);    // 練習課 15 人 → 上限 4 桌，已用 4 桌
    pickerOn(tutorEv(), '2026-08-13', ['小天']);
    assertEq(spCustomIssues({ date: '2026-08-13', h: 15, mi: 0, dur: 60, room: '大教室' }, 0).length, 1);
  });

  test('多人補課借整間大教室 → 不套家教桌規則', () => {
    resetCustom();
    addBigRoom(['a', 'b', 'c'], 6);
    pickerOn(groupEv(), '2026-08-13', ['小明', '小華', '小美']);
    assertEqDeep(spCustomIssues({ date: '2026-08-13', h: 15, mi: 0, dur: 45, room: '大教室' }, 0), []);
  });

  test('小教室這種一次一堂的照舊：有課就算撞', () => {
    resetCustom();
    pickerOn(tutorEv(), '2026-08-13', ['小天']);
    const issues = spCustomIssues({ date: '2026-08-13', h: 19, mi: 0, dur: 60, room: '108' }, 0);
    assertTrue(issues.some(t => t.includes('108 這時段已有')), '108 撞課沒報：' + issues.join('｜'));
  });
});

// ────────────────────────────────────────────────────────
suite('一次排好幾場：各場自己的日期與分鐘', () => {

  function openOn(ev, dayStr, students) {
    const [y, m, d] = dayStr.split('-').map(Number);
    slotPicker = { ev, mode: 'makeup', date: dayStr, time: null, room: null,
      avail: occsOn(y, m, d), branch: '北投', students: students || null,
      recId: null, join: null, custom: null };
    spAvailCache = {};
    spOpenCustom();
  }

  test('開起來是一列，時長預設＝還差幾分鐘', () => {
    resetCustom();
    openOn(tutorEv(), '2026-08-18', ['小天']);
    assertEq(spCustomRows().length, 1);
    assertEq(spCustomRows()[0].dur, 120);
    assertEq(spCustomRows()[0].date, '2026-08-18');
  });

  test('還沒選日期就點自訂 → 第一列用今天當起點（不是空白）', () => {
    resetCustom();
    slotPicker = { ev: tutorEv(), mode: 'makeup', date: null, time: null, room: null,
      avail: null, branch: '北投', students: ['小天'], recId: null, join: null, custom: null };
    spAvailCache = {};
    spOpenCustom();
    assertEq(spCustomRows()[0].date, toDateStr(new Date()));
  });

  test('加一列 → 時長預設帶「扣掉已填之後還差的」', () => {
    resetCustom();
    openOn(tutorEv(), '2026-08-18', ['小天']);
    slotPicker.custom.rows[0].dur = 60;
    spAddRow();
    assertEq(spCustomRows().length, 2);
    assertEq(spCustomRows()[1].dur, 60);      // 120 − 60
  });

  test('已填時數是各列相加', () => {
    resetCustom();
    openOn(tutorEv(), '2026-08-18', ['小天']);
    slotPicker.custom.rows[0].dur = 45;
    spAddRow();
    slotPicker.custom.rows[1].dur = 30;
    assertEq(spFilledMins(), 75);
    assertEq(spRemainMins(), 120);
  });

  test('刪到剩 0 列時自動補回一列（面板不會變空白）', () => {
    resetCustom();
    openOn(tutorEv(), '2026-08-18', ['小天']);
    spDelRow(0);
    assertEq(spCustomRows().length, 1);
  });

  test('兩列排在同一天同一個時間 → 報「跟自己撞在一起」', () => {
    resetCustom();
    openOn(tutorEv(), '2026-08-19', ['小天']);
    slotPicker.custom.rows = [
      { date: '2026-08-19', h: 13, mi: 0, dur: 60, room: '309' },
      { date: '2026-08-19', h: 13, mi: 30, dur: 60, room: '小教室' },
    ];
    assertTrue(spCustomIssues(spCustomRows()[0], 0).some(t => t.includes('跟第 2 場')), '第 1 列沒報');
    assertTrue(spCustomIssues(spCustomRows()[1], 1).some(t => t.includes('跟第 1 場')), '第 2 列沒報');
  });

  test('兩列排不同天 → 不算互撞', () => {
    resetCustom();
    openOn(tutorEv(), '2026-08-19', ['小天']);
    slotPicker.custom.rows = [
      { date: '2026-08-19', h: 13, mi: 0, dur: 60, room: '309' },
      { date: '2026-08-20', h: 13, mi: 0, dur: 60, room: '309' },
    ];
    assertEqDeep(spCustomIssues(spCustomRows()[0], 0), []);
    assertEqDeep(spCustomIssues(spCustomRows()[1], 1), []);
  });

  test('各列的檢查看的是「那一列自己那天」的課表', () => {
    resetCustom();
    openOn(tutorEv(), '2026-08-19', ['小天']);
    // 8/13（週四）19:00 有李老師的國二數學B班；8/19（週三）沒有
    assertEqDeep(spCustomIssues({ date: '2026-08-19', h: 19, mi: 0, dur: 60, room: '309' }, 0), []);
    assertTrue(spCustomIssues({ date: '2026-08-13', h: 19, mi: 0, dur: 60, room: '309' }, 0)
      .some(t => t.includes('李老師')), '換到週四該報老師撞課');
  });

  test('spAllIssues 會標出是第幾場出問題', () => {
    resetCustom();
    openOn(tutorEv(), '2026-08-19', ['小天']);
    slotPicker.custom.rows = [
      { date: '2026-08-19', h: 13, mi: 0, dur: 60, room: '309' },
      { date: '2026-08-13', h: 19, mi: 0, dur: 60, room: '108' },
    ];
    const all = spAllIssues();
    assertTrue(all.every(t => t.startsWith('第 ')), '沒標場次：' + all.join('｜'));
    assertTrue(all.some(t => t.startsWith('第 2 場')), '第 2 場的問題沒被收進來');
  });
});

