// 滾動判型測試（schedule.js courseTypeByCount / courseTypeOn / _occType）
// 規則：課型看「那一堂在籍幾個人」，不看課程本體的固定標籤。
// 載入順序：stubs（index.html 內）→ js/enrollment.js → js/schedule.js → test-runner.js → 本檔

function ctResetDriveData(courses, enrollments) {
  currentPeriodId = 'sem2';   // 前面的 suite 可能改過（dayview-move 會切 summer），這裡自己扶正
  driveData = {
    studentList: [
      { id: 1, name: '承軒' }, { id: 2, name: '子晴' },
      { id: 3, name: '宥澄' }, { id: 4, name: '品妍' },
    ],
    courses: courses || [],
    enrollments: enrollments || [],
    makeupScheduled: [],
    coursePrices: [],
    absences: [],
  };
  _saveCount = 0;
}
// 每週三 16:00-18:00 的課；type 帶什麼由各測試決定
function ctCourse(over) {
  return Object.assign({
    id: 10, name: '承軒、子晴數學班', type: '一對二', subject: '數學',
    status: '開課中',
    schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '16:00', end: '18:00' }] },
  }, over || {});
}
function ctEnroll(studentId, over) {
  return Object.assign({
    id: 100 + studentId, studentId, courseId: 10,
    courseTitle: '承軒、子晴數學班', periodId: '2025-sem2',
    startDate: null, endDate: null,
  }, over || {});
}
// 某一天那堂課展開出來的 type code
function ctTypeOnDay(y, m, d) {
  const day = new Date(y, m - 1, d);
  const occ = courseOccurrencesInRange(getCourses()[0], day, day);
  return occ.length ? occ[0].type : null;
}

// ────────────────────────────────────────────────────────
suite('courseTypeByCount：人數 → 課型', () => {

  test('1 人一對一、2 人一對二、3 人以上團班', () => {
    const co = ctCourse();
    assertEq(courseTypeByCount(co, 1), '一對一');
    assertEq(courseTypeByCount(co, 2), '一對二');
    assertEq(courseTypeByCount(co, 3), '團班');
    assertEq(courseTypeByCount(co, 9), '團班');
  });

  test('人數 0（那天沒人在籍）→ 退回課程本體的型，不當成一對一', () => {
    assertEq(courseTypeByCount(ctCourse({ type: '團班' }), 0), '團班');
    assertEq(courseTypeByCount(ctCourse({ type: '一對二' }), 0), '一對二');
  });

  test('練習課、試聽不滾', () => {
    assertEq(courseTypeByCount(ctCourse({ type: '練習課' }), 1), '練習課');
    assertEq(courseTypeByCount(ctCourse({ type: '練習課' }), 5), '練習課');
    assertEq(courseTypeByCount(ctCourse({ type: '試聽' }), 2), '試聽');
  });

  test('手動鎖定（typePinned）不滾：兩人的團班仍是團班', () => {
    const co = ctCourse({ type: '團班', typePinned: true });
    assertEq(courseTypeByCount(co, 2), '團班');
    assertEq(courseTypeByCount(co, 1), '團班');
  });

  test('沒鎖的舊課（typePinned 未設）照滾', () => {
    assertEq(courseTypeByCount(ctCourse({ type: '團班' }), 2), '一對二');
  });
});

// ────────────────────────────────────────────────────────
suite('滾動判型 × 修課起訖：課型隨課堂日期變', () => {

  // 子晴 8/15 起不上（endDate 含當日 → 存 8/14）
  function setupOneLeaves() {
    ctResetDriveData([ctCourse()], [
      ctEnroll(1),
      ctEnroll(2, { endDate: '2025-08-14' }),
    ]);
  }

  test('退出前是一對二，退出後變一對一', () => {
    setupOneLeaves();
    assertEq(ctTypeOnDay(2025, 8, 13), 'pair');  // 8/13 週三，兩人都在
    assertEq(ctTypeOnDay(2025, 8, 20), 'one');   // 8/20 週三，只剩承軒
  });

  test('名單也跟著只剩一人（型與名單同一份事實）', () => {
    setupOneLeaves();
    const day = new Date(2025, 7, 20);
    const occ = courseOccurrencesInRange(getCourses()[0], day, day)[0];
    assertEqDeep(occ.students, ['承軒']);
  });

  test('插班：第三人進來後升成團班', () => {
    ctResetDriveData([ctCourse()], [
      ctEnroll(1), ctEnroll(2),
      ctEnroll(3, { startDate: '2025-08-15' }),
    ]);
    assertEq(ctTypeOnDay(2025, 8, 13), 'pair');
    assertEq(ctTypeOnDay(2025, 8, 20), 'group');
  });

  test('團班掉到兩人 → 課堂變一對二（費率單位不在此處，仍看 course.type）', () => {
    ctResetDriveData([ctCourse({ type: '團班' })], [
      ctEnroll(1), ctEnroll(2),
      ctEnroll(3, { endDate: '2025-08-14' }),
      ctEnroll(4, { endDate: '2025-08-14' }),
    ]);
    assertEq(ctTypeOnDay(2025, 8, 13), 'group');
    assertEq(ctTypeOnDay(2025, 8, 20), 'pair');
    assertEq(getCourses()[0].type, '團班'); // 課程本體不動＝費率單位不動
  });

  test('鎖定的課不隨人數變', () => {
    ctResetDriveData([ctCourse({ type: '團班', typePinned: true })], [
      ctEnroll(1), ctEnroll(2),
      ctEnroll(3, { endDate: '2025-08-14' }),
    ]);
    assertEq(ctTypeOnDay(2025, 8, 20), 'group');
  });

  test('courseTypeOn：不用展開課堂也能問某天的型', () => {
    setupOneLeaves();
    assertEq(courseTypeOn(getCourses()[0], '2025-08-13'), '一對二');
    assertEq(courseTypeOn(getCourses()[0], '2025-08-20'), '一對一');
  });
});

