// ══════════════════════════════════════════════════════════════
// 復原「剛才那一下」（2026-08-27）
// ══════════════════════════════════════════════════════════════
// 【在解什麼】
// 老闆 2026-08-27 不小心按到待補課卡的「取消安排」，一場排好的補課當場沒了。
// 那顆鈕按下去沒有第二道關卡，要救只能整場重排一次。
//
// 【範圍：只做「剛才那一下」】
// 不做無限次上一步，做的是 Gmail 封存後那顆「復原」：動作完成後在畫面下方掛一條軟籤，
// UNDO_WINDOW 毫秒內按得到，過了就沒有。理由是這樣涵蓋了真實需求的絕大部分
// （按錯都是當下就發現），而且窗口短＝下面那條多裝置取捨的機率壓到最低。
//
// 【為什麼不必另建一套機制】
// 第三刀（2026-08-24）已經把存檔拆成「算 ops → 套到雲端」兩步，而 ops 是對稱的：
//   diffRecords(動作前, 現在) ＝ 這次改了哪幾筆      ← 存檔用的
//   diffRecords(現在, 動作前) ＝ 要變回去得改哪幾筆  ← 復原用的（就是這支）
// 所以復原＝把反向 ops 套回 driveData、再走一次正常存檔。同一套待送佇列、同一套逐筆
// 合併、同一套「撞在一起時誰贏」的規則，沒有第二條寫入路徑要維護。
//
// ⚠️ 已知取捨（刻意收的）：從拍快照到按下復原之間，別台可能改過同一筆（onSnapshot 會
//    更新 driveData）。復原是把那幾筆**整筆**換回舊值，所以別台那段改動會被蓋掉。
//    窗口只有 UNDO_WINDOW，而且復原的是使用者剛剛親眼做的那件事，這個代價換的是
//    「按錯救得回來」。真要收掉得逐欄比對誰動過，成本遠高於效益。

var UNDO_WINDOW=12000;   // 軟籤活多久（毫秒）
var _undoCur=null;       // 目前掛著的那一筆；一次只留一筆，新的動作會頂掉舊的
var _undoTimer=null;

// ── 一個「可復原的資料位置」＝ 讀得到、寫得回去、認得出筆別、存得掉 ──
// 系統有兩種資料源，形狀不同但都是「一個陣列 + 一把認筆鑰匙」，所以抽成同一個介面：
//   ① 課表那包（sharedData/main 的 8 個欄位）→ undoField('absences')
//   ② 期別文件（點名／成績／段考，資料在各自的快取而不是 driveData）→ 各模組自己給
//      （例：js/attendance.js 的 attUndoSlot）
function undoField(f){
  return{
    name:f,
    read:()=>driveData[f]||[],
    write:list=>{driveData[f]=list;},
    keyOf:syncKeyOf(f),
    save:()=>scheduleDriveSave(f),
  };
}

// ── 動作前：拍下這幾個位置現在長什麼樣 ──
// slots 可以混著給：字串＝課表欄位的簡便寫法，物件＝自訂資料源。
// 回傳的 token 拿去給 undoOffer，中途放棄就丟著不管（沒有副作用）。
function undoBegin(slots){
  const list=(Array.isArray(slots)?slots:[]).map(s=>typeof s==='string'?undoField(s):s).filter(Boolean);
  if(!list.length)return null;
  return{slots:list,before:list.map(s=>syncClone(s.read()))};
}

// ── 動作後：算出反向 ops，掛上軟籤 ──
// opt = {label, act, redraw}
//   label ＝ 軟籤上那句話（講剛才做掉了什麼，用過去式）
//   act   ＝ logAct 回傳的那筆動態（或陣列）；有給的話復原時一併撤掉
//   redraw＝ 復原後要重畫什麼。各功能自己給——undo 不猜哪些畫面該更新
function undoOffer(tok,opt){
  if(!tok)return;
  const items=[];
  for(let i=0;i<tok.slots.length;i++){
    const s=tok.slots[i];
    const o=diffRecords(s.read(),tok.before[i],s.keyOf);
    // 認不出筆別時逐筆還原等於用猜的。寧可這次沒有復原，也不要還原成錯的東西
    if(o.unmergeable){console.warn('[undo] '+s.name+' 認不出筆別（紀錄缺鑰匙或重複），這次不提供復原');return;}
    if(syncHasOps(o))items.push({slot:s,ops:o});
  }
  if(!items.length)return;   // 這個動作其實什麼都沒改到，不用給復原
  _undoShow({items,label:(opt&&opt.label)||'剛才那個動作',
    act:(opt&&opt.act)||null,redraw:(opt&&opt.redraw)||null});
}

// ── 按下復原 ──
async function undoRun(){
  const e=_undoCur;
  if(!e)return;
  _undoHide();     // 先收起來：重畫要跑一會兒，不要讓人有機會按第二次
  e.items.forEach(it=>{
    it.slot.write(applyOps(it.slot.read(),it.ops,it.slot.keyOf));
    it.slot.save();
  });
  // 動態一起撤：不撤的話動態會留著「取消了補課」，但補課其實還在——
  // 就是 2026-08-24 那種「動態說了算、資料另一回事」的對不起來（老闆 8/27 指定要撤）
  // 一個動作可能記了好幾筆動態（例：整堂調課一次撤掉三場），所以 act 收陣列也收單筆
  if(e.act&&typeof actRemoveEvent==='function'){
    (Array.isArray(e.act)?e.act:[e.act]).forEach(a=>{if(a)actRemoveEvent(a);});
  }
  try{if(e.redraw)await e.redraw();}
  catch(err){console.error('[undo] 復原後重畫失敗（資料已經還原，重整一次畫面就對了）',err);}
  if(typeof toast==='function')toast('已復原：'+e.label,'ok');
}

// 手動關掉軟籤（按 ✕）：只是不想看到它，不代表要復原
function undoDismiss(){_undoHide();}

function _undoShow(entry){
  const el=document.getElementById('undo-bar');
  if(!el)return;                       // 桌面日曆獨立視窗沒有這塊
  _undoCur=entry;
  const txt=document.getElementById('undo-bar-txt');
  if(txt)txt.textContent=entry.label;
  el.classList.add('open');
  clearTimeout(_undoTimer);
  _undoTimer=setTimeout(_undoHide,UNDO_WINDOW);
}

function _undoHide(){
  clearTimeout(_undoTimer);_undoTimer=null;_undoCur=null;
  const el=document.getElementById('undo-bar');
  if(el)el.classList.remove('open');
}
