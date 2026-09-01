// 換老師分段測試（courses.js courseTeacherPhases / courseTeacherIdsOn / courseTeacherNamesOn /
// courseAllTeacherIds，以及 schedule.js 展開課堂時吐出的 teacher 欄位）
//
// 為什麼要有這一套：課堂是「現算」出來的。老師欄位直接改掉的話，連已經上完、已經點過名的
// 課堂也會一起變成新老師——薪資表之後要吃這份資料，那就是錢會算錯。
// 分段的唯一硬保證：**生效日之前的課堂，老師不准變**。
//
// 載入順序：stubs（index.html 內）→ js/enrollment.js → js/schedule.js → js/courses.js → 本檔

function tpResetDriveData(courses) {
  currentPeriodId = 'sem2';
  driveData = {
    studentList: [{ id: 1, name: '承軒' }, { id: 2, name: '子晴' }],
    teachers: [
      { id: 1, name: '王老師', status: '在職' },
      { id: 2, name: '陳老師', status: '在職' },
      { id: 3, name: '林老師', status: '在職' },
    ],
    courses: courses || [],
    enrollments: [
      { id: 101, studentId: 1, courseId: 10, courseTitle: '承軒數學', periodId: '2025-sem2', startDate: null, endDate: null },
    ],
    makeupScheduled: [], coursePrices: [], absences: [],
  };
  _saveCount = 0;
}

// 每週三 16:00–18:00、王老師的課
function tpCourse(over) {
  return Object.assign({
    id: 10, name: '承軒數學', type: '一對一', subject: '數學', status: '開課中',
    teacherIds: [1],
    schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '16:00', end: '18:00' }] },
  }, over || {});
}

// 某一天那堂課展開出來的老師字串
function tpTeacherOnDay(y, m, d) {
  const day = new Date(y, m - 1, d);
  const occ = courseOccurrencesInRange(getCourses()[0], day, day);
  return occ.length ? occ[0].teacher : null;
}
// 撞課檢查看到的老師身分（mkTeacherIds 反查母課程時會依課堂日期取分段）
function tpBusyIdsOnDay(y, m, d) {
  const day = new Date(y, m - 1, d);
  const occ = courseOccurrencesInRange(getCourses()[0], day, day);
  return occ.length ? [...mkTeacherIds(occ[0])] : null;
}

// ────────────────────────────────────────────────────────
suite('courseTeacherIdsOn：某天由誰上', () => {

  test('沒有分段 → 一律回課程本體的老師', () => {
    tpResetDriveData([tpCourse()]);
    const co = getCourses()[0];
    assertEqDeep(courseTeacherIdsOn(co, '2026-01-01'), [1]);
    assertEqDeep(courseTeacherIdsOn(co, '2026-12-31'), [1]);
    assertEqDeep(courseTeacherIdsOn(co, null), [1]);
  });

  test('9/1 起換陳老師：8 月的課還是王老師，9 月起才是陳老師', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }] })]);
    const co = getCourses()[0];
    assertEqDeep(courseTeacherIdsOn(co, '2026-08-31'), [1]);
    assertEqDeep(courseTeacherIdsOn(co, '2026-09-01'), [2]);   // 生效日當天就算新的
    assertEqDeep(courseTeacherIdsOn(co, '2026-09-02'), [2]);
  });

  test('多段依日期接力，取「from<=那天」的最後一段', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [
      { from: '2026-09-01', teacherIds: [2] },
      { from: '2027-02-01', teacherIds: [3] },
    ] })]);
    const co = getCourses()[0];
    assertEqDeep(courseTeacherIdsOn(co, '2026-08-31'), [1]);
    assertEqDeep(courseTeacherIdsOn(co, '2026-11-15'), [2]);
    assertEqDeep(courseTeacherIdsOn(co, '2027-02-01'), [3]);
    assertEqDeep(courseTeacherIdsOn(co, '2028-01-01'), [3]);
  });

  test('分段順序寫顛倒也照日期排，不看陣列順序', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [
      { from: '2027-02-01', teacherIds: [3] },
      { from: '2026-09-01', teacherIds: [2] },
    ] })]);
    const co = getCourses()[0];
    assertEqDeep(courseTeacherIdsOn(co, '2026-11-15'), [2]);
    assertEqDeep(courseTeacherIdsOn(co, '2027-03-01'), [3]);
  });

  test('殘缺的分段（沒日期／沒老師／老師是空陣列）整段忽略，不會把老師洗成空白', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [
      { from: '', teacherIds: [2] },
      { from: '2026-09-01', teacherIds: [] },
      { from: '2026-10-01' },
    ] })]);
    const co = getCourses()[0];
    assertEq(courseTeacherPhases(co).length, 0);
    assertEqDeep(courseTeacherIdsOn(co, '2026-12-01'), [1]);
  });

  test('一段可以掛多位老師（協同教學）', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [{ from: '2026-09-01', teacherIds: [2, 3] }] })]);
    const co = getCourses()[0];
    assertEqDeep(courseTeacherNamesOn(co, '2026-09-05'), ['陳老師', '林老師']);
  });

  test('day 傳 Date 物件跟傳字串同結果', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }] })]);
    const co = getCourses()[0];
    assertEqDeep(courseTeacherIdsOn(co, new Date(2026, 8, 5)), courseTeacherIdsOn(co, '2026-09-05'));
    assertEqDeep(courseTeacherIdsOn(co, new Date(2026, 7, 5)), courseTeacherIdsOn(co, '2026-08-05'));
  });
});

