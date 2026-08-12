// 今日重點卡自動撈的那些（2026-08-11，js/remind.js rmdAutoItems）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → search → remind → test-runner → 本檔
//
// 這張卡的價值在「只講不一樣的事」，所以最在意兩個方向都不能錯：
//  ① 該進來的不能漏 —— 尤其**併班補課**：它不長成課堂（展開器看不到），只有紀錄裡有。
//     這裡若照抄 expandMakeupForRange，小明今天要去 B 班補課這件事會安靜地消失
//  ② 不該進來的不能進 —— 一般課程照上就不該佔位置，否則卡片變成第二份今日課程表

// 週二 19:00 國二數學班（小明/小華/小美・李老師・小教室）＝課程 7
// 週四 19:00 國二數學B班（小龍/小虎・李老師・108）＝課程 8
// 2026-08-11＝週二、2026-08-13＝週四、2026-08-14＝週五
function resetRmd() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' },
                  { id: 3, name: '小美', grade: '國二' }, { id: 4, name: '小龍', grade: '國二' },
                  { id: 5, name: '小虎', grade: '國二' }],
    enrollments: [
      ...[1, 2, 3].map(sid => ({ studentId: sid, courseId: 7, periodId: yearPeriodId('summer') })),
      ...[4, 5].map(sid => ({ studentId: sid, courseId: 8, periodId: yearPeriodId('summer') })),
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }],
    courses: [
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 8, name: '國二數學B班', type: '團班', room: '108', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '19:00', end: '20:30' }], phases: [] } },
    ],
    absences: [],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';
  rmdList = [];
  makeupList = sysAbsenceEvents();
}

// 三人在 8/11 全請假（整堂沒上）
function rmdLeaveAll() {
  driveData.absences = [{
    id: 1, occId: 'sys:7:2026-08-11:0', courseId: 7, date: new Date(2026, 7, 11, 19, 0).toISOString(),
    teacherAbsent: false, noShow: [], makeupSkip: [],
    leave: [{ studentId: 1, name: '小明', timing: 'A' },
            { studentId: 2, name: '小華', timing: 'A' },
            { studentId: 3, name: '小美', timing: 'A' }],
  }];
  makeupList = sysAbsenceEvents();
  return makeupList.find(e => e.id === 'sys:7:2026-08-11:0');
}
function rmdOccOf(courseId, y, m, d) {
  return expandCoursesForRange(new Date(y, m, d, 0, 0), new Date(y, m, d, 23, 59))
    .find(o => o.courseId === courseId);
}
function rmdItemsOn(y, m, d) { return rmdAutoItems(new Date(y, m, d)); }

