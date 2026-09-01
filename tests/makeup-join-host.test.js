// 「補課一起補」：已經排好的補課場次也能當併班主課（2026-09-01 老闆要求）
//
// 【在解什麼】
// 兩個**不同日期**請假的人想約在同一天同一時段一起補。以前併班的候選只認系統課
// （`courseId != null`），而補課場次的 courseId 就是 null——所以第二個人排補課時
// **看不到第一個人那場**，只能自己再開一場，課表上長出兩張卡、拖曳一次只搬得動一筆。
// 老闆 2026-08-12 實際踩到，2026-09-01 指名要修。
//
// 這裡守四件事：
//  ① 補課場次要出現在併班候選裡（而且同科目／同年級／同老師三個條件照樣把關）
//  ② 併進去的人要疊上那場的名冊——不然第二個人排完會整個看不見，比原本兩張卡更糟
//  ③ 課表上仍然只有一堂（併班本來就不另開場次）
//  ④ 主課被拖去改時間時，併進來的那幾筆時間快照要跟著動
//
// ⚠️ 頂層名稱一律加 jh 前綴：所有 .test.js 共用同一個全域範圍，撞名會讓整份檔案靜默不執行。

// 小明 9/1（週二）請假、小華 9/4（週五）請假，兩人同一門課的同學（國二數學班・李老師）。
// 想讓兩人 9/9（週三）19:00 一起補。
function jhReset() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' },
                  { id: 3, name: '小美', grade: '國二' }, { id: 9, name: '高二生', grade: '高二' }],
    enrollments: [
      ...[1, 2, 3].map(sid => ({ studentId: sid, courseId: 7, periodId: yearPeriodId('summer') })),
      { studentId: 9, courseId: 12, periodId: yearPeriodId('summer') },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }, { id: 2, name: '張老師' }],
    courses: [
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1], subject: '數學',
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' },
                                            { weekday: 5, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 12, name: '高二數學班', type: '團班', room: '108', status: '開課中', teacherIds: [2], subject: '數學',
        schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '19:00', end: '20:30' }], phases: [] } },
    ],
    absences: [
      { id: 1, occId: 'sys:7:2026-09-01:0', courseId: 7, date: new Date(2026, 8, 1, 19, 0).toISOString(),
        teacherAbsent: false, noShow: [], makeupSkip: [], leave: [{ studentId: 1, name: '小明', timing: 'A' }] },
      { id: 2, occId: 'sys:7:2026-09-04:1', courseId: 7, date: new Date(2026, 8, 4, 19, 0).toISOString(),
        teacherAbsent: false, noShow: [], makeupSkip: [], leave: [{ studentId: 2, name: '小華', timing: 'A' }] },
    ],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';
  makeupList = sysAbsenceEvents();
}

function jhAbs(occId) { return makeupList.find(e => e.id === occId); }
const JH_MING = 'sys:7:2026-09-01:0';       // 小明請假那堂
const JH_HUA = 'sys:7:2026-09-04:1';        // 小華請假那堂
// 9/9（週三）那天課表上有什麼（＝slot picker 的 avail）：系統課 ＋ 已排好的補課場次
function jhWed() {
  const s = new Date(2026, 8, 9, 0, 0), e = new Date(2026, 8, 9, 23, 59);
  return [...expandCoursesForRange(s, e), ...expandMakeupForRange(s, e)];
}
// 幫小明排一場 9/9 19:00–20:30 的補課，回傳那場的課堂物件
function jhMingMakeup() {
  const ev = jhAbs(JH_MING);
  saveMakeupScheduled(ev, new Date(2026, 8, 9, 19, 0), new Date(2026, 8, 9, 20, 30), '小教室', null, '補課', ['小明']);
  makeupList = sysAbsenceEvents();
  return jhWed().find(o => o.isMakeupOcc);
}

// ────────────────────────────────────────────────────────
suite('補課一起補：補課場次要能當併班主課', () => {

  test('🔑 小明的補課場次會出現在小華的併班候選裡', () => {
    jhReset();
    jhMingMakeup();
    const list = mkJoinCandidates(jhAbs(JH_HUA), jhWed(), ['小華']);
    const hit = list.find(c => c.occ.isMakeupOcc);
    assertTrue(!!hit, '補課場次要列得出來');
    assertTrue(hit.exact, '同科目、同年級、同老師 → 完全符合');
  });

  test('修好之前列不出來（濾掉 courseId==null 的那一行就是病因）', () => {
    jhReset();
    jhMingMakeup();
    // 重跑一次舊邏輯：只認系統課
    const old = jhWed().filter(o => o.courseId != null && o.id !== JH_HUA);
    assertEq(old.filter(o => o.isMakeupOcc).length, 0, '舊條件下補課場次一律被濾掉');
  });

  test('別門課的補課場次不會混進來（同科目同老師的條件照樣把關）', () => {
    jhReset();
    // 高二那門課是張老師、學生是高二生
    const ev = jhAbs(JH_MING);
    saveMakeupScheduled(jhAbs('sys:7:2026-09-04:1'), new Date(2026, 8, 9, 19, 0), new Date(2026, 8, 9, 20, 30),
      '小教室', null, '補課', ['小華']);
    makeupList = sysAbsenceEvents();
    const list = mkJoinCandidates(ev, jhWed(), ['小明']).filter(c => c.exact);
    assertTrue(list.every(c => c.occ.teacher !== '張老師'), '張老師的課不該是完全符合');
  });

  test('已經在那場名單上的人不會再被列（沒得補）', () => {
    jhReset();
    jhMingMakeup();
    const list = mkJoinCandidates(jhAbs(JH_MING), jhWed(), ['小明']);
    assertEq(list.filter(c => c.occ.isMakeupOcc).length, 0, '小明自己已經在那場了');
  });

  test('改期既有那場時，不會把自己列成可併入的對象', () => {
    jhReset();
    const occ = jhMingMakeup();
    const recId = occ.makeupRecId;
    const list = mkJoinCandidates(jhAbs(JH_MING), jhWed(), ['小明'], ['mk:' + recId]);
    assertEq(list.filter(c => c.occ.id === 'mk:' + recId).length, 0);
  });
});

