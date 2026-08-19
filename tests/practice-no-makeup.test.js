// 練習課不補課測試（makeup.js mkNoMakeupNeeded / mkPendingTotal、students.js getStudentStats）
// 規則（2026-08-19 老闆定）：練習課不收費 → 請假就是請假、不欠一堂。
//   不進待補課清單、不算欠課、標記完不再問「要現在排補課嗎」；請假紀錄本身照記。
// 兩個例外：①調課不在此列（整堂移到別的時間，練習課照樣要排得出新時間）
//           ②這條規則之前已經排好的場次，卡片留著（不然按不到「取消安排」＝孤兒場次）
// 載入順序：js/state.js → stubs → enrollment/schedule/courses/absence/makeup/students.js → test-runner → 本檔

const PN_PRAC = 1900000000010;   // 小明數學練習課（週三 17:00，練習課）
const PN_GRP  = 1900000000011;   // 國二數學班（週三 19:00，團班）
const PN_DAY  = '2026-04-15';    // 下學期的週三

function pnReset() {
  driveData = {
    studentList: [{ id: 1, name: '小明' }, { id: 2, name: '小華' }],
    courses: [
      { id: PN_PRAC, name: '小明數學練習課', type: '練習課', status: '開課中', room: '大教室',
        schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '17:00', end: '19:00' }] } },
      { id: PN_GRP, name: '國二數學班', type: '團班', status: '開課中', room: '108',
        schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '19:00', end: '21:00' }] } },
    ],
    enrollments: [
      { id: 1, studentId: 1, courseId: PN_PRAC, periodId: '2025-sem2', practiceSubject: '數學' },
      { id: 2, studentId: 2, courseId: PN_PRAC, periodId: '2025-sem2', practiceSubject: '理化' },
      { id: 3, studentId: 1, courseId: PN_GRP, periodId: '2025-sem2' },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [], teachers: [], absences: [],
  };
  currentPeriodId = 'sem2';
  makeupMatchMap = new Map();
  makeupList = [];
}
function pnOccOn(dateStr, courseId) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  return courseOccurrencesInRange(driveData.courses.find(c => c.id === courseId), day, day)[0];
}
function pnOcc(courseId) { return pnOccOn(PN_DAY, courseId); }
function pnRefresh() {
  makeupList = sysAbsenceEvents().sort((a, b) => a.startDt - b.startDt);
  rebuildMakeupMatchMap();
}
function pnMarkLeave(courseId, names) {
  sysApplyAbsence(pnOcc(courseId), { type: 'student', students: names, timing: 'A' });
  pnRefresh();
}
function pnMarkResched(courseId) {
  const occ = pnOcc(courseId);
  const rec = { id: Date.now() + Math.random(), occId: occ.id, courseId,
    date: toDateStr(occ.startDt), teacherAbsent: false, leave: [], noShow: [], makeupSkip: [],
    resched: true, reschedReason: '老師有事' };
  driveData.absences = [...driveData.absences, rec];
  pnRefresh();
}
// 幫某一堂補上一場已排好的補課（模擬這條規則上線前排的）
function pnScheduleMakeup(occId, who) {
  driveData.makeupScheduled = [...driveData.makeupScheduled, {
    id: 'mk-' + occId, originalId: occId,
    scheduledDate: new Date(2026, 3, 17, 17, 0).toISOString(),
    scheduledEnd: new Date(2026, 3, 17, 19, 0).toISOString(),
    room: '大教室', origTitle: '小明數學練習課', absentStudents: who, calName: '補課',
  }];
  pnRefresh();
}
const pnEv = courseId => makeupList.find(e => e.courseId === courseId);
const pnNow = () => new Date(2026, 3, 15, 12, 0);

