// 待補課清單的期別盲區（2026-08-13 老闆回報：8 月標了一堂 9/12 的調課，清單四個分頁都找不到）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → search → remind → test-runner → 本檔
//
// 病灶：期別分頁是照**今天所在的學年**現算的（state.js getPeriods），四顆只涵蓋 9/1～隔年 8/31。
//       今天在 8 月 → 四顆是 2025/9/1～2026/8/31，9/12 落在四顆之外，切遍每個分頁都找不到。
// 修法：凡是「還有沒排完的」但落在四顆之外的期別，自己長一顆分頁出來（排完就消失）。
//       ⚠ 那顆分頁只換「這一頁在看哪一段」，不動 currentPeriodId（＝登記簿／點名／成績的文件 key）。
//
// 課程 9＝週六 14:00 國三理化班（小明・李老師）。2026-09-12＝週六、2026-08-15＝週六。

function resetMkPeriod() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國三' }],
    enrollments: [{ studentId: 1, courseId: 9, periodId: yearPeriodId('summer') }],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }],
    courses: [
      { id: 9, name: '國三理化班', type: '一對一', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 6, start: '14:00', end: '15:30' }], phases: [] } },
    ],
    absences: [],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';   // 分頁停在暑假（8 月的預設）
  mkPeriodSel = null;
  makeupList = sysAbsenceEvents();
}

// 把某天那一堂標成調課（＝confirmReschedule 寫出來的形狀）
function mkResched(y, m, d) {
  const occId = 'sys:9:' + toDateStr(new Date(y, m, d)) + ':0';
  driveData.absences = [...(driveData.absences || []), {
    id: Date.now() + Math.random(), occId, courseId: 9,
    date: new Date(y, m, d, 14, 0).toISOString(),
    teacherAbsent: false, leave: [], noShow: [], makeupSkip: [],
    resched: true, reschedReason: '家族旅遊',
  }];
  makeupList = sysAbsenceEvents();
  return makeupList.find(e => e.id === occId);
}

// ────────────────────────────────────────────────────────
suite('待補課清單：跨學年的期別分頁', () => {

  test('前提：9/12 確實落在四顆基本分頁之外（這就是病灶）', () => {
    resetMkPeriod();
    assertEq(periodOfDate(new Date(2026, 8, 12)), null, '8 月時 getPeriods 涵蓋不到 9 月');
    assertTrue(periodOfDate(new Date(2026, 7, 15)) !== null, '同年 8 月的課則落在暑假分頁內');
  });

  test('9/12 標調課 → 自動長出一顆「2026學年 上學期（1）」分頁', () => {
    resetMkPeriod();
    mkResched(2026, 8, 12);
    const ex = mkExtraPeriods();
    assertEq(ex.length, 1);
    assertEq(ex[0].id, '2026-sem1');
    assertEq(ex[0].label, '2026學年 上學期');
    assertEq(ex[0].n, 1, '要講得出那邊還欠幾筆');
    assertTrue(mkPeriodTabsHtml().indexOf('2026學年 上學期（1）') >= 0, '分頁列要畫得出來');
  });

  test('切過去之後這一頁的視野換成那一段，但 currentPeriodId 不動', () => {
    resetMkPeriod();
    mkResched(2026, 8, 12);
    switchMkPeriod('2026-sem1');
    assertEq(mkViewPeriod().id, '2026-sem1');
    assertTrue(mkViewPeriod().start <= new Date(2026, 8, 12), '9/12 要落在這一段裡');
    assertTrue(mkViewPeriod().end >= new Date(2026, 8, 12));
    assertEq(currentPeriodId, 'summer', '登記簿／點名／成績的文件 key 不可以被動到');
    assertEq(yearPeriodId(), '2025-summer', '名冊還是讀得到原本那份');
  });

  test('同期別的課不長額外分頁（8/15 那筆四顆裡就看得到）', () => {
    resetMkPeriod();
    mkResched(2026, 7, 15);
    assertEq(mkExtraPeriods().length, 0);
  });

  test('排好時段之後那顆分頁自己消失', () => {
    resetMkPeriod();
    const ev = mkResched(2026, 8, 12);
    saveMakeupScheduled(ev, new Date(2026, 8, 19, 14, 0), new Date(2026, 8, 19, 15, 30), '小教室', null, '調課');
    mkPeriodSel = null;   // 沒有正在看那顆
    assertEq(mkExtraPeriods().length, 0, '排完就不該再長分頁');
  });

  test('正在看那顆時剛好排完 → 分頁留著（不會在腳下消失）', () => {
    resetMkPeriod();
    const ev = mkResched(2026, 8, 12);
    switchMkPeriod('2026-sem1');
    saveMakeupScheduled(ev, new Date(2026, 8, 19, 14, 0), new Date(2026, 8, 19, 15, 30), '小教室', null, '調課');
    const ex = mkExtraPeriods();
    assertEq(ex.length, 1);
    assertEq(ex[0].n, 0, '沒欠了就不標數字');
  });

});

