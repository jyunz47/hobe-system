// 「排好了卻又跳回待安排」的回歸測試（2026-08-10 老闆回報）
// 載入順序同 index.html：stubs → utils → enrollment → schedule → dayview → courses
//                        → absence → makeup → students → test-runner → 本檔
//
// 病灶：第 3 刀的時數帳，**分母是現算的**（課型看那天在籍幾人、課長看課程本體時段），
// 而排出去的場次是凍在紀錄裡的。兩邊時間點不同，中間只要有人退班／插班／換期別看清單／
// 改上課時間，分母就會偷偷變大，已經排好的補課無聲跳回「待安排」。
// 修法：排的當下把分母寫進那筆安排（owedMins）凍結，之後只讀不算（＝老闆的「不回溯改」原則）。
//
// 五條各自對應一個現場重現過的情境：
//  ① 團班的人退到剩 1 個 → 滾動判型把課型變成「一對一」，該補時數從半堂變整堂
//  ② 期別切到還沒登記修課的學期 → 名冊算出 1 人，同上
//  ③ 課程本體的上課時段改長 → 過去那堂的課長跟著變，半堂也跟著變長
//  ④ 調課排好後插班一個新同學 → 調課的名單是「現算的全名冊」，新同學變成「還沒排」
//  ⑤ 舊紀錄沒有 scheduledEnd → 時長算出 0 分鐘，永遠補不滿

// 週二 19:00–20:30（90 分）團班，小明、小華、小美三人在籍；2026-08-11＝週二
function resetFreeze(enr, courseEnd) {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' },
                  { id: 3, name: '小美', grade: '國二' }],
    enrollments: enr || [1, 2, 3].map(sid => ({ studentId: sid, courseId: 7, periodId: yearPeriodId('summer') })),
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }],
    courses: [{ id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
      schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: courseEnd || '20:30' }], phases: [] } }],
    absences: [],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';
}
// 請假／調課紀錄一筆，回傳長出來的那堂課
function freezeEv(opt) {
  driveData.absences = [{ id: 1, occId: 'sys:7:2026-08-11:0', courseId: 7,
    date: new Date(2026, 7, 11, 19, 0).toISOString(), teacherAbsent: false, resched: !!(opt && opt.resched),
    noShow: [], makeupSkip: [],
    leave: ((opt && opt.leave) || []).map(n => ({ studentId: n === '小明' ? 1 : 2, name: n, timing: 'A' })) }];
  makeupList = sysAbsenceEvents();
  rebuildMakeupMatchMap();
  return makeupList[0];
}
// 照系統預設排一場（＝使用者按「安排」走推薦時段那條路的結果）
function arrangeAsSystem(ev, students) {
  const mode = ev.absType === '調課' ? 'reschedule' : 'makeup';
  const dur = calcMakeupDur(ev, mode);
  const s = new Date(2026, 7, 18, 19, 0);
  saveMakeupScheduled(ev, s, new Date(s.getTime() + dur * 60000), '208', null,
    mode === 'makeup' ? '補課' : '調課', students || null);
}
const AFTER = new Date(2026, 7, 12);   // 請假隔天：場次還沒上，狀態應該是 scheduled

