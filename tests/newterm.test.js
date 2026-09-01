// 開學準備（js/newterm.js）
//
// 【在解什麼】
// 期別交接不是「複製一份名單」——課表本身會變。暑假白天上的課（12:30），開學後
// 孩子要上學，同一門課得改晚上（19:00）；同時有人升學不續。老闆 2026-08-27：
// 「需要可以提早去針對每一堂修課登記做開學後的時間調整與確認」。
//
// 這裡守的是最會靜默出錯的兩件事：
//   ① 改時段**不可以動到目標日之前的課堂**（過去的課表、名冊、堂數都得原封不動）
//   ② 進度是從「結果」推出來的，不另外存狀態——判斷要準
//
// ⚠️ 頂層名稱一律加 nt 前綴：所有 .test.js 共用同一個全域範圍，撞名會讓整份檔案靜默不執行。

function ntResetTerm() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' },
                  { id: 3, name: '升學生', grade: '國三' }],
    enrollments: [], makeupScheduled: [], coursePrices: [], courseSettings: [], absences: [],
    teachers: [{ id: 1, name: '李老師' }],
    courses: [
      // 暑假白天上的課：週二 12:30–14:00
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '12:30', end: '14:00' }], phases: [] } },
    ],
  };
  ntState = { pick: {}, collapsed: null };
  ntSlotDraft = {};
}

// 直接把「確認這門」會寫進去的那一段算出來（ntConfirm 會開確認視窗與重畫，測不到）
function ntApplyPhase(co, fromStr, slots) {
  const c = JSON.parse(JSON.stringify(co));
  c.schedule.phases = (c.schedule.phases || []).filter(p => !(p && p.from === fromStr));
  c.schedule.phases.push({ from: fromStr, slots: slots.map(s => ({ weekday: Number(s.weekday), start: s.start, end: s.end })) });
  c.schedule.phases.sort((a, b) => String(a.from).localeCompare(String(b.from)));
  return c;
}
// 某天那堂課實際幾點上（走的是全系統同一支展開器）
function ntSlotOn(co, dayStr) {
  const occ = courseOccurrencesInRange(co, new Date(dayStr + 'T00:00:00'), new Date(dayStr + 'T23:59:59'));
  return occ.length ? `${fmtT(occ[0].startDt)}–${fmtT(occ[0].endDt)}` : '(沒課)';
}

suite('開學準備 — 期別的前後與起始日', () => {

  test('下一期：暑假之後跨到新學年的上學期', () => {
    assertEq(nextYearPeriodId('2025-summer'), '2026-sem1');
    assertEq(nextYearPeriodId('2026-sem1'), '2026-winter');
    assertEq(nextYearPeriodId('2026-winter'), '2026-sem2');
    assertEq(nextYearPeriodId('2026-sem2'), '2026-summer');
  });

  test('前後互為反向（來回推得回原點）', () => {
    ['2026-sem1', '2026-winter', '2026-sem2', '2026-summer'].forEach(p => {
      assertEq(prevYearPeriodId(nextYearPeriodId(p)), p, p + ' 來回推應該回到原點');
    });
  });

  test('上學期從 9/1 開始（開學準備的分段就從這天起生效）', () => {
    assertEq(yearPeriodStart('2026-sem1'), '2026-09-01');
    assertEq(yearPeriodStart('2026-winter'), '2027-02-01');
    assertEq(yearPeriodStart('2026-sem2'), '2027-03-01');
    assertEq(yearPeriodStart('2026-summer'), '2027-07-01');
  });

  test('格式不對回 null，不要亂猜', () => {
    assertEq(nextYearPeriodId('summer'), null);
    assertEq(yearPeriodStart('2026-xxx'), null);
  });
});

