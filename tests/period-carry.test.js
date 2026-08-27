// 期別交接：把上一期的修課登記帶到這一期（js/enrollment.js prevYearPeriodId + js/settings.js coCarry*）
//
// 【在解什麼】
// 修課登記綁在「學年-期別」上。每年 9/1、3/1、7/1 期別翻頁時，全系統撈名單的二十幾處
// 會改用新的期別 id 去查——**舊登記一筆都對不上，每堂課的名單當場變空**。
// 2026-08-27 盤點時發現 9/1 就會發生（那批登記全掛在 2025-summer）。
//
// ⚠️ 頂層名稱一律加 pc 前綴：所有 .test.js 共用同一個全域範圍，撞名會讓整份檔案靜默不執行。

const pcEn = (id, sid, cid, ypid, extra) =>
  Object.assign({ id, studentId: sid, courseId: cid, courseTitle: '國二數學班', periodId: ypid, price: 800 }, extra || {});

function resetCarry() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' },
                  { id: 3, name: '畢業生', grade: '高三', status: '已畢業' }],
    enrollments: [], makeupScheduled: [], coursePrices: [], courseSettings: [], absences: [],
    teachers: [{ id: 1, name: '李老師' }],
    courses: [
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 9, name: '已結束的課', type: '團班', room: '108', status: '已結束', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 3, start: '19:00', end: '20:30' }], phases: [] } },
    ],
  };
  _coCarryPick = null;
}

suite('期別交接 — 上一期是哪一期（prevYearPeriodId）', () => {

  test('上學期的上一期＝去年的暑假（跨學年，9/1 那次就是這條）', () => {
    assertEq(prevYearPeriodId('2026-sem1'), '2025-summer');
  });

  test('同一學年內照 上→寒→下→暑 往回推', () => {
    assertEq(prevYearPeriodId('2026-winter'), '2026-sem1');
    assertEq(prevYearPeriodId('2026-sem2'), '2026-winter');
    assertEq(prevYearPeriodId('2026-summer'), '2026-sem2');
  });

  test('格式不對就回 null（不要亂猜出一個期別來）', () => {
    assertEq(prevYearPeriodId(''), null);
    assertEq(prevYearPeriodId('summer'), null);
    assertEq(prevYearPeriodId('2026-xxx'), null);
    assertEq(prevYearPeriodId(null), null);
  });
});

suite('期別交接 — 卡片什麼時候該出現', () => {

  test('這一期 0 筆、上一期有 → 出現（9/1 早上的處境）', () => {
    resetCarry();
    driveData.enrollments = [pcEn(1, 1, 7, prevYearPeriodId(yearPeriodId()))];
    const info = coCarryInfo();
    assertTrue(!!info, '該出現卡片');
    assertEq(info.rows.length, 1);
  });

  test('這一期已經有登記 → 不出現（不要一直卡在畫面上）', () => {
    resetCarry();
    driveData.enrollments = [
      pcEn(1, 1, 7, prevYearPeriodId(yearPeriodId())),
      pcEn(2, 1, 7, yearPeriodId()),
    ];
    assertEq(coCarryInfo(), null);
  });

  test('上一期也沒東西 → 不出現（全新的系統不要莫名其妙冒一張卡）', () => {
    resetCarry();
    assertEq(coCarryInfo(), null);
  });
});

suite('期別交接 — 帶過來之後的資料長相', () => {

  // coCarryRun 會開確認視窗與重畫，測不到；這裡直接驗它算出來要新增的那幾筆長什麼樣
  function pcCarried(src, curYpid) {
    return src.map(en => makeEnrollment({
      studentId: en.studentId, courseTitle: en.courseTitle, periodId: curYpid,
      price: en.price, courseId: en.courseId, practiceSubject: en.practiceSubject || '', note: en.note || '',
    }));
  }

  test('舊那期一筆都不動，新的是另外長出來的', () => {
    resetCarry();
    const prev = prevYearPeriodId(yearPeriodId());
    const src = [pcEn(1, 1, 7, prev), pcEn(2, 2, 7, prev)];
    driveData.enrollments = src.slice();
    const add = pcCarried(src, yearPeriodId());
    driveData.enrollments = [...driveData.enrollments, ...add];
    assertEq(getEnrollments({ periodId: prev }).length, 2, '上一期還是兩筆');
    assertEq(getEnrollments({ periodId: yearPeriodId() }).length, 2, '這一期多了兩筆');
  });

  test('單價沿用（老闆 8/27：價格照理說不會變）', () => {
    resetCarry();
    const prev = prevYearPeriodId(yearPeriodId());
    const add = pcCarried([pcEn(1, 1, 7, prev, { price: 950 })], yearPeriodId());
    assertEq(add[0].price, 950);
  });

  test('期中加退不帶過來（那是上一期的事，新的一期從頭開始）', () => {
    resetCarry();
    const prev = prevYearPeriodId(yearPeriodId());
    const add = pcCarried([pcEn(1, 1, 7, prev, { startDate: '2026-08-15', endDate: '2026-08-20' })], yearPeriodId());
    assertEq(add[0].startDate, null, 'startDate 要留空');
    assertEq(add[0].endDate, null, 'endDate 要留空');
  });

  test('courseId 與練習科目要跟著走（不然名冊對不回那門課）', () => {
    resetCarry();
    const prev = prevYearPeriodId(yearPeriodId());
    const add = pcCarried([pcEn(1, 1, 7, prev, { practiceSubject: '數學、理化' })], yearPeriodId());
    assertEq(add[0].courseId, 7);
    assertEq(add[0].practiceSubject, '數學、理化');
  });

  test('每一筆是新的 id（沿用舊 id 會被逐筆同步當成同一筆而互相蓋掉）', () => {
    resetCarry();
    const prev = prevYearPeriodId(yearPeriodId());
    const src = [pcEn(1, 1, 7, prev), pcEn(2, 2, 7, prev)];
    const add = pcCarried(src, yearPeriodId());
    assertTrue(add[0].id !== 1 && add[1].id !== 2, '不可以沿用來源的 id');
    assertTrue(add[0].id !== add[1].id, '兩筆之間也要不一樣');
  });
});
