// 排補課時「學生那時段有沒有課」的判斷（2026-08-11 老闆要求）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 最在意的四條：
//  ① 學生自己那時段有課 → 抓得出來（以前只看教室與老師，會推薦他來不了的時段）
//  ② 沒修那堂的人不受影響（多人一起排時，只有真的撞到的那位算數）
//  ③ 他在那堂「本來就請假／曠課」＝人是空的，不算撞
//  ④ 已經排好的其他補課、以及併班補課，都算佔用（不然同一個人會被排兩場疊在一起）

// 週二 19:00 國二數學班（小明、小華，李老師）8/11 兩人請假 → 要在 8/13（週四）排補課。
// 週四當天：17:00–18:30 國二英文班（小明有修）、20:00–21:30 國二數學C班（小華有修）
function resetStuBusy() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' },
                  { id: 3, name: '小龍', grade: '國二' }],
    enrollments: [
      { studentId: 1, courseId: 7, periodId: yearPeriodId('summer') },
      { studentId: 2, courseId: 7, periodId: yearPeriodId('summer') },
      { studentId: 1, courseId: 9, periodId: yearPeriodId('summer') },
      { studentId: 2, courseId: 11, periodId: yearPeriodId('summer') },
      { studentId: 3, courseId: 9, periodId: yearPeriodId('summer') },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }, { id: 2, name: '張老師' }],
    courses: [
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 9, name: '國二英文班', type: '團班', room: '208', status: '開課中', teacherIds: [2],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '17:00', end: '18:30' }], phases: [] } },
      { id: 11, name: '國二數學C班', type: '團班', room: '309', status: '開課中', teacherIds: [2],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '20:00', end: '21:30' }], phases: [] } },
    ],
    absences: [{
      id: 1, occId: 'sys:7:2026-08-11:0', courseId: 7, date: new Date(2026, 7, 11, 19, 0).toISOString(),
      teacherAbsent: false, noShow: [], makeupSkip: [],
      leave: [{ studentId: 1, name: '小明', timing: 'A' }, { studentId: 2, name: '小華', timing: 'A' }],
    }],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';
  makeupList = sysAbsenceEvents();
}

function sbEv() { return makeupList.find(e => e.id === 'sys:7:2026-08-11:0'); }
// 週四那天課表上的全部（＝slot picker 的 avail：系統課堂＋已排的補課場次）
function sbAvail() {
  const s = new Date(2026, 7, 13, 0, 0), e = new Date(2026, 7, 13, 23, 59);
  return expandCoursesForRange(s, e).concat(expandMakeupForRange(s, e));
}
function sbBusy(names, h, mi, durH) {
  return mkStudentBusyAt(names, sbAvail(), new Date(2026, 7, 13, h, mi),
    new Date(2026, 7, 13, h + (durH || 1), mi), sbEv().id);
}
function sbCourseOcc(courseId) {
  return expandCoursesForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59))
    .find(o => o.courseId === courseId);
}

// ────────────────────────────────────────────────────────
suite('排補課：學生那時段有沒有課', () => {

  test('學生自己有課的時段抓得出來（撞到哪一堂也講得出）', () => {
    resetStuBusy();
    const busy = sbBusy(['小明'], 17, 0);
    assertEqDeep(busy.map(o => o.origTitle), ['國二英文班']);
  });

  test('空的時段就是空的（不誤判）', () => {
    resetStuBusy();
    assertEq(sbBusy(['小明'], 15, 0).length, 0);
  });

  test('沒修那堂的人不受影響', () => {
    resetStuBusy();
    assertEq(sbBusy(['小華'], 17, 0).length, 0);   // 英文班是小明的，不是小華的
  });

  test('多人一起排：只要有一個人撞到就算撞', () => {
    resetStuBusy();
    assertEqDeep(sbBusy(['小明', '小華'], 20, 0).map(o => o.origTitle), ['國二數學C班']);
  });

  test('說明字串講得出是誰、撞哪一堂', () => {
    resetStuBusy();
    const txt = mkStudentBusyTxt(['小明', '小華'], sbBusy(['小明', '小華'], 20, 0));
    assertTrue(txt.indexOf('小華') === 0, '要先講是誰：' + txt);
    assertTrue(txt.includes('國二數學C班'), '要講撞哪堂：' + txt);
  });
});

// ────────────────────────────────────────────────────────
suite('排補課：哪些情況不算「有課」', () => {

  test('他在那堂本來就請假 → 人是空的，不算撞', () => {
    resetStuBusy();
    driveData.absences.push({
      id: 2, occId: 'sys:9:2026-08-13:0', courseId: 9, date: new Date(2026, 7, 13, 17, 0).toISOString(),
      teacherAbsent: false, noShow: [], makeupSkip: [],
      leave: [{ studentId: 1, name: '小明', timing: 'A' }],
    });
    assertEq(sbBusy(['小明'], 17, 0).length, 0);
  });

  test('那堂整堂沒上（老師請假）→ 不算撞', () => {
    resetStuBusy();
    driveData.absences.push({
      id: 3, occId: 'sys:9:2026-08-13:0', courseId: 9, date: new Date(2026, 7, 13, 17, 0).toISOString(),
      teacherAbsent: true, noShow: [], makeupSkip: [], leave: [],
    });
    assertEq(sbBusy(['小明'], 17, 0).length, 0);
  });
});

// ────────────────────────────────────────────────────────
suite('排補課：已排好的補課也算佔用', () => {

  test('同一人另一場補課排在那時段 → 算他有課', () => {
    resetStuBusy();
    saveMakeupScheduled(sbEv(), new Date(2026, 7, 13, 15, 0), new Date(2026, 7, 13, 16, 0),
      '108', null, '補課', ['小明']);
    assertEq(sbBusy(['小明'], 15, 30).length, 1);
    assertEq(sbBusy(['小華'], 15, 30).length, 0);   // 那場不是小華的
  });

  test('併班補課的人也算佔用（人在主課那堂，卻沒有自己的場次）', () => {
    resetStuBusy();
    saveMakeupJoin(sbEv(), sbCourseOcc(11), ['小明']);   // 小明併進 20:00 數學C班
    assertEq(sbBusy(['小明'], 20, 0).length, 1);
    assertEq(sbBusy(['小龍'], 20, 0).length, 0);         // 沒併也沒修那堂的人不受影響
  });
});
