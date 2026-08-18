// 桌面日曆側欄的練習課名冊（dayview.js _dvPracGroups）
// 規則：側欄預設長成課程主頁課程卡那個樣子——「年級 ｜ 科目 ｜ 名字、名字…」，一行一科。
// 分法與卡片一致（today.js pracRosterHtml）：一位學生練兩類科目會在兩行各出現一次。
// 併班補課生在這堂沒有登記＝沒有科目，自成一列「補課生」擺最後。
// 載入順序：stubs（index.html 內）→ js/utils.js → js/dayview.js → js/courses.js → js/students.js → 本檔

function dprSetStudents(list) {
  driveData.studentList = list;
}
// 呼叫端（renderDvInspector）怎麼把 studentGroups 攤成 name→科目，這裡照抄
function dprSubjOf(groups) {
  const m = new Map();
  (groups || []).forEach(g => g.students.forEach(nm => m.set(nm, m.has(nm) ? m.get(nm) + '、' + g.subject : g.subject)));
  return m;
}
function dprGroups(ev, roster) {
  return _dvPracGroups(ev, roster, dprSubjOf(ev.studentGroups));
}
// 攤成好讀的形狀：[['國二', [['數學', '士翔、晉瑋']]], ...]
function dprFlat(grps) {
  return (grps || []).map(g => [g.grade, g.lines.map(l => [l.subj, l.names.join('、')])]);
}

suite('桌面日曆側欄：練習課名冊（年級 ｜ 科目 ｜ 名字）', () => {

  test('依年級 → 科目分行，順序與課程卡一致', () => {
    dprSetStudents([
      { id: 1, name: '士翔', grade: '國二' },
      { id: 2, name: '晉瑋', grade: '國二' },
      { id: 3, name: '芙嫚', grade: '國二' },
      { id: 4, name: '慕萱', grade: '國三' },
    ]);
    const ev = {
      type: 'practice',
      studentGroups: [
        { subject: '英文', students: ['芙嫚'] },
        { subject: '數學', students: ['士翔', '晉瑋'] },
        { subject: '數學', students: ['慕萱'] },
      ],
    };
    const roster = [
      { studentId: 3, name: '芙嫚' }, { studentId: 1, name: '士翔' },
      { studentId: 2, name: '晉瑋' }, { studentId: 4, name: '慕萱' },
    ];
    assertEqDeep(dprFlat(dprGroups(ev, roster)), [
      ['國二', [['數學', '士翔、晉瑋'], ['英文', '芙嫚']]],   // 年級低到高、科目照常用順序
      ['國三', [['數學', '慕萱']]],
    ]);
  });

  test('練兩類科目的人兩行都出現（跟課程卡同一套）', () => {
    dprSetStudents([{ id: 1, name: '侑軒', grade: '國二' }, { id: 2, name: '品叡', grade: '國二' }]);
    const ev = {
      type: 'practice',
      studentGroups: [
        { subject: '數理', students: ['品叡'] },          // 數學＋理化在展開器就併成「數理」
        { subject: '數理、英文', students: ['侑軒'] },
      ],
    };
    assertEqDeep(dprFlat(dprGroups(ev, [{ studentId: 1, name: '侑軒' }, { studentId: 2, name: '品叡' }])),
      [['國二', [['數理', '侑軒、品叡'], ['英文', '侑軒']]]]);   // 行內名字照名冊（＝登記）順序
  });

  test('沒填科目排最後；併班補課生自成一列在更後面', () => {
    dprSetStudents([
      { id: 1, name: '新力', grade: '國二' },
      { id: 2, name: '品叡', grade: '國二' },
      { id: 9, name: '彥勳', grade: '國三' },
    ]);
    const ev = {
      type: 'practice',
      studentGroups: [
        { subject: '數理', students: ['新力'] },
        { subject: '（未填科目）', students: ['品叡'] },   // 展開器用全形括號代表沒填
      ],
    };
    const roster = [
      { studentId: 1, name: '新力' }, { studentId: 2, name: '品叡' },
      { studentId: 9, name: '彥勳', join: true, fromTitle: '國三數學班' },
    ];
    assertEqDeep(dprFlat(dprGroups(ev, roster)), [
      ['國二', [['數理', '新力'], ['未填科目', '品叡']]],
      ['補課生', [['', '彥勳']]],
    ]);
  });

  test('查不到年級（同名兩個人）歸「未填年級」，排在有年級的後面', () => {
    dprSetStudents([
      { id: 1, name: '宥澄', grade: '國一' }, { id: 2, name: '宥澄', grade: '國三' },
      { id: 3, name: '永晴', grade: '國三' },
    ]);
    const ev = { type: 'practice', studentGroups: [{ subject: '數學', students: ['宥澄', '永晴'] }] };
    assertEqDeep(dprFlat(dprGroups(ev, [{ studentId: null, name: '宥澄' }, { studentId: 3, name: '永晴' }])), [
      ['國三', [['數學', '永晴']]],
      ['未填年級', [['數學', '宥澄']]],
    ]);
  });

  test('整堂沒人填科目也照樣分行（未填科目），不會退回逐人名單', () => {
    dprSetStudents([{ id: 1, name: '新力', grade: '國二' }]);
    assertEqDeep(dprFlat(dprGroups({ type: 'practice', studentGroups: [] }, [{ studentId: 1, name: '新力' }])),
      [['國二', [['未填科目', '新力']]]]);
  });

  test('不是練習課、或名冊空的 → null（維持原本那條逐人的名單）', () => {
    dprSetStudents([{ id: 1, name: '新力', grade: '國二' }]);
    assertEq(dprGroups({ type: 'group', studentGroups: [{ subject: '數理', students: ['新力'] }] },
      [{ studentId: 1, name: '新力' }]), null);
    assertEq(dprGroups({ type: 'practice', studentGroups: [] }, []), null);
  });

});

