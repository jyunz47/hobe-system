// 多裝置同步：逐筆合併（第二刀，2026-08-20）
//
// 【在解什麼】
// 第一刀（2026-08-19）讓存檔「只送自己改過的那幾欄」，跨欄位互蓋根絕了。
// 但每一欄送出去的仍是**整份陣列**：兩台在 1.5 秒的存檔延遲內都動到同一欄，
// 慢的那台會把快的那筆整片蓋掉（A 標小明請假、B 標小華請假 → 只活一筆）。
// 這裡把存檔改成「算出我這台真的動了哪幾筆，在交易裡套到雲端最新那份上」。
//
// 【三個名詞】
//   基準（base）：上次跟雲端對齊時的那份快照。「我改了什麼」＝ 現在這份 vs 基準
//   ops：diffRecords 算出來的 {upserts, deletes}，就是「我改了什麼」
//   認筆鑰匙（keyOf）：一筆紀錄的身分。各陣列不一樣，見 SYNC_KEYFN
//
// 【撞在一起時誰贏】（刻意選的，不是意外）
//   · 同一筆兩台都改 → **後寫進雲端的贏**。交易保證讀到的是最新版，不會讀到寫一半的東西
//   · 一台刪、一台改同一筆 → **刪的贏**。刪除通常是明確意圖（退課、刪課），
//     反過來讓「改」復活那筆，使用者會看到刪不掉的東西一直回來
//   · 兩台各改各的筆 → 兩邊都留（這就是這一刀要修的本體）
//
// 【為什麼要交易而不是直接 set】
// 「讀雲端最新 → 疊上我的改動 → 寫回去」中間若別台插進來寫，不用交易就會拿舊的疊。
// runTransaction 會偵測到並自動重跑，所以疊的一定是最新版。

// ── 各陣列的認筆鑰匙 ──
// ⚠ 加新欄位到 DRIVE_KEYS 時記得也加這裡。查無對應會退回 r.id，
//   而「認不出筆別」的欄位會保守退回整份取代（＝第一刀的行為，不會漏存但會互蓋）。
var SYNC_KEYFN={
  absences:r=>r&&(r.occId??r.id),   // 一個課堂一筆
  makeupScheduled:r=>r&&r.id,
  courses:r=>r&&r.id,
  teachers:r=>r&&r.id,
  studentList:r=>r&&r.id,
  enrollments:r=>r&&r.id,
  coursePrices:r=>r&&r.title,       // 一門課名一筆
  courseSettings:r=>r&&r.title,
};
function syncKeyOf(field){return SYNC_KEYFN[field]||(r=>r&&r.id);}

// 期別文件（attendance_/grades_/exams_）的鑰匙
function attKeyOf(r){return r?r.eventId+'|'+r.studentId:null;}   // 一堂一生一筆（markAtt 就是照這一對 upsert）
function recIdKeyOf(r){return r&&r.id;}                          // 成績／段考：每筆自己的 id

// 存檔失敗後的重試間隔：5 秒 → 15 秒 → 之後固定 60 秒。
// ⚠ 為什麼第二刀非有重試不可：以前用 set() 寫，斷線一下下 Firestore 會先把它收在記憶體裡、
//   回線自己補送；改成交易之後，交易需要一個來回，斷線就是直接失敗。沒有重試的話，
//   一次 wifi 抖動就要使用者自己再改一次才會被存上去。
// 拉長間隔是為了「權限被拿掉」這種改不掉的錯：不會每 5 秒洗一次錯誤提示。
function syncRetryDelay(streak){return streak<=1?5000:streak===2?15000:60000;}

function syncClone(v){return JSON.parse(JSON.stringify(v==null?[]:v));}
function syncSame(a,b){return JSON.stringify(a||[])===JSON.stringify(b||[]);}
function syncKeyStr(keyOf,r){const k=keyOf(r);return(k==null||k==='')?null:String(k);}

