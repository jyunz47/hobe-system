// 請假次數提醒測試（absence.js countStudentLeaves / leaveThresholdWarnings）
// 規則：同一門課、同一期別內，學生「自己請假」累計達門檻就提醒。
//       上下學期 3 次、寒暑假 2 次；調課／老師請假／曠課都不算。
//       期別看「那堂課的日期」，不是學生頁上面選的分頁。
// 這裡走真的管線：driveData.absences → sysAbsenceEvents() → makeupList（跟學生卡片同一份）
// 載入順序：js/state.js → stubs（index.html 內）→ enrollment/schedule/courses/absence.js → test-runner → 本檔

// 2025 學年（getSchoolYear stub 固定 2025）：下學期 2026-03-01~06-30、暑假 2026-07-01~08-31
const LT_CID = 1700000000000;          // 每週五 17:00–19:00 的團班「國二數學班」
const LT_CID2 = 1700000000001;         // 另一門課，拿來確認不會跨課相加

function ltReset() {
  driveData = {
    studentList: [{ id: 1, name: '承軒' }, { id: 2, name: '子晴' }, { id: 3, name: '宥澄' }],
    courses: [
      { id: LT_CID, name: '國二數學班', type: '團班', subject: '數學', status: '開課中', room: '大教室',
        schedule: { mode: 'weekly', slots: [{ weekday: 5, start: '17:00', end: '19:00' }] } },
      { id: LT_CID2, name: '國二理化班', type: '團班', subject: '理化', status: '開課中', room: '小教室',
        schedule: { mode: 'weekly', slots: [{ weekday: 5, start: '19:00', end: '21:00' }] } },
    ],
    enrollments: [1, 2, 3].flatMap(sid => [
      { id: sid, studentId: sid, courseId: LT_CID, periodId: '2025-summer' },
      { id: sid + 10, studentId: sid, courseId: LT_CID, periodId: '2025-sem2' },
      { id: sid + 20, studentId: sid, courseId: LT_CID2, periodId: '2025-summer' },
    ]),
    makeupScheduled: [], coursePrices: [], courseSettings: [], teachers: [], absences: [],
  };
  currentPeriodId = 'summer';
  makeupList = [];
}
// 取某天那一堂課堂物件（走真的展開器）
function ltOcc(dateStr, courseId) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  const co = driveData.courses.find(c => c.id === (courseId || LT_CID));
  return courseOccurrencesInRange(co, day, day)[0];
}
// 走真的寫入路徑標一筆請假，然後重建 makeupList（＝loadMakeup 做的事）
function ltMarkLeave(dateStr, names, courseId) {
  sysApplyAbsence(ltOcc(dateStr, courseId), { type: 'student', students: names, timing: 'A' });
  ltRefresh();
}
function ltRefresh() { makeupList = sysAbsenceEvents().sort((a, b) => a.startDt - b.startDt); }
// 舊行事曆搬遷來的快照紀錄：courseId 是 null，課名存在 snapshot 裡
function ltLegacyLeave(dateStr, title, names) {
  driveData.absences.push({
    id: Date.now() + Math.random(), occId: 'legacy:' + dateStr, courseId: null,
    date: new Date(dateStr + 'T17:00:00').toISOString(),
    snapshot: { title, start: dateStr + 'T17:00:00', end: dateStr + 'T19:00:00',
      students: ['承軒', '子晴', '宥澄'], classroom: '大教室', teacher: '王老師', type: 'group' },
    teacherAbsent: false, noShow: [], makeupSkip: [],
    leave: names.map(n => ({ studentId: driveData.studentList.find(s => s.name === n).id, name: n, timing: 'A' })),
  });
  ltRefresh();
}
const LT_STATE = names => ({ type: 'student', students: names, timing: 'A' });

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
    currentPeriodId = 'summer';
  });

  test('暑假：第 1 次不提醒、第 2 次提醒', () => {
    ltReset();
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒'])), []);
    ltMarkLeave('2026-07-10', ['承軒']);
    const w = leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒']));
    assertEq(w.length, 1);
    assertEq(w[0].name, '承軒');
    assertEq(w[0].count, 2);
    assertEq(w[0].period.id, 'summer');
    assertEq(w[0].threshold, 2);
  });

  test('先標晚的日期、再標早的：一樣要跳（不看按的順序、不看日期先後）', () => {
    ltReset();
    ltMarkLeave('2026-08-14', ['承軒']);                        // 先標 8/14
    const w = leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒'])); // 再標 8/7
    assertEq(w.length, 1);
    assertEq(w[0].count, 2);
  });

  test('舊行事曆搬遷的紀錄（courseId 是 null）：靠課名認得出是同一門課', () => {
    ltReset();
    ltLegacyLeave('2026-07-10', '國二數學班', ['承軒']);
    const w = leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒']));
    assertEq(w.length, 1, 'courseId 是 null 的舊紀錄要算進來');
    assertEq(w[0].count, 2);
  });

  test('舊紀錄課名不同 → 是別門課，不相加', () => {
    ltReset();
    ltLegacyLeave('2026-07-10', '國一數學班', ['承軒']);
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒'])), []);
  });

  test('不同課程不相加', () => {
    ltReset();
    ltMarkLeave('2026-07-10', ['承軒'], LT_CID2);
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒'])), []);
  });

  test('不同期別不相加（下學期的請假不會算進暑假）', () => {
    ltReset();
    ltMarkLeave('2026-06-05', ['承軒']);                        // 下學期
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒'])), []);
  });

  test('下學期：第 2 次不提醒、第 3 次才提醒', () => {
    ltReset();
    ltMarkLeave('2026-03-06', ['承軒']);
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-04-24'), LT_STATE(['承軒'])), []);
    ltMarkLeave('2026-03-20', ['承軒']);
    const w = leaveThresholdWarnings(ltOcc('2026-04-24'), LT_STATE(['承軒']));
    assertEq(w.length, 1);
    assertEq(w[0].count, 3);
    assertEq(w[0].threshold, 3);
  });

  test('超過門檻仍每次提醒，次數照實遞增', () => {
    ltReset();
    ['2026-07-10', '2026-07-17', '2026-07-24'].forEach(d => ltMarkLeave(d, ['承軒']));
    assertEq(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒']))[0].count, 4);
  });

  test('調課不算', () => {
    ltReset();
    const occ = ltOcc('2026-07-10');
    driveData.absences.push({ id: 1, occId: occ.id, courseId: LT_CID, date: occ.startDt.toISOString(),
      teacherAbsent: false, leave: [], noShow: [], makeupSkip: [], resched: true, reschedReason: '教室衝突' });
    ltRefresh();
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒'])), []);
  });

  test('老師請假不算', () => {
    ltReset();
    sysApplyAbsence(ltOcc('2026-07-10'), { type: 'teacher', students: [] });
    ltRefresh();
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒'])), []);
  });

  test('曠課不算：舊的一筆曠課不進數、這次標曠課也不跳', () => {
    ltReset();
    sysApplyAbsence(ltOcc('2026-07-10'), { type: 'student', students: ['承軒'], timing: 'C' });
    ltRefresh();
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒'])), []);
    ltMarkLeave('2026-07-17', ['承軒']);                        // 真的請一次
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'),
      { type: 'student', students: ['承軒'], timing: 'C' }), [], '這次標曠課 → 不跳');
    assertEq(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒']))[0].count, 2, '標請假 → 第 2 次');
  });

  test('同一堂裡有人曠課有人請假：只有請假的那個被算', () => {
    ltReset();
    sysApplyAbsence(ltOcc('2026-07-10'), { type: 'student', students: ['承軒'], timing: 'A' });
    sysApplyAbsence(ltOcc('2026-07-10'), { type: 'student', students: ['子晴'], timing: 'C' });
    ltRefresh();
    assertEq(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒']))[0].count, 2);
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['子晴'])), []);
  });

  test('重標同一堂不會重複計數（排除本堂）', () => {
    ltReset();
    ltMarkLeave('2026-07-10', ['承軒']);
    ltMarkLeave('2026-08-07', ['子晴']);                        // 本堂已有別人請假 → 紀錄已存在
    const w = leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒']));
    assertEq(w[0].count, 2, '本堂那筆不該把承軒算進去，也不該把自己算兩次');
  });

  test('一次標多人：只列出達門檻的那幾個', () => {
    ltReset();
    ltMarkLeave('2026-07-10', ['承軒']);                        // 承軒已 1 次、子晴 0 次
    const w = leaveThresholdWarnings(ltOcc('2026-08-07'), LT_STATE(['承軒', '子晴']));
    assertEqDeep(w.map(x => x.name), ['承軒']);
  });

  // 名冊上有兩個同名時，請假紀錄只會掛到其中一個 studentId 上
  //（sysApplyAbsence 的「名字→id」對照表後者蓋前者，是既有的同名限制，見 todos「同名學生」）。
  // 這裡要守的是：次數不會被兩個人共用——一個算到 1，另一個就是 0。
  test('同名不同人靠 studentId 分開（不互相污染）', () => {
    ltReset();
    driveData.studentList = [{ id: 1, name: '承軒' }, { id: 3, name: '承軒' }];
    ltMarkLeave('2026-07-10', ['承軒']);
    const occ = ltOcc('2026-08-07'), p = periodOfDate(occ.startDt);
    assertEq(eventRosterWithId(occ).filter(r => r.name === '承軒').length, 2, '前提：名冊上真的有兩個同名');
    const counts = [1, 3].map(id => countStudentLeaves(occ, id, '承軒', p, occ.id));
    assertEqDeep(counts.slice().sort(), [0, 1], '一個人算到、另一個是 0，不會兩個人都被算');
  });

  test('一對一（student-auto）：名冊第一人也照樣算', () => {
    ltReset();
    ltMarkLeave('2026-07-10', ['承軒']);
    const w = leaveThresholdWarnings(ltOcc('2026-08-07'), { type: 'student-auto', students: [], timing: 'B' });
    assertEq(w.length, 1);
    assertEq(w[0].name, '承軒');
    assertEq(w[0].count, 2);
  });

  test('老師請假的那次標記本身不跳提醒', () => {
    ltReset();
    ltMarkLeave('2026-07-10', ['承軒']);
    assertEqDeep(leaveThresholdWarnings(ltOcc('2026-08-07'), { type: 'teacher', students: [], timing: null }), []);
  });

});