// ── 點名／成績面板的分段（utils.js pracRosterSections）──
// 跟上面那組刻意不同：這裡每列有到／遲到／曠的按鈕與成績輸入框，**一個人只能出現一次**，
// 所以多科的人歸在合併標籤那一段，不拆到兩段去。
function dprSecFlat(secs) {
  return (secs || []).map(s => [s.grade + '｜' + s.subj, s.rows.map(r => r.name).join('、')]);
}

suite('點名／成績面板：練習課分段（一個人只出現一次）', () => {

  test('依年級 → 科目切段，多科的人歸在合併那一段', () => {
    dprSetStudents([
      { id: 1, name: '侑軒', grade: '國二' }, { id: 2, name: '品叡', grade: '國二' },
      { id: 3, name: '慕萱', grade: '國三' },
    ]);
    const ev = {
      type: 'practice',
      studentGroups: [
        { subject: '數理', students: ['品叡'] },
        { subject: '數理、英文', students: ['侑軒'] },
        { subject: '數學', students: ['慕萱'] },
      ],
    };
    const roster = [{ studentId: 1, name: '侑軒' }, { studentId: 2, name: '品叡' }, { studentId: 3, name: '慕萱' }];
    const secs = pracRosterSections(ev, roster);
    assertEqDeep(dprSecFlat(secs), [
      ['國二｜數理', '品叡'],
      ['國二｜數理、英文', '侑軒'],
      ['國三｜數學', '慕萱'],
    ]);
    // 段內列數加起來＝名冊人數（點名 x/y 對得起來）
    assertEq(secs.reduce((n, s) => n + s.rows.length, 0), roster.length);
  });

  test('未填科目排最後、補課生自成一段在更後面', () => {
    dprSetStudents([{ id: 1, name: '新力', grade: '國二' }, { id: 2, name: '品叡', grade: '國二' },
      { id: 9, name: '彥勳', grade: '國三' }]);
    const ev = {
      type: 'practice',
      studentGroups: [{ subject: '數理', students: ['新力'] }, { subject: '（未填科目）', students: ['品叡'] }],
    };
    const roster = [{ studentId: 1, name: '新力' }, { studentId: 2, name: '品叡' },
      { studentId: 9, name: '彥勳', join: true, fromTitle: '國三數學班' }];
    assertEqDeep(dprSecFlat(pracRosterSections(ev, roster)), [
      ['國二｜數理', '新力'],
      ['國二｜未填科目', '品叡'],
      ['補課生｜', '彥勳'],
    ]);
  });

  test('不是練習課、或名冊空的 → null（面板維持原本不分段的名單）', () => {
    dprSetStudents([{ id: 1, name: '新力', grade: '國二' }]);
    assertEq(pracRosterSections({ type: 'group', studentGroups: [] }, [{ studentId: 1, name: '新力' }]), null);
    assertEq(pracRosterSections({ type: 'practice', studentGroups: [] }, []), null);
  });

});
