// 排好的補課／調課要在課程卡上標出來（2026-08-12 老闆要求）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 卡片 HTML 那幾支（today.js tcardHtml / week.js wcardHtml）綁 DOM 太深不進測試，
// 所以測的是它們共用的唯一判斷入口：makeup.js 的 mkOccKind / mkOccFromWhen，
// 加上展開器有沒有把「原課什麼時候」帶上（schedule.js makeupFromDate）。
//
// 釘住的四件事：
//  ① 補課場次標「補課」、調課場次標「調課」——以前調課場次整個沒標籤（桌面日曆條件寫死 '補課'）
//  ② 一般課堂、以及被移走的原課堂**不可以**被標成場次（那兩個有自己的請假／調課標記）
//  ③ 併班補課不長場次，所以也沒有場次標籤（人是疊進主課名冊、標「補」）
//  ④ 舊紀錄沒存原課日期時只出標籤、不硬掰日期

// 週二 19:00–20:30 國二數學班（小明、小華）；8/11 兩人請假 → 8/13（週四）15:00 排一場補課
function resetMkOcc() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' }],
    enrollments: [
      { studentId: 1, courseId: 7, periodId: yearPeriodId('summer') },
      { studentId: 2, courseId: 7, periodId: yearPeriodId('summer') },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }],
    courses: [
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] } },
    ],
    absences: [{
      id: 1, occId: 'sys:7:2026-08-11:0', courseId: 7, date: new Date(2026, 7, 11, 19, 0).toISOString(),
      teacherAbsent: false, noShow: [], makeupSkip: [],
      leave: [{ studentId: 1, name: '小明', timing: 'A' }, { studentId: 2, name: '小華', timing: 'A' }],
    }],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _actCalls = [];
  currentPeriodId = 'summer';
  makeupList = sysAbsenceEvents();
}

function mkoEv() { return makeupList.find(e => e.id === 'sys:7:2026-08-11:0'); }
// 8/13（週四）15:00 排一場，calName 決定它是補課還是調課場次
function mkoSave(calName) {
  saveMakeupScheduled(mkoEv(), new Date(2026, 7, 13, 15, 0), new Date(2026, 7, 13, 16, 0),
    '108', null, calName || '補課', ['小明', '小華']);
}
function mkoOcc() {
  return expandMakeupForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59))[0];
}
// 8/11（二）那天的原課堂（展開器長出來的，帶著請假狀態）
function mkoOrig() {
  return expandCoursesForRange(new Date(2026, 7, 11, 0, 0), new Date(2026, 7, 11, 23, 59))[0];
}

// ────────────────────────────────────────────────────────
suite('補課／調課場次的卡片標記', () => {

  test('補課場次 → 標「補課」', () => {
    resetMkOcc();
    mkoSave('補課');
    assertEq(mkOccKind(mkoOcc()), '補課');
  });

  test('調課場次 → 標「調課」（以前這種場次沒有任何標籤）', () => {
    resetMkOcc();
    mkoSave('調課');
    assertEq(mkOccKind(mkoOcc()), '調課');
  });

  test('一般課堂沒有場次標籤', () => {
    resetMkOcc();
    const occ = expandCoursesForRange(new Date(2026, 7, 18, 0, 0), new Date(2026, 7, 18, 23, 59))[0];
    assertEq(mkOccKind(occ), '');
    assertEq(mkOccFromWhen(occ), '');
  });

  test('被移走的原課堂不算場次（它有自己的請假／調課標記）', () => {
    resetMkOcc();
    mkoSave('補課');
    assertEq(mkOccKind(mkoOrig()), '');
  });

  test('卡片講得出替哪一堂排的：原課 8/11（二）19:00', () => {
    resetMkOcc();
    mkoSave('補課');
    assertEq(mkOccFromWhen(mkoOcc()), '8/11（二）19:00');
    assertEq(mkOccFromTxt(mkoOcc()), '原課 8/11（二）19:00');
  });

  test('舊紀錄沒存原課日期 → 只出標籤、不硬掰日期', () => {
    resetMkOcc();
    mkoSave('補課');
    driveData.makeupScheduled = driveData.makeupScheduled.map(r => {
      const { originalDate, ...rest } = r; return rest;
    });
    rebuildMakeupMatchMap();
    assertEq(mkOccKind(mkoOcc()), '補課');
    assertEq(mkOccFromWhen(mkoOcc()), '');
    assertEq(mkOccFromTxt(mkoOcc()), '');
  });

  test('併班補課不長場次 → 沒有場次卡、也沒有場次標籤', () => {
    resetMkOcc();
    // 8/13（週四）沒有別的課，直接手捏一筆併班紀錄（形狀同 saveMakeupJoin）
    driveData.makeupScheduled = [{
      id: 'mk_join_1', kind: 'join', originalId: 'sys:7:2026-08-11:0', hostOccId: 'sys:9:2026-08-13:0',
      hostTitle: '國二數學C班', origTitle: '國二數學班', owedMins: 45,
      originalDate: new Date(2026, 7, 11, 19, 0).toISOString(),
      scheduledDate: new Date(2026, 7, 13, 20, 0).toISOString(),
      scheduledEnd: new Date(2026, 7, 13, 21, 30).toISOString(),
      room: '309', calEventId: null, absentStudents: ['小明'], calName: '補課',
    }];
    rebuildMakeupMatchMap();
    assertEq(expandMakeupForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59)).length, 0);
  });

});
