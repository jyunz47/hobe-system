// 日期列的「那天排不排得進去」統計（2026-08-13 老闆要求）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 最在意的四條：
//  ① 日期上寫的數字，要跟點進去之後「時段列真的亮著幾格」一模一樣
//     （寫「3 個時段」點進去卻全灰，比完全不標更糟——這是本檔最重要的一條）
//  ② 教室／老師／學生三種佔用都算進去（跟時段列同一套判斷，不是另寫的簡化版）
//  ③ 整天塞滿 → 0（日期會標「滿」並變淡）
//  ④ 換老師、換分校要重算（兩者都是「灰不灰」的判斷條件，快取不能混在一起）

// 週二 19:00–20:30 國二數學班（小明、小華，李老師，小教室）8/11 兩人請假
// → 要排補課。補課時長＝團班砍半＝45 分。目標日 8/13（週四）。
function resetDayAvail() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' }],
    enrollments: [
      { studentId: 1, courseId: 7, periodId: yearPeriodId('summer') },
      { studentId: 2, courseId: 7, periodId: yearPeriodId('summer') },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }, { id: 2, name: '張老師' }],
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
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';
  makeupList = sysAbsenceEvents();
  daEnterPicker();
}

const DA_DAY = '2026-08-13';   // 週四，8 月＝暑假平日 12:30–21:30

// 照 openSlotPicker 的樣子把狀態擺好（那支要 sp-title/sp-sub 這些 DOM，測試頁沒有）
function daEnterPicker(mode) {
  const ev = makeupList.find(e => e.id === 'sys:7:2026-08-11:0');
  slotPicker = { ev, mode: mode || 'makeup', date: null, time: null, room: null, avail: null,
    branch: '北投', students: null, recId: null, join: null, custom: null, teacherId: null };
  spAvailCache = {}; spDayCache = {};
}

// 加一堂 8/13 的課（用來製造教室／老師／學生的佔用）
function daAddCourse(o) {
  driveData.courses.push({
    id: o.id, name: o.name, type: o.type || '團班', room: o.room, status: '開課中',
    teacherIds: o.teacherIds || [2],
    schedule: { mode: 'weekly', slots: [{ weekday: 4, start: o.start, end: o.end }], phases: [] },
  });
  (o.students || []).forEach(sid =>
    driveData.enrollments.push({ studentId: sid, courseId: o.id, periodId: yearPeriodId('summer') }));
  makeupList = sysAbsenceEvents();
  daEnterPicker(slotPicker.mode);
}

// ① 的對照組：真的去跑 buildSpTimeSection，數「沒有 sp-na（沒被灰掉）」的格子有幾個。
// 這是使用者點進去之後看到的東西，日期上的數字必須跟它相等。
function daLitSlots(ds) {
  slotPicker = { ...slotPicker, date: ds, avail: spAvailFor(ds), time: null, room: null };
  const sec = buildSpTimeSection();
  return [...sec.querySelectorAll('.sp-time')].filter(el => !el.classList.contains('sp-na')).length;
}

// ────────────────────────────────────────────────────────
suite('日期列空檔統計：跟時段列同一套判斷', () => {

  test('沒有任何課的一天：數字＝時段列亮著的格數，最早＝開門時間', () => {
    resetDayAvail();
    const sum = spDaySummary(DA_DAY);
    assertTrue(sum.n > 0, '空的一天應該有得排，實際 ' + sum.n);
    assertEq(sum.first, '12:30');            // 8 月平日 12:30 開門
    assertEq(sum.n, daLitSlots(DA_DAY));
  });

  test('教室被佔走：數字跟著減，且仍等於時段列亮著的格數', () => {
    resetDayAvail();
    const before = spDaySummary(DA_DAY).n;
    // 四間小教室 + 大教室全部佔滿 14:00–16:00 → 那幾格沒有教室可用
    ['小教室', '108', '208', '309', '大教室'].forEach((r, i) =>
      daAddCourse({ id: 20 + i, name: '佔位' + i, room: r, start: '14:00', end: '16:00' }));
    const sum = spDaySummary(DA_DAY);
    assertTrue(sum.n < before, `教室被佔走後應該變少（${before} → ${sum.n}）`);
    assertEq(sum.n, daLitSlots(DA_DAY));
  });

  test('原班老師那時段有課：數字跟著減，且仍等於時段列亮著的格數', () => {
    resetDayAvail();
    const before = spDaySummary(DA_DAY).n;
    daAddCourse({ id: 30, name: '國三數學班', room: '108', start: '18:00', end: '19:30', teacherIds: [1] });
    const sum = spDaySummary(DA_DAY);
    assertTrue(sum.n < before, `老師撞課後應該變少（${before} → ${sum.n}）`);
    assertEq(sum.n, daLitSlots(DA_DAY));
  });

  test('要補的學生那時段有課：數字跟著減，且仍等於時段列亮著的格數', () => {
    resetDayAvail();
    const before = spDaySummary(DA_DAY).n;
    daAddCourse({ id: 40, name: '國二英文班', room: '208', start: '17:00', end: '18:30',
      teacherIds: [2], students: [1] });
    const sum = spDaySummary(DA_DAY);
    assertTrue(sum.n < before, `學生自己有課後應該變少（${before} → ${sum.n}）`);
    assertEq(sum.n, daLitSlots(DA_DAY));
  });
});