suite('開學準備 — 改時段絕不影響過去（這條錯了會很難查）', () => {

  test('9/1 起改成晚上，8 月的課堂完全不動', () => {
    ntResetTerm();
    const co = driveData.courses[0];
    const after = ntApplyPhase(co, '2026-09-01', [{ weekday: 2, start: '19:00', end: '20:30' }]);
    // 8/25 是週二，暑假時段
    assertEq(ntSlotOn(after, '2026-08-25'), '12:30–14:00', '8 月要維持暑假的白天時段');
    // 9/1 是週二，新時段
    assertEq(ntSlotOn(after, '2026-09-01'), '19:00–20:30', '9/1 起要變晚上');
    assertEq(ntSlotOn(after, '2026-09-08'), '19:00–20:30', '之後的每一週都照新的');
  });

  test('生效日當天就算新的（含當日，不是隔天才生效）', () => {
    ntResetTerm();
    const after = ntApplyPhase(driveData.courses[0], '2026-09-01', [{ weekday: 2, start: '19:00', end: '20:30' }]);
    assertEq(ntSlotOn(after, '2026-09-01'), '19:00–20:30');
  });

  test('同一天重複確認只會留一段（不會愈按愈多段）', () => {
    ntResetTerm();
    let co = ntApplyPhase(driveData.courses[0], '2026-09-01', [{ weekday: 2, start: '19:00', end: '20:30' }]);
    co = ntApplyPhase(co, '2026-09-01', [{ weekday: 2, start: '18:00', end: '19:30' }]);
    assertEq(co.schedule.phases.length, 1, '同一個 from 只留一段');
    assertEq(ntSlotOn(co, '2026-09-01'), '18:00–19:30', '留下的是後來改的那個');
  });

  test('可以改成不同星期（開學後換天上課）', () => {
    ntResetTerm();
    const after = ntApplyPhase(driveData.courses[0], '2026-09-01', [{ weekday: 4, start: '19:00', end: '20:30' }]);
    assertEq(ntSlotOn(after, '2026-09-01'), '(沒課)', '9/1 是週二，改成週四之後這天就沒課了');
    assertEq(ntSlotOn(after, '2026-09-03'), '19:00–20:30', '9/3 是週四');
    assertEq(ntSlotOn(after, '2026-08-25'), '12:30–14:00', '8 月的週二照舊');
  });

  test('多個時段一起帶（一週上兩天）', () => {
    ntResetTerm();
    const after = ntApplyPhase(driveData.courses[0], '2026-09-01',
      [{ weekday: 2, start: '19:00', end: '20:30' }, { weekday: 5, start: '19:00', end: '20:30' }]);
    assertEq(ntSlotOn(after, '2026-09-01'), '19:00–20:30', '週二');
    assertEq(ntSlotOn(after, '2026-09-04'), '19:00–20:30', '週五');
  });
});

suite('開學準備 — 進度是從結果推出來的', () => {

  const ntT = { dst: '2026-sem1', src: '2025-summer', start: '2026-09-01' };

  test('都沒做 → 兩個都未定', () => {
    ntResetTerm();
    const d = ntDone(driveData.courses[0], ntT);
    assertFalse(d.timeDone, '時間未定');
    assertFalse(d.rosterDone, '名單未定');
  });

  test('設了 9/1 起的時段 → 時間已定', () => {
    ntResetTerm();
    driveData.courses[0] = ntApplyPhase(driveData.courses[0], '2026-09-01', [{ weekday: 2, start: '19:00', end: '20:30' }]);
    assertTrue(ntDone(driveData.courses[0], ntT).timeDone);
  });

  test('9/1 之前的舊分段不算數（那是上個學期留下的）', () => {
    ntResetTerm();
    driveData.courses[0] = ntApplyPhase(driveData.courses[0], '2026-07-01', [{ weekday: 2, start: '12:30', end: '14:00' }]);
    assertFalse(ntDone(driveData.courses[0], ntT).timeDone, '7/1 那段不能被當成開學準備做過了');
  });

  test('新期別有這門課的登記 → 名單已定', () => {
    ntResetTerm();
    driveData.enrollments = [{ id: 1, studentId: 1, courseId: 7, courseTitle: '國二數學班', periodId: '2026-sem1' }];
    assertTrue(ntDone(driveData.courses[0], ntT).rosterDone);
  });

  test('別門課的登記不算（一門一門各自判斷）', () => {
    ntResetTerm();
    driveData.enrollments = [{ id: 1, studentId: 1, courseId: 99, courseTitle: '別的課', periodId: '2026-sem1' }];
    assertFalse(ntDone(driveData.courses[0], ntT).rosterDone);
  });
});

suite('開學準備 — 整區收合', () => {

  const ntCT = { dst: '2026-sem1', src: '2025-summer', start: '2026-09-01' };

  test('還有沒辦完的 → 預設攤開（開學前要一直看得到待辦）', () => {
    ntResetTerm();
    ntState.collapsed = null;
    assertFalse(ntCollapsed(ntCT, [{ co: driveData.courses[0], ens: [] }]), '有待辦就該攤開');
  });

  test('全部辦完 → 預設收起來（自己讓開，不要一直佔版面）', () => {
    ntResetTerm();
    ntState.collapsed = null;
    driveData.courses[0].schedule.phases = [{ from: '2026-09-01', slots: [{ weekday: 2, start: '19:00', end: '20:30' }] }];
    driveData.enrollments = [{ id: 1, studentId: 1, courseId: 7, courseTitle: '國二數學班', periodId: '2026-sem1' }];
    assertTrue(ntCollapsed(ntCT, [{ co: driveData.courses[0], ens: [] }]), '全部就緒就該收起來');
  });

  test('手動點過就以手動為準，不被自動判斷蓋回去', () => {
    ntResetTerm();
    const items = [{ co: driveData.courses[0], ens: [] }];
    ntState.collapsed = true;                       // 還有待辦，但使用者自己收起來了
    assertTrue(ntCollapsed(ntCT, items), '手動收起要留住');
    ntState.collapsed = false;
    assertFalse(ntCollapsed(ntCT, items), '手動攤開也要留住');
  });
});

