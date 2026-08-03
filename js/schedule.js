// 系統自有課表 → 課堂物件展開器（開發路線 ①「全頁改讀系統」的地基）
// 把 driveData.courses 的排程（每週重複 / 指定日期）在某日期範圍內展開成「課堂物件」，
// 輸出形狀沿用舊 Calendar 解析器的課堂物件，讓今日/本週/時間軸/hero 幾乎不用改就能改讀系統。
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

// ── 滾動判型（2026-08-03）──
// 課型不是課程本體的固定標籤，而是「那一堂實際幾個人」：1 人一對一、2 人一對二、3+ 團班。
// 期中有人退出／插班，課型跟著那天的在籍人數自己降級或升級，補課時長與
// 「課前 1hr 內請假要不要算半堂」才會照實況走（見 makeup.js getEffectiveDur / needsMakeupDecision）。
// 三種不滾：練習課、試聽（本來就有自己的規則）、手動鎖定的課（typePinned，編輯課程點類型 chip）。
// 那天沒人在籍（人數 0）→ 退回課程本體的型，免得空堂顯示成「一對一」。
// ⚠ 老師費率單位刻意**不滾**（courses.js cfRateUnit 一律吃 co.type）：費率是開課時談好的合約，
//   團班的「元／人／堂」不該因為這個月少來一個人就變成「元／小時」。
function courseTypeByCount(co,n){
  if(!co)return'團班';
  if(co.type==='練習課'||co.type==='試聽')return co.type;
  if(co.typePinned)return co.type||'團班';
  if(!n)return co.type||'團班';
  return n===1?'一對一':n===2?'一對二':'團班';
}
// 某天在籍人數（登記簿依修課起訖裁切）
function courseRosterCountOn(co,day){
  if(!co)return 0;
  const d=typeof day==='string'?day:toDateStr(day||new Date());
  return getEnrollments({periodId:yearPeriodId()})
    .filter(en=>en.courseId===co.id&&enrollmentActiveOn(en,d)).length;
}
// 某天的課型（中文）。展開器手上已有人數走 courseTypeByCount，這支給沒人數在手的地方用
function courseTypeOn(co,day){return courseTypeByCount(co,courseRosterCountOn(co,day));}

