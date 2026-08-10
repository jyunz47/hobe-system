// dayview.js 拖曳課塊改時間／教室的寫入邏輯測試
// 載入順序：stubs（index.html 內）→ js/utils.js → js/enrollment.js → js/schedule.js
//           → js/dayview.js → test-runner.js → 本檔
//
// 只測「放開之後往資料寫了什麼」，不測滑鼠拖曳本身（那要真瀏覽器操作，去系統裡點）。
// 最在意的一條：**「從這天起都改」不可以動到更早的課堂**——那是老闆定的「從 X 起分段、
// 不回溯」原則，錯了會安靜地把上個月已經上過的課改掉，之後算學費/薪資全歪。

// 每個測試前重置：一門週二 19:00–20:30 的國二數學班，一位學生小明（2026 暑假）
function resetDV(scheduleOver) {
  driveData = {
    studentList: [{ id: 1, name: '小明' }],
    enrollments: [{ studentId: 1, courseId: 7, periodId: yearPeriodId('summer') }],
    makeupScheduled: [], absences: [], coursePrices: [], courseSettings: [], teachers: [],
    courses: [{
      id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中',
      schedule: scheduleOver || { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] },
    }],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = [];
  currentPeriodId = 'summer';
}

// 某天展開出來的課堂 → [[起, 迄, 教室], ...]
function occOn(y, m, d) {
  const day = new Date(y, m - 1, d);
  return courseOccurrencesInRange(findCourseById(7), day, day)
    .map(o => [fmtT(o.startDt), fmtT(o.endDt), o.classroom]);
}

// 模擬「把 occDate 那堂拖到 newStart–newEnd / room，然後按下 how 那顆鈕」
function dragTo(occDate, newStart, newEnd, room, how) {
  const day = new Date(occDate + 'T00:00:00');
  const ev = courseOccurrencesInRange(findCourseById(7), day, day)[0];
  if (!ev) throw new Error('那天沒有課堂：' + occDate);
  const s = new Date(newStart), en = new Date(newEnd);
  const co = findCourseById(ev.courseId);
  const p = {
    ev, s, en, room, co, weekly: co.schedule.mode !== 'dates',
    from: new Date(Math.min(_dvMidnight(ev.startDt).getTime(), _dvMidnight(s).getTime())),
  };
  return { Series: _dvMoveSeries, Once: _dvMoveOnce, Dates: _dvMoveDates }[how](p);
}

// ────────────────────────────────────────────────────────
suite('拖曳「從這天起都改」：加一段 phase，更早的課堂不動', () => {

  test('8/11 拖到 20:00 → 8/4 還是 19:00、8/11 起變 20:00', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-11T20:00:00', '2026-08-11T21:30:00', '小教室', 'Series');
    assertEqDeep(occOn(2026, 8, 4), [['19:00', '20:30', '小教室']]);   // 改動日之前
    assertEqDeep(occOn(2026, 8, 11), [['20:00', '21:30', '小教室']]);  // 當天
    assertEqDeep(occOn(2026, 8, 18), [['20:00', '21:30', '小教室']]);  // 之後每週
  });

  test('原始 slots 原封不動，改動寫在 phases 裡', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-11T20:00:00', '2026-08-11T21:30:00', '小教室', 'Series');
    assertEqDeep(findCourseById(7).schedule.slots, [{ weekday: 2, start: '19:00', end: '20:30' }]);
    assertEqDeep(findCourseById(7).schedule.phases,
      [{ from: '2026-08-11', slots: [{ weekday: 2, start: '20:00', end: '21:30' }] }]);
  });

  test('同一天再拖一次 → 更新同一段，不會長出第二段', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-11T20:00:00', '2026-08-11T21:30:00', '小教室', 'Series');
    dragTo('2026-08-11', '2026-08-11T20:30:00', '2026-08-11T22:00:00', '小教室', 'Series');
    assertEq(findCourseById(7).schedule.phases.length, 1);
    assertEqDeep(occOn(2026, 8, 11), [['20:30', '22:00', '小教室']]);
  });
});

// ────────────────────────────────────────────────────────
suite('跨日拖曳（週檢視換一天）：起算日取「原本那天」與「新那天」較早者', () => {

  test('週二 8/11 拖到週四 8/13 → 同一週的週二沒課、週四有課', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-13T19:00:00', '2026-08-13T20:30:00', '小教室', 'Series');
    assertEq(findCourseById(7).schedule.phases[0].from, '2026-08-11');
    assertEqDeep(occOn(2026, 8, 11), []);                              // 原本的週二讓出來
    assertEqDeep(occOn(2026, 8, 13), [['19:00', '20:30', '小教室']]);  // 同一週的週四長出來
    assertEqDeep(occOn(2026, 8, 4), [['19:00', '20:30', '小教室']]);   // 上一週不受影響
  });

  test('往前拖：週二 8/11 拖到 8/10（週一）→ 起算日＝8/10', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-10T19:00:00', '2026-08-10T20:30:00', '小教室', 'Series');
    assertEq(findCourseById(7).schedule.phases[0].from, '2026-08-10');
    assertEqDeep(occOn(2026, 8, 10), [['19:00', '20:30', '小教室']]);
    assertEqDeep(occOn(2026, 8, 11), []);
  });
});

