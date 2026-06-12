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

// ────────────────────────────────────────────────────────
suite('migrateCoursesToEnrollments：一次性轉換', () => {

  test('在學學生的 courses 轉成本期 enrollment', () => {
    resetDriveData({ studentList: [
      { id: 1, name: '小明', grade: '國二', status: '在學', courses: ['國二數學', '國二理化'] },
    ]});
    migrateCoursesToEnrollments();
    assertEq(driveData.enrollments.length, 2);
    assertEq(driveData.enrollments[0].studentId, 1);
    assertEq(driveData.enrollments[0].periodId, '2025-sem2');
    assertEq(driveData.enrollments[0].price, null);
    assertTrue(!!driveData.enrollmentsMigratedAt);
  });

  test('歷屆學生不轉', () => {
    resetDriveData({ studentList: [
      { id: 1, name: '畢業生', grade: '高三', status: '畢業', courses: ['高三數學'] },
    ]});
    migrateCoursesToEnrollments();
    assertEq(driveData.enrollments.length, 0);
  });

  test('【調課】開頭的殘留字串不轉', () => {
    resetDriveData({ studentList: [
      { id: 1, name: '小明', grade: '國二', status: '在學', courses: ['國二數學', '【調課】國二理化'] },
    ]});
    migrateCoursesToEnrollments();
    assertEq(driveData.enrollments.length, 1);
    assertEq(driveData.enrollments[0].courseTitle, '國二數學');
  });

  test('已轉換過（有 marker）不重跑', () => {
    resetDriveData({
      studentList: [{ id: 1, name: '小明', grade: '國二', status: '在學', courses: ['國二數學'] }],
      enrollmentsMigratedAt: '2026-06-01T00:00:00Z',
    });
    migrateCoursesToEnrollments();
    assertEq(driveData.enrollments.length, 0);
  });

  test('學生清單空（雲端可能沒讀到）不跑也不寫 marker', () => {
    resetDriveData();
    migrateCoursesToEnrollments();
    assertEq(driveData.enrollments.length, 0);
    assertEq(driveData.enrollmentsMigratedAt || null, null);
    assertEq(_saveCount, 0); // 完全沒碰儲存
  });

  test('重複跑不會產生重複 enrollment（同學生同課同期別）', () => {
    resetDriveData({
      studentList: [{ id: 1, name: '小明', grade: '國二', status: '在學', courses: ['國二數學'] }],
      enrollments: [{ id: 99, studentId: 1, courseTitle: '國二數學', periodId: '2025-sem2', price: 550 }],
    });
    migrateCoursesToEnrollments();
    assertEq(driveData.enrollments.length, 1);
    assertEq(driveData.enrollments[0].price, 550); // 既有的沒被動到
  });
});

// ────────────────────────────────────────────────────────
suite('ensureEnrollments：掃描補登（只補不刪）', () => {

  test('缺的補上、已有的不動', () => {
    resetDriveData({ enrollments: [
      { id: 1, studentId: 10, courseTitle: '國二數學', periodId: '2025-sem2', price: 550 },
    ]});
    const added = ensureEnrollments(10, ['國二數學', '國二理化']);
    assertEq(added, 1);
    assertEq(driveData.enrollments.length, 2);
    assertEq(driveData.enrollments[0].price, 550); // 覆蓋價沒被洗掉
  });

  test('登記簿多出來的課不會被刪', () => {
    resetDriveData({ enrollments: [
      { id: 1, studentId: 10, courseTitle: '國一英文', periodId: '2025-sem2', price: null },
    ]});
    ensureEnrollments(10, ['國二數學']);
    assertEq(driveData.enrollments.length, 2);
  });

  test('【調課】殘留字串不補', () => {
    resetDriveData();
    const added = ensureEnrollments(10, ['【調課】國二數學']);
    assertEq(added, 0);
    assertEq(_saveCount, 0); // 沒有變動就不觸發儲存
  });
});