// ────────────────────────────────────────────────────────
suite('課堂展開：老師依課堂日期取', () => {

  test('🔑 換老師不動歷史：8/26 那堂仍是王老師，9/2 才是陳老師', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }] })]);
    assertEq(tpTeacherOnDay(2026, 8, 26), '王老師');    // 週三
    assertEq(tpTeacherOnDay(2026, 9, 2), '陳老師');     // 週三
  });

  test('撞課檢查也吃分段（比的是 id 不是名字，反查母課程時要看課堂哪一天）', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }] })]);
    assertEqDeep(tpBusyIdsOnDay(2026, 8, 26), ['t:1']);
    assertEqDeep(tpBusyIdsOnDay(2026, 9, 2), ['t:2']);
  });

  test('沒有分段的課，每一堂都是課程本體的老師（舊資料照舊）', () => {
    tpResetDriveData([tpCourse()]);
    assertEq(tpTeacherOnDay(2026, 8, 26), '王老師');
    assertEq(tpTeacherOnDay(2026, 9, 2), '王老師');
    assertEq(tpTeacherOnDay(2027, 3, 3), '王老師');
  });

  test('換老師不影響課名、時段、名冊', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }] })]);
    const day = new Date(2026, 8, 2);
    const occ = courseOccurrencesInRange(getCourses()[0], day, day)[0];
    assertEq(occ.origTitle, '承軒數學');
    assertEq(occ.startDt.getHours(), 16);
    assertEq(occ.endDt.getHours(), 18);
    assertEqDeep(occ.students, ['承軒']);
  });

  test('換時段＋換老師同時生效，兩者互不干擾', () => {
    tpResetDriveData([tpCourse({
      teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }],
      schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '12:30', end: '14:30' }],
        phases: [{ from: '2026-09-01', slots: [{ weekday: 3, start: '19:00', end: '21:00' }] }] },
    })]);
    const d1 = new Date(2026, 7, 26), d2 = new Date(2026, 8, 2);
    const o1 = courseOccurrencesInRange(getCourses()[0], d1, d1)[0];
    const o2 = courseOccurrencesInRange(getCourses()[0], d2, d2)[0];
    assertEq(o1.teacher, '王老師');
    assertEq(o1.startDt.getHours(), 12);
    assertEq(o2.teacher, '陳老師');
    assertEq(o2.startDt.getHours(), 19);
  });
});

// ────────────────────────────────────────────────────────
suite('courseAllTeacherIds：這門課出現過的所有老師', () => {

  test('含分段裡的老師（不是只看今天）', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [
      { from: '2026-09-01', teacherIds: [2] },
      { from: '2027-02-01', teacherIds: [3] },
    ] })]);
    const ids = courseAllTeacherIds(getCourses()[0]).slice().sort();
    assertEqDeep(ids, [1, 2, 3]);
  });

  test('沒有分段時＝課程本體的老師', () => {
    tpResetDriveData([tpCourse()]);
    assertEqDeep(courseAllTeacherIds(getCourses()[0]), [1]);
  });

  test('同一位老師在多段重複出現只算一次', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [
      { from: '2026-09-01', teacherIds: [2] },
      { from: '2027-02-01', teacherIds: [1] },
    ] })]);
    const ids = courseAllTeacherIds(getCourses()[0]).slice().sort();
    assertEqDeep(ids, [1, 2]);
  });

  test('🔑 刪老師的擋門員看得到「之後才接手」的那位', () => {
    // taDelete 用的就是這一支：只看課程本體的話，陳老師會被當成沒課而准刪，
    // 刪完那門課 9 月起的老師欄就靜默變空白
    tpResetDriveData([tpCourse({ teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }] })]);
    const used = getCourses().filter(c => courseAllTeacherIds(c).includes(2));
    assertEq(used.length, 1);
  });
});

