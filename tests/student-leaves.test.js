// 畢業／離開＝課也跟著不見（schedule.js「那天沒人在籍就不長課堂」＋ students.js 狀態變更）
// 規則（2026-08-19 老闆定，需求 #16）：改狀態時把本期還在的修課「從那天起結束」
//   （enrollment.endDate，含當日），不是刪掉；課表那邊那天沒人在籍就不長課堂。
//   → 一對一的課整堂從課表消失、團班少一人照常上、過去的課堂與名冊完全不動。
// 只有「本期有人登記過」的課才套用：完全沒登記的課（剛建好還沒加人）照舊長出來。
// 載入順序：js/state.js → stubs → enrollment/schedule/courses/absence/makeup/students.js → test-runner → 本檔

const SL_ONE  = 1900000000020;   // 小明數學家教（週三 17:00，只有小明）
const SL_GRP  = 1900000000021;   // 國三數學班（週三 19:00，小明＋小華）
const SL_NEW  = 1900000000022;   // 剛建好、還沒加任何學生的課（週三 15:00）

function slReset() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '高三' }, { id: 2, name: '小華', grade: '國三' }],
    courses: [
      { id: SL_ONE, name: '小明數學家教', type: '一對一', status: '開課中', room: '108',
        schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '17:00', end: '19:00' }] } },
      { id: SL_GRP, name: '國三數學班', type: '團班', status: '開課中', room: '208',
        schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '19:00', end: '21:00' }] } },
      { id: SL_NEW, name: '新開的課', type: '團班', status: '開課中', room: '309',
        schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '15:00', end: '17:00' }] } },
    ],
    enrollments: [
      { id: 1, studentId: 1, courseId: SL_ONE, periodId: '2025-sem2' },
      { id: 2, studentId: 1, courseId: SL_GRP, periodId: '2025-sem2' },
      { id: 3, studentId: 2, courseId: SL_GRP, periodId: '2025-sem2' },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [], teachers: [], absences: [],
  };
  currentPeriodId = 'sem2';
  makeupMatchMap = new Map();
  makeupList = [];
}
// 某一天有哪幾門課長出來（課程編號）
function slCourseIdsOn(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  return expandCoursesForRange(day, day).map(o => o.courseId).sort();
}
function slRosterOn(courseId, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const occ = courseOccurrencesInRange(driveData.courses.find(c => c.id === courseId), day, day)[0];
  return occ ? occ.students : null;
}
// 模擬「畢業／離開」那一刀：本期還在的修課從那天起結束
function slEndCourses(studentId, dateStr) {
  const targets = statusEndTargets(studentId, dateStr);
  targets.forEach(en => { en.endDate = dateStr; });
  saveEnrollments(getEnrollments());
  return targets.length;
}

const SL_BEFORE = '2026-04-08';   // 結束日之前的週三
const SL_END    = '2026-04-15';   // 最後一天上課（週三，這天還算上課）
const SL_AFTER  = '2026-04-22';   // 隔週的週三

suite('畢業／離開：課跟著不見', () => {

  test('動手之前：三門課每週三都長得出來', () => {
    slReset();
    assertEqDeep(slCourseIdsOn(SL_AFTER), [SL_ONE, SL_GRP, SL_NEW].sort());
  });

  test('要結束的修課＝本期還在的那幾筆（本人的，不含別人）', () => {
    slReset();
    const targets = statusEndTargets(1, SL_END);
    assertEq(targets.length, 2, '小明的兩門課');
    assertEqDeep(targets.map(en => en.courseId).sort(), [SL_ONE, SL_GRP].sort());
  });

  test('最後一天當天照常上課（endDate 含當日）', () => {
    slReset();
    slEndCourses(1, SL_END);
    assertEqDeep(slRosterOn(SL_ONE, SL_END), ['小明']);
  });

  test('隔週起：只剩他一人的課整堂從課表消失', () => {
    slReset();
    slEndCourses(1, SL_END);
    assertEqDeep(slCourseIdsOn(SL_AFTER), [SL_GRP, SL_NEW].sort(), '一對一那門不再長出來');
  });

  test('團班只是少一個人，照常上', () => {
    slReset();
    slEndCourses(1, SL_END);
    assertEqDeep(slRosterOn(SL_GRP, SL_AFTER), ['小華']);
  });

  test('過去的課堂完全不動（名冊照樣有他）', () => {
    slReset();
    slEndCourses(1, SL_END);
    assertEqDeep(slRosterOn(SL_ONE, SL_BEFORE), ['小明'], '4/8 那堂還是他的');
    assertEqDeep(slRosterOn(SL_GRP, SL_BEFORE), ['小明', '小華']);
  });

  test('剛建好、本期完全沒有人登記的課照舊長出來（不然像壞掉）', () => {
    slReset();
    slEndCourses(1, SL_END);
    assertTrue(slCourseIdsOn(SL_AFTER).includes(SL_NEW));
  });

  test('團班的人全部離開 → 那門課也整堂消失', () => {
    slReset();
    slEndCourses(1, SL_END);
    slEndCourses(2, SL_END);
    assertEqDeep(slCourseIdsOn(SL_AFTER), [SL_NEW], '只剩沒人登記過的那門');
    assertEqDeep(slCourseIdsOn(SL_BEFORE).sort(), [SL_ONE, SL_GRP, SL_NEW].sort(), '過去照舊');
  });

  test('已經設過更早結束日的修課不會被往後推', () => {
    slReset();
    driveData.enrollments[0].endDate = '2026-03-31';    // 小明的家教早就停了
    const n = slEndCourses(1, SL_END);
    assertEq(n, 1, '只動還在的那一筆');
    assertEq(driveData.enrollments[0].endDate, '2026-03-31', '舊的結束日保持原樣');
  });

  test('暫停不走這條：statusEndTargets 只被畢業／離開叫用', () => {
    slReset();
    assertEqDeep(STATUS_ENDS_COURSES, ['畢業', '離開']);
  });

});
