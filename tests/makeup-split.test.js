// 「一堂請假拆成多場補課」的資料層測試（2026-08-05）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 最在意的三條：
//  ① 兩場補課不可以互相蓋掉（舊版用 originalId 當唯一鍵，第二場會把第一場擠掉、安靜消失）
//  ② 只排了一部分人，那筆請假必須還算「待安排」（不然剩下的人會從清單上消失、沒人補到）
//  ③ 某位學生的補課要認「名單含他的那場」，不能拿整堂的第一場當每個人的答案（欠課會少算）

// 每個測試前重置：週二 19:00–20:30 國二數學班，小明／小華／小美三人，8/11 那堂三人都請假
function resetMK() {
  driveData = {
    studentList: [{ id: 1, name: '小明' }, { id: 2, name: '小華' }, { id: 3, name: '小美' }],
    enrollments: [1, 2, 3].map(sid => ({ studentId: sid, courseId: 7, periodId: yearPeriodId('summer') })),
    makeupScheduled: [], coursePrices: [], courseSettings: [], teachers: [],
    courses: [{
      id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中',
      schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] },
    }],
    absences: [{
      id: 1, occId: 'sys:7:2026-08-11:0', courseId: 7, date: new Date(2026, 7, 11, 19, 0).toISOString(),
      teacherAbsent: false, noShow: [], makeupSkip: [],
      leave: [{ studentId: 1, name: '小明', timing: 'A' },
              { studentId: 2, name: '小華', timing: 'A' },
              { studentId: 3, name: '小美', timing: 'A' }],
    }],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = [];
  currentPeriodId = 'summer';
  makeupList = sysAbsenceEvents();
}

// 那堂請假的課堂物件
function absEv() { return makeupList.find(e => e.id === 'sys:7:2026-08-11:0'); }

// 幫某幾個人排一場補課
function arrange(students, dayStr, hh, mm, room) {
  const s = new Date(dayStr + 'T' + hh + ':' + mm + ':00');
  const en = new Date(s.getTime() + 45 * 60000);
  saveMakeupScheduled(absEv(), s, en, room || '108', null, '補課', students);
}

// ────────────────────────────────────────────────────────
suite('一堂請假可以排出多場補課', () => {

  test('排兩場 → 兩筆紀錄各自留著，不會互相蓋掉', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    arrange(['小華'], '2026-08-15', '10', '00');
    assertEq(driveData.makeupScheduled.length, 2);
    assertEq(getMakeupsFor('sys:7:2026-08-11:0').length, 2);
  });

  test('兩場各自長出一堂課，課堂 id 不同（用 originalId 當 id 會併成一堂）', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00', '108');
    arrange(['小華'], '2026-08-14', '19', '00', '208');
    const occ = expandMakeupForRange(new Date(2026, 7, 14, 0, 0), new Date(2026, 7, 14, 23, 59));
    assertEq(occ.length, 2);
    assertTrue(occ[0].id !== occ[1].id, '兩堂補課的 id 撞在一起了');
    assertEqDeep(occ.map(o => o.classroom).sort(), ['108', '208']);
  });

  test('每場只帶自己那份名單', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    arrange(['小華', '小美'], '2026-08-15', '10', '00');
    const recs = getMakeupsFor('sys:7:2026-08-11:0');
    assertEqDeep(recs[0].absentStudents, ['小明']);
    assertEqDeep(recs[1].absentStudents, ['小華', '小美']);
  });

  test('改期沿用同一筆（帶 recId）→ 不會多長一場', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    const rid = getMakeupsFor('sys:7:2026-08-11:0')[0].id;
    saveMakeupScheduled(absEv(), new Date('2026-08-16T18:00:00'), new Date('2026-08-16T18:45:00'),
      '309', null, '補課', ['小明'], rid);
    const recs = getMakeupsFor('sys:7:2026-08-11:0');
    assertEq(recs.length, 1);
    assertEq(recs[0].room, '309');
    assertEq(new Date(recs[0].scheduledDate).getDate(), 16);
  });
});

