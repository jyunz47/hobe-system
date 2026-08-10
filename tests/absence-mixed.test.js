// 「同一堂裡兩個人不同狀態」的資料層測試（2026-08-06）
// 背景：以前請假面板一次只能選一個時機、而且已經標過的人會從 chip 名單被濾掉
//       → 一人請假一人曠課做不到，想改某人的狀態也得先整堂取消請假重來。
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 最在意的四條：
//  ① 同一次確認可以一人請假、一人曠課（title、leave/noShow 兩組都要對）
//  ② 已經標過的人再標一次＝改狀態（要搬組，不能兩組都留著他）
//  ③ 曠課的人不進「請假次數提醒」，同批的請假的人照樣要跳
//  ④ 從請假改標成曠課時，他原本排好的補課要跟著撤（曠課不排補課）

const AM_CID = 1800000000000;   // 每週二 19:00–20:30 的團班「國二數學班」，三人

function amReset() {
  driveData = {
    studentList: [{ id: 1, name: '小明' }, { id: 2, name: '小華' }, { id: 3, name: '小美' }],
    courses: [{
      id: AM_CID, name: '國二數學班', type: '團班', subject: '數學', status: '開課中', room: '小教室',
      schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }] },
    }],
    enrollments: [1, 2, 3].map(sid => ({ id: sid, studentId: sid, courseId: AM_CID, periodId: '2025-summer' })),
    makeupScheduled: [], coursePrices: [], courseSettings: [], teachers: [], absences: [],
  };
  makeupMatchMap = new Map();
  currentPeriodId = 'summer';
  makeupList = [];
  _actCalls = [];
}
// 2026-08-11 是週二 → 那天那一堂（走真的展開器，才會疊上請假狀態）
function amOcc() {
  const day = new Date(2026, 7, 11);
  return courseOccurrencesInRange(driveData.courses[0], day, day)[0];
}
function amRefresh() { makeupList = sysAbsenceEvents(); }
// 面板選擇的形狀：students＝這批要標的人，timings＝每個人各自的時機
function amState(timings) {
  return { type: 'student', students: Object.keys(timings), timing: 'B', timings };
}

// ────────────────────────────────────────────────────────
suite('同一堂：一人請假、一人曠課', () => {

  test('absTimingOf：有個別設定用個別的，沒有才吃這批的共同值', () => {
    const st = { type: 'student', students: ['小明', '小華'], timing: 'B', timings: { 小明: 'A' } };
    assertEq(absTimingOf(st, '小明'), 'A');
    assertEq(absTimingOf(st, '小華'), 'B');
    assertEq(absTimingOf({ timing: 'C' }, '小美'), 'C', '沒有 timings 時退回共同值（程式呼叫端相容）');
    assertEq(absTimingOf({}, '小美'), null, '兩個都沒選 → null（不預設成 B，確認前會被擋下來）');
  });

  test('absMissingTiming：選了人卻沒選時機 → 列出是誰（老師請假不受影響）', () => {
    amReset();
    const ev = amOcc();
    const st = { type: 'student', students: ['小明', '小華'], timings: { 小明: 'A' } };
    assertEqDeep(absMissingTiming(ev, st), ['小華']);
    st.timings['小華'] = 'C';
    assertEqDeep(absMissingTiming(ev, st), []);
    assertEqDeep(absMissingTiming(ev, { type: 'teacher', students: [] }), []);
    assertEqDeep(absMissingTiming(ev, { type: 'student-auto', students: [] }), ['小明'],
      '一對一也一樣要選時機（名冊第一人）');
  });

  test('一次標兩人不同狀態 → 標題分成請假組與曠課組', () => {
    amReset();
    const res = computeAbsResult(amOcc(), amState({ 小明: 'A', 小華: 'C' }));
    assertEq(res.title, '【小明請假】【小華曠課】國二數學班');
    assertEq(res.timing['小明'], 'A');
    assertEq(res.timing['小華'], 'C');
  });

  test('一次標兩人不同狀態 → 寫進紀錄時 leave / noShow 各分各的', () => {
    amReset();
    sysApplyAbsence(amOcc(), amState({ 小明: 'A', 小華: 'C' }));
    const rec = driveData.absences.find(a => a.occId === amOcc().id);
    assertEqDeep(rec.leave.map(x => x.name), ['小明']);
    assertEqDeep(rec.noShow.map(x => x.name), ['小華']);
    assertEq(rec.leave[0].timing, 'A');
    assertEq(rec.leave[0].studentId, 1, '請假紀錄要帶 studentId（同名學生靠它分開）');
  });

  test('動態：同時機的人併一則、不同時機各記一則', () => {
    amReset();
    logAbsenceAct(amOcc(), amState({ 小明: 'A', 小華: 'A', 小美: 'C' }));
    assertEq(_actCalls.length, 2);
    assertEq(_actCalls[0].text, '標記 小明、小華 請假');
    assertEq(_actCalls[1].text, '標記 小美 曠課');
  });

});