suite('開學準備 — 已排到新學期的補課要提醒', () => {

  const ntT = { dst: '2026-sem1', src: '2025-summer', start: '2026-09-01' };

  test('排在 9/1 之後的場次要被撈出來（改時段不會動到它們）', () => {
    ntResetTerm();
    driveData.makeupScheduled = [
      { id: 'mk1', originalId: 'sys:7:2026-08-11:0', scheduledDate: '2026-09-05T19:00:00.000Z' },
      { id: 'mk2', originalId: 'sys:7:2026-08-11:0', scheduledDate: '2026-08-20T19:00:00.000Z' },
    ];
    const list = ntFutureMakeups(driveData.courses[0], ntT);
    assertEq(list.length, 1, '只有 9/5 那場要提醒');
    assertEq(list[0].id, 'mk1');
  });

  test('別門課的場次不要混進來', () => {
    ntResetTerm();
    driveData.makeupScheduled = [
      { id: 'mk9', originalId: 'sys:99:2026-08-11:0', scheduledDate: '2026-09-05T19:00:00.000Z' },
    ];
    assertEq(ntFutureMakeups(driveData.courses[0], ntT).length, 0);
  });
});

// ────────────────────────────────────────────────────────
// 【2026-09-01 老闆踩到】「阿為什麼我選好一個課就全部不見了」
//
// 原本 ntTarget 用「這一期有沒有登記」決定要準備哪一期。9/1 當天這一期是 0 筆，
// 所以目標＝這一期、整區列出暑假那批課。但**第一門課一確認**就寫進了這一期的登記，
// 條件當場翻面：目標跳到下一期（寒假，還有 100 多天）→ 被 28 天門檻擋掉 →
// 整區消失，剩下的課再也沒有地方可辦。
//
// 改成看「這一期還剩幾門沒辦完」。時鐘一律自己帶（ntTarget(now)），
// 免得測試某天自己過期——這條規矩 2026-08-27 才踩過一次。
function ntSetPeriod(pid) { currentPeriodId = pid; }
// getSchoolYear() 被固定 stub 成 2025，所以 yearPeriodId() ＝ '2025-<currentPeriodId>'
// '2025-sem1' 從 2025-09-01 開始、下一期 '2025-winter' 從 2026-02-01 開始
const NT_SEM1_DAY1 = new Date(2025, 8, 1);      // 開學當天
const NT_SEM1_MID = new Date(2025, 9, 15);      // 開學一個半月後

