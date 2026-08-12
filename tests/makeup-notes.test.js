// 待補課卡的處理進度留言（2026-08-12，js/makeup.js mkNotes*）
// 載入順序：stubs（index.html 內）→ … → makeup.js → test-runner → 本檔
//
// 最在意的三條：
//  ① 留言要認得出是哪一堂的（occId 對錯了會把小明的進度貼到小華那張卡上）
//  ② 同一筆課在「待安排」與「已安排」兩區各出現一次 → 只有待安排那張能寫，
//     兩張都放輸入框會撞到同一個 DOM id（游標會跳到另一張卡）
//  ③ 寫下去的當下畫面就要有（樂觀更新），不能等雲端回來才出現

// 雲端層在測試裡收掉（真身要 Firebase）：只驗本機狀態與畫面
var _noteWrites = [];
var _noteSeq = 0;
function actDoc() {
  return { set(o) { _noteWrites.push(o); return Promise.resolve(); },
           update(o) { _noteWrites.push(o); return Promise.resolve(); } };
}
var firebase = { firestore: { FieldValue: {
  arrayUnion: (...a) => ({ _union: a }), arrayRemove: (...a) => ({ _remove: a }) } } };
function actMe() { return 'william90525@gmail.com'; }
function actName() { return 'William'; }
function actNewId() { return 'n' + (++_noteSeq); }

function resetNotes() {
  mkNotes = [];
  mkNoteState = { openFor: null, openIn: 'list', draft: '', allFor: null };
  mkNotesPruned = false;
  _noteWrites = []; _noteSeq = 0;
  currentPanel = 'makeup';
}
function noteAt(daysAgo) { return new Date(Date.now() - daysAgo * 864e5).toISOString(); }

// ────────────────────────────────────────────────────────
suite('待補課進度留言：讀進來的資料', () => {

  test('只拿這一堂的留言，舊到新排好', () => {
    resetNotes();
    mkNotesApplySnap({ mkNotes: [
      { id: 'b', occId: 'sys:7:2026-08-11:0', text: '第二則', at: noteAt(1), byName: 'William' },
      { id: 'a', occId: 'sys:7:2026-08-11:0', text: '第一則', at: noteAt(3), byName: 'William' },
      { id: 'c', occId: 'sys:20:2026-08-11:0', text: '別堂的', at: noteAt(2), byName: 'Derek' },
    ] });
    const mine = mkNotesFor('sys:7:2026-08-11:0');
    assertEq(mine.length, 2);
    assertEqDeep(mine.map(n => n.text), ['第一則', '第二則']);
    assertEq(mkNotesFor('sys:20:2026-08-11:0').length, 1);
    assertEq(mkNotesFor('沒這堂').length, 0);
  });

  test('缺 occId／缺時間的殘缺紀錄直接跳過（不要讓一筆爛資料炸掉整張清單）', () => {
    resetNotes();
    mkNotesApplySnap({ mkNotes: [null, { text: '沒 occId', at: noteAt(1) },
      { occId: 'sys:7:2026-08-11:0', text: '沒時間' },
      { id: 'ok', occId: 'sys:7:2026-08-11:0', text: '好的', at: noteAt(1), byName: 'William' }] });
    assertEq(mkNotes.length, 1);
    assertEq(mkNotes[0].text, '好的');
  });

  test('超過保留期限的留言不再顯示，並排進清理名單', () => {
    resetNotes();
    mkNotesApplySnap({ mkNotes: [
      { id: 'old', occId: 'sys:7:2026-08-11:0', text: '半年前', at: noteAt(MK_NOTE_KEEP_DAYS + 5), byName: 'W' },
      { id: 'new', occId: 'sys:7:2026-08-11:0', text: '今天', at: noteAt(0), byName: 'W' },
    ] });
    assertEqDeep(mkNotes.map(n => n.id), ['new']);
    assertEq(_noteWrites.length, 1);                       // 清理只發一次
    assertEq(_noteWrites[0].mkNotes._remove[0].id, 'old');
  });

  test('沒有 mkNotes 欄位的舊文件不會壞（三個人裡有人還沒寫過任何進度）', () => {
    resetNotes();
    mkNotesApplySnap({ todos: [], events: [] });
    assertEq(mkNotes.length, 0);
  });
});

