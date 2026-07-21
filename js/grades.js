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
  if(gradesCache[ypid])return;
  gradesCache[ypid]={records:[],idx:new Map()};
  try{
    if(!firebase.auth().currentUser)return;
    const snap=await gradesDocRef(ypid).get();
    if(snap.exists){
      const d=snap.data();
      gradesCache[ypid].records=Array.isArray(d.records)?d.records:[];
      gradesRebuildIdx(gradesCache[ypid]);
    }
  }catch(e){console.error('loadGrades failed',e);}
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
  try{await gradesDocRef(ypid).set({records:b.records},{merge:true});gradesPendingSave=false;}
  catch(e){console.error('saveGrades failed',e);}
}

// ── 段考成績（exams）— sharedData/exams_<yearPeriodId> ──
// 學校段考，跟課堂無關、以學生為單位手動登記（學生視窗）。
// { records:[ {id,studentId,examName,subject,score,note,createdAt} ] }
var examsCache={};
var examsCurrentYpid=null;
var examsSaveTimer=null;
var examsPendingSave=false;
var _lastExamId=0;

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
  if(examsCache[ypid])return;
  examsCache[ypid]={records:[],idx:new Map()};
  try{
    if(!firebase.auth().currentUser)return;
    const snap=await examsDocRef(ypid).get();
    if(snap.exists){
      const d=snap.data();
      examsCache[ypid].records=Array.isArray(d.records)?d.records:[];
      examsRebuildIdx(examsCache[ypid]);
    }
  }catch(e){console.error('loadExams failed',e);}
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
  try{await examsDocRef(ypid).set({records:b.records},{merge:true});examsPendingSave=false;}
  catch(e){console.error('saveExams failed',e);}
}
