// 系統自有課表 → 課堂物件展開器（開發路線 ①「全頁改讀系統」的地基）
// 把 driveData.courses 的排程（每週重複 / 指定日期）在某日期範圍內展開成「課堂物件」，
// 輸出形狀對齊 parse.js 的 parseEv，讓今日/本週/時間軸/hero 幾乎不用改就能改讀系統。
// 只讀寫 driveData（courses/teachers/enrollments/studentList/absences），不打 Google Calendar。
// 第 2 刀（2026-07-17）：請假/曠課改存系統（driveData.absences，每課堂一筆），
// 展開時疊回課堂物件；調課仍待第 3 刀。

// ── 請假紀錄（driveData.absences）──
// 每課堂（occId）一筆：{id, occId, courseId, date, teacherAbsent,
//   leave:[{studentId,name,timing:'A'|'B'}], noShow:[{studentId,name}], makeupSkip:[name]}
// 名單同時存 studentId（同名終結、供學費/薪資）與 name（顯示與既有 UI 慣例）。
// 紀錄清空（無老師請假、無請假、無曠課）即整筆刪除。
function getAbsences(){return driveData.absences||[];}
function saveAbsences(list){driveData.absences=list;scheduleDriveSave();}
function findAbsenceByOcc(occId){return getAbsences().find(a=>a.occId===occId);}

// 系統課類型（中文）→ 內部 type code（parseEv 慣例 one/pair/group/practice；CSS 與 typeLbl 都吃它）
function _occType(course,count){
  switch(course.type){
    case '一對一':return'one';
    case '一對二':return'pair';
    case '團班':return'group';
    case '練習課':return'practice';
    case '試聽':return count>=3?'group':count===2?'pair':'one';
    default:return'group';
  }
}
// 系統課 → 對應行事曆色名（calColor 吃它；系統課沒有真的行事曆，只借同一組顏色）
function _occCalName(course){
  if(course.type==='練習課')return'練習課';
  if(course.type==='試聽')return'試聽';
  return'一般課程';
}
// 'HH:MM' + 基準日 → Date（基準日的當天那個時刻）
function _atTime(baseDate,hhmm){
  const[h,m]=String(hhmm||'').split(':').map(Number);
  const d=new Date(baseDate);d.setHours(h||0,m||0,0,0);return d;
}

// 一門課在 [start,end]（含）範圍內的所有課堂
function courseOccurrencesInRange(course,start,end){
  const sched=course&&course.schedule;
  if(!sched||!Array.isArray(sched.slots)||!sched.slots.length)return[];
  if(course.status&&course.status!=='開課中')return[]; // 已結束的課不排
  // 名冊（本期登記簿，依 courseId）——一次算好，同課多堂共用
  const pid=yearPeriodId();
  const byId=new Map(getStudentList().map(s=>[s.id,s]));
  const ens=(driveData.enrollments||[]).filter(en=>en.courseId===course.id&&en.periodId===pid);
  const rosterNames=ens.map(en=>byId.get(en.studentId)?.name).filter(Boolean);
  // 練習課分組（科目：學生）——供課堂物件的 studentGroups
  const groupMap=new Map();
  ens.forEach(en=>{
    const nm=byId.get(en.studentId)?.name;if(!nm)return;
    const subj=(en.practiceSubject||'').trim()||'（未填科目）';
    if(!groupMap.has(subj))groupMap.set(subj,[]);
    groupMap.get(subj).push(nm);
  });
  const studentGroups=course.type==='練習課'?[...groupMap].map(([subject,students])=>({subject,students})):[];

  const out=[];
  const s0=new Date(start);s0.setHours(0,0,0,0);
  const e0=new Date(end);e0.setHours(23,59,59,999);
  sched.slots.forEach((slot,si)=>{
    const dates=[];
    if(sched.mode==='dates'){
      if(!slot.date)return;
      const[y,mo,dd]=String(slot.date).split('-').map(Number);
      const d=new Date(y,(mo||1)-1,dd||1);d.setHours(0,0,0,0);
      if(d>=s0&&d<=e0)dates.push(d);
    }else{ // weekly：掃範圍內每天，逢對應星期就長一堂
      const wd=Number(slot.weekday);
      const cur=new Date(s0);
      while(cur<=e0){
        if(cur.getDay()===wd)dates.push(new Date(cur));
        cur.setDate(cur.getDate()+1);
      }
    }
    dates.forEach(day=>{
      out.push(_makeOccurrence(course,day,si,_atTime(day,slot.start),_atTime(day,slot.end),rosterNames,studentGroups));
    });
  });
  return out;
}