// 系統課類型（中文）→ 內部 type code（parseEv 慣例 one/pair/group/practice；CSS 與 typeLbl 都吃它）
// count 已由 rosterOn 依課堂日期裁切，所以這裡拿到的就是「這一堂」的人數
function _occType(course,count){
  switch(courseTypeByCount(course,count)){
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

// 多段上課時間：schedule.slots＝起始段（課程建立起生效）；schedule.phases＝之後的換時段，各帶 from 日期。
// 回傳依生效日排序的段清單，每段 {fromMs, slots}；起始段 fromMs=-Infinity（涵蓋最早）。
function _schedulePhases(sched){
  const extra=(sched.phases||[])
    .filter(p=>p&&p.from&&Array.isArray(p.slots)&&p.slots.length)
    .map(p=>{const[y,mo,dd]=String(p.from).split('-').map(Number);const d=new Date(y,(mo||1)-1,dd||1);d.setHours(0,0,0,0);return{fromMs:d.getTime(),slots:p.slots};})
    .sort((a,b)=>a.fromMs-b.fromMs);
  return[{fromMs:-Infinity,slots:sched.slots||[]},...extra];
}
// 某天生效的段＝ from<=該天 的最後一段
function _activePhase(phases,day){
  const t=new Date(day);t.setHours(0,0,0,0);const ms=t.getTime();
  let cur=phases[0];
  for(const p of phases){if(p.fromMs<=ms)cur=p;else break;}
  return cur;
}

// 一門課在 [start,end]（含）範圍內的所有課堂
function courseOccurrencesInRange(course,start,end){
  const sched=course&&course.schedule;
  if(!sched||!Array.isArray(sched.slots)||!sched.slots.length)return[];
  if(course.status&&course.status!=='開課中')return[]; // 已結束的課不排
  // 名冊（本期登記簿，依 courseId）。有人設了修課起訖（插班／中途退出）時**逐日算**，
  // 名冊隨課堂日期變（8/1 起退出 → 7 月的堂還是 2 人、8 月的堂 1 人）；
  // 沒人設起訖就走快取的單一名冊（絕大多數課，成本同舊版）。
  const pid=yearPeriodId();
  const byId=new Map(getStudentList().map(s=>[s.id,s]));
  const ens=(driveData.enrollments||[]).filter(en=>en.courseId===course.id&&en.periodId===pid);
  const hasWindow=ens.some(en=>en.startDate||en.endDate);
  const rosterCache=new Map();
  function rosterOn(day){
    const key=hasWindow?toDateStr(day):'*';
    if(rosterCache.has(key))return rosterCache.get(key);
    const act=hasWindow?ens.filter(en=>enrollmentActiveOn(en,key)):ens;
    const names=act.map(en=>byId.get(en.studentId)?.name).filter(Boolean);
    // 練習課分組（科目：學生）——供課堂物件的 studentGroups
    const groupMap=new Map();
    act.forEach(en=>{
      const nm=byId.get(en.studentId)?.name;if(!nm)return;
      const subj=pracSubjLabel(en.practiceSubject)||'（未填科目）'; // 數學＋理化 → 併成「數理」一組
      if(!groupMap.has(subj))groupMap.set(subj,[]);
      groupMap.get(subj).push(nm);
    });
    const r={names,groups:course.type==='練習課'?[...groupMap].map(([subject,students])=>({subject,students})):[]};
    rosterCache.set(key,r);
    return r;
  }

  const out=[];
  const s0=new Date(start);s0.setHours(0,0,0,0);
  const e0=new Date(end);e0.setHours(23,59,59,999);
  if(sched.mode==='dates'){
    // 指定日期（試聽等單場）：不分段
    sched.slots.forEach((slot,si)=>{
      if(!slot.date)return;
      const[y,mo,dd]=String(slot.date).split('-').map(Number);
      const d=new Date(y,(mo||1)-1,dd||1);d.setHours(0,0,0,0);
      if(d>=s0&&d<=e0){const r=rosterOn(d);out.push(_makeOccurrence(course,d,si,_atTime(d,slot.start),_atTime(d,slot.end),r.names,r.groups));}
    });
  }else{
    // 每週重複：逐日掃，套用「當天生效的時段段落」（多段依日期自動切換）
    const phases=_schedulePhases(sched);
    const cur=new Date(s0);
    while(cur<=e0){
      const slots=_activePhase(phases,cur).slots;
      for(let si=0;si<slots.length;si++){
        const slot=slots[si];
        if(Number(slot.weekday)===cur.getDay()){
          const r=rosterOn(cur);
          out.push(_makeOccurrence(course,new Date(cur),si,_atTime(cur,slot.start),_atTime(cur,slot.end),r.names,r.groups));
        }
      }
      cur.setDate(cur.getDate()+1);
    }
  }
  return out;
}

// 請假紀錄 + 該堂名冊 → 課堂物件的請假欄位（語意對齊 parseEv 的標題解析結果）。
// 系統課堂（_makeOccurrence）與舊行事曆搬遷的快照紀錄（_snapshotOccurrence）共用同一套判斷。
function _absFields(ab,rosterNames){
  if(!ab)return{isAbsent:false,isPartialAbsent:false,isFullAbsent:false,
    absentWho:'',absType:'',absentStudents:[],
    isNoShow:false,noShowStudents:[],absenceTiming:{},makeupSkip:[],
    isRescheduled:false,rescheduleReason:''};
  const leaveNames=(ab.leave||[]).map(x=>x.name);
  const noShowNames=(ab.noShow||[]).map(x=>x.name);
  const teacherAbs=!!ab.teacherAbsent;
  const resched=!!ab.resched;
  const isAbsent=teacherAbs||leaveNames.length>0;
  const total=rosterNames.length;
  const timing={};
  (ab.leave||[]).forEach(x=>{timing[x.name]=x.timing||'B';});
  noShowNames.forEach(n=>{timing[n]='C';});
  return{
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

function _makeOccurrence(course,day,slotIdx,startDt,endDt,rosterNames,studentGroups){
  // 穩定合成 id：同一堂重載後不變（點名/請假紀錄以此為鍵）。sys: 前綴標明「系統課堂」非 Calendar 事件
  const occId=`sys:${course.id}:${toDateStr(day)}:${slotIdx}`;
  // 疊加請假狀態（第 2 刀）：查系統請假紀錄
  const abs=_absFields(findAbsenceByOcc(occId),rosterNames);
  // 課名依課堂日期取（namePhases：某日起改叫別的，名單期中變動時用）
  const occName=courseNameOn(course,day);
  return{
    id:occId,
    title:occName,origTitle:occName,
    desc:'',notes:'',
    teacher:courseTeacherNames(course).join('、'),
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

// 舊行事曆搬遷來的請假紀錄（第 4 刀）：課程本身已不存在系統裡，紀錄自帶 snapshot
// （課名/時段/教室/老師/名單），直接照快照長出課堂物件，不需要 findCourseById。
function _snapshotOccurrence(rec){
  const sn=rec.snapshot||{};
  const startDt=new Date(sn.start),endDt=new Date(sn.end);
  const roster=(sn.students||[]).slice();
  return{
    id:rec.occId,
    title:sn.title||'',origTitle:sn.title||'',
    desc:'',notes:sn.notes||'',
    teacher:sn.teacher||'',classroom:sn.classroom||'',subject:sn.subject||'',
    type:sn.type||'group',
    students:roster,studentGroups:sn.studentGroups||[],
    startDt,endDt,
    durMins:Math.round((endDt-startDt)/60000),
    calId:null,calName:sn.calName||'一般課程',
    courseId:null,               // 沒有對應的系統課
    isLegacyAbsence:true,        // 標記來源：走系統寫入路徑，但不長在今日/本週（那門課早已不排）
    ..._absFields(rec,roster),
  };
}

// 系統請假紀錄 → 課堂物件（供待補課清單/學生統計）：
// 每筆紀錄重建它那一堂（含請假疊加），課程已刪的紀錄跳過（deleteCourse 會清，這裡防呆）
function sysAbsenceEvents(){
  const out=[];
  getAbsences().forEach(rec=>{
    if(rec.snapshot){out.push(_snapshotOccurrence(rec));return;}
    const co=findCourseById(rec.courseId);if(!co)return;
    const day=new Date(rec.date);
    const occ=courseOccurrencesInRange(co,day,day).find(o=>o.id===rec.occId);
    if(occ)out.push(occ);
  });
  return out;
}

// 這堂課的請假/調課/不補課要寫進系統（driveData.absences）還是 Google Calendar？
// 系統課堂有 courseId；舊行事曆搬遷的快照紀錄沒有 courseId 但一樣走系統路徑。
// 第 4 刀拔掉 Calendar 分支後，這個判斷會整個消失（屆時全部都走系統）。
function isSysEvent(ev){return !!ev&&(ev.courseId!=null||ev.isLegacyAbsence===true);}

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
      teacher:co?courseTeacherNames(co).join('、'):'',
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