// ────────────────────────────────────────────────────────
suite('拖曳「只改這一天」＝登記成調課，課程本體不動', () => {

  test('寫一筆 absences（resched 旗標）＋一筆調課場次', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-11T20:00:00', '2026-08-11T21:30:00', '108', 'Once');
    assertEq(driveData.absences.length, 1);
    assertEq(driveData.absences[0].occId, 'sys:7:2026-08-11:0');
    assertTrue(driveData.absences[0].resched);
    assertEq(_mkCalls.length, 1);
    assertEqDeep(_mkCalls[0].students, ['小明']);   // 調課場次要帶這堂的名冊
    assertEq(_mkCalls[0].room, '108');
    assertEq(_mkCalls[0].calName, '調課');
  });

  test('課程的時段與教室完全沒被改', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-11T20:00:00', '2026-08-11T21:30:00', '108', 'Once');
    assertEqDeep(findCourseById(7).schedule.slots, [{ weekday: 2, start: '19:00', end: '20:30' }]);
    assertEqDeep(findCourseById(7).schedule.phases, []);
    assertEq(findCourseById(7).room, '小教室');
  });

  test('原時段變成調課（畫刪除線），新場次長在 8/11 20:00 108', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-11T20:00:00', '2026-08-11T21:30:00', '108', 'Once');
    const day = new Date(2026, 7, 11);
    const orig = courseOccurrencesInRange(findCourseById(7), day, day)[0];
    assertTrue(orig.isRescheduled);
    assertTrue(orig.isFullAbsent);
    const mk = expandMakeupForRange(new Date(2026, 7, 11, 0, 0), new Date(2026, 7, 11, 23, 59))[0];
    assertEq(mk.calName, '調課');
    assertEq(fmtT(mk.startDt), '20:00');
    assertEq(mk.classroom, '108');
  });
});

// ────────────────────────────────────────────────────────
suite('換教室與其他排法', () => {

  test('「從這天起都改」換教室 → 整門課換（含以前的課堂顯示）', () => {
    // course.room 沒有分段，所以這是已知行為——確認視窗會先講明再讓人按
    resetDV();
    dragTo('2026-08-11', '2026-08-11T19:00:00', '2026-08-11T20:30:00', '108', 'Series');
    assertEq(findCourseById(7).room, '108');
    assertEq(occOn(2026, 8, 4)[0][2], '108');
  });

  test('指定日期課（試聽等單場）：直接改那個 slot 的日期與時間', () => {
    resetDV({ mode: 'dates', slots: [{ weekday: 1, start: '14:00', end: '15:30', date: '2026-08-12' }], phases: [] });
    dragTo('2026-08-12', '2026-08-14T16:00:00', '2026-08-14T17:30:00', '208', 'Dates');
    assertEqDeep(findCourseById(7).schedule.slots[0], { weekday: 1, start: '16:00', end: '17:30', date: '2026-08-14' });
    assertEq(findCourseById(7).room, '208');
    assertEqDeep(occOn(2026, 8, 12), []);
    assertEqDeep(occOn(2026, 8, 14), [['16:00', '17:30', '208']]);
  });

  test('補課／調課場次改期：改 makeupScheduled 那筆，快取也要同步', () => {
    resetDV();
    dragTo('2026-08-11', '2026-08-11T20:00:00', '2026-08-11T21:30:00', '108', 'Once'); // 先造一筆調課場次
    const mk = expandMakeupForRange(new Date(2026, 7, 11, 0, 0), new Date(2026, 7, 11, 23, 59))[0];
    _dvMoveMakeup({ ev: mk, s: new Date('2026-08-12T18:00:00'), en: new Date('2026-08-12T19:30:00'), room: '309' });
    const rec = driveData.makeupScheduled[0];
    assertEq(new Date(rec.scheduledDate).getDate(), 12);
    assertEq(new Date(rec.scheduledDate).getHours(), 18);
    assertEq(rec.room, '309');
    // O(1) 快取沒同步的話，畫面會繼續顯示舊教室
    assertEq(getMakeupsFor('sys:7:2026-08-11:0')[0].room, '309');
  });
});

// ────────────────────────────────────────────────────────
suite('拖曳的小工具與擋門員', () => {

  test('_dvSlotIdx：從 occId 解析這是第幾個時段', () => {
    assertEq(_dvSlotIdx('sys:7:2026-08-11:0'), 0);
    assertEq(_dvSlotIdx('sys:12:2026-08-11:3'), 3);
    assertEq(_dvSlotIdx('mk:sys:7:2026-08-11:0'), -1); // 補課場次沒有 slot 概念
  });

  test('_dvDragWhyNot：哪些可以拖、哪些擋下來', () => {
    assertEq(_dvDragWhyNot({ courseId: 7 }), null);                       // 一般系統課堂
    assertEq(_dvDragWhyNot({ isMakeupOcc: true, courseId: null }), null); // 補課／調課場次
    assertEq(typeof _dvDragWhyNot({ courseId: null }), 'string');         // 沒有對應系統課程
    assertEq(typeof _dvDragWhyNot({ isLegacyAbsence: true }), 'string');  // 舊行事曆快照
    assertEq(typeof _dvDragWhyNot({ courseId: 7, isRescheduled: true }), 'string'); // 已調課的原時段
  });
});