// ────────────────────────────────────────────────────────
// 表單裡「換時段」與「換老師」合併成同一張卡（老闆 2026-08-27 要求）：
// 存的還是兩份資料，卡片以生效日 from 當鑰匙把它們湊在一起，存檔時再拆回去。
suite('cfMergePhases：兩份分段 → 表單的一份合併清單', () => {

  test('同一天的時段與老師收進同一張卡', () => {
    tpResetDriveData([tpCourse({
      teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }],
      schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '12:30', end: '14:30' }],
        phases: [{ from: '2026-09-01', slots: [{ weekday: 3, start: '19:00', end: '21:00' }] }] },
    })]);
    const merged = cfMergePhases(getCourses()[0]);
    assertEq(merged.length, 1);
    assertEq(merged[0].from, '2026-09-01');
    assertEq(merged[0].slots.length, 1);
    assertEq(merged[0].slots[0].start, '19:00');
    assertEqDeep(merged[0].teachers, ['陳老師']);
  });

  test('只有時段的那天 → 老師區空的（＝不換人）', () => {
    tpResetDriveData([tpCourse({
      schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '12:30', end: '14:30' }],
        phases: [{ from: '2026-09-01', slots: [{ weekday: 3, start: '19:00', end: '21:00' }] }] },
    })]);
    const merged = cfMergePhases(getCourses()[0]);
    assertEq(merged.length, 1);
    assertEqDeep(merged[0].teachers, []);
  });

  test('只有老師的那天 → 時段區空的（＝不改時間）', () => {
    tpResetDriveData([tpCourse({ teacherPhases: [{ from: '2026-09-01', teacherIds: [2] }] })]);
    const merged = cfMergePhases(getCourses()[0]);
    assertEq(merged.length, 1);
    assertEqDeep(merged[0].slots, []);
    assertEqDeep(merged[0].teachers, ['陳老師']);
  });

  test('生效日不同的兩件事 → 兩張卡，依日期排序', () => {
    tpResetDriveData([tpCourse({
      teacherPhases: [{ from: '2027-02-01', teacherIds: [3] }],
      schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '12:30', end: '14:30' }],
        phases: [{ from: '2026-09-01', slots: [{ weekday: 3, start: '19:00', end: '21:00' }] }] },
    })]);
    const merged = cfMergePhases(getCourses()[0]);
    assertEq(merged.length, 2);
    assertEq(merged[0].from, '2026-09-01');
    assertEqDeep(merged[0].teachers, []);
    assertEq(merged[1].from, '2027-02-01');
    assertEqDeep(merged[1].slots, []);
  });

  test('一段分段都沒有的課 → 空清單（舊資料開表單不會冒出空卡）', () => {
    tpResetDriveData([tpCourse()]);
    assertEqDeep(cfMergePhases(getCourses()[0]), []);
  });

  test('拖曳「從這天起都改」寫進去的段（沒有老師）合併後不會憑空長出老師', () => {
    // _dvMoveSeries 只寫 schedule.phases，不碰 teacherPhases；表單讀進來再存回去不該誤動老師
    tpResetDriveData([tpCourse({
      teacherPhases: [{ from: '2027-02-01', teacherIds: [3] }],
      schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '12:30', end: '14:30' }],
        phases: [{ from: '2026-10-05', slots: [{ weekday: 3, start: '18:00', end: '20:00' }] }] },
    })]);
    const merged = cfMergePhases(getCourses()[0]);
    const oct = merged.find(p => p.from === '2026-10-05');
    assertEqDeep(oct.teachers, []);
    // 原本 2 月那段的老師還在，沒被 10 月那段吃掉
    assertEqDeep(merged.find(p => p.from === '2027-02-01').teachers, ['林老師']);
  });
});