// ── 我這台把 base 改成 cur，動了哪幾筆？ ──
// 回傳 {upserts:[{key,rec}], deletes:[key], unmergeable}
// unmergeable＝這份資料認不出筆別（有紀錄缺鑰匙、或同一把鑰匙出現兩次），
// 這時任何逐筆判斷都是猜的，呼叫端要退回整份取代。
function diffRecords(base,cur,keyOf){
  const ops={upserts:[],deletes:[],unmergeable:false};
  const bMap=new Map();
  for(const r of(base||[])){
    const k=syncKeyStr(keyOf,r);
    if(k==null||bMap.has(k)){ops.unmergeable=true;return ops;}
    bMap.set(k,r);
  }
  const seen=new Set();
  for(const r of(cur||[])){
    const k=syncKeyStr(keyOf,r);
    if(k==null||seen.has(k)){ops.unmergeable=true;return ops;}
    seen.add(k);
    const prev=bMap.get(k);
    if(!prev||JSON.stringify(prev)!==JSON.stringify(r))ops.upserts.push({key:k,rec:r});
  }
  bMap.forEach((_,k)=>{if(!seen.has(k))ops.deletes.push(k);});
  return ops;
}
function syncHasOps(ops){return !!(ops&&(ops.unmergeable||ops.upserts.length||ops.deletes.length));}

// ── 把 ops 疊到雲端那份上 ──
// 先刪再 upsert（刪的贏）；upsert 找得到同一把鑰匙就原地換掉，找不到就接在後面。
// 順序刻意保留雲端那份的順序＝別台的排列不會因為我存個檔就被重排。
function applyOps(cloudArr,ops,keyOf){
  let out=(cloudArr||[]).slice();
  if(ops.deletes.length){
    const del=new Set(ops.deletes);
    out=out.filter(r=>{const k=syncKeyStr(keyOf,r);return k==null||!del.has(k);});
  }
  const idx=new Map();
  out.forEach((r,i)=>{const k=syncKeyStr(keyOf,r);if(k!=null&&!idx.has(k))idx.set(k,i);});
  ops.upserts.forEach(u=>{
    const i=idx.get(u.key);
    if(i==null){idx.set(u.key,out.length);out.push(u.rec);}
    else out[i]=u.rec;
  });
  return out;
}

// 算出這一發「我改了哪幾筆」，每欄一份 ops。
// 認不出筆別的欄位記成 {replace:[整份]}（第一刀的行為）——保守但不會漏存，
// 並在 console 講明是哪一欄，日後追得到。
// ⚠️ 拆成「先算 ops、再套到雲端」兩步是第三刀的前提：ops 要在發交易**之前**
//    就寫得進本機待送佇列，頁面中途消失才補得回來。
function syncMainOps(fields,local,base){
  const out={};
  fields.forEach(f=>{
    const ops=diffRecords(base[f]||[],local[f]||[],syncKeyOf(f));
    if(ops.unmergeable){
      console.warn('[sync] '+f+' 認不出筆別（紀錄缺鑰匙或重複），這次退回整份取代');
      out[f]={replace:(local[f]||[]).slice()};
    }else out[f]=ops;
  });
  return out;
}

// 把每欄的 ops 套到雲端那份上，算出要寫回去的 payload（只含 opsByField 裡的欄位）
function applyMainOps(cloudDoc,opsByField){
  const payload={},fellBack=[];
  Object.keys(opsByField).forEach(f=>{
    const o=opsByField[f];
    if(o&&o.replace){payload[f]=o.replace.slice();fellBack.push(f);}
    else payload[f]=applyOps((cloudDoc&&cloudDoc[f])||[],o,syncKeyOf(f));
  });
  return{payload,fellBack};
}

