// 點名（attendance）— 按期別分文件，schema 見 mds/資料結構.md
// 每個期別一份 Firestore 文件 sharedData/attendance_<yearPeriodId>，
// 形如 { records:[ {eventId,date,studentId,status:'到'|'未到',markedAt} ] }。
// 不放 driveData：一學年 ~1 萬筆會撐爆單文件 1MB 上限（見資料結構.md）。
// 用到才載入：loadToday 時載入「當前期別」那份。

// ── 狀態 ──
// attCache: ypid → {records:[...], idx:Map(eventId → Map(studentId → record))}
var attCache={};
var attCurrentYpid=null;
var attSaveTimer=null;
var attPendingSave=false;
// 多裝置同步 第二刀（2026-08-20）：跟 sharedData/main 同一套——
// 基準快照算出「我這台動了哪幾筆」、交易裡逐筆疊上雲端最新版、再掛即時監聽。
// 以前這份是整包 records 寫回又完全沒有監聽：兩台同一天各點各的課會互相抹掉整個下午。
var attBase={};        // ypid → 上次跟雲端對齊的 records 快照
var attUnsub=null;     // 目前監聽中那份文件的取消函式
var attWatchYpid=null;
var attInFlight=false; // 交易在路上：別台的更新先不套，等合併結果一起帶回來
var attFailStreak=0;   // 連續存檔失敗次數：決定重試間隔（見 sync.js syncRetryDelay）

function attDocRef(ypid){return db.collection('sharedData').doc('attendance_'+ypid);}

function attRebuildIdx(bucket){
  const idx=new Map();
  bucket.records.forEach(r=>{
    if(!idx.has(r.eventId))idx.set(r.eventId,new Map());
    idx.get(r.eventId).set(r.studentId,r);
  });
  bucket.idx=idx;
}

// 載入「當前期別」那份點名文件（已快取就跳過）。loadToday 會 await 它。
async function loadAttendance(){
  const ypid=yearPeriodId();
  attCurrentYpid=ypid;
  if(attCache[ypid]){watchAttendance();return;}
  // 先放空桶，避免讀取期間 getAtt 噴錯
  attCache[ypid]={records:[],idx:new Map()};
  attBase[ypid]=[];
  try{
    if(!firebase.auth().currentUser)return;
    const snap=await attDocRef(ypid).get();
    if(snap.exists){
      const d=snap.data();
      attCache[ypid].records=Array.isArray(d.records)?d.records:[];
      attRebuildIdx(attCache[ypid]);
      attBase[ypid]=syncClone(attCache[ypid].records);
    }
  }catch(e){console.error('loadAttendance failed',e);}
  // 讀失敗時桶與基準都留在空的——以前這會讓下一次存檔把整份點名寫成空陣列，
  // 現在存檔是「疊上我動過的那幾筆」，空基準只會產生 upsert、不會產生刪除。
  watchAttendance();
}

// ── 別台一點名，這台就跟上 ──
function watchAttendance(){
  const ypid=attCurrentYpid;
  if(!ypid||!isSignedIn())return;
  if(attUnsub&&attWatchYpid===ypid)return;   // 已經在聽同一份
  unwatchAttendance();                        // 換期別了：先退掉舊那份
  attWatchYpid=ypid;
  try{
    attUnsub=attDocRef(ypid).onSnapshot(snap=>{
      if(!snap.exists)return;
      if(snap.metadata.hasPendingWrites)return;  // 自己剛寫出去的回音
      onAttRemote(ypid,snap.data());
    },err=>{
      console.error('attendance onSnapshot failed',err);
      attUnsub=null;attWatchYpid=null;   // 監聽掉了就退回舊行為（重新載入才更新）
    });
  }catch(e){console.error('watchAttendance failed',e);}
}
function unwatchAttendance(){
  if(attUnsub){try{attUnsub();}catch(_){}}
  attUnsub=null;attWatchYpid=null;
}
function onAttRemote(ypid,d){
  const b=attCache[ypid];if(!b)return;
  // 本機還有沒寫上去的點名 → 先不套。1.5 秒後自己那一發交易會把兩邊合起來，
  // 直接套會讓剛按下去的那幾筆在畫面上消失（資料其實還在，但使用者會嚇到）。
  if(attPendingSave||attInFlight)return;
  const next=Array.isArray(d&&d.records)?d.records:[];
  if(syncSame(next,b.records))return;
  b.records=next;attRebuildIdx(b);attBase[ypid]=syncClone(next);
  noteRemoteChange(['點名']);
}

function attBucket(){return attCache[attCurrentYpid]||{records:[],idx:new Map()};}

// 某堂某生的點名紀錄（無則 undefined）
function getAtt(eventId,studentId){return attBucket().idx.get(eventId)?.get(studentId);}

// 標記出席（upsert）。status 一律 '到'（有來＝出席＝算一堂）；
// lateMin>0 表示遲到 N 分（仍算出席）。沒來＝曠課，不在此記，走 Calendar 流程。
function markAtt(eventId,date,studentId,status,lateMin=0){
  const b=attBucket();
  let rec=b.idx.get(eventId)?.get(studentId);
  if(rec){rec.status=status;rec.lateMin=lateMin;rec.markedAt=new Date().toISOString();}
  else{
    rec={eventId,date,studentId,status,lateMin,markedAt:new Date().toISOString()};
    b.records.push(rec);
    if(!b.idx.has(eventId))b.idx.set(eventId,new Map());
    b.idx.get(eventId).set(studentId,rec);
  }
  scheduleAttSave();
}

// 取消點名（移除該筆）
function unmarkAtt(eventId,studentId){
  const b=attBucket();
  const m=b.idx.get(eventId);
  if(m)m.delete(studentId);
  b.records=b.records.filter(r=>!(r.eventId===eventId&&r.studentId===studentId));
  scheduleAttSave();
}

function scheduleAttSave(){attPendingSave=true;clearTimeout(attSaveTimer);attSaveTimer=setTimeout(saveAttendance,1500);}
async function saveAttendance(){
  const ypid=attCurrentYpid;const b=attCache[ypid];
  if(!b)return;
  // 先放掉旗標：交易期間又點的會把它設回 true → 那一發不採用合併結果，留給下一發重算
  attPendingSave=false;
  attInFlight=true;
  try{
    const merged=await syncSaveRecords(attDocRef(ypid),fn=>db.runTransaction(fn),
      attBase[ypid]||[],b.records,attKeyOf);
    if(merged&&!attPendingSave){
      const gained=!syncSame(merged,b.records);
      b.records=merged;attRebuildIdx(b);attBase[ypid]=syncClone(merged);
      if(gained)noteRemoteChange(['點名']);   // 合併帶回別台點的那幾筆，畫面要跟上
    }
    attFailStreak=0;
  }catch(e){
    console.error('saveAttendance failed',e);
    attPendingSave=true;   // 還回去，重試時連這批一起送（不然這批無聲消失）
    attFailStreak++;
    if(attFailStreak===1)toast('點名存到雲端失敗，改動只在這台裝置上（會自動重試）：'+(e?.message||e),'err',true);
    clearTimeout(attSaveTimer);
    attSaveTimer=setTimeout(saveAttendance,syncRetryDelay(attFailStreak));
  }finally{attInFlight=false;}
}
