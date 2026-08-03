// 請假次數提醒測試（absence.js countStudentLeaves / leaveThresholdWarnings）
// 規則：同一門課、同一期別內，學生「自己請假」累計達門檻就提醒。
//       上下學期 3 次、寒暑假 2 次；調課／老師請假／曠課都不算。
//       期別看「那堂課的日期」，不是學生頁上面選的分頁。
// 載入順序：js/state.js → stubs（index.html 內）→ enrollment/schedule/absence.js → test-runner → 本檔

// 2025 學年（getSchoolYear stub 固定 2025）：下學期 2026-03-01~06-30、暑假 2026-07-01~08-31
const LT_COURSE_ID = 77;
function ltReset() {
  driveData = {
    studentList: [{ id: 1, name: '承軒' }, { id: 2, name: '子晴' }],
    courses: [], enrollments: [], makeupScheduled: [], coursePrices: [],
    absences: [],
  };
}
// 一筆請假紀錄：某天、某課、某些人請假
function ltLeave(dateStr, names, over) {
  return Object.assign({
    occId: 'sys:' + LT_COURSE_ID + ':' + dateStr + ':0',
    courseId: LT_COURSE_ID,
    date: new Date(dateStr + 'T16:00:00').toISOString(),
    teacherAbsent: false,
    leave: names.map(n => ({ studentId: driveData.studentList.find(s => s.name === n).id, name: n, timing: 'A' })),
    noShow: [],
  }, over);
}
// 假課堂：直接給名冊（不走登記簿，eventRosterWithId 對 courseId 反查會拿不到，
// 所以這裡測 leaveThresholdWarnings 時用 courseId=null 的路徑：students 陣列即名冊）
function ltEvent(dateStr, students) {
  return {
    id: 'sys:' + LT_COURSE_ID + ':' + dateStr + ':0',
    courseId: LT_COURSE_ID,
    origTitle: '國二數學班',
    startDt: new Date(dateStr + 'T16:00:00'),
    students: students.slice(),
    absentStudents: [], noShowStudents: [],
  };
}

