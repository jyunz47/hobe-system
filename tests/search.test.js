// 全站搜尋測試（search.js gsBuild / gsGroups / gsScore）
// 測的是「打什麼字找得到什麼、誰排前面」，不碰 DOM（gsRender/gsPick 那半段要瀏覽器）。
// 載入順序：js/state.js → stubs → enrollment/schedule/courses/... /search.js → test-runner → 本檔

const GSC_MATH = 1900000100000;    // 高二數學班（王老師，週五 18:00，淇倫＋臻亞）
const GSC_TUT = 1900000100001;     // 佳潼理化家教（陳老師，週二 17:00）
const GST_WANG = 2000000100000;    // 王老師（在職）
const GST_CHEN = 2000000100001;    // 陳老師（離職）

function gsReset() {
  driveData = {
    studentList: [
      { id: 1, name: '淇倫', grade: '高二', school: '中正高中', status: '在學' },
      { id: 2, name: '臻亞', grade: '高二', school: '北一女', status: '在學' },
      { id: 3, name: '佳潼', grade: '國三', school: '石牌國中', status: '在學' },
      { id: 4, name: '淇恩', grade: '高三', school: '中正高中', status: '畢業' },
    ],
    teachers: [
      { id: GST_WANG, name: '王老師', status: '在職' },
      { id: GST_CHEN, name: '陳老師', status: '離職' },
    ],
    courses: [
      { id: GSC_MATH, name: '高二數學班', type: '團班', subject: '數學', room: '大教室',
        teacherIds: [GST_WANG], nameAuto: false,
        schedule: { mode: 'weekly', slots: [{ weekday: 5, start: '18:00', end: '20:00' }] } },
      { id: GSC_TUT, name: '佳潼理化家教', type: '一對一', subject: '理化', room: '108',
        teacherIds: [GST_CHEN], nameAuto: false,
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '17:00', end: '19:00' }] } },
    ],
    enrollments: [
      { id: 1, studentId: 1, courseId: GSC_MATH, periodId: '2025-sem2' },
      { id: 2, studentId: 2, courseId: GSC_MATH, periodId: '2025-sem2' },
      { id: 3, studentId: 3, courseId: GSC_TUT, periodId: '2025-sem2' },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [], absences: [],
  };
  currentPeriodId = 'sem2';
}

// 結果裡的 kind:id 清單（好寫斷言）
function gsKeys(q) { return gsBuild(q).map(r => r.kind + ':' + r.id); }
function gsNames(q, kind) { return gsBuild(q).filter(r => r.kind === kind).map(r => r.name); }

suite('全站搜尋：找得到（search.js gsBuild）', () => {
  gsReset();

  test('空字串不回任何結果（不要一聚焦就噴整份名單）', () => {
    assertEq(gsBuild('').length, 0);
    assertEq(gsBuild('   ').length, 0);
  });

  test('打課程名稱找得到那門課', () => {
    assertTrue(gsKeys('高二數學').includes('course:' + GSC_MATH), '應該找到高二數學班');
  });

  test('打科目也找得到課（理化 → 佳潼理化家教）', () => {
    assertTrue(gsKeys('理化').includes('course:' + GSC_TUT), '科目命中');
  });

  test('打老師姓名：老師本人 + 他教的課都出來', () => {
    const keys = gsKeys('王老師');
    assertTrue(keys.includes('teacher:' + GST_WANG), '要有老師本人');
    assertTrue(keys.includes('course:' + GSC_MATH), '要有他教的課');
  });

  test('打學生姓名：學生本人 + 他修的課都出來', () => {
    const keys = gsKeys('臻亞');
    assertTrue(keys.includes('student:2'), '要有學生本人');
    assertTrue(keys.includes('course:' + GSC_MATH), '要有他修的課');
  });

  test('打學校找得到學生（中正高中 → 淇倫、淇恩）', () => {
    const names = gsNames('中正', 'student');
    assertTrue(names.includes('淇倫') && names.includes('淇恩'), '實際：' + names.join('/'));
  });

  test('打教室找得到課（大教室 → 高二數學班）', () => {
    assertTrue(gsKeys('大教室').includes('course:' + GSC_MATH));
  });

  test('大小寫與前後空白不影響（英文名／貼上來的字）', () => {
    driveData.studentList.push({ id: 9, name: 'Amy', grade: '國一', school: '', status: '在學' });
    assertTrue(gsKeys('  amy  ').includes('student:9'), 'amy 應該找得到 Amy');
    driveData.studentList.pop();
  });

  test('查無此人回空陣列', () => {
    assertEq(gsBuild('沒有這個人').length, 0);
  });
});