suite('已經標過的人可以再標一次（改狀態，不用先取消請假）', () => {

  test('請假 → 曠課：搬組，不會兩組都留著他', () => {
    amReset();
    sysApplyAbsence(amOcc(), amState({ 小明: 'A' }));
    amRefresh();
    sysApplyAbsence(amOcc(), amState({ 小明: 'C' }));
    const rec = driveData.absences.find(a => a.occId === amOcc().id);
    assertEqDeep(rec.leave.map(x => x.name), []);
    assertEqDeep(rec.noShow.map(x => x.name), ['小明']);
  });

  test('曠課 → 請假：一樣搬回來，時機照新的存', () => {
    amReset();
    sysApplyAbsence(amOcc(), amState({ 小明: 'C' }));
    amRefresh();
    sysApplyAbsence(amOcc(), amState({ 小明: 'B' }));
    const rec = driveData.absences.find(a => a.occId === amOcc().id);
    assertEqDeep(rec.noShow.map(x => x.name), []);
    assertEqDeep(rec.leave.map(x => x.name), ['小明']);
    assertEq(rec.leave[0].timing, 'B');
  });

  test('只改一個人，另一個人的既有狀態原封不動', () => {
    amReset();
    sysApplyAbsence(amOcc(), amState({ 小明: 'A', 小華: 'A' }));
    amRefresh();
    sysApplyAbsence(amOcc(), amState({ 小華: 'C' }));   // 只點小華
    const rec = driveData.absences.find(a => a.occId === amOcc().id);
    assertEqDeep(rec.leave.map(x => x.name), ['小明']);
    assertEq(rec.leave[0].timing, 'A', '小明的時機不能被這批蓋掉');
    assertEqDeep(rec.noShow.map(x => x.name), ['小華']);
  });

  test('改成曠課的人不留「不補課」標記', () => {
    amReset();
    sysApplyAbsence(amOcc(), amState({ 小明: 'A', 小華: 'A' }));
    amRefresh();
    sysSetMakeupSkip(amOcc(), ['小明', '小華']);
    sysApplyAbsence(amOcc(), amState({ 小華: 'C' }));
    const rec = driveData.absences.find(a => a.occId === amOcc().id);
    assertEqDeep(rec.makeupSkip, ['小明']);
  });

  test('預覽標題把既有的人一起算進去（第二次標記不會蓋掉第一次）', () => {
    amReset();
    sysApplyAbsence(amOcc(), amState({ 小明: 'A' }));
    amRefresh();
    const res = computeAbsResult(makeupList[0], amState({ 小華: 'C' }));
    assertEq(res.title, '【小明請假】【小華曠課】國二數學班');
  });

});

suite('混合狀態下的下游：次數提醒與已排補課', () => {

  test('同一批裡曠課的不跳提醒、請假的照跳', () => {
    amReset();
    // 暑假門檻 2 次：先讓小明有一次請假紀錄（8/4 那堂，也是週二）
    const prevDay = new Date(2026, 7, 4);
    const prevOcc = courseOccurrencesInRange(driveData.courses[0], prevDay, prevDay)[0];
    sysApplyAbsence(prevOcc, amState({ 小明: 'A' }));
    sysApplyAbsence(prevOcc, amState({ 小華: 'A' }));
    amRefresh();
    const w = leaveThresholdWarnings(amOcc(), amState({ 小明: 'A', 小華: 'C' }));
    assertEqDeep(w.map(x => x.name), ['小明'], '小華這次是曠課 → 不算多收費');
    assertEq(w[0].count, 2);
  });

  test('請假改標成曠課 → 他那場補課跟著撤掉', () => {
    amReset();
    sysApplyAbsence(amOcc(), amState({ 小明: 'A', 小華: 'A' }));
    amRefresh();
    const ev = makeupList[0];
    saveMakeupScheduled(ev, new Date(2026, 7, 14, 17, 0), new Date(2026, 7, 14, 17, 45), '108', null, '補課', ['小明']);
    saveMakeupScheduled(ev, new Date(2026, 7, 15, 10, 0), new Date(2026, 7, 15, 10, 45), '208', null, '補課', ['小華']);
    assertEq(getMakeupsFor(ev.id).length, 2, '前提：兩人各排了一場');
    sysApplyAbsence(ev, amState({ 小明: 'C' }));
    dropMakeupsForNoShow(ev.id, ['小明']);
    const left = getMakeupsFor(ev.id);
    assertEq(left.length, 1);
    assertEqDeep(left[0].absentStudents, ['小華'], '只撤小明那場，小華那場留著');
  });

  test('一場補兩個人、只有一個改成曠課 → 那場留著、名單縮小', () => {
    amReset();
    sysApplyAbsence(amOcc(), amState({ 小明: 'A', 小華: 'A' }));
    amRefresh();
    const ev = makeupList[0];
    saveMakeupScheduled(ev, new Date(2026, 7, 14, 17, 0), new Date(2026, 7, 14, 17, 45), '108', null, '補課', ['小明', '小華']);
    sysApplyAbsence(ev, amState({ 小明: 'C' }));
    dropMakeupsForNoShow(ev.id, ['小明']);
    const left = getMakeupsFor(ev.id);
    assertEq(left.length, 1);
    assertEqDeep(left[0].absentStudents, ['小華']);
  });

  test('老師請假／調課那種「整堂一場、沒有個別名單」的場次不被誤撤', () => {
    amReset();
    sysApplyAbsence(amOcc(), { type: 'teacher', students: [] });
    amRefresh();
    const ev = makeupList[0];
    saveMakeupScheduled(ev, new Date(2026, 7, 14, 19, 0), new Date(2026, 7, 14, 20, 30), '小教室', null, '補課', []);
    dropMakeupsForNoShow(ev.id, ['小明']);
    assertEq(getMakeupsFor(ev.id).length, 1);
  });

});