suite('請假次數提醒（多收費門檻）', () => {

  test('getThreshold：上下學期 3 次、寒暑假 2 次', () => {
    assertEq(getThreshold('sem1'), 3);
    assertEq(getThreshold('sem2'), 3);
    assertEq(getThreshold('winter'), 2);
    assertEq(getThreshold('summer'), 2);
  });

  test('periodOfDate：課堂日期決定期別，跟 currentPeriodId 無關', () => {
    currentPeriodId = 'sem2';                                  // 學生頁停在下學期
    assertEq(periodOfDate(new Date('2026-08-03T16:00:00')).id, 'summer');
    assertEq(periodOfDate(new Date('2026-04-10T16:00:00')).id, 'sem2');
    assertEq(periodOfDate(new Date('2026-02-10T16:00:00')).id, 'winter');
    assertEq(periodOfDate(new Date('2025-10-01T16:00:00')).id, 'sem1');
  });

  test('countStudentLeaves：只數同一門課、同一期別、該學生的請假', () => {
    ltReset();
    const summer = periodOfDate(new Date('2026-08-03T16:00:00'));
    driveData.absences = [
      ltLeave('2026-07-08', ['承軒']),
      ltLeave('2026-07-22', ['承軒', '子晴']),
      ltLeave('2026-08-05', ['子晴']),
      ltLeave('2026-04-15', ['承軒']),                          // 下學期，不同期別 → 不算
      ltLeave('2026-07-15', ['承軒'], { courseId: 99 }),        // 別門課 → 不算
    ];
    assertEq(countStudentLeaves(LT_COURSE_ID, 1, '承軒', summer, null), 2);
    assertEq(countStudentLeaves(LT_COURSE_ID, 2, '子晴', summer, null), 2);
  });

  test('countStudentLeaves：調課／老師請假／曠課都不算', () => {
    ltReset();
    const summer = periodOfDate(new Date('2026-08-03T16:00:00'));
    driveData.absences = [
      ltLeave('2026-07-08', [], { teacherAbsent: true }),                     // 老師請假
      ltLeave('2026-07-15', [], { resched: true, reschedReason: '教室衝突' }), // 調課
      ltLeave('2026-07-22', [], { noShow: [{ studentId: 1, name: '承軒' }] }), // 曠課
      ltLeave('2026-07-29', ['承軒']),                                        // 真的請假
    ];
    assertEq(countStudentLeaves(LT_COURSE_ID, 1, '承軒', summer, null), 1);
  });

  test('countStudentLeaves：同名不同人靠 studentId 分開（不互相污染）', () => {
    ltReset();
    driveData.studentList = [{ id: 1, name: '承軒' }, { id: 5, name: '承軒' }];
    const summer = periodOfDate(new Date('2026-08-03T16:00:00'));
    driveData.absences = [
      { occId: 'a', courseId: LT_COURSE_ID, date: new Date('2026-07-08T16:00:00').toISOString(),
        leave: [{ studentId: 1, name: '承軒', timing: 'A' }], noShow: [] },
      { occId: 'b', courseId: LT_COURSE_ID, date: new Date('2026-07-15T16:00:00').toISOString(),
        leave: [{ studentId: 5, name: '承軒', timing: 'A' }], noShow: [] },
    ];
    assertEq(countStudentLeaves(LT_COURSE_ID, 1, '承軒', summer, null), 1);
    assertEq(countStudentLeaves(LT_COURSE_ID, 5, '承軒', summer, null), 1);
  });

  test('countStudentLeaves：舊紀錄沒有 studentId 時退回比名字', () => {
    ltReset();
    const summer = periodOfDate(new Date('2026-08-03T16:00:00'));
    driveData.absences = [
      { occId: 'a', courseId: LT_COURSE_ID, date: new Date('2026-07-08T16:00:00').toISOString(),
        leave: [{ studentId: null, name: '承軒', timing: 'A' }], noShow: [] },
    ];
    assertEq(countStudentLeaves(LT_COURSE_ID, 1, '承軒', summer, null), 1);
  });

  test('countStudentLeaves：排除本堂（避免重標時重複計數）', () => {
    ltReset();
    const summer = periodOfDate(new Date('2026-08-03T16:00:00'));
    driveData.absences = [ltLeave('2026-07-08', ['承軒']), ltLeave('2026-08-03', ['承軒'])];
    assertEq(countStudentLeaves(LT_COURSE_ID, 1, '承軒', summer,
      'sys:' + LT_COURSE_ID + ':2026-08-03:0'), 1);
  });

  test('暑假：第 1 次不提醒、第 2 次提醒', () => {
    ltReset();
    const ev = ltEvent('2026-08-03', ['承軒', '子晴', '宥澄']);
    assertEqDeep(leaveThresholdWarnings(ev, { type: 'student', students: ['承軒'], timing: 'A' }), []);
    driveData.absences = [ltLeave('2026-07-08', ['承軒'])];
    const w = leaveThresholdWarnings(ev, { type: 'student', students: ['承軒'], timing: 'A' });
    assertEq(w.length, 1);
    assertEq(w[0].name, '承軒');
    assertEq(w[0].count, 2);
    assertEq(w[0].period.id, 'summer');
    assertEq(w[0].threshold, 2);
  });

  test('下學期：第 2 次不提醒、第 3 次才提醒', () => {
    ltReset();
    const ev = ltEvent('2026-04-22', ['承軒', '子晴', '宥澄']);
    driveData.absences = [ltLeave('2026-03-04', ['承軒'])];
    assertEqDeep(leaveThresholdWarnings(ev, { type: 'student', students: ['承軒'], timing: 'A' }), []);
    driveData.absences.push(ltLeave('2026-03-18', ['承軒']));
    const w = leaveThresholdWarnings(ev, { type: 'student', students: ['承軒'], timing: 'A' });
    assertEq(w.length, 1);
    assertEq(w[0].count, 3);
    assertEq(w[0].threshold, 3);
  });

  test('超過門檻仍每次提醒，次數照實遞增', () => {
    ltReset();
    const ev = ltEvent('2026-08-19', ['承軒', '子晴']);
    driveData.absences = [ltLeave('2026-07-08', ['承軒']), ltLeave('2026-07-22', ['承軒']),
      ltLeave('2026-08-05', ['承軒'])];
    const w = leaveThresholdWarnings(ev, { type: 'student', students: ['承軒'], timing: 'A' });
    assertEq(w[0].count, 4);
  });

  test('一次標多人：只列出達門檻的那幾個', () => {
    ltReset();
    const ev = ltEvent('2026-08-03', ['承軒', '子晴']);
    driveData.absences = [ltLeave('2026-07-08', ['承軒'])];   // 承軒已 1 次、子晴 0 次
    const w = leaveThresholdWarnings(ev, { type: 'student', students: ['承軒', '子晴'], timing: 'A' });
    assertEqDeep(w.map(x => x.name), ['承軒']);
  });

  test('曠課（時機 C）與老師請假：都不跳提醒', () => {
    ltReset();
    const ev = ltEvent('2026-08-03', ['承軒', '子晴']);
    driveData.absences = [ltLeave('2026-07-08', ['承軒'])];
    assertEqDeep(leaveThresholdWarnings(ev, { type: 'student', students: ['承軒'], timing: 'C' }), []);
    assertEqDeep(leaveThresholdWarnings(ev, { type: 'teacher', students: [], timing: null }), []);
  });

  test('一對一（student-auto）：名冊第一人也照樣算', () => {
    ltReset();
    const ev = ltEvent('2026-08-03', ['承軒']);
    driveData.absences = [ltLeave('2026-07-08', ['承軒'])];
    const w = leaveThresholdWarnings(ev, { type: 'student-auto', students: [], timing: 'B' });
    assertEq(w.length, 1);
    assertEq(w[0].name, '承軒');
    assertEq(w[0].count, 2);
  });

});