suite('待補課進度留言：寫入與畫面', () => {

  test('寫下去當場就看得到，形狀含 occId／作者／時間', () => {
    resetNotes();
    mkNoteState.draft = '打去問了，媽媽週三回覆';
    mkNoteAdd('sys:7:2026-08-11:0');                       // 不 await：樂觀更新是同步的
    const all = mkNotesFor('sys:7:2026-08-11:0');
    assertEq(all.length, 1);
    assertEq(all[0].text, '打去問了，媽媽週三回覆');
    assertEq(all[0].byName, 'William');
    assertTrue(!!all[0].at, '沒寫時間');
    assertEq(mkNoteState.draft, '');                       // 送出後清空
    assertEq(mkNoteState.openFor, null);                   // 輸入框收起來
  });

  test('空白內容不寫進去', () => {
    resetNotes();
    mkNoteState.draft = '   ';
    mkNoteAdd('sys:7:2026-08-11:0');
    assertEq(mkNotes.length, 0);
  });

  test('雲端寫入走 arrayUnion（兩個人同一秒寫不會互蓋）', () => {
    resetNotes();
    mkNoteState.draft = '已排好時間';
    mkNoteAdd('sys:7:2026-08-11:0');
    assertEq(_noteWrites.length, 1);
    assertEq(_noteWrites[0].mkNotes._union[0].text, '已排好時間');
  });

  test('只有待安排卡有輸入框；已安排那張同一筆課不能再撞一次 DOM id', () => {
    resetNotes();
    const ev = { id: 'sys:7:2026-08-11:0' };
    mkNoteOpen(ev.id);
    assertTrue(mkNotesHtml(ev, true).includes('id="mk-note-input-list"'), '待安排卡該有輸入框');
    assertFalse(mkNotesHtml(ev, false).includes('mk-note-input'), '已安排卡不該有輸入框');
  });

  test('沒有留言、也沒在寫的卡＝完全不長東西', () => {
    resetNotes();
    assertEq(mkNotesHtml({ id: 'sys:7:2026-08-11:0' }, true), '');
  });

  test('卡片很擠：預設只露最新那則，點了才全開', () => {
    resetNotes();
    mkNotesApplySnap({ mkNotes: [1, 2, 3, 4].map(i => (
      { id: 'p' + i, occId: 'sys:7:2026-08-11:0', text: '第' + i + '則', at: noteAt(10 - i), byName: 'W' })) });
    const ev = { id: 'sys:7:2026-08-11:0' };
    const folded = mkNotesHtml(ev, true);
    assertTrue(folded.includes('第4則'), '最新那則要露出來');
    assertFalse(folded.includes('第3則'), '收合時只該露一則');
    assertTrue(folded.includes('前面還有 3 則'), '沒給展開的入口');
    mkNoteAll(ev.id);
    const opened = mkNotesHtml(ev, true);
    assertTrue(opened.includes('第1則') && opened.includes('第4則'), '展開後要看得到全部');
  });

  test('每一則都有自己的刪除鈕（輸入錯了整則刪掉、串太長了刪其中一則）', () => {
    resetNotes();
    mkNotesApplySnap({ mkNotes: [1, 2].map(i => (
      { id: 'p' + i, occId: 'sys:7:2026-08-11:0', text: '第' + i + '則', at: noteAt(3 - i), byName: 'W' })) });
    const ev = { id: 'sys:7:2026-08-11:0' };
    mkNoteAll(ev.id);
    const html = mkNotesHtml(ev, true);
    assertTrue(html.includes(`mkNoteDel('p1')`) && html.includes(`mkNoteDel('p2')`), '刪除鈕要一則一顆');
    // 已安排／已完成那幾區也給刪（唯讀只是不能再寫，不是不能改錯）
    assertTrue(mkNotesHtml(ev, false).includes('mkNoteDel('), '唯讀卡也要能刪');
  });

  // mkNoteDel＝確認視窗 + mkNoteRemove，這裡測動手的那半（視窗那半是共用元件）
  test('刪掉一則：畫面當場少一則，雲端走 arrayRemove 只拔那一筆', () => {
    resetNotes();
    mkNotesApplySnap({ mkNotes: [
      { id: 'p1', occId: 'sys:7:2026-08-11:0', text: '留著的', at: noteAt(2), byName: 'W' },
      { id: 'p2', occId: 'sys:7:2026-08-11:0', text: '打錯的', at: noteAt(1), byName: 'W' },
      { id: 'p3', occId: 'sys:20:2026-08-11:0', text: '別堂的', at: noteAt(1), byName: 'W' },
    ] });
    _noteWrites = [];
    mkNoteRemove('p2');
    assertEqDeep(mkNotesFor('sys:7:2026-08-11:0').map(n => n.id), ['p1']);
    assertEq(mkNotesFor('sys:20:2026-08-11:0').length, 1);   // 別堂的不能被掃到
    assertEq(_noteWrites.length, 1);
    assertEq(_noteWrites[0].mkNotes._remove[0].id, 'p2');    // 整份寫回會洗掉別人同時寫的
  });

  test('刪不存在的 id＝什麼都不動（重複點兩下不會炸）', () => {
    resetNotes();
    mkNotesApplySnap({ mkNotes: [{ id: 'p1', occId: 'sys:7:2026-08-11:0', text: '在', at: noteAt(1), byName: 'W' }] });
    _noteWrites = [];
    assertEq(mkNoteRemove('沒這則'), null);
    assertEq(mkNotes.length, 1);
    assertEq(_noteWrites.length, 0);
  });

  test('留言內容有 HTML 也照字面顯示（不給人在卡片裡塞標籤）', () => {
    resetNotes();
    mkNotesApplySnap({ mkNotes: [{ id: 'x', occId: 'sys:7:2026-08-11:0',
      text: '<img src=x onerror=alert(1)>', at: noteAt(0), byName: 'W' }] });
    const html = mkNotesHtml({ id: 'sys:7:2026-08-11:0' }, false);
    assertFalse(html.includes('<img'), '沒跳脫，標籤被當成 HTML 吃進去了');
    assertTrue(html.includes('&lt;img'), '應該原樣顯示文字');
  });
});