// ────────────────────────────────────────────────────────
suite('日期列空檔統計：滿的一天與併班', () => {

  test('原班老師整天都有課 → 0（日期會標「滿」）', () => {
    resetDayAvail();
    daAddCourse({ id: 50, name: '整天班', room: '108', start: '12:30', end: '21:30', teacherIds: [1] });
    const sum = spDaySummary(DA_DAY);
    assertEq(sum.n, 0);
    assertEq(sum.first, null);
    assertEq(daLitSlots(DA_DAY), 0);
  });

  test('當天有同科同年級同老師的課 → 標得出可併班', () => {
    resetDayAvail();
    assertEq(spDaySummary(DA_DAY).join, 0);
    daAddCourse({ id: 60, name: '國二數學B班', room: '108', start: '17:00', end: '18:30',
      teacherIds: [1], students: [] });
    driveData.enrollments.push({ studentId: 2, courseId: 60, periodId: yearPeriodId('summer') });
    makeupList = sysAbsenceEvents(); daEnterPicker();
    assertEq(spDaySummary(DA_DAY).join, 1);
  });

  test('調課（整堂移走）不走併班那條路', () => {
    resetDayAvail();
    driveData.absences[0].resched = true;
    makeupList = sysAbsenceEvents(); daEnterPicker('reschedule');
    daAddCourse({ id: 61, name: '國二數學B班', room: '108', start: '17:00', end: '18:30', teacherIds: [1] });
    assertEq(spDaySummary(DA_DAY).join, 0);
  });
});

// ────────────────────────────────────────────────────────
// 日期列本體（buildSpDateSection）：14 顆 chip 每顆都要帶標記，上面那行摘要要講得出最早哪天
suite('日期列畫出來的樣子', () => {

  test('14 顆日期每顆都帶一個空檔標記', () => {
    resetDayAvail();
    const sec = buildSpDateSection();
    assertEq(sec.querySelectorAll('.sp-date').length, 14);
    assertEq(sec.querySelectorAll('.sp-date .sp-date-av').length, 14);
  });

  test('排不進去的那天標「滿」並變淡', () => {
    resetDayAvail();
    daAddCourse({ id: 80, name: '整天班', room: '108', start: '12:30', end: '21:30', teacherIds: [1] });
    const sec = buildSpDateSection();
    // 8/13 是今天(8/13)起算的第 0 顆；週四每週一次，14 天內會中兩顆（8/13、8/20）
    const full = [...sec.querySelectorAll('.sp-date.sp-date-full')];
    assertTrue(full.length >= 1, '應該至少有一天標成滿');
    assertTrue(full.every(el => el.querySelector('.sp-av-0')), '滿的那幾天要標「滿」');
  });

  test('摘要行講得出有幾天排得進去、最早哪一天', () => {
    resetDayAvail();
    const txt = buildSpDateSection().querySelector('.sp-date-sum').textContent;
    assertTrue(txt.includes('接下來 14 天'), '摘要行內容：' + txt);
    assertTrue(txt.includes('天排得進去'), '摘要行內容：' + txt);
    assertTrue(txt.includes('最早'), '摘要行內容：' + txt);
  });

  test('14 天全滿 → 摘要行改指路到「自訂時段」，不留空白', () => {
    resetDayAvail();
    // 原班老師天天整天有課 → 每一天都排不進去
    [1, 2, 3, 4, 5, 6, 0].forEach(wd => driveData.courses.push({
      id: 90 + wd, name: '整天班' + wd, type: '團班', room: '108', status: '開課中', teacherIds: [1],
      schedule: { mode: 'weekly', slots: [{ weekday: wd, start: '09:00', end: '21:30' }], phases: [] },
    }));
    makeupList = sysAbsenceEvents(); daEnterPicker();
    const sec = buildSpDateSection();
    assertEq(sec.querySelectorAll('.sp-date-full').length, 14);
    const sum = sec.querySelector('.sp-date-sum');
    assertTrue(sum.className.includes('sp-date-sum-none'), '全滿時摘要行要標成警告色');
    assertTrue(sum.textContent.includes('自訂時段'), '全滿時要指路：' + sum.textContent);
  });
});

// ────────────────────────────────────────────────────────
suite('日期列空檔統計：換條件要重算', () => {

  test('換掉上課老師 → 原老師撞課的那幾格重新亮起來', () => {
    resetDayAvail();
    daAddCourse({ id: 70, name: '國三數學班', room: '108', start: '18:00', end: '19:30', teacherIds: [1] });
    const withLi = spDaySummary(DA_DAY).n;        // 李老師（原班）：18:00 那段撞課
    slotPicker = { ...slotPicker, teacherId: 2 }; // 改由張老師上
    const withZhang = spDaySummary(DA_DAY).n;
    assertTrue(withZhang > withLi, `換老師後應該多出時段（${withLi} → ${withZhang}）`);
    assertEq(withZhang, daLitSlots(DA_DAY));
  });

  test('快取不會把不同老師的答案混在一起（換回去要拿回原本的數字）', () => {
    resetDayAvail();
    daAddCourse({ id: 71, name: '國三數學班', room: '108', start: '18:00', end: '19:30', teacherIds: [1] });
    const withLi = spDaySummary(DA_DAY).n;
    slotPicker = { ...slotPicker, teacherId: 2 };
    spDaySummary(DA_DAY);
    slotPicker = { ...slotPicker, teacherId: null };
    assertEq(spDaySummary(DA_DAY).n, withLi);
  });

  test('換分校 → 石牌走自己那套判斷，跟北投分開快取', () => {
    resetDayAvail();
    const taipei = spDaySummary(DA_DAY).n;
    slotPicker = { ...slotPicker, branch: '石牌' };
    const shipai = spDaySummary(DA_DAY).n;
    assertEq(shipai, daLitSlots(DA_DAY));
    slotPicker = { ...slotPicker, branch: '北投' };
    assertEq(spDaySummary(DA_DAY).n, taipei);
  });
});
