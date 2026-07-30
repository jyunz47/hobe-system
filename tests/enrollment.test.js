// enrollment.js 測試：期別 id、價格解析、一次性轉換、掃描補登
// 載入順序：stubs（index.html 內）→ js/enrollment.js → test-runner.js → 本檔
//
// enrollment.js 依賴的全域（driveData、getSchoolYear、currentPeriodId、
// detectPeriodId、getStudentList、scheduleDriveSave）由 index.html 的 stub 區提供。

// 每個 suite 開頭都重置 driveData，避免測試互相污染
function resetDriveData(over) {
  driveData = Object.assign({
    studentList: [],
    makeupScheduled: [],
    enrollments: [],
    coursePrices: [],
  }, over || {});
  _saveCount = 0;
}

// ────────────────────────────────────────────────────────
suite('yearPeriodId / yearPeriodLabel：期別 id 帶學年', () => {

  test('預設用目前 UI 期別', () => {
    assertEq(yearPeriodId(), '2025-sem2'); // stub：學年 2025、currentPeriodId sem2
  });

  test('可指定期別', () => {
    assertEq(yearPeriodId('summer'), '2025-summer');
  });

  test('label：學年 + 中文期別', () => {
    assertEq(yearPeriodLabel('2025-sem2'), '2025 下學期');
    assertEq(yearPeriodLabel('2026-winter'), '2026 寒假');
  });

  test('label：看不懂的格式原樣返回', () => {
    assertEq(yearPeriodLabel('亂寫'), '亂寫');
    assertEq(yearPeriodLabel(''), '');
  });
});

// ────────────────────────────────────────────────────────
suite('effectivePrice：個人覆蓋 > 價目表預設 > 未定價', () => {

  test('個人覆蓋優先', () => {
    resetDriveData({ coursePrices: [{ title: '國二數學', price: 600 }] });
    assertEq(effectivePrice({ courseTitle: '國二數學', price: 550 }), 550);
  });

  test('沒覆蓋時用價目表預設', () => {
    resetDriveData({ coursePrices: [{ title: '國二數學', price: 600 }] });
    assertEq(effectivePrice({ courseTitle: '國二數學', price: null }), 600);
  });

  test('價目表也沒有 → null（未定價）', () => {
    resetDriveData();
    assertEq(effectivePrice({ courseTitle: '國二數學', price: null }), null);
  });

  test('覆蓋價 0 是合法價格（免費），不可被預設蓋掉', () => {
    resetDriveData({ coursePrices: [{ title: '國二數學', price: 600 }] });
    assertEq(effectivePrice({ courseTitle: '國二數學', price: 0 }), 0);
  });

  test('價目表有課名但價格未定（null）→ null', () => {
    resetDriveData({ coursePrices: [{ title: '國二數學', price: null }] });
    assertEq(effectivePrice({ courseTitle: '國二數學', price: null }), null);
  });
});

// ────────────────────────────────────────────────────────
suite('getEnrollments：篩選', () => {

  function seed() {
    resetDriveData({ enrollments: [
      { id: 1, studentId: 10, courseTitle: '國二數學', periodId: '2025-sem2', price: null },
      { id: 2, studentId: 10, courseTitle: '國二理化', periodId: '2025-sem1', price: null },
      { id: 3, studentId: 20, courseTitle: '國二數學', periodId: '2025-sem2', price: 550 },
    ]});
  }

  test('不給條件回全部', () => {
    seed();
    assertEq(getEnrollments().length, 3);
  });

  test('依學生篩', () => {
    seed();
    assertEq(getEnrollments({ studentId: 10 }).length, 2);
  });

  test('學生 + 期別', () => {
    seed();
    const r = getEnrollments({ studentId: 10, periodId: '2025-sem2' });
    assertEq(r.length, 1);
    assertEq(r[0].courseTitle, '國二數學');
  });

  test('依課名篩', () => {
    seed();
    assertEq(getEnrollments({ courseTitle: '國二數學' }).length, 2);
  });
});

// 註：ensureEnrollments 與 computeReconciliation 的測試隨「課表對帳」於 2026-07-29 第 4 刀一併移除；
//     migrateCoursesToEnrollments 的測試隨該函式於 2026-07-30 cutover 重建完成後一併移除。