suite('待補課清單：排好之後不會自己跳回待安排（分母凍結）', () => {

  test('分母寫進紀錄：排一場就凍住該補時數', () => {
    resetFreeze();
    arrangeAsSystem(freezeEv({ leave: ['小明'] }), ['小明']);
    assertEq(driveData.makeupScheduled[0].owedMins, 45, '團班 90 分砍半 → 45 分寫進紀錄');
  });

  test('① 團班的人退到剩 1 個，已排的補課不受影響', () => {
    resetFreeze();
    arrangeAsSystem(freezeEv({ leave: ['小明'] }), ['小明']);
    assertEq(mkStatusOf(freezeEv({ leave: ['小明'] }), AFTER), 'scheduled', '排完當下');
    // 小華、小美退出登記簿 → 那堂變成「一對一」，現算的話該補時數會從 45 變 90
    driveData.enrollments = [{ studentId: 1, courseId: 7, periodId: yearPeriodId('summer') }];
    const ev = freezeEv({ leave: ['小明'] });
    assertEq(ev.type, 'one', '滾動判型確實變了（分母現算就會跟著變）');
    assertEq(mkOwedMins(ev), 45, '但該補時數讀凍結值');
    assertEq(mkStatusOf(ev, AFTER), 'scheduled', '卡片不該跳回待安排');
  });

  test('② 切到還沒登記修課的期別，已排的補課不受影響', () => {
    resetFreeze();
    arrangeAsSystem(freezeEv({ leave: ['小明'] }), ['小明']);
    currentPeriodId = 'sem1';   // 上學期目前只登記了小明
    driveData.enrollments = [{ studentId: 1, courseId: 7, periodId: yearPeriodId('sem1') }];
    assertEq(mkStatusOf(freezeEv({ leave: ['小明'] }), AFTER), 'scheduled');
    currentPeriodId = 'summer';
  });

  test('③ 課程本體把上課時段改長，已排的補課不受影響', () => {
    resetFreeze();
    arrangeAsSystem(freezeEv({ leave: ['小明'] }), ['小明']);
    driveData.courses[0].schedule.slots[0].end = '21:00';   // 90 分 → 120 分
    const ev = freezeEv({ leave: ['小明'] });
    assertEq(ev.durMins, 120, '那堂確實變長了');
    assertEq(mkOwedMins(ev), 45, '該補時數仍是排的當下那個數字');
    assertEq(mkStatusOf(ev, AFTER), 'scheduled');
  });

  test('④ 調課排好後插班一個新同學，調課不該回到待安排', () => {
    resetFreeze([1, 2].map(sid => ({ studentId: sid, courseId: 7, periodId: yearPeriodId('summer') })));
    const ev = freezeEv({ resched: true });
    arrangeAsSystem(ev, ev.absentStudents);
    assertEq(mkStatusOf(ev, AFTER), 'scheduled', '排完當下');
    driveData.enrollments.push({ studentId: 3, courseId: 7, periodId: yearPeriodId('summer') });
    assertEq(mkStatusOf(freezeEv({ resched: true }), AFTER), 'scheduled', '插班之後');
  });

  test('④b 調課不數人頭：卡片講「已安排」不講 N/M 人', () => {
    resetFreeze();
    const ev = freezeEv({ resched: true });
    assertEq(mkStBadgeInfo(ev).txt, '未安排');
    arrangeAsSystem(ev, ev.absentStudents);
    assertEq(mkStBadgeInfo(freezeEv({ resched: true })).txt, '已安排');
    assertEqDeep(mkWaitTxt(freezeEv({ resched: true })), [], '調課沒有「還沒排完誰」這回事');
  });

  test('⑤ 舊紀錄沒存結束時間 → 當作補滿，不是補 0 分鐘', () => {
    resetFreeze();
    const ev = freezeEv({ leave: ['小明'] });
    driveData.makeupScheduled = [{ id: 'old1', originalId: ev.id, origTitle: ev.origTitle,
      originalDate: ev.startDt.toISOString(), scheduledDate: new Date(2026, 7, 18, 19, 0).toISOString(),
      room: '208', absentStudents: ['小明'], calName: '補課' }];   // 沒有 scheduledEnd、沒有 owedMins
    rebuildMakeupMatchMap();
    assertEq(mkStatusOf(ev, AFTER), 'scheduled');
    assertEq(mkMadeUpBy(ev, '小明', new Date(2026, 7, 19)), true, '那天過了就是補完了（欠課要消掉）');
  });

  test('沒排的還是待安排：凍結不會把空的也當成排好了', () => {
    resetFreeze();
    assertEq(mkStatusOf(freezeEv({ leave: ['小明'] }), AFTER), 'pending');
  });

  test('拆兩場補足仍然照算：凍結的是分母，不是「排了就算補完」', () => {
    resetFreeze();
    driveData.courses[0].type = '一對一';
    driveData.enrollments = [{ studentId: 1, courseId: 7, periodId: yearPeriodId('summer') }];
    driveData.courses[0].schedule.slots[0].end = '21:00';   // 一對一 120 分：補課維持原時長
    let ev = freezeEv({ leave: ['小明'] });
    assertEq(mkOwedMins(ev), 120);
    const s1 = new Date(2026, 7, 18, 18, 0);
    saveMakeupScheduled(ev, s1, new Date(s1.getTime() + 60 * 60000), '208', null, '補課', ['小明']);
    assertEq(mkStatusOf(ev, AFTER), 'pending', '只補了 1 小時，還差 1 小時');
    assertEq(mkStBadgeInfo(ev).txt, '已補 1小時／2小時');
    const s2 = new Date(2026, 7, 19, 18, 0);
    saveMakeupScheduled(ev, s2, new Date(s2.getTime() + 60 * 60000), '208', null, '補課', ['小明']);
    assertEq(mkStatusOf(ev, AFTER), 'scheduled', '兩場相加補滿');
  });
});
