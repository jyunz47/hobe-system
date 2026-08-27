// 復原「剛才那一下」（js/undo.js）
//
// 這裡測的是**反向 ops** 這條核心：復原不是另寫一套還原程式，而是把
//   diffRecords(現在, 動作前)
// 算出來的 ops 用 applyOps 套回去。所以只要證明「套回去之後跟動作前一樣」，
// 復原就是對的——不管那個動作是刪、是改、是新增、還是一次動好幾筆。
//
// 起因：2026-08-27 老闆不小心按到待補課卡的「取消安排」，一場排好的補課當場消失。
//
// ⚠️ 這一組刻意不碰 DOM 也不碰 Firebase：undoOffer／undoRun 要抓 driveData 與畫面，
//    那些在瀏覽器實測比較實在。這裡專測「還原算得對不對」這個會靜默錯掉的部分。
//
// ⚠️ 所有 .test.js 是用 <script> 載進**同一個全域範圍**的，頂層的 const 會互相撞。
//    撞到的話那一整份檔案直接不執行（SyntaxError），而且測試頁上完全看不出來——只會發現
//    總數莫名少了幾條。所以這裡的頂層名稱一律加 undo 前綴（2026-08-27 撞了 sync-merge
//    的 byId 才學到，當時是「新測試一條都沒跑，但頁面上沒有任何錯誤」）。

const undoMkKey = r => r && r.id;   // 補課紀錄的鑰匙（跟 SYNC_KEYFN.makeupScheduled 同一把）

// 一場補課長什麼樣（只留這組測試會看的欄位）
const undoMk = (id, who, date) => ({ id, originalId: 'occ-1', absentStudents: who, scheduledDate: date, room: '308', calName: '補課' });

// 「動作前 → 動作後」的反向 ops，套回動作後，應該要變回動作前
function undoBack(before, after, keyOf) {
  const ops = diffRecords(after, before, keyOf || undoMkKey);
  return applyOps(after, ops, keyOf || undoMkKey);
}

// ⚠️ 比內容、不比順序：applyOps 刻意保留「雲端那份的順序」（別台的排列不會因為我存個檔
//    就被重排），所以復原回來的那筆是接在**陣列最後面**，不是回到原本的位置。
//    使用者看不到這件事——待補課清單與課表都自己照日期排序，陣列順序不影響任何畫面。
const undoSortById = list => list.slice().sort((x, y) => String(x.id).localeCompare(String(y.id)));

suite('復原 — 反向 ops 算得對（js/undo.js 的核心）', () => {

  test('取消一場補課 → 復原之後那場回來了（老闆 8/27 踩到的那個）', () => {
    const a = undoMk('mk_1', ['岑安'], '2026-08-27T16:00:00.000Z');
    const b = undoMk('mk_2', ['小華'], '2026-08-28T18:00:00.000Z');
    const before = [a, b];
    const after = [b];                       // deleteMakeupScheduled 把 mk_1 濾掉了
    assertEqDeep(undoSortById(undoBack(before, after)), undoSortById(before), '復原後的內容應該跟取消前一樣');
  });

  test('復原回來的那筆接在陣列最後（applyOps 保留雲端順序，不是 bug）', () => {
    const a = undoMk('mk_1', ['岑安'], '2026-08-27T16:00:00.000Z');
    const b = undoMk('mk_2', ['小華'], '2026-08-28T18:00:00.000Z');
    const restored = undoBack([a, b], [b]);
    assertEqDeep(restored.map(r => r.id), ['mk_2', 'mk_1'], '順序會變，但畫面照日期排所以看不出來');
  });

  test('一次取消整堂的三場 → 復原把三場都放回來', () => {
    const before = [undoMk('mk_1', ['甲'], '2026-08-27T16:00:00.000Z'),
                    undoMk('mk_2', ['乙'], '2026-08-27T17:00:00.000Z'),
                    undoMk('mk_3', ['丙'], '2026-08-27T18:00:00.000Z')];
    const after = [];                        // deleteMakeupsForOcc 整堂撤掉
    assertEqDeep(undoBack(before, after), before, '三場都要回來');
  });

  test('改時間（不是刪）→ 復原改回原本的時間', () => {
    const before = [undoMk('mk_1', ['岑安'], '2026-08-27T16:00:00.000Z')];
    const after = [Object.assign({}, before[0], { scheduledDate: '2026-08-29T20:00:00.000Z' })];
    assertEqDeep(undoBack(before, after), before, '時間要退回去');
  });

  test('新增一場 → 復原把它拿掉（不是留著）', () => {
    const before = [undoMk('mk_1', ['岑安'], '2026-08-27T16:00:00.000Z')];
    const after = [before[0], undoMk('mk_2', ['小華'], '2026-08-28T18:00:00.000Z')];
    assertEqDeep(undoBack(before, after), before, '新排的那場要消失');
  });

  test('動作其實沒改到東西 → 反向 ops 是空的（不該掛出復原軟籤）', () => {
    const list = [undoMk('mk_1', ['岑安'], '2026-08-27T16:00:00.000Z')];
    const ops = diffRecords(list, list.slice(), undoMkKey);
    assertFalse(syncHasOps(ops), '沒動就不該有 ops');
  });

  test('別台在這 12 秒內插進來一場新的 → 復原不會把它一起清掉', () => {
    // 這是那條「多裝置取捨」的另一面：復原只動「我那個動作碰過的那幾筆」，
    // 別台新增的筆不在反向 ops 裡，所以留得住。
    const a = undoMk('mk_1', ['岑安'], '2026-08-27T16:00:00.000Z');
    const before = [a];
    const afterMine = [];                                        // 我取消掉了
    const other = undoMk('mk_9', ['別台排的'], '2026-08-30T19:00:00.000Z');
    const nowOnScreen = [other];                                 // 別台的透過 onSnapshot 進來了
    const ops = diffRecords(afterMine, before, undoMkKey);       // 反向 ops 照「我的動作」算
    const restored = applyOps(nowOnScreen, ops, undoMkKey);
    assertTrue(restored.some(r => r.id === 'mk_1'), '我取消的那場要回來');
    assertTrue(restored.some(r => r.id === 'mk_9'), '別台新排的那場不能被清掉');
  });

  test('認不出筆別（有紀錄沒 id）→ 標成 unmergeable，undoOffer 會放棄提供復原', () => {
    const before = [{ originalId: 'occ-1', absentStudents: ['舊資料沒有 id'] }];
    const after = [];
    const ops = diffRecords(after, before, undoMkKey);
    assertTrue(ops.unmergeable, '沒鑰匙就不能逐筆還原，要退出而不是猜');
  });

  test('對照組：反向 ops 不套回去的話，那場就是真的不見了', () => {
    const after = [];
    assertFalse(after.some(r => r.id === 'mk_1'), '沒有復原就找不回來——這就是 8/27 的處境');
  });
});