suite('全站搜尋：多關鍵字是 AND（search.js gsHitAll）', () => {
  gsReset();

  test('「王 數學」＝王老師的數學課（兩個字都要中）', () => {
    assertTrue(gsKeys('王 數學').includes('course:' + GSC_MATH), '王老師的數學課要在');
    assertFalse(gsKeys('王 數學').includes('course:' + GSC_TUT), '陳老師的理化課不該在');
  });

  test('兩個字分別命中不同欄位也算（老師欄 + 學生欄）', () => {
    assertTrue(gsKeys('王 臻亞').includes('course:' + GSC_MATH));
  });

  test('其中一個字沒中就整筆不算', () => {
    assertFalse(gsKeys('王 英文').includes('course:' + GSC_MATH));
  });
});

suite('全站搜尋：排序（search.js gsScore / gsGroups）', () => {
  gsReset();

  test('名字完全相同排在「只是包含」前面', () => {
    assertTrue(gsScore('淇倫', ['淇倫']) < gsScore('淇倫的數學課', ['淇倫']));
  });

  test('名字開頭命中排在中間命中前面', () => {
    assertTrue(gsScore('數學班', ['數']) < gsScore('高二數學班', ['數']));
  });

  test('名字完全沒中（靠關聯欄位找到的）分數最差', () => {
    assertEq(gsScore('高二數學班', ['王老師']), 3);
  });

  test('打學生姓名時「學生」組排在最前面', () => {
    const g = gsGroups(gsBuild('臻亞'));
    assertEq(g[0].kind, 'student', '實際第一組：' + g.map(x => x.kind).join('/'));
  });

  test('打課名時兩個課程組排在最前面，課程主頁又在課程管理之前', () => {
    const g = gsGroups(gsBuild('高二數學班')).map(x => x.kind);
    assertEqDeep(g.slice(0, 2), ['occ', 'course'], '實際：' + g.join('/'));
  });

  test('歷屆學生排在同分的在學學生後面', () => {
    const names = gsNames('淇', 'student');
    assertEqDeep(names, ['淇倫', '淇恩'], '在學的淇倫要在畢業的淇恩前面');
  });

  test('離職老師排在同分的在職老師後面', () => {
    const names = gsNames('老師', 'teacher');
    assertEqDeep(names, ['王老師', '陳老師'], '在職的王老師要在離職的陳老師前面');
  });
});

suite('全站搜尋：課程主頁的課堂（未來日期也找得到）', () => {
  gsReset();
  const occsOf = (q, cid) => gsBuild(q).filter(r => r.kind === 'occ' && (cid == null || r.courseId === cid));

  test('搜課名會列出接下來的課堂', () => {
    assertTrue(occsOf('高二數學班', GSC_MATH).length > 0, '應該至少列一堂');
  });

  test('不是只有今天——未來日期的課堂也在（這正是老闆要的）', () => {
    const now = Date.now();
    assertTrue(occsOf('高二數學班', GSC_MATH).some(r => r.occTs > now + 864e5),
      '應該有明天以後的課堂');
  });

  test('同一門課最多列 GS_OCC_PER_COURSE 堂（列太多會把別門課擠掉）', () => {
    const n = occsOf('高二數學班', GSC_MATH).length;
    assertTrue(n <= GS_OCC_PER_COURSE, '實際列了 ' + n + ' 堂');
  });

  test('課堂按時間排，早的在前', () => {
    const ts = occsOf('高二數學班', GSC_MATH).map(r => r.occTs);
    assertEqDeep(ts, ts.slice().sort((a, b) => a - b));
  });

  test('每一堂都帶得回自己的課堂 id 與日期（點下去要開得了視窗）', () => {
    occsOf('高二數學班', GSC_MATH).forEach(r => {
      assertTrue(/^sys:\d+:\d{4}-\d{2}-\d{2}:\d+$/.test(r.id), '課堂 id 格式：' + r.id);
      assertTrue(r.occTs > 0, '要有日期');
    });
  });

  test('已結束的課不列課堂，但「課程管理」那組還找得到它', () => {
    driveData.courses.find(c => c.id === GSC_MATH).status = '已結束';
    assertEq(occsOf('高二數學班', GSC_MATH).length, 0);
    assertTrue(gsBuild('高二數學班').some(r => r.kind === 'course' && r.id === GSC_MATH),
      '課程本體還是要搜得到（要進去改設定）');
    gsReset();
  });

  test('一句話同時打到四組：課程主頁 / 課程管理 / 老師 / 學生', () => {
    const kinds = gsGroups(gsBuild('數學')).map(g => g.kind);
    ['occ', 'course', 'teacher', 'student'].forEach(k =>
      assertTrue(kinds.includes(k), '缺了 ' + k + ' 組，實際：' + kinds.join('/')));
  });
});

