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

// 合併一欄。認不出筆別就退回整份取代（第一刀的行為）——保守但不會漏存，
// 並在 console 講明是哪一欄，日後追得到。
function mergeField(field,cloudArr,base,cur){
  const keyOf=syncKeyOf(field);
  const ops=diffRecords(base,cur,keyOf);
  if(ops.unmergeable){
    console.warn('[sync] '+field+' 認不出筆別（紀錄缺鑰匙或重複），這次退回整份取代');
    return{list:(cur||[]).slice(),ops,fellBack:true};
  }
  return{list:applyOps(cloudArr,ops,keyOf),ops,fellBack:false};
}

// 一次合併多欄，算出這一發要寫回雲端的 payload（只含 fields 裡的欄位）
function syncMergeMain(cloudDoc,fields,local,base){
  const payload={},fellBack=[];
  fields.forEach(f=>{
    const r=mergeField(f,(cloudDoc&&cloudDoc[f])||[],base[f]||[],local[f]||[]);
    payload[f]=r.list;
    if(r.fellBack)fellBack.push(f);
  });
  return{payload,fellBack};
}

// ── 期別文件（{records:[...]}）的逐筆合併寫回 ──
// runTx 由呼叫端傳進來（而不是這裡直接抓 db）＝測試餵得進假的 Firestore。
// 回傳合併後的 records 給呼叫端當新的本機值與新基準；沒動到任何一筆時回傳 null（連寫都不用寫）。
async function syncSaveRecords(ref,runTx,base,cur,keyOf){
  const ops=diffRecords(base,cur,keyOf);
  if(!syncHasOps(ops))return null;
  if(ops.unmergeable){
    console.warn('[sync] records 認不出筆別，這次退回整份取代');
    const list=(cur||[]).slice();
    await ref.set({records:list},{merge:true});
    return list;
  }
  return await runTx(async tx=>{
    const snap=await tx.get(ref);
    const d=snap.exists?snap.data():null;
    const cloud=(d&&Array.isArray(d.records))?d.records:[];
    const list=applyOps(cloud,ops,keyOf);
    tx.set(ref,{records:list},{merge:true});
    return list;
  });
}