// ────────────────────────────────────────────────────────
suite('排到一半的狀態：剩下的人不可以從清單上消失', () => {

  test('三人請假排掉一人 → 還沒排的是另外兩人', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    assertEqDeep(mkPendingNames(absEv()), ['小華', '小美']);
  });

  test('只排一部分 → 那筆請假仍算「待安排」', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    assertEq(mkStatusOf(absEv(), new Date(2026, 7, 12)), 'pending');
  });

  test('三人都排完且都還沒上 → 已安排', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    arrange(['小華', '小美'], '2026-08-15', '10', '00');
    assertEqDeep(mkPendingNames(absEv()), []);
    assertEq(mkStatusOf(absEv(), new Date(2026, 7, 12)), 'scheduled');
  });

  test('全部場次都上完了 → 已完成', () => {
    resetMK();
    arrange(['小明', '小華', '小美'], '2026-08-14', '17', '00');
    assertEq(mkStatusOf(absEv(), new Date(2026, 7, 20)), 'completed');
  });

  test('一場已上完、另一場還沒 → 還是已安排（不算完成）', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    arrange(['小華', '小美'], '2026-08-25', '10', '00');
    assertEq(mkStatusOf(absEv(), new Date(2026, 7, 20)), 'scheduled');
  });

  test('決定不補課的人不算進待安排的分母', () => {
    resetMK();
    driveData.absences[0].makeupSkip = ['小美'];
    makeupList = sysAbsenceEvents();
    assertEq(mkTotalCount(absEv()), 2);
    arrange(['小明', '小華'], '2026-08-14', '17', '00');
    assertEqDeep(mkPendingNames(absEv()), []);
    assertEq(mkStatusOf(absEv(), new Date(2026, 7, 12)), 'scheduled');
  });

  test('全部人都決定不補課、也沒排任何場次 → 不補課區', () => {
    resetMK();
    driveData.absences[0].makeupSkip = ['小明', '小華', '小美'];
    makeupList = sysAbsenceEvents();
    assertEq(mkStatusOf(absEv(), new Date(2026, 7, 12)), 'skipped');
  });

  test('老師請假沒有個別名單 → 排了就是已安排，沒排就是待安排', () => {
    resetMK();
    driveData.absences[0].leave = [];
    driveData.absences[0].teacherAbsent = true;
    makeupList = sysAbsenceEvents();
    assertEq(mkStatusOf(absEv(), new Date(2026, 7, 12)), 'pending');
    arrange([], '2026-08-14', '17', '00');
    assertEq(mkStatusOf(absEv(), new Date(2026, 7, 12)), 'scheduled');
  });
});

// ────────────────────────────────────────────────────────
suite('某位學生對到哪一場補課', () => {

  test('只認名單含他的那場：小華還沒排 → 沒有補課', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    assertTrue(makeupForStudent(absEv(), '小明') !== null, '小明應該對得到自己那場');
    assertEq(makeupForStudent(absEv(), '小華'), null);
  });

  test('學生統計：只幫小明排了，小華小美對不到任何補課場次', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    assertTrue(getStudentStats(1, 'summer').pairs[0].makeup !== null, '小明該對到自己那場');
    assertEq(getStudentStats(2, 'summer').pairs[0].makeup, null);
    assertEq(getStudentStats(3, 'summer').pairs[0].makeup, null);
  });

  test('補課上完後只消掉小明的欠課，小華小美照欠', () => {
    resetMK();
    // 欠課要「補課已經上完」才消（排了但還沒上仍算欠著）→ 這裡排在已過去的日期
    arrange(['小明'], '2026-07-20', '17', '00');
    assertEq(getStudentStats(1, 'summer').owed, 0);
    assertEq(getStudentStats(2, 'summer').owed, 1);
    assertEq(getStudentStats(3, 'summer').owed, 1);
  });

  test('老師請假：場次沒有個別名單，每位學生都對到那一場', () => {
    resetMK();
    driveData.absences[0].leave = [];
    driveData.absences[0].teacherAbsent = true;
    makeupList = sysAbsenceEvents();
    arrange([], '2026-08-14', '17', '00');
    assertTrue(makeupForStudent(absEv(), '小華') !== null, '老師請假的補課每個人都該對得到');
  });
});