// ────────────────────────────────────────────────────────
// 同一串留言畫在兩個地方：待補課清單（list）與桌面日曆側欄（dv）。
// 兩邊是同一份 DOM（切分頁只是 display:none）→ 輸入框同名的話 focus 會跑去看不見的那個
suite('待補課進度留言：待補課清單與桌面日曆側欄共用', () => {

  test('輸入框的 id 各自帶畫面代號，不會撞在一起', () => {
    resetNotes();
    const ev = { id: 'sys:7:2026-08-11:0' };
    mkNoteOpen(ev.id, 'dv');
    assertTrue(mkNotesHtml(ev, true, 'dv').includes('id="mk-note-input-dv"'), '側欄的框沒開');
    assertFalse(mkNotesHtml(ev, true, 'list').includes('mk-note-input'), '清單那邊不該同時長一個框');
    mkNoteOpen(ev.id, 'list');
    assertTrue(mkNotesHtml(ev, true, 'list').includes('id="mk-note-input-list"'), '清單的框沒開');
    assertFalse(mkNotesHtml(ev, true, 'dv').includes('mk-note-input'), '側欄那邊該收起來了');
  });

  test('同一堂的留言兩邊看到的是同一串', () => {
    resetNotes();
    mkNoteState.draft = '從側欄寫的';
    mkNoteAdd('sys:7:2026-08-11:0');
    const ev = { id: 'sys:7:2026-08-11:0' };
    assertTrue(mkNotesHtml(ev, true, 'list').includes('從側欄寫的'), '清單那邊沒看到');
    assertTrue(mkNotesHtml(ev, true, 'dv').includes('從側欄寫的'), '側欄那邊沒看到');
  });
});