suite('桌面日曆搜尋：只找課堂（search.js gsDvResults / gsMakeupOccs）', () => {
  // 桌面日曆視窗沒有側欄，切分頁就回不來 → 那裡的搜尋只回「課堂」，不回課程本體／老師／學生
  gsReset();

  test('只回課堂，不回課程管理／老師／學生', () => {
    const kinds = [...new Set(gsDvResults('數學').map(r => r.kind))];
    assertEqDeep(kinds, ['occ'], '實際有這些種類：' + kinds.join('/'));
  });

  test('打老師姓名也找得到他的課堂', () => {
    assertTrue(gsDvResults('王老師').length > 0, '王老師的課堂應該找得到');
  });

  test('打學生姓名也找得到他修的課堂', () => {
    assertTrue(gsDvResults('臻亞').length > 0, '臻亞在高二數學班，應該找得到那些課堂');
  });

  test('照日期排、最多 GS_DV_MAX 筆', () => {
    const rs = gsDvResults('數學');
    assertTrue(rs.length <= GS_DV_MAX, '實際 ' + rs.length + ' 筆');
    assertEqDeep(rs.map(r => r.occTs), rs.map(r => r.occTs).slice().sort((a, b) => a - b));
  });

  test('只命中一門課時多列幾堂（在日曆裡通常就是要挑它的某一天）', () => {
    const one = gsDvResults('高二數學班');
    assertTrue(one.length > GS_OCC_PER_COURSE,
      '只有一門課命中時應該列超過 ' + GS_OCC_PER_COURSE + ' 堂，實際 ' + one.length);
  });

  test('已排的補課場次也找得到（它是行事曆上真的一堂課）', () => {
    driveData.makeupScheduled = [{
      id: 5001, originalId: 'sys:' + GSC_MATH + ':2026-01-01:0',
      scheduledDate: new Date(Date.now() + 2 * 864e5).toISOString(),
      scheduledEnd: new Date(Date.now() + 2 * 864e5 + 90 * 60000).toISOString(),
      room: '208', origTitle: '高二數學班', absentStudents: ['淇倫'], calName: '補課',
    }];
    const rs = gsDvResults('高二數學班');
    assertTrue(rs.some(r => r.id === 'mk:5001'), '補課場次應該在結果裡');
    gsReset();
  });

  test('空字串不回東西（一打開不要噴整份課表）', () => {
    assertEq(gsDvResults('').length, 0);
    assertEq(gsDvResults('  ').length, 0);
  });
});

suite('全站搜尋：日期小工具（search.js gsWeekOffsetOf / gsOccWhen）', () => {
  test('今天＝本週（offset 0）、七天後＝下一週（offset 1）', () => {
    assertEq(gsWeekOffsetOf(new Date()), 0);
    assertEq(gsWeekOffsetOf(new Date(Date.now() + 7 * 864e5)), 1);
    assertEq(gsWeekOffsetOf(new Date(Date.now() - 7 * 864e5)), -1);
  });

  test('今天／明天講白話，再遠就寫日期', () => {
    assertEq(gsOccWhen(new Date()), '今天');
    assertEq(gsOccWhen(new Date(Date.now() + 864e5)), '明天');
    const d = new Date(Date.now() + 3 * 864e5);
    assertEq(gsOccWhen(d), `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`);
  });
});

suite('全站搜尋：分組與截斷（search.js gsGroups）', () => {
  gsReset();

  test('每組最多 GS_MAX 筆，其餘收成 more', () => {
    const many = [];
    for (let i = 0; i < GS_MAX + 3; i++) many.push({ id: 100 + i, name: '測試' + i, grade: '國一', school: '', status: '在學' });
    driveData.studentList = many;
    const g = gsGroups(gsBuild('測試'));
    assertEq(g[0].total, GS_MAX + 3, '總數要照實算');
    assertEq(g[0].items.length, GS_MAX, '只顯示 GS_MAX 筆');
    assertEq(g[0].more, 3, '其餘收成 more');
    gsReset();
  });

  test('沒有結果的組不出現', () => {
    const kinds = gsGroups(gsBuild('中正')).map(g => g.kind);
    assertEqDeep(kinds, ['student'], '只有學生中，不該多出空的課程／老師組');
  });
});