// 側欄紅色數字＝「這學期開始 + 之後所有學期」的加總（2026-08-13 老闆定）。
// 固定用 2026-08-13（暑假期間）當「今天」，測試才不會隨真實日期飄。
suite('側欄待補課數字：這學期起算、往後不封頂', () => {
  const NOW = new Date(2026, 7, 13, 10, 0);   // 2026-08-13＝暑假（2026/7/1–8/31）

  test('起算點＝今天所在期別的第一天', () => {
    resetMkPeriod();
    assertEq(mkCountFromDate(NOW).getTime(), new Date(2026, 6, 1).getTime(), '暑假從 7/1 起算');
  });

  test('當期的算（8/15）', () => {
    resetMkPeriod();
    mkResched(2026, 7, 15);
    assertEq(mkPendingTotal(NOW), 1);
  });

  test('之後所有學期都算，不封頂（9/12＝下一個學年）', () => {
    resetMkPeriod();
    mkResched(2026, 8, 12);
    assertEq(mkPendingTotal(NOW), 1, '綁單一期別的話這裡會是 0（＝系統從頭到尾沒提醒過）');
  });

  test('這學期之前的舊帳不算（6/20＝上一期的下學期）', () => {
    resetMkPeriod();
    mkResched(2026, 5, 20);
    assertEq(mkPendingTotal(NOW), 0, '舊帳去清單切那一期的分頁查，不該一直吵側欄');
  });

  test('三筆混在一起 → 只加當期與之後的兩筆', () => {
    resetMkPeriod();
    mkResched(2026, 5, 20); mkResched(2026, 7, 15); mkResched(2026, 8, 12);
    assertEq(mkPendingTotal(NOW), 2);
  });

  test('今日頁的提醒跟側欄是同一支（不會各數各的）', () => {
    resetMkPeriod();
    mkResched(2026, 7, 15); mkResched(2026, 8, 12);
    assertEq(rmdPendingCount(NOW), mkPendingTotal(NOW));
    assertEq(rmdPendingCount(NOW), 2);
  });

  test('排好之後就不再算', () => {
    resetMkPeriod();
    const ev = mkResched(2026, 8, 12);
    saveMakeupScheduled(ev, new Date(2026, 8, 19, 14, 0), new Date(2026, 8, 19, 15, 30), '小教室', null, '調課');
    assertEq(mkPendingTotal(NOW), 0);
  });
});

suite('期別範圍：跨學年也答得出是哪一期', () => {

  test('9 月起算新學年', () => {
    assertEq(periodRangeOfDate(new Date(2026, 8, 12)).label, '2026學年 上學期');
    assertEq(schoolYearOfDate(new Date(2026, 8, 12)), 2026);
  });

  test('1 月還算前一個學年的上學期', () => {
    assertEq(periodRangeOfDate(new Date(2026, 0, 20)).label, '2025學年 上學期');
  });

  test('2 月＝寒假、4 月＝下學期、8 月＝暑假', () => {
    assertEq(periodRangeOfDate(new Date(2026, 1, 10)).label, '2025學年 寒假');
    assertEq(periodRangeOfDate(new Date(2026, 3, 10)).label, '2025學年 下學期');
    assertEq(periodRangeOfDate(new Date(2026, 7, 15)).label, '2025學年 暑假');
  });

  test('getPeriods 指定學年不影響原本的無參數用法', () => {
    assertEq(getPeriods(2026)[0].start.getFullYear(), 2026);
    assertEq(getPeriods()[0].start.getFullYear(), 2025, '省略＝今天所在的學年（測試裡固定 2025）');
  });
});

// ⚠ 調課的動態（week.js confirmReschedule / cancelReschedule）沒有單元測試：
//    week.js 沒被這份測試頁載入（它整支綁 modal DOM），硬拉進來要補一堆 stub 才跑得動。
//    那兩支的驗證走瀏覽器實測（見進展紀錄 2026-08-13）。