suite('補課一起補：併進去的人要看得見', () => {

  // 小明先排好 9/9 那場，小華再併進去
  function jhBoth() {
    jhReset();
    const host = jhMingMakeup();
    saveMakeupJoin(jhAbs(JH_HUA), host, ['小華']);
    makeupList = sysAbsenceEvents();
    return jhWed().find(o => o.isMakeupOcc);
  }

  test('🔑 補課場次的名冊＝原本要補的人 ＋ 併進來的人', () => {
    const host = jhBoth();
    const roster = eventRoster(host);
    assertTrue(roster.includes('小明'), '本來就要補的人還在');
    assertTrue(roster.includes('小華'), '併進來的人要看得見（這條沒過等於整個功能沒用）');
    assertEq(roster.length, 2);
  });

  test('點名用的名冊也帶得到 studentId（同名終結）', () => {
    const host = jhBoth();
    const rows = eventRosterWithId(host);
    const hua = rows.find(r => r.name === '小華');
    assertTrue(!!hua, '小華要在點名名冊上');
    assertEq(hua.studentId, 2, 'studentId 要查得到，不然點不了名');
    assertTrue(hua.join, '要標得出來是併進來的');
  });

  test('🔑 課表上仍然只有一堂（併班不另開場次）', () => {
    jhBoth();
    const occs = jhWed().filter(o => o.isMakeupOcc);
    assertEq(occs.length, 1, '兩個人一場課，不是兩張卡');
  });

  test('沒有人併進來的補課場次，名冊就是原本那幾個（不會憑空多人）', () => {
    jhReset();
    const host = jhMingMakeup();
    assertEqDeep(eventRoster(host), ['小明']);
  });

  test('一般系統課的名冊沒被這次改動影響', () => {
    jhReset();
    const wed = new Date(2026, 8, 2, 0, 0);
    const occ = expandCoursesForRange(wed, new Date(2026, 8, 2, 23, 59)).find(o => o.courseId === 12);
    assertEqDeep(eventRoster(occ), ['高二生']);
  });
});

suite('補課一起補：主課改時間，併進來的要跟著搬', () => {

  function jhBothRecs() {
    jhReset();
    const host = jhMingMakeup();
    saveMakeupJoin(jhAbs(JH_HUA), host, ['小華']);
    makeupList = sysAbsenceEvents();
    return { hostOccId: host.id, hostRecId: host.makeupRecId };
  }

  test('🔑 拖走主課，併班紀錄的時間快照跟著改', () => {
    const { hostOccId } = jhBothRecs();
    const list = getMakeupScheduledLS().map(normalizeMakeupRec);
    const n = syncJoinSnapshots(list, hostOccId, new Date(2026, 8, 10, 15, 0), new Date(2026, 8, 10, 16, 30), '108');
    assertEq(n, 1, '有一筆併班要跟著搬');
    const join = list.find(r => isJoinRec(r));
    assertEq(new Date(join.scheduledDate).getHours(), 15);
    assertEq(new Date(join.scheduledEnd).getHours(), 16);
    assertEq(join.room, '108');
  });

  test('別堂主課的併班紀錄不會被搬到', () => {
    const { } = jhBothRecs();
    const list = getMakeupScheduledLS().map(normalizeMakeupRec);
    const n = syncJoinSnapshots(list, 'sys:99:2026-09-09:0', new Date(2026, 8, 10, 15, 0), new Date(2026, 8, 10, 16, 30), '108');
    assertEq(n, 0);
    const join = list.find(r => isJoinRec(r));
    assertEq(new Date(join.scheduledDate).getHours(), 19, '原本的時間不能被動到');
  });

  test('沒有人併進來時回 0，不會亂改別的紀錄', () => {
    jhReset();
    const host = jhMingMakeup();
    const list = getMakeupScheduledLS().map(normalizeMakeupRec);
    const before = JSON.stringify(list);
    assertEq(syncJoinSnapshots(list, host.id, new Date(2026, 8, 10, 15, 0), new Date(2026, 8, 10, 16, 30), '108'), 0);
    assertEq(JSON.stringify(list), before, '一個位元都不該動');
  });

  test('saveMakeupScheduled 會回傳這一場的 id（調課要用它改掛併班的人）', () => {
    jhReset();
    const id = saveMakeupScheduled(jhAbs(JH_MING), new Date(2026, 8, 9, 19, 0), new Date(2026, 8, 9, 20, 30),
      '小教室', null, '補課', ['小明']);
    assertTrue(id != null, '要回得出 id');
    assertTrue(getMakeupScheduledLS().some(r => r.id === id), 'id 要對得到那筆紀錄');
  });
});