function _makeOccurrence(course,day,slotIdx,startDt,endDt,rosterNames,studentGroups){
  // 穩定合成 id：同一堂重載後不變（點名/請假紀錄以此為鍵）。sys: 前綴標明「系統課堂」非 Calendar 事件
  const occId=`sys:${course.id}:${toDateStr(day)}:${slotIdx}`;
  // 疊加請假狀態（第 2 刀）：查系統請假紀錄，欄位語意對齊 parseEv 的標題解析結果
  const ab=findAbsenceByOcc(occId);
  let abs={isAbsent:false,isPartialAbsent:false,isFullAbsent:false,
    absentWho:'',absType:'',absentStudents:[],
    isNoShow:false,noShowStudents:[],absenceTiming:{},makeupSkip:[],
    isRescheduled:false,rescheduleReason:''};
  if(ab){
    const leaveNames=(ab.leave||[]).map(x=>x.name);
    const noShowNames=(ab.noShow||[]).map(x=>x.name);
    const teacherAbs=!!ab.teacherAbsent;
    const resched=!!ab.resched;
    const isAbsent=teacherAbs||leaveNames.length>0;
    const total=rosterNames.length;
    const timing={};
    (ab.leave||[]).forEach(x=>{timing[x.name]=x.timing||'B';});
    noShowNames.forEach(n=>{timing[n]='C';});
    abs={
      isAbsent,
      isPartialAbsent:isAbsent&&!teacherAbs&&!resched&&total>0&&leaveNames.length<total,
      // 調課＝整堂移走（同 parseEv：isRescheduled 視為 full absent、absentStudents=全名冊）
      isFullAbsent:resched||teacherAbs||(isAbsent&&(total===0||leaveNames.length>=total)),
      absentWho:teacherAbs?'老師':leaveNames.join('、'),
      absType:resched?'調課':(teacherAbs?'老師請假':(isAbsent?'學生請假':'')),
      absentStudents:resched?rosterNames.slice():(teacherAbs?[]:leaveNames),
      isNoShow:noShowNames.length>0,noShowStudents:noShowNames,
      absenceTiming:timing,makeupSkip:(ab.makeupSkip||[]).slice(),
      isRescheduled:resched,rescheduleReason:ab.reschedReason||'',
    };
  }
  return{
    id:occId,
    title:course.name,origTitle:course.name,
    desc:'',notes:'',
    teacher:teacherNameById(course.teacherId)||'',
    classroom:course.room||'',
    subject:course.subject||'',
    type:_occType(course,rosterNames.length),
    students:rosterNames.slice(),
    studentGroups,
    startDt,endDt,
    durMins:Math.round((endDt-startDt)/60000),
    calId:null,calName:_occCalName(course),
    courseId:course.id,          // 讓 eventRoster/eventRosterWithId 走 courseId 反查登記簿
    ...abs,
  };
}

// 範圍展開（今日=單日、本週=週一到週日）：掃所有系統課程
function expandCoursesForRange(start,end){
  const out=[];
  (driveData.courses||[]).forEach(c=>{out.push(...courseOccurrencesInRange(c,start,end));});
  return out;
}

// 系統請假紀錄 → 課堂物件（供待補課清單/學生統計）：
// 每筆紀錄重建它那一堂（含請假疊加），課程已刪的紀錄跳過（deleteCourse 會清，這裡防呆）
function sysAbsenceEvents(){
  const out=[];
  getAbsences().forEach(rec=>{
    const co=findCourseById(rec.courseId);if(!co)return;
    const day=new Date(rec.date);
    const occ=courseOccurrencesInRange(co,day,day).find(o=>o.id===rec.occId);
    if(occ)out.push(occ);
  });
  return out;
}

// 已排補課/調課（makeupScheduled 紀錄）→ 課堂物件（第 3 刀起主頁直接長補課場次，不靠 Google Calendar）
// 紀錄本身帶齊顯示所需（時段/教室/名單/原課名）；老師從原系統課反查（舊行事曆紀錄查無就留空）
function expandMakeupForRange(start,end){
  const out=[];
  (driveData.makeupScheduled||[]).forEach(rec=>{
    const sD=new Date(rec.scheduledDate),eD=new Date(rec.scheduledEnd);
    if(!(sD>=start&&sD<=end))return;
    const m=String(rec.originalId).match(/^sys:(\d+):/);
    const co=m?findCourseById(Number(m[1])):null;
    const students=(rec.absentStudents||[]).slice();
    // 補課場次的課型看實到人數（團班一人請假的補課＝一對一），練習課補課維持練習課
    const type=co&&co.type==='練習課'?'practice':(students.length>=3?'group':students.length===2?'pair':'one');
    out.push({
      id:'mk:'+rec.originalId,
      title:rec.origTitle,origTitle:rec.origTitle,
      desc:'',notes:'',
      teacher:co?(teacherNameById(co.teacherId)||''):'',
      classroom:rec.room||'',
      subject:co?(co.subject||''):'',
      type,students,studentGroups:[],
      startDt:sD,endDt:eD,
      durMins:Math.round((eD-sD)/60000),
      calId:null,calName:rec.calName==='調課'?'調課':'補課',
      courseId:null,               // 不走系統課請假路徑
      isMakeupOcc:true,            // 主頁動作列不出請假/調課鈕（要改期→待補課清單取消安排重排）
      makeupOriginalId:rec.originalId,
      isAbsent:false,isPartialAbsent:false,isFullAbsent:false,isRescheduled:false,
      rescheduleReason:'',absentWho:'',absType:'',absentStudents:[],
      isNoShow:false,noShowStudents:[],absenceTiming:{},makeupSkip:[],
    });
  });
  return out;
}