suite('開學準備 — 辦完一門課，其他門不可以跟著消失', () => {

  // 上一期（2024-summer）有兩門課、這一期（2025-sem1）什麼都還沒辦
  function ntTwoCourseTerm() {
    ntResetTerm();
    ntSetPeriod('sem1');
    driveData.courses.push({ id: 8, name: '國三理化班', type: '團班', room: '108', status: '開課中',
      teacherIds: [1], schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '13:00', end: '14:30' }], phases: [] } });
    driveData.enrollments = [
      { id: 201, studentId: 1, courseId: 7, courseTitle: '國二數學班', periodId: '2024-summer' },
      { id: 202, studentId: 2, courseId: 7, courseTitle: '國二數學班', periodId: '2024-summer' },
      { id: 203, studentId: 3, courseId: 8, courseTitle: '國三理化班', periodId: '2024-summer' },
    ];
  }
  // 「確認一門課」實際會寫進去的兩樣東西：時段分段 ＋ 新期別的登記
  function ntConfirmCourse(cid, fromStr) {
    const list = getCourses().slice();
    const i = list.findIndex(c => c.id === cid);
    list[i] = ntApplyPhase(list[i], fromStr, [{ weekday: 2, start: '19:00', end: '21:00' }]);
    driveData.courses = list;
    driveData.enrollments = [...driveData.enrollments,
      { id: 900 + cid, studentId: 1, courseId: cid, courseTitle: 'x', periodId: '2025-sem1' }];
  }

  test('開學當天、一門都還沒辦 → 目標＝這一期，兩門課都在清單上', () => {
    ntTwoCourseTerm();
    const t = ntTarget(NT_SEM1_DAY1);
    assertEq(t.dst, '2025-sem1');
    assertEq(t.src, '2024-summer');
    assertEq(t.daysLeft, 0, '開學就是今天');
    assertEq(ntCourses(t).length, 2);
  });

  test('🔑 辦完第一門之後，目標還是這一期（另一門要留在清單上）', () => {
    ntTwoCourseTerm();
    ntConfirmCourse(7, '2025-09-01');
    const t = ntTarget(NT_SEM1_MID);
    assertEq(t.dst, '2025-sem1', '不可以因為「這一期有登記了」就跳到下一期');
    assertEq(t.src, '2024-summer');
    assertEq(ntCourses(t).length, 2, '兩門都還列著（辦完的那門會自己顯示成已完成）');
    assertEq(ntPendingCount('2025-sem1'), 1, '只剩國三理化班沒辦');
  });

  test('🔑 兩門都辦完 → 這一期沒事了，目標才換到下一期', () => {
    ntTwoCourseTerm();
    ntConfirmCourse(7, '2025-09-01');
    ntConfirmCourse(8, '2025-09-01');
    assertEq(ntPendingCount('2025-sem1'), 0);
    assertEq(ntTarget(NT_SEM1_MID).dst, '2025-winter', '該往前看下一期了');
  });

  test('只帶了名單、時段還沒排 → 那門課仍算沒辦完', () => {
    ntTwoCourseTerm();
    driveData.enrollments.push({ id: 907, studentId: 1, courseId: 7, courseTitle: 'x', periodId: '2025-sem1' });
    assertEq(ntPendingCount('2025-sem1'), 2, '名單帶了但時段沒排，還是沒辦完');
    assertEq(ntTarget(NT_SEM1_MID).dst, '2025-sem1');
  });

  test('只排了時段、名單還沒帶 → 那門課仍算沒辦完', () => {
    ntTwoCourseTerm();
    const list = getCourses().slice();
    list[0] = ntApplyPhase(list[0], '2025-09-01', [{ weekday: 2, start: '19:00', end: '21:00' }]);
    driveData.courses = list;
    assertEq(ntPendingCount('2025-sem1'), 2);
    assertEq(ntTarget(NT_SEM1_MID).dst, '2025-sem1');
  });

  test('生效日在目標期別之前的舊分段不算數（去年的換時段不能充當今年的準備）', () => {
    ntTwoCourseTerm();
    const list = getCourses().slice();
    list[0] = ntApplyPhase(list[0], '2025-03-01', [{ weekday: 2, start: '19:00', end: '21:00' }]);
    driveData.courses = list;
    driveData.enrollments.push({ id: 907, studentId: 1, courseId: 7, courseTitle: 'x', periodId: '2025-sem1' });
    assertEq(ntPendingCount('2025-sem1'), 2, '3/1 那段早於 9/1，不能算開學準備做過了');
  });

  test('下一期逼近（28 天內）時，即使這一期還有剩，也改成準備下一期', () => {
    ntTwoCourseTerm();
    // '2025-winter' 從 2026-02-01 開始；1/20 距它 12 天
    const t = ntTarget(new Date(2026, 0, 20));
    assertEq(t.dst, '2025-winter', '寒假近在眼前，該準備的是寒假');
    assertEq(t.src, '2025-sem1');
  });

  test('上一期本來就沒有登記 → 沒東西可辦，不會把目標卡在這一期', () => {
    ntResetTerm();
    ntSetPeriod('sem1');
    driveData.enrollments = [];
    assertEq(ntPendingCount('2025-sem1'), 0);
    assertEq(ntTarget(NT_SEM1_MID).dst, '2025-winter');
  });

  test('上一期的課已經被刪掉 → 不算欠辦（這一區本來就處理不了沒有課本體的登記）', () => {
    ntTwoCourseTerm();
    driveData.courses = driveData.courses.filter(c => c.id !== 8);
    ntConfirmCourse(7, '2025-09-01');
    assertEq(ntPendingCount('2025-sem1'), 0, '剩下那筆的課程本體不存在，不該讓整區永遠停在這一期');
  });

  test('不傳時鐘也要能跑（正式程式呼叫的就是無參數版）', () => {
    ntTwoCourseTerm();
    const t = ntTarget();
    assertTrue(t !== null && !!t.dst, 'ntTarget() 應該回得出目標');
  });
});