suite('練習課不補課', () => {

  test('練習課的請假判定為「不用補」，一般課照舊要補', () => {
    pnReset();
    pnMarkLeave(PN_PRAC, ['小明']);
    pnMarkLeave(PN_GRP, ['小明']);
    assertTrue(mkNoMakeupNeeded(pnEv(PN_PRAC)), '練習課不補課');
    assertFalse(mkNoMakeupNeeded(pnEv(PN_GRP)), '團班照舊要補');
  });

  test('請假紀錄本身照記——兩堂都展開得出來、練習課那筆是 practice', () => {
    pnReset();
    pnMarkLeave(PN_PRAC, ['小明']);
    pnMarkLeave(PN_GRP, ['小明']);
    assertEq(makeupList.length, 2, '兩筆請假都在（拿掉的是補課義務，不是資料）');
    assertEq(pnEv(PN_PRAC).type, 'practice');
    assertEqDeep(pnEv(PN_PRAC).absentStudents, ['小明']);
  });

  test('待安排總數（側欄徽章／今日重點）只算一般課', () => {
    pnReset();
    pnMarkLeave(PN_PRAC, ['小明']);
    pnMarkLeave(PN_GRP, ['小明']);
    assertEq(mkPendingTotal(pnNow()), 1);
  });

  test('欠課不算練習課那一堂', () => {
    pnReset();
    pnMarkLeave(PN_PRAC, ['小明']);
    pnMarkLeave(PN_GRP, ['小明']);
    const st = getStudentStats(1, 'sem2');
    assertEq(st.total, 2, '請假次數照算兩筆');
    assertEq(st.owed, 1, '欠課只有團班那一堂');
    const rows = Object.values(st.byCourse);
    assertEq(rows.find(c => c.label === '小明數學練習課').owed, 0);
    assertEq(rows.find(c => c.label === '國二數學班').owed, 1);
  });

  test('練習課只有一人請假時，另一人的欠課也不受影響', () => {
    pnReset();
    pnMarkLeave(PN_PRAC, ['小華']);
    assertEq(getStudentStats(2, 'sem2').owed, 0);
    assertEq(mkPendingTotal(pnNow()), 0);
  });

  test('練習課的「調課」不在此列——整堂移到別的時間照樣要排', () => {
    pnReset();
    pnMarkResched(PN_PRAC);
    assertFalse(mkNoMakeupNeeded(pnEv(PN_PRAC)), '調課要排新時間');
    assertEq(mkPendingTotal(pnNow()), 1);
  });

  test('規則上線前已排好的練習課補課，卡片留著；取消那場之後自己退場', () => {
    pnReset();
    pnMarkLeave(PN_PRAC, ['小明']);
    const occId = pnEv(PN_PRAC).id;
    pnScheduleMakeup(occId, ['小明']);
    assertFalse(mkNoMakeupNeeded(pnEv(PN_PRAC)), '有場次就看得到，才按得到「取消安排」');
    driveData.makeupScheduled = [];
    pnRefresh();
    assertTrue(mkNoMakeupNeeded(pnEv(PN_PRAC)), '場次取消後回到「不用補」');
  });

  test('多收費警示不看練習課——請假再多也不會亮（不收費就不可能收過頭）', () => {
    pnReset();
    // 下學期門檻＝同一門課請假 3 次
    ['2026-04-15', '2026-04-22', '2026-04-29'].forEach(d => {
      sysApplyAbsence(pnOccOn(d, PN_PRAC), { type: 'student', students: ['小明'], timing: 'A' });
    });
    pnRefresh();
    const st = getStudentStats(1, 'sem2');
    assertEq(Object.values(st.byCourse)[0].studentAbs, 3, '請假次數照算');
    assertTrue(Object.values(st.byCourse)[0].isPractice, '標得出來是練習課');
    assertFalse(hasThresholdWarning(st, 'sem2'), '練習課不亮多收費');
    // 標記當下的提醒視窗也是同一條規則
    assertEqDeep(leaveThresholdWarnings(pnOccOn('2026-05-06', PN_PRAC),
      { type: 'student', students: ['小明'], timing: 'A' }), []);
  });

  test('同樣三次請假，一般課照舊亮多收費（對照組）', () => {
    pnReset();
    ['2026-04-15', '2026-04-22', '2026-04-29'].forEach(d => {
      sysApplyAbsence(pnOccOn(d, PN_GRP), { type: 'student', students: ['小明'], timing: 'A' });
    });
    pnRefresh();
    assertTrue(hasThresholdWarning(getStudentStats(1, 'sem2'), 'sem2'));
    assertEq(leaveThresholdWarnings(pnOccOn('2026-05-06', PN_GRP),
      { type: 'student', students: ['小明'], timing: 'A' }).length, 1);
  });

  test('「補課排哪天」小標籤：練習課整堂請假不掛「未安排補課」', () => {
    pnReset();
    pnMarkLeave(PN_PRAC, ['小明', '小華']);   // 全班請假＝整堂沒上
    assertTrue(pnEv(PN_PRAC).isFullAbsent, '前提：這堂算整堂沒上');
    assertEq(mkChipsHtml(pnEv(PN_PRAC)), '');
    pnMarkLeave(PN_GRP, ['小明']);            // 一對照組：團班單人＝整堂（名冊只有他）
    assertTrue(mkChipsHtml(pnEv(PN_GRP)).includes('未安排補課'), '一般課照舊要標');
  });

});