// ────────────────────────────────────────────────────────
suite('取消：只動該動的那一場', () => {

  // deleteMakeupScheduled / deleteMakeupsForOcc 是 async，但寫資料那段在第一個 await 之前，
  // 所以同步呼叫完就可以斷言（測試框架是同步的，寫成 async test 會靜默通過）
  test('取消其中一場，另一場留著', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    arrange(['小華'], '2026-08-15', '10', '00');
    const rid = getMakeupsFor('sys:7:2026-08-11:0')[0].id;
    deleteMakeupScheduled(rid);
    const recs = getMakeupsFor('sys:7:2026-08-11:0');
    assertEq(recs.length, 1);
    assertEqDeep(recs[0].absentStudents, ['小華']);
  });

  test('取消調課／請假時整堂的場次全撤', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    arrange(['小華'], '2026-08-15', '10', '00');
    deleteMakeupsForOcc('sys:7:2026-08-11:0');
    assertEq(driveData.makeupScheduled.length, 0);
  });

  test('取消小明的請假 → 小明專屬那場整場移除，小華那場不受影響', () => {
    resetMK();
    arrange(['小明'], '2026-08-14', '17', '00');
    arrange(['小華'], '2026-08-15', '10', '00');
    driveData.absences[0].leave = driveData.absences[0].leave.filter(x => x.name !== '小明');
    syncMakeupOnLeaveCancel('sys:7:2026-08-11:0');
    const recs = getMakeupsFor('sys:7:2026-08-11:0');
    assertEq(recs.length, 1);
    assertEqDeep(recs[0].absentStudents, ['小華']);
  });

  test('一場補兩人、只取消其中一人 → 那場留著、名單縮小', () => {
    resetMK();
    arrange(['小華', '小美'], '2026-08-15', '10', '00');
    driveData.absences[0].leave = driveData.absences[0].leave.filter(x => x.name !== '小華');
    syncMakeupOnLeaveCancel('sys:7:2026-08-11:0');
    const recs = getMakeupsFor('sys:7:2026-08-11:0');
    assertEq(recs.length, 1);
    assertEqDeep(recs[0].absentStudents, ['小美']);
  });
});

// ────────────────────────────────────────────────────────
suite('舊資料（一堂一筆、沒有 id）照舊能用', () => {

  test('讀進來自動補 id＝originalId，補課場次照樣長得出來', () => {
    resetMK();
    driveData.makeupScheduled = [{
      originalId: 'sys:7:2026-08-11:0', origTitle: '國二數學班',
      originalDate: new Date(2026, 7, 11, 19, 0).toISOString(),
      scheduledDate: new Date(2026, 7, 14, 17, 0).toISOString(),
      scheduledEnd: new Date(2026, 7, 14, 17, 45).toISOString(),
      room: '108', absentStudents: ['小明', '小華', '小美'], calName: '補課',
    }];
    rebuildMakeupMatchMap();
    const recs = getMakeupsFor('sys:7:2026-08-11:0');
    assertEq(recs.length, 1);
    assertEq(recs[0].id, 'sys:7:2026-08-11:0');
    assertEqDeep(mkPendingNames(absEv()), []);
    const occ = expandMakeupForRange(new Date(2026, 7, 14, 0, 0), new Date(2026, 7, 14, 23, 59));
    assertEq(occ.length, 1);
    assertEq(occ[0].classroom, '108');
  });

  test('舊資料之後再加排一場 → 兩場並存，舊的那筆沒被擠掉', () => {
    resetMK();
    driveData.makeupScheduled = [{
      originalId: 'sys:7:2026-08-11:0', origTitle: '國二數學班',
      originalDate: new Date(2026, 7, 11, 19, 0).toISOString(),
      scheduledDate: new Date(2026, 7, 14, 17, 0).toISOString(),
      scheduledEnd: new Date(2026, 7, 14, 17, 45).toISOString(),
      room: '108', absentStudents: ['小明'], calName: '補課',
    }];
    rebuildMakeupMatchMap();
    arrange(['小華'], '2026-08-15', '10', '00');
    assertEq(getMakeupsFor('sys:7:2026-08-11:0').length, 2);
    assertEqDeep(mkPendingNames(absEv()), ['小美']);
  });
});
