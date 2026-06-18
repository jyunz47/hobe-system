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
  if(attCache[ypid])return;
  // 先放空桶，避免讀取期間 getAtt 噴錯
  attCache[ypid]={records:[],idx:new Map()};
  try{
    if(!firebase.auth().currentUser)return;
    const snap=await attDocRef(ypid).get();
    if(snap.exists){
      const d=snap.data();
      attCache[ypid].records=Array.isArray(d.records)?d.records:[];
      attRebuildIdx(attCache[ypid]);
    }
  }catch(e){console.error('loadAttendance failed',e);}
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
  try{await attDocRef(ypid).set({records:b.records},{merge:true});attPendingSave=false;}
  catch(e){console.error('saveAttendance failed',e);}
}
