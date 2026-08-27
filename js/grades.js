// 成績（grades）— 按期別分文件，schema 見 mds/資料結構.md「grades_<periodId>」
// 每個期別一份 Firestore 文件 sharedData/grades_<yearPeriodId>，
// 形如 { records:[ {id,eventId,date,studentId,label,score,note,createdAt} ] }。
// 每堂每生可多筆（課前考、練習課第二份考卷…）。
// 儲存模式與 attendance.js 一致：用到才載入、debounce 1.5 秒寫回。

// ── 狀態 ──
// gradesCache: ypid → {records:[...], idx:Map(eventId → Map(studentId → [records]))}
var gradesCache={};
var gradesCurrentYpid=null;
var gradesSaveTimer=null;
var gradesPendingSave=false;
var _lastGradeId=0;
// 多裝置同步 第二刀（2026-08-20）：與 attendance.js 同一套（基準＋交易逐筆合併＋即時監聽）
var gradesBase={};
var gradesUnsub=null;
var gradesWatchYpid=null;
var gradesInFlight=false;
var gradesFailStreak=0;

function gradesDocRef(ypid){return db.collection('sharedData').doc('grades_'+ypid);}

function gradesRebuildIdx(bucket){
  const idx=new Map();
  bucket.records.forEach(r=>{
    if(!idx.has(r.eventId))idx.set(r.eventId,new Map());
    const m=idx.get(r.eventId);
    if(!m.has(r.studentId))m.set(r.studentId,[]);
    m.get(r.studentId).push(r);
  });
  bucket.idx=idx;
}

// 載入「當前期別」那份成績文件（已快取就跳過）。loadToday 會 await 它。
async function loadGrades(){
  const ypid=yearPeriodId();
  gradesCurrentYpid=ypid;
  if(gradesCache[ypid]){watchGrades();return;}
  gradesCache[ypid]={records:[],idx:new Map()};
  gradesBase[ypid]=[];
  try{
    if(!firebase.auth().currentUser)return;
    const snap=await gradesDocRef(ypid).get();
    if(snap.exists){
      const d=snap.data();
      gradesCache[ypid].records=Array.isArray(d.records)?d.records:[];
      gradesRebuildIdx(gradesCache[ypid]);
      gradesBase[ypid]=syncClone(gradesCache[ypid].records);
    }
  }catch(e){console.error('loadGrades failed',e);}
  watchGrades();
}

// ── 別台登了成績，這台就跟上 ──
function watchGrades(){
  const ypid=gradesCurrentYpid;
  if(!ypid||!isSignedIn())return;
  if(gradesUnsub&&gradesWatchYpid===ypid)return;
  unwatchGrades();
  gradesWatchYpid=ypid;
  try{
    gradesUnsub=gradesDocRef(ypid).onSnapshot(snap=>{
      if(!snap.exists)return;
      if(snap.metadata.hasPendingWrites)return;
      onGradesRemote(ypid,snap.data());
    },err=>{
      console.error('grades onSnapshot failed',err);
      gradesUnsub=null;gradesWatchYpid=null;
    });
  }catch(e){console.error('watchGrades failed',e);}
}
function unwatchGrades(){
  if(gradesUnsub){try{gradesUnsub();}catch(_){}}
  gradesUnsub=null;gradesWatchYpid=null;
}
function onGradesRemote(ypid,d){
  const b=gradesCache[ypid];if(!b)return;
  if(gradesPendingSave||gradesInFlight)return;   // 自己那一發交易會把兩邊合起來
  const next=Array.isArray(d&&d.records)?d.records:[];
  if(syncSame(next,b.records))return;
  b.records=next;gradesRebuildIdx(b);gradesBase[ypid]=syncClone(next);
  noteRemoteChange(['成績']);
}

function gradesBucket(){return gradesCache[gradesCurrentYpid]||{records:[],idx:new Map()};}

