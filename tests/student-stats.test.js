// 學生卡片出缺勤統計測試（students.js getStudentStats / hasThresholdWarning）
// 規則：按「哪一門課」分組，不是按課名字串——舊行事曆搬來的紀錄課名停在改年級之前
//       （寫「高一數學班」但那批人現在在「高二數學班」），照字串分會把同一門課拆成兩列。
//       多收費警示 2026-08-04 起不限團班，與標記請假時跳的提醒視窗同範圍。
// 載入順序：js/state.js → stubs → enrollment/schedule/courses/absence/makeup/students.js → test-runner → 本檔

const SS_CID = 1900000000000;      // 高二數學班（週五 18:00，淇倫＋臻亞）
const SS_CID2 = 1900000000001;     // 佳潼數學家教（週二 17:00，一對一）

function ssReset() {
  driveData = {
    studentList: [{ id: 1, name: '淇倫' }, { id: 2, name: '臻亞' }, { id: 3, name: '佳潼' }],
    courses: [
      { id: SS_CID, name: '高二數學班', type: '團班', status: '開課中', room: '大教室',
        schedule: { mode: 'weekly', slots: [{ weekday: 5, start: '18:00', end: '20:00' }] } },
      { id: SS_CID2, name: '佳潼數學家教', type: '一對一', status: '開課中', room: '108',
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '17:00', end: '19:00' }] } },
    ],
    enrollments: [
      { id: 1, studentId: 1, courseId: SS_CID, periodId: '2025-summer' },
      { id: 2, studentId: 2, courseId: SS_CID, periodId: '2025-summer' },
      { id: 3, studentId: 3, courseId: SS_CID2, periodId: '2025-summer' },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [], teachers: [], absences: [],
  };
  currentPeriodId = 'summer';
  makeupMatchMap = new Map();
  makeupList = [];
}
function ssOcc(dateStr, courseId) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  return courseOccurrencesInRange(driveData.courses.find(c => c.id === courseId), day, day)[0];
}
function ssRefresh() { makeupList = sysAbsenceEvents().sort((a, b) => a.startDt - b.startDt); }
function ssMarkLeave(dateStr, courseId, names) {
  sysApplyAbsence(ssOcc(dateStr, courseId), { type: 'student', students: names, timing: 'A' });
  ssRefresh();
}
// 回填過的舊紀錄：courseId 已補上，但快照課名還是改年級之前的舊名字
function ssLegacyLeave(dateStr, title, names, courseId) {
  driveData.absences.push({
    id: Date.now() + Math.random(), occId: 'legacy:' + dateStr + ':' + title,
    courseId: courseId ?? null,
    date: new Date(dateStr + 'T18:00:00').toISOString(),
    snapshot: { title, start: dateStr + 'T18:00:00', end: dateStr + 'T20:00:00',
      students: ['淇倫', '臻亞'], classroom: '大教室', teacher: '王老師', type: 'group' },
    teacherAbsent: false, noShow: [], makeupSkip: [],
    leave: names.map(n => ({ studentId: driveData.studentList.find(s => s.name === n).id, name: n, timing: 'A' })),
  });
  ssRefresh();
}
const ssRows = sid => Object.values(getStudentStats(sid, 'summer').byCourse);

suite('學生卡片出缺勤（分組與多收費警示）', () => {

  test('回填過的舊紀錄與新紀錄併成同一列，標現在的課名', () => {
    ssReset();
    ssLegacyLeave('2026-07-10', '高一數學班', ['淇倫'], SS_CID);   // 舊課名，courseId 已回填
    ssMarkLeave('2026-08-07', SS_CID, ['淇倫']);                   // 新紀錄
    const rows = ssRows(1);
    assertEq(rows.length, 1, '同一門課只該有一列');
    assertEq(rows[0].label, '高二數學班', '標現在的課名，不是快照裡的舊課名');
    assertEq(rows[0].studentAbs, 2);
  });

  test('沒回填到的舊紀錄（courseId 仍是 null）自成一列，標它自己的課名', () => {
    ssReset();
    ssLegacyLeave('2026-07-10', '高一數學班', ['淇倫'], null);
    ssMarkLeave('2026-08-07', SS_CID, ['淇倫']);
    const rows = ssRows(1).sort((a, b) => a.label.localeCompare(b.label));
    assertEq(rows.length, 2, '認不出是同一門課時不硬併');
    assertEqDeep(rows.map(r => r.label), ['高一數學班', '高二數學班']);
  });

  test('不同課程仍分開列', () => {
    ssReset();
    ssMarkLeave('2026-08-07', SS_CID, ['淇倫']);
    ssMarkLeave('2026-08-11', SS_CID2, ['佳潼']);
    assertEq(ssRows(1).length, 1);
    assertEq(ssRows(3).length, 1);
    assertEq(ssRows(3)[0].label, '佳潼數學家教');
  });

  test('多收費警示：家教（非團班）達門檻也要亮', () => {
    ssReset();
    ssMarkLeave('2026-07-14', SS_CID2, ['佳潼']);
    assertFalse(hasThresholdWarning(getStudentStats(3, 'summer'), 'summer'), '第 1 次不亮');
    ssMarkLeave('2026-08-11', SS_CID2, ['佳潼']);
    assertTrue(hasThresholdWarning(getStudentStats(3, 'summer'), 'summer'), '暑假第 2 次要亮（不限團班）');
  });

  test('多收費警示：團班照舊會亮，門檻同暑假 2 次', () => {
    ssReset();
    ssMarkLeave('2026-07-10', SS_CID, ['淇倫']);
    assertFalse(hasThresholdWarning(getStudentStats(1, 'summer'), 'summer'));
    ssMarkLeave('2026-08-07', SS_CID, ['淇倫']);
    assertTrue(hasThresholdWarning(getStudentStats(1, 'summer'), 'summer'));
  });

  test('拆兩列時各自計數，不會因為併不起來就誤達門檻', () => {
    ssReset();
    ssLegacyLeave('2026-07-10', '高一數學班', ['淇倫'], null);   // 沒回填 → 自成一列
    ssMarkLeave('2026-08-07', SS_CID, ['淇倫']);
    assertFalse(hasThresholdWarning(getStudentStats(1, 'summer'), 'summer'), '兩列各 1 次，都沒到 2 次');
  });

  test('併成一列後才達門檻（回填的價值）', () => {
    ssReset();
    ssLegacyLeave('2026-07-10', '高一數學班', ['淇倫'], SS_CID);  // 回填過 → 併進高二數學班
    ssMarkLeave('2026-08-07', SS_CID, ['淇倫']);
    assertTrue(hasThresholdWarning(getStudentStats(1, 'summer'), 'summer'), '併起來就是 2 次，該亮');
  });

  test('調課與老師請假不算進多收費次數', () => {
    ssReset();
    sysApplyAbsence(ssOcc('2026-07-10', SS_CID), { type: 'teacher', students: [] });
    ssRefresh();
    ssMarkLeave('2026-08-07', SS_CID, ['淇倫']);
    const row = ssRows(1)[0];
    assertEq(row.studentAbs, 1, '學生自己請假只有 1 次');
    assertEq(row.teacherAbs, 1);
    assertFalse(hasThresholdWarning(getStudentStats(1, 'summer'), 'summer'));
  });

});