// ── 第二種資料源：期別文件（點名／成績）──
// 這些不在 driveData 裡（一學年上萬筆會撐爆單文件），資料在各自的快取。
// undo 因此把「可復原的位置」抽成 read/write/keyOf/save 四件事，兩種資料源共用同一套算法。
suite('復原 — 期別文件也走同一套（點名／成績）', () => {

  const att = (ev, sid, status, late) => ({ eventId: ev, date: '2026-08-27', studentId: sid, status, lateMin: late || 0 });

  test('一鍵「全部到」標了五個人 → 復原把五筆都收回去', () => {
    const before = [];                                   // 這堂還沒點過名
    const after = ['s1', 's2', 's3', 's4', 's5'].map(s => att('ev-1', s, '到'));
    const ops = diffRecords(after, before, attKeyOf);
    assertEqDeep(applyOps(after, ops, attKeyOf), [], '五筆都要回到未點名');
  });

  test('「全部到」之前已經有人被標遲到 → 復原退回遲到那筆，不是清成空的', () => {
    const late = att('ev-1', 's2', '到', 15);
    const before = [late];
    // markAllHere 會把 s2 從「遲到 15 分」蓋成「準時到」，並補上其他人
    const after = [att('ev-1', 's2', '到', 0), att('ev-1', 's1', '到', 0)];
    const ops = diffRecords(after, before, attKeyOf);
    const restored = applyOps(after, ops, attKeyOf);
    assertEqDeep(restored, [late], '要退回原本那筆遲到 15 分');
  });

  test('點名的鑰匙是「一堂一生」，不同堂的同一個學生不會互相蓋掉', () => {
    const a = att('ev-1', 's1', '到'), b = att('ev-2', 's1', '到');
    const ops = diffRecords([a, b], [a], attKeyOf);
    assertEqDeep(ops.deletes, [attKeyOf(b)], '只該刪掉 ev-2 那筆');
  });

  test('刪掉一筆成績 → 復原把那筆放回來（成績用自己的 id 當鑰匙）', () => {
    const g1 = { id: 101, eventId: 'ev-1', studentId: 's1', label: '課前考', score: 88 };
    const g2 = { id: 102, eventId: 'ev-1', studentId: 's1', label: '練習卷', score: 92 };
    const before = [g1, g2];
    const after = [g1];                                  // removeGrade 刪掉了 102
    const ops = diffRecords(after, before, recIdKeyOf);
    assertEqDeep(undoSortById(applyOps(after, ops, recIdKeyOf)), undoSortById(before), '那筆成績要回來');
  });

  test('同一堂同一生有多筆成績 → 只復原被刪的那筆，其他不動', () => {
    const g = n => ({ id: n, eventId: 'ev-1', studentId: 's1', label: '第' + n + '份', score: n });
    const before = [g(1), g(2), g(3)];
    const after = [g(1), g(3)];
    const ops = diffRecords(after, before, recIdKeyOf);
    const restored = applyOps(after, ops, recIdKeyOf);
    assertEqDeep(restored.map(r => r.id).sort(), [1, 2, 3], '三筆都在，沒有重複也沒有漏');
  });
});