// 某堂某生的成績紀錄（陣列，無則空陣列）
function getGrades(eventId,studentId){return gradesBucket().idx.get(eventId)?.get(studentId)||[];}

// 新增一筆成績（每堂每生可多筆）
function addGrade(eventId,date,studentId,label,score){
  _lastGradeId=Math.max(_lastGradeId+1,Date.now()*1000);
  const b=gradesBucket();
  const rec={id:_lastGradeId,eventId,date,studentId,
    label:(label||'').trim(),score:(score===''||score==null)?null:Number(score),
    note:'',createdAt:new Date().toISOString()};
  b.records.push(rec);
  if(!b.idx.has(eventId))b.idx.set(eventId,new Map());
  const m=b.idx.get(eventId);
  if(!m.has(studentId))m.set(studentId,[]);
  m.get(studentId).push(rec);
  scheduleGradesSave();
  return rec;
}

// 刪除一筆成績（以紀錄 id）
function removeGrade(gradeId){
  const b=gradesBucket();
  b.records=b.records.filter(r=>r.id!==gradeId);
  gradesRebuildIdx(b);
  scheduleGradesSave();
}

function scheduleGradesSave(){gradesPendingSave=true;clearTimeout(gradesSaveTimer);gradesSaveTimer=setTimeout(saveGrades,1500);}
async function saveGrades(){
  const ypid=gradesCurrentYpid;const b=gradesCache[ypid];
  if(!b)return;
  gradesPendingSave=false;
  gradesInFlight=true;
  try{
    const merged=await syncSaveRecords(gradesDocRef(ypid),fn=>db.runTransaction(fn),
      gradesBase[ypid]||[],b.records,recIdKeyOf,
      {docId:'grades_'+ypid,keyKind:'rec',uid:currentUid()});   // 本機待送佇列（第三刀）
    if(merged&&!gradesPendingSave){
      const gained=!syncSame(merged,b.records);
      b.records=merged;gradesRebuildIdx(b);gradesBase[ypid]=syncClone(merged);
      if(gained)noteRemoteChange(['成績']);
    }
    gradesFailStreak=0;
  }catch(e){
    console.error('saveGrades failed',e);
    gradesPendingSave=true;
    gradesFailStreak++;
    if(gradesFailStreak===1)toast('成績存到雲端失敗，改動只在這台裝置上（會自動重試）：'+(e?.message||e),'err',true);
    clearTimeout(gradesSaveTimer);
    gradesSaveTimer=setTimeout(saveGrades,syncRetryDelay(gradesFailStreak));
  }finally{gradesInFlight=false;updateUnsavedChip();}
}

// ── 段考成績（exams）— sharedData/exams_<yearPeriodId> ──
// 學校段考，跟課堂無關、以學生為單位手動登記（學生視窗）。
// { records:[ {id,studentId,examName,subject,score,note,createdAt} ] }
var examsCache={};
var examsCurrentYpid=null;
var examsSaveTimer=null;
var examsPendingSave=false;
var _lastExamId=0;
var examsBase={};
var examsUnsub=null;
var examsWatchYpid=null;
var examsInFlight=false;
var examsFailStreak=0;

function examsDocRef(ypid){return db.collection('sharedData').doc('exams_'+ypid);}

function examsRebuildIdx(bucket){
  const idx=new Map();
  bucket.records.forEach(r=>{
    if(!idx.has(r.studentId))idx.set(r.studentId,[]);
    idx.get(r.studentId).push(r);
  });
  bucket.idx=idx;
}

async function loadExams(){
  const ypid=yearPeriodId();
  examsCurrentYpid=ypid;
  if(examsCache[ypid]){watchExams();return;}
  examsCache[ypid]={records:[],idx:new Map()};
  examsBase[ypid]=[];
  try{
    if(!firebase.auth().currentUser)return;
    const snap=await examsDocRef(ypid).get();
    if(snap.exists){
      const d=snap.data();
      examsCache[ypid].records=Array.isArray(d.records)?d.records:[];
      examsRebuildIdx(examsCache[ypid]);
      examsBase[ypid]=syncClone(examsCache[ypid].records);
    }
  }catch(e){console.error('loadExams failed',e);}
  watchExams();
}