// ────────────────────────────────────────────────────────
suite('今日重點：該進來的不能漏', () => {

  test('併班補課會出現（它不長成課堂，只有紀錄裡有）', () => {
    resetRmd();
    saveMakeupJoin(rmdLeaveAll(), rmdOccOf(8, 2026, 7, 13), ['小明']);
    const items = rmdItemsOn(2026, 7, 13);
    assertEq(items.length, 1);
    assertEq(items[0].tag, '併班補課');
    assertEq(items[0].time, '19:00');
    assertTrue(items[0].text.indexOf('小明') >= 0, '要講是誰來補：' + items[0].text);
    assertTrue(items[0].sub.indexOf('國二數學B班') >= 0, '要講併進哪堂：' + items[0].sub);
  });

  test('另開一場的補課會出現，帶教室與老師（提醒老師用）', () => {
    resetRmd();
    saveMakeupScheduled(rmdLeaveAll(), new Date(2026, 7, 13, 14, 0), new Date(2026, 7, 13, 15, 30),
      '309', null, '補課', ['小華']);
    const items = rmdItemsOn(2026, 7, 13);
    assertEq(items.length, 1);
    assertEq(items[0].tag, '補課');
    assertEq(items[0].time, '14:00');
    assertEq(items[0].sub, '309・李老師');
  });

  test('整堂請假 → 今天不上；補課還沒排時要講', () => {
    resetRmd();
    rmdLeaveAll();
    const items = rmdItemsOn(2026, 7, 11);
    assertEq(items.length, 1);
    assertEq(items[0].tag, '整堂請假');
    assertTrue(items[0].text.indexOf('今天不上') >= 0, items[0].text);
    assertTrue(items[0].sub.indexOf('補課還沒排') >= 0, items[0].sub);
  });

  test('排好補課後，原本那天就不再喊「補課還沒排」', () => {
    resetRmd();
    saveMakeupScheduled(rmdLeaveAll(), new Date(2026, 7, 13, 14, 0), new Date(2026, 7, 13, 15, 30),
      '309', null, '補課');
    const items = rmdItemsOn(2026, 7, 11);
    assertEq(items.length, 1);
    assertFalse(items[0].sub.indexOf('補課還沒排') >= 0, items[0].sub);
  });

  test('調課：原本那天講「今天不上・已改到 X」', () => {
    resetRmd();
    driveData.absences = [{
      id: 2, occId: 'sys:8:2026-08-13:0', courseId: 8, date: new Date(2026, 7, 13, 19, 0).toISOString(),
      resched: true, teacherAbsent: false, leave: [], noShow: [], makeupSkip: [],
    }];
    makeupList = sysAbsenceEvents();
    saveMakeupScheduled(makeupList.find(e => e.id === 'sys:8:2026-08-13:0'),
      new Date(2026, 7, 14, 19, 0), new Date(2026, 7, 14, 20, 30), '108', null, '調課');
    const thu = rmdItemsOn(2026, 7, 13);
    assertEq(thu.length, 1);
    assertEq(thu[0].tag, '調課');
    assertTrue(thu[0].sub.indexOf('8/14') >= 0, '要講改到哪天：' + thu[0].sub);
    // 移過去的那天則長出調課場次
    const fri = rmdItemsOn(2026, 7, 14);
    assertEq(fri.length, 1);
    assertEq(fri[0].tag, '調課');
    assertEq(fri[0].time, '19:00');
  });

  test('課照上、只有一個人請假 → 只講誰沒來，不重複列這堂課', () => {
    resetRmd();
    driveData.absences = [{
      id: 3, occId: 'sys:7:2026-08-11:0', courseId: 7, date: new Date(2026, 7, 11, 19, 0).toISOString(),
      teacherAbsent: false, noShow: [], makeupSkip: [],
      leave: [{ studentId: 1, name: '小明', timing: 'A' }],
    }];
    makeupList = sysAbsenceEvents();
    const items = rmdItemsOn(2026, 7, 11);
    assertEq(items.length, 1);
    assertEq(items[0].tag, '請假');
    assertTrue(items[0].text.indexOf('小明') >= 0 && items[0].text.indexOf('沒來') >= 0, items[0].text);
  });
});

// ────────────────────────────────────────────────────────
suite('今日重點：不該進來的不能進', () => {

  test('一般課程照上 → 不進重點卡（否則變成第二份今日課程表）', () => {
    resetRmd();
    assertEq(rmdItemsOn(2026, 7, 11).length, 0);   // 週二有國二數學班
    assertEq(rmdItemsOn(2026, 7, 13).length, 0);   // 週四有國二數學B班
  });

  test('補課排在別天 → 不會混進今天', () => {
    resetRmd();
    saveMakeupScheduled(rmdLeaveAll(), new Date(2026, 7, 13, 14, 0), new Date(2026, 7, 13, 15, 30),
      '309', null, '補課', ['小華']);
    const fri = rmdItemsOn(2026, 7, 14);
    assertEq(fri.length, 0);
  });
});

// ────────────────────────────────────────────────────────
suite('今日重點：手寫提醒與自動項目排在同一條時間軸', () => {

  test('沒填時間的排最前面（整天），其餘照時間排', () => {
    resetRmd();
    const ds = toDateStr(new Date(2026, 7, 13));
    // rmdItemsFor 讀的是「今天／明天」，這裡直接驗排序規則本身
    const notes = [
      { id: 'a', date: ds, time: '', text: '記得訂便當', byName: '王' },
      { id: 'b', date: ds, time: '15:00', text: '面試 王小明媽媽', byName: '王' },
    ];
    saveMakeupJoin(rmdLeaveAll(), rmdOccOf(8, 2026, 7, 13), ['小明']);   // 19:00
    const merged = [
      ...notes.map(r => ({ mins: rmdMins(r.time), time: r.time, cls: 'note', tag: '提醒', text: r.text, rec: r })),
      ...rmdItemsOn(2026, 7, 13),
    ].sort((a, b) => a.mins - b.mins);
    assertEqDeep(merged.map(x => x.time), ['', '15:00', '19:00']);
  });

  test('複製出去的文字：沒填時間的講「整天」', () => {
    resetRmd();
    assertEq(rmdMins(''), -1);
    assertEq(rmdMins('9:05'), 545);
    assertEq(rmdMins('19:00'), 1140);
  });
});