// 一次合併多欄（＝上面兩步接起來），算出這一發要寫回雲端的 payload
function syncMergeMain(cloudDoc,fields,local,base){
  return applyMainOps(cloudDoc,syncMainOps(fields,local,base));
}
function syncMainHasOps(opsByField){
  return Object.keys(opsByField||{}).some(f=>{
    const o=opsByField[f];
    return !!(o&&(o.replace||syncHasOps(o)));
  });
}

// ══ 本機待送佇列（第三刀，2026-08-24）══
//
// 【在解什麼】
// 第二刀把寫入從 set() 改成 runTransaction，換來逐筆合併的正確性，但**賠掉了離線耐受**：
// set() 寫不出去時 Firestore 會先收在本機、回線自己補送；交易需要一個來回，頁面一消失
// 就是直接沒了。2026-08-24 老闆因此丟了一筆調課——動態寫著排好了，雲端從來沒有那筆。
// 重試迴圈救不了這種，它只在分頁還開著時有效。
//
// 【怎麼修】
// 把「我改了哪幾筆」（ops）在**發交易之前**就寫進 localStorage，交易成功才清掉。
// 頁面怎麼消失都沒關係——下次開頁先把沒清掉的那批重送一次（syncReplayBatch）。
// ops 是照鑰匙 upsert／delete 的，重送兩次跟一次結果一樣（冪等），所以「到底送出去沒有」
// 這個問句不用回答，一律再送一次就對了。
var SYNC_QUEUE_LS='hobe_pendingOps';   // 測試會換掉這個 key，別讓測試批次汙染正式佇列
var SYNC_QUEUE_MAX=300;                // 防爆：異常情況下不要把 localStorage 塞爆
var _syncBatchSeq=0;

function syncQueueRead(){
  try{const raw=localStorage.getItem(SYNC_QUEUE_LS);const a=raw?JSON.parse(raw):[];return Array.isArray(a)?a:[];}
  catch(e){console.error('[sync] 待送佇列讀不出來，當成空的',e);return[];}
}
function syncQueueWrite(list){
  try{localStorage.setItem(SYNC_QUEUE_LS,JSON.stringify(list));return true;}
  // 寫不進去（容量滿／隱私模式）→ 這一發就沒有保險，但交易照送，不能因此擋住存檔
  catch(e){console.error('[sync] 待送佇列寫不進 localStorage，這批沒有保險',e);return false;}
}
function syncQueuePush(batch){
  const list=syncQueueRead();
  list.push(batch);
  while(list.length>SYNC_QUEUE_MAX)list.shift();   // 舊的先丟：新的比較可能還有救
  syncQueueWrite(list);
  return batch;
}
function syncQueueDrop(id){
  const list=syncQueueRead();
  const next=list.filter(b=>b&&b.id!==id);
  if(next.length!==list.length)syncQueueWrite(next);
}

// 這一批寫成功了 → 把它自己、以及**更早**排進佇列、同一份文件（main 再細到同一欄）的那幾批
// 一起清掉。
// ⚠️ 少了這一步會出事，而且是「改了又自己變回去」這種最難查的症狀：存檔失敗時基準不會前進，
//    下一發是從同一個基準重算，所以新 ops 一定涵蓋舊 ops。舊批留在佇列裡，下次開頁重送就會
//    把舊值蓋回去（先標「到」存檔失敗 → 改成「遲到」存檔成功 → 明天開頁又變回「到」）。
//    比自己晚排進來的不動：那些是這一發之後才做的事，還沒落地。
function syncQueueSettle(batchId,kind,docId,fields){
  const list=syncQueueRead();
  const at=list.findIndex(b=>b&&b.id===batchId);
  const cut=at<0?list.length:at;   // 找不到自己（沒排進佇列）＝現有的全部都算更早
  const out=[];
  list.forEach((b,i)=>{
    if(!b)return;
    if(b.id===batchId)return;                        // 自己：落地了
    if(i>cut){out.push(b);return;}                   // 比自己晚排的：不干涉
    if(kind==='records'){
      if(b.kind==='records'&&b.docId===docId)return; // 同一份文件的舊批：已被蓋過去
      out.push(b);return;
    }
    if(b.kind!=='main'){out.push(b);return;}
    const rest={};
    Object.keys(b.ops||{}).forEach(f=>{if(!(fields||[]).includes(f))rest[f]=b.ops[f];});
    if(Object.keys(rest).length)out.push(Object.assign({},b,{ops:rest}));  // 別欄還沒送成，留著
  });
  syncQueueWrite(out);
}
// 這個帳號還有幾批沒送出去（未存指示燈讀這支）
function syncQueueCount(uid){
  return syncQueueRead().filter(b=>b&&(!uid||b.uid===uid)).length;
}
function syncQueueFor(uid){
  return syncQueueRead().filter(b=>b&&(!uid||b.uid===uid));
}
function syncNewBatchId(){return Date.now().toString(36)+'-'+(++_syncBatchSeq).toString(36);}