function watchExams(){
  const ypid=examsCurrentYpid;
  if(!ypid||!isSignedIn())return;
  if(examsUnsub&&examsWatchYpid===ypid)return;
  unwatchExams();
  examsWatchYpid=ypid;
  try{
    examsUnsub=examsDocRef(ypid).onSnapshot(snap=>{
      if(!snap.exists)return;
      if(snap.metadata.hasPendingWrites)return;
      onExamsRemote(ypid,snap.data());
    },err=>{
      console.error('exams onSnapshot failed',err);
      examsUnsub=null;examsWatchYpid=null;
    });
  }catch(e){console.error('watchExams failed',e);}
}
function unwatchExams(){
  if(examsUnsub){try{examsUnsub();}catch(_){}}
  examsUnsub=null;examsWatchYpid=null;
}
function onExamsRemote(ypid,d){
  const b=examsCache[ypid];if(!b)return;
  if(examsPendingSave||examsInFlight)return;
  const next=Array.isArray(d&&d.records)?d.records:[];
  if(syncSame(next,b.records))return;
  b.records=next;examsRebuildIdx(b);examsBase[ypid]=syncClone(next);
  noteRemoteChange(['段考成績']);
}

function examsBucket(){return examsCache[examsCurrentYpid]||{records:[],idx:new Map()};}

// 某生本期的段考紀錄（陣列，無則空陣列）
function getExams(studentId){return examsBucket().idx.get(studentId)||[];}

function addExam(studentId,examName,subject,score){
  _lastExamId=Math.max(_lastExamId+1,Date.now()*1000);
  const b=examsBucket();
  const rec={id:_lastExamId,studentId,
    examName:(examName||'').trim(),subject:(subject||'').trim(),
    score:(score===''||score==null)?null:Number(score),
    note:'',createdAt:new Date().toISOString()};
  b.records.push(rec);
  if(!b.idx.has(studentId))b.idx.set(studentId,[]);
  b.idx.get(studentId).push(rec);
  scheduleExamsSave();
  return rec;
}

function removeExam(examId){
  const b=examsBucket();
  b.records=b.records.filter(r=>r.id!==examId);
  examsRebuildIdx(b);
  scheduleExamsSave();
}

function scheduleExamsSave(){examsPendingSave=true;clearTimeout(examsSaveTimer);examsSaveTimer=setTimeout(saveExams,1500);}
async function saveExams(){
  const ypid=examsCurrentYpid;const b=examsCache[ypid];
  if(!b)return;
  examsPendingSave=false;
  examsInFlight=true;
  try{
    const merged=await syncSaveRecords(examsDocRef(ypid),fn=>db.runTransaction(fn),
      examsBase[ypid]||[],b.records,recIdKeyOf,
      {docId:'exams_'+ypid,keyKind:'rec',uid:currentUid()});   // 本機待送佇列（第三刀）
    if(merged&&!examsPendingSave){
      const gained=!syncSame(merged,b.records);
      b.records=merged;examsRebuildIdx(b);examsBase[ypid]=syncClone(merged);
      if(gained)noteRemoteChange(['段考成績']);
    }
    examsFailStreak=0;
  }catch(e){
    console.error('saveExams failed',e);
    examsPendingSave=true;
    examsFailStreak++;
    if(examsFailStreak===1)toast('段考成績存到雲端失敗，改動只在這台裝置上（會自動重試）：'+(e?.message||e),'err',true);
    clearTimeout(examsSaveTimer);
    examsSaveTimer=setTimeout(saveExams,syncRetryDelay(examsFailStreak));
  }finally{examsInFlight=false;updateUnsavedChip();}
}