// ────────────────────────────────────────────────────────
suite('滾動命名：自動命名的課，課名跟著名單走', () => {

  // 子晴 8/15 起不上；課名是自動算出來的「承軒、子晴數學班」
  function setupAutoNamed(over) {
    ctResetDriveData([ctCourse(Object.assign({ nameAuto: true }, over || {}))], [
      ctEnroll(1),
      ctEnroll(2, { endDate: '2025-08-14' }),
    ]);
    return getCourses()[0];
  }

  test('退出前後課名不同：「承軒、子晴數學班」→「承軒數學家教」', () => {
    const co = setupAutoNamed();
    assertEq(courseNameOn(co, '2025-08-13'), '承軒、子晴數學班');
    assertEq(courseNameOn(co, '2025-08-20'), '承軒數學家教');
  });

  test('課堂卡上的課名也跟著（展開器用同一支）', () => {
    setupAutoNamed();
    const day = new Date(2025, 7, 20);
    const occ = courseOccurrencesInRange(getCourses()[0], day, day)[0];
    assertEq(occ.title, '承軒數學家教');
  });

  test('手取的名字不滾（nameAuto=false）', () => {
    const co = setupAutoNamed({ nameAuto: false, name: '週三晚班' });
    assertEq(courseNameOn(co, '2025-08-13'), '週三晚班');
    assertEq(courseNameOn(co, '2025-08-20'), '週三晚班');
  });

  test('課名分段壓過滾動命名', () => {
    const co = setupAutoNamed();
    co.namePhases = [{ from: '2025-08-15', name: '承軒衝刺班' }];
    assertEq(courseNameOn(co, '2025-08-13'), '承軒、子晴數學班'); // 分段之前照滾
    assertEq(courseNameOn(co, '2025-08-20'), '承軒衝刺班');
  });

  test('那天沒人在籍（算不出名字）→ 落回建課當下的名字，不變空白', () => {
    ctResetDriveData([ctCourse({ nameAuto: true })], [
      ctEnroll(1, { endDate: '2025-08-14' }),
      ctEnroll(2, { endDate: '2025-08-14' }),
    ]);
    assertEq(courseNameOn(getCourses()[0], '2025-08-20'), '承軒、子晴數學班');
  });

  test('舊課沒有 nameAuto 旗標：名字等於自動算出來的 → 判定為自動，會滾', () => {
    const co = setupAutoNamed();
    delete co.nameAuto;
    assertTrue(courseNameIsAuto(co));
    assertEq(courseNameOn(co, '2025-08-20'), '承軒數學家教');
  });

  test('舊課沒有旗標：名字是自己取的 → 判定為手取，不滾', () => {
    const co = setupAutoNamed();
    delete co.nameAuto;
    co.name = '週三晚班';
    assertFalse(courseNameIsAuto(co));
    assertEq(courseNameOn(co, '2025-08-20'), '週三晚班');
  });

  // 2026-08-03～08-20 的表單把自動算出的名字直接填進課名欄，存檔時整批被記成 nameAuto:false。
  // 旗標對那批資料等於沒有資訊 → 名字對得上自動命名就當它是自動的。
  test('nameAuto:false 但名字＝自動算得出來的（表單舊 bug 的資料）→ 照樣滾', () => {
    const co = setupAutoNamed({ nameAuto: false });
    assertTrue(courseNameIsAuto(co));
    assertEq(courseNameOn(co, '2025-08-20'), '承軒數學家教');
  });
});

// ────────────────────────────────────────────────────────
// 整筆退課（登記直接刪掉，不是設修課起訖）：刪完就沒有「兩人份的名字」可以回推了，
// 所以刪之前先蓋章（courses.js stampNameAutoBeforeRosterCut）。
suite('退課前蓋章：整筆退課後課名還滾得動', () => {

  function setupTwo(over) {
    ctResetDriveData([ctCourse(over || {})], [ctEnroll(1), ctEnroll(2)]);
    return getCourses()[0];
  }
  function dropStudent2() {
    stampNameAutoBeforeRosterCut([10]);
    driveData.enrollments = driveData.enrollments.filter(en => en.studentId !== 2);
  }

  test('自動命名的課（沒旗標）：蓋章後退課，課名變「承軒數學家教」', () => {
    setupTwo();
    delete getCourses()[0].nameAuto;
    dropStudent2();
    assertTrue(getCourses()[0].nameAuto);
    assertEq(courseNameOn(getCourses()[0], '2025-08-20'), '承軒數學家教');
  });

  test('沒蓋章的話會凍住（證明這一步有用）', () => {
    setupTwo();
    delete getCourses()[0].nameAuto;
    driveData.enrollments = driveData.enrollments.filter(en => en.studentId !== 2);
    assertEq(courseNameOn(getCourses()[0], '2025-08-20'), '承軒、子晴數學班');
  });

  test('手取名字的課：不蓋章，退課後仍叫原名', () => {
    setupTwo({ nameAuto: false, name: '週三晚班' });
    dropStudent2();
    assertFalse(!!getCourses()[0].nameAuto);
    assertEq(courseNameOn(getCourses()[0], '2025-08-20'), '週三晚班');
  });
});