// 重送一批。docRefFor 由呼叫端給（測試餵得進假的 Firestore）：
//   docRefFor('main')          → sharedData/main
//   docRefFor('doc', docId)    → sharedData/<docId>（點名／成績／段考那三份）
async function syncReplayBatch(batch,docRefFor,runTx){
  if(!batch||!batch.ops)return;
  if(batch.kind==='main'){
    const ref=docRefFor('main');
    await runTx(async tx=>{
      const snap=await tx.get(ref);
      const out=applyMainOps(snap.exists?snap.data():{},batch.ops);
      tx.set(ref,out.payload,{merge:true});
    });
    return;
  }
  const ref=docRefFor('doc',batch.docId);
  const keyOf=batch.keyKind==='att'?attKeyOf:recIdKeyOf;
  await runTx(async tx=>{
    const snap=await tx.get(ref);
    const d=snap.exists?snap.data():null;
    const cloud=(d&&Array.isArray(d.records))?d.records:[];
    const list=batch.ops.replace?batch.ops.replace.slice():applyOps(cloud,batch.ops,keyOf);
    tx.set(ref,{records:list},{merge:true});
  });
}

// ── 期別文件（{records:[...]}）的逐筆合併寫回 ──
// runTx 由呼叫端傳進來（而不是這裡直接抓 db）＝測試餵得進假的 Firestore。
// 回傳合併後的 records 給呼叫端當新的本機值與新基準；沒動到任何一筆時回傳 null（連寫都不用寫）。
// q＝{docId,keyKind,uid}：有給就把這一發先排進待送佇列，寫成功才清掉（第三刀）。
async function syncSaveRecords(ref,runTx,base,cur,keyOf,q){
  const ops=diffRecords(base,cur,keyOf);
  if(!syncHasOps(ops))return null;
  const batch=q?syncQueuePush({id:syncNewBatchId(),ts:Date.now(),uid:q.uid||null,
    kind:'records',docId:q.docId,keyKind:q.keyKind||'rec',
    ops:ops.unmergeable?{replace:(cur||[]).slice()}:ops}):null;
  // ⚠️ 失敗時什麼都不清：保險留在佇列裡，這次的重試或下次開頁會補上
  if(ops.unmergeable){
    console.warn('[sync] records 認不出筆別，這次退回整份取代');
    const list=(cur||[]).slice();
    await ref.set({records:list},{merge:true});
    if(batch)syncQueueSettle(batch.id,'records',q.docId);
    return list;
  }
  const list=await runTx(async tx=>{
    const snap=await tx.get(ref);
    const d=snap.exists?snap.data():null;
    const cloud=(d&&Array.isArray(d.records))?d.records:[];
    const merged=applyOps(cloud,ops,keyOf);
    tx.set(ref,{records:merged},{merge:true});
    return merged;
  });
  if(batch)syncQueueSettle(batch.id,'records',q.docId);   // 確定落地了才清保險
  return list;
}
