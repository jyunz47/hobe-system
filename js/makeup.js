// 待補課/調課清單 + 補課媒合 + slot picker（日期→時段→教室→確認）

// 底部「已完成安排」「不補課」區塊預設收合，點標題展開；搜尋時強制展開
var mkSecOpen={completed:false,skipped:false};
function toggleMkSec(key){mkSecOpen[key]=!mkSecOpen[key];renderMakeup();}
// 點頂部「已完成」統計卡 → 展開已完成區塊並捲過去
function jumpToMkCompleted(){
  if(!mkSecOpen.completed){mkSecOpen.completed=true;renderMakeup();}
  document.getElementById('mk-sec-completed')?.scrollIntoView({behavior:'smooth',block:'start'});
}

// ── 載入補課清單 + 媒合 ──
async function loadMakeup(silent=false){
  if(!gapi.client.getToken())return;
  if(!silent)showL('讀取待補課/調課清單...');
  try{
    const y=getSchoolYear(),past=new Date(y,8,1),future=new Date(y+1,7,31,23,59,59);
    const calEntries=Object.entries(calendarIds).filter(([name])=>MAKEUP_CALS.includes(name));
    const all=await Promise.all(calEntries.map(async([name,id])=>{
      try{const r=await cachedEventList({calendarId:id,timeMin:past.toISOString(),timeMax:future.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:2500});
      return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));}catch(e){return[];}
    }));
    const SUBJECTS=['數學','英文','理化','物理','化學','國文','生物','歷史','地理','社會','自然','寫作','作文'];
    const decorate=ev=>({...ev,
      subject:ev.subject&&SUBJECTS.includes(ev.subject)?ev.subject:(SUBJECTS.find(s=>ev.origTitle.includes(s))||'其他'),
      extraNote:(ev.desc||'').split('\n').slice(1).filter(Boolean).join(' · ')});
    const calAbs=all.flat()
      .filter(e=>/^【.+?請假】/.test(e.summary||'')||/^【調課(?:[：:].*?)?】/.test(e.summary||'')||/^【[^】]*曠課】/.test(e.summary||''))
      .map(e=>decorate(parseEv(e)));
    // 系統請假（driveData.absences，第 2 刀起）：展開成同形狀課堂物件一起進清單
    const sysAbs=(typeof sysAbsenceEvents==='function'?sysAbsenceEvents():[]).map(decorate);
    makeupList=[...calAbs,...sysAbs].sort((a,b)=>a.startDt-b.startDt);
    // Scan 補課 and 調課 calendars to match against absences
    const newMatchMap=new Map();
    for(const calName of['補課','調課']){
      const calId=calendarIds[calName];if(!calId)continue;
      try{
        const mr=await cachedEventList({calendarId:calId,timeMin:past.toISOString(),timeMax:future.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:2500});
        (mr.result.items||[]).forEach(calEv=>{
          const desc=cleanDesc(calEv.description||'');
          const sD=new Date(calEv.start.dateTime||calEv.start.date);
          const eD=new Date(calEv.end.dateTime||calEv.end.date);
          const extId=calEv.extendedProperties?.private?.originalAbsenceId?.trim();
          const descId=desc.split('\n').find(l=>/^originalId:/.test(l))?.match(/^originalId:(.+)/)?.[1]?.trim();
          const absId=extId||descId;
          const firstLine=desc.split('\n')[0]||'';
          const roomMatch=firstLine.match(/(小教室|大教室|108|208|309|石牌分校)/);
          const room=roomMatch?roomMatch[1]:'';
          const origTitle=(calEv.summary||'').replace(/^【.+?】/,'').trim();
          const entry={calEventId:calEv.id,scheduledDate:sD.toISOString(),scheduledEnd:eD.toISOString(),room,origTitle,absentStudents:[],calName};
          if(absId){
            newMatchMap.set(absId,entry);
          }else{
            // Fallback: match by title
            const titleMatch=calName==='補課'
              ?(calEv.summary||'').match(/^【(.+?)補課[（(].*?[）)]】(.+)$/)
              :(calEv.summary||'').match(/^【.+?的調課】(.+)$/);
            if(titleMatch){
              const matchOrigTitle=(calName==='補課'?titleMatch[2]:titleMatch[1]).trim();
              const candidate=makeupList.find(a=>a.origTitle===matchOrigTitle&&!newMatchMap.has(a.id)&&a.absType===(calName==='補課'?'學生請假':'調課'));
              if(candidate)newMatchMap.set(candidate.id,{...entry,origTitle:matchOrigTitle});
            }
          }
        });
      }catch(e){console.warn(`${calName}行事曆掃描失敗`,e);}
    }
    // Merge localStorage records as fallback for unmatched
    getMakeupScheduledLS().forEach(rec=>{if(!newMatchMap.has(rec.originalId))newMatchMap.set(rec.originalId,{...rec,calName:rec.calName||'補課'});});
    makeupMatchMap=newMatchMap;
    if(!silent){hideErr('makeup');populateMkFilters();renderMakeup();}
    const pendingCount=updateMakeupBadge();
    if(!silent)toast(`找到 ${pendingCount} 筆待安排`,'ok');
  }catch(err){if(!silent)showErr('makeup','讀取失敗：'+(err.result?.error?.message||err.message));}
  finally{if(!silent)hideL();}
}

function populateMkFilters(){
  const subs=[...new Set(makeupList.map(e=>e.subject).filter(Boolean))].sort();
  const sel=document.getElementById('f-subject');const cur=sel.value;
  sel.innerHTML='<option value="">全部科目</option>'+subs.map(s=>`<option value="${esc(s)}">${s}</option>`).join('');
  if(subs.includes(cur))sel.value=cur;
}

// 純曠課事件（只有曠課、沒有請假/調課）→ 收進 makeupList 供學生統計用，但不該出現在待補課清單
function isPureNoShow(e){return e.isNoShow&&!e.isAbsent&&!e.isRescheduled;}
// 這筆請假是否已決定「不補課」（請假學生全在 makeupSkip 名單）→ 退半堂、不算欠課、不進待安排
function isMakeupSkipped(e){
  return (e.absentStudents?.length>0)&&e.absentStudents.every(s=>(e.makeupSkip||[]).includes(s));
}
// 課前1hr內請假、且補/不補有學費分歧 → 待與家長確認（補 +半堂、不補 −半堂）
// 適用：一對一家教(one)、一對二(pair 兩人，沒一起調課成功而走個別補課的)。團班不適用
function needsMakeupDecision(e){
  if(e.absType!=='學生請假')return false; // 只有學生請假才有補/不補分歧（調課/老師請假不算）
  const small=e.type==='one'||(e.type==='pair'&&(e.students?.length||0)===2);
  return small&&(e.absentStudents||[]).some(s=>(e.absenceTiming||{})[s]==='B');
}

function renderMakeup(){
  const period=getCurrentPeriod();
  const fs=document.getElementById('f-subject').value;
  const ft=document.getElementById('f-type').value;
  const fq=(document.getElementById('f-search')?.value||'').trim().toLowerCase();
  const now=new Date();
  const scheduledAll=getMakeupScheduled();
  const completedIds=new Set(scheduledAll.filter(s=>new Date(s.scheduledEnd)<now).map(s=>s.originalId));
  const scheduledFutureIds=new Set(scheduledAll.filter(s=>new Date(s.scheduledEnd)>=now).map(s=>s.originalId));

  // 純曠課事件雖收在 makeupList（供學生統計），但不進補課清單
  const allInPeriod=makeupList.filter(e=>e.startDt>=period.start&&e.startDt<=period.end&&!isPureNoShow(e));
  const pendingStatCnt=allInPeriod.filter(e=>!completedIds.has(e.id)&&!scheduledFutureIds.has(e.id)&&!isMakeupSkipped(e)).length;
  const scheduledStatCnt=allInPeriod.filter(e=>scheduledFutureIds.has(e.id)).length;
  const completedStatCnt=allInPeriod.filter(e=>completedIds.has(e.id)).length;

  function matchesFilter(e){
    if(fs&&e.subject!==fs)return false;
    if(ft&&e.absType!==ft)return false;
    if(fq){const hay=(e.origTitle+' '+e.absentWho+' '+e.teacher+' '+(e.absentStudents||[]).join(' ')).toLowerCase();if(!hay.includes(fq))return false;}
    return true;
  }

  const filteredAll=allInPeriod.filter(matchesFilter);
  const pending=filteredAll.filter(e=>!completedIds.has(e.id)&&!scheduledFutureIds.has(e.id)&&!isMakeupSkipped(e));
  const scheduledList=filteredAll.filter(e=>scheduledFutureIds.has(e.id));
  const completedList=filteredAll.filter(e=>completedIds.has(e.id));
  const skippedList=filteredAll.filter(e=>isMakeupSkipped(e)&&!scheduledFutureIds.has(e.id)&&!completedIds.has(e.id));

  document.getElementById('rc').textContent=`共 ${filteredAll.length} 筆`;

  const topArea=document.getElementById('mk-top-area');
  if(topArea){
    topArea.innerHTML=periodTabsHtml()+`<div class="mk-stats">
      <div class="mk-stat mk-stat-pending"><div class="mk-stat-icon">⏰</div><div><div class="mk-stat-num">${pendingStatCnt}</div><div class="mk-stat-lbl">待安排</div></div></div>
      <div class="mk-stat mk-stat-arr"><div class="mk-stat-icon">🗓️</div><div><div class="mk-stat-num">${scheduledStatCnt}</div><div class="mk-stat-lbl">已安排</div></div></div>
      <div class="mk-stat mk-stat-done mk-stat-link" onclick="jumpToMkCompleted()" title="點擊查看已完成安排"><div class="mk-stat-icon">✅</div><div><div class="mk-stat-num">${completedStatCnt}</div><div class="mk-stat-lbl">已完成</div></div></div>
    </div>`;
  }

  const c=document.getElementById('clist-makeup');
  if(!allInPeriod.length){c.innerHTML=`<div class="empty">${period.label}沒有待補課/調課 🎉</div>`;return;}

  function mkCardTitle(e){
    if(e.absType==='學生請假'&&e.absentWho)return`${esc(e.absentWho)} — ${esc(e.origTitle)}`;
    return esc(e.origTitle);
  }
  function absBadge(e){
    if(e.absType==='老師請假')return`<span class="mk-badge mk-badge-teacher">老師請假</span>`;
    if(e.absType==='調課')return`<span class="mk-badge mk-badge-reschedule">調課</span>`;
    return`<span class="mk-badge mk-badge-student">學生請假</span>`;
  }

  function pendingCard(e){
    const d=e.startDt,de=e.endDt,color=calColor(e.calName);
    const mode=e.absType==='調課'?'reschedule':'makeup';
    const tutorB=needsMakeupDecision(e); // 課前1hr內、補/不補待確認（一對一家教 / 個別補課的一對二）
    return`<div class="mk-list-card${tutorB?' mk-confirm':''}" onclick="openSlotPicker('${esc(e.id)}','${mode}')">
      <div class="mk-list-bar" style="background:${color}"></div>
      <div class="mk-list-body">
        <div class="mk-list-top">
          <span class="mk-list-title">${mkCardTitle(e)}</span>
          ${absBadge(e)}<span class="mk-badge mk-badge-un">未安排</span>${tutorB?'<span class="mk-badge" style="background:#F8EDEA;color:#C0504A;border:1px solid #E8C5BF" title="課前1小時內請假，補課要與家長確認。去排補課＝補（多收半堂）；不補則退半堂">⚠ 待確認補課</span>':''}
        </div>
        <div class="mk-list-meta">
          <span>📅 ${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）</span>
          <span>🕐 ${fmtT(d)}–${fmtT(de)}</span>
          ${e.classroom?`<span>📍 ${esc(e.classroom)}</span>`:''}
          ${e.teacher?`<span>👤 ${esc(e.teacher)}</span>`:''}
        </div>
      </div>
      <div class="mk-list-actions">
        ${tutorB?`<button class="mk-btn-cancel" style="font-size:12px;padding:5px 10px;margin-left:0" onclick="event.stopPropagation();markMakeupSkip('${esc(e.id)}')">不補課</button>`:''}
        <button class="mk-btn-arrange" onclick="event.stopPropagation();openSlotPicker('${esc(e.id)}','${mode}')">安排</button>
      </div>
    </div>`;
  }

  function skippedCard(e){
    const d=e.startDt,de=e.endDt,color=calColor(e.calName);
    return`<div class="mk-list-card mk-completed">
      <div class="mk-list-bar" style="background:${color}"></div>
      <div class="mk-list-body">
        <div class="mk-list-top">
          <span class="mk-list-title">${mkCardTitle(e)}</span>
          <span class="mk-badge" style="background:var(--sf2);color:var(--tx2);border:1px solid var(--br)">不補課・退半堂</span>
        </div>
        <div class="mk-list-meta">
          <span>📅 ${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）</span>
          <span>🕐 ${fmtT(d)}–${fmtT(de)}</span>
          ${e.teacher?`<span>👤 ${esc(e.teacher)}</span>`:''}
        </div>
      </div>
      <div class="mk-list-actions">
        <button class="mk-btn-cancel" onclick="unmarkMakeupSkip('${esc(e.id)}')">改為補課</button>
      </div>
    </div>`;
  }

  function scheduledCard(e,rec,isCompleted){
    const d=e.startDt,de=e.endDt,color=calColor(e.calName);
    const sd=new Date(rec.scheduledDate),se=new Date(rec.scheduledEnd);
    const statusBadge=isCompleted
      ?`<span class="mk-badge mk-badge-done">✓ 已完成</span>`
      :`<span class="mk-badge mk-badge-arr">✓ 已安排</span>`;
    return`<div class="mk-list-card${isCompleted?' mk-completed':' mk-arr'}">
      <div class="mk-list-bar" style="background:${color}"></div>
      <div class="mk-list-body">
        <div class="mk-list-top">
          <span class="mk-list-title">${mkCardTitle(e)}</span>
          ${absBadge(e)}${statusBadge}
        </div>
        <div class="mk-list-meta">
          <span>📅 ${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）</span>
          <span>🕐 ${fmtT(d)}–${fmtT(de)}</span>
          ${e.classroom?`<span>📍 ${esc(e.classroom)}</span>`:''}
          ${e.teacher?`<span>👤 ${esc(e.teacher)}</span>`:''}
        </div>
        <div class="mk-list-makeup">
          <span class="mk-list-makeup-lbl">${e.absType==='調課'?'調課':'補課'}：</span>
          <span>${sd.getMonth()+1}/${sd.getDate()}（${WD[sd.getDay()]}）</span>
          <span class="mk-dot">•</span>
          <span>${fmtT(sd)}–${fmtT(se)}</span>
          ${rec.room?`<span class="mk-dot">•</span><span>📍 ${esc(rec.room)}</span>`:''}
          ${!isCompleted?`<button class="mk-btn-cancel" onclick="event.stopPropagation();deleteMakeupScheduled('${esc(e.id)}')">取消安排</button>`:''}
        </div>
      </div>
    </div>`;
  }

  let html='';

  // 待安排
  html+=`<div class="mk-sec"><div class="mk-sec-head"><span class="mk-sec-dot" style="background:#EE9F3C"></span>待安排<span class="mk-sec-pill">${pending.length}</span></div>`;
  if(!pending.length){html+=`<div class="empty" style="padding:14px 0">全部已安排 🎉</div>`;}
  else{pending.forEach(e=>{html+=pendingCard(e);});}
  html+=`</div>`;

  // 已安排
  html+=`<div class="mk-sec"><div class="mk-sec-head"><span class="mk-sec-dot" style="background:#6B8F7A"></span>已安排<span class="mk-sec-pill">${scheduledList.length}</span></div>`;
  if(!scheduledList.length){html+=`<div class="empty" style="padding:14px 0">尚無已安排補課</div>`;}
  else{scheduledList.forEach(e=>{const rec=scheduledAll.find(s=>s.originalId===e.id);if(rec)html+=scheduledCard(e,rec,false);});}
  html+=`</div>`;

  // 已完成安排（最近完成的在上）
  if(completedList.length){
    const open=mkSecOpen.completed||!!fq;
    html+=`<div id="mk-sec-completed" class="mk-sec-lbl mk-sec-gap mk-sec-toggle" style="margin-top:24px" onclick="toggleMkSec('completed')"><span class="mk-sec-arrow">${open?'▾':'▸'}</span>已完成安排（${completedList.length}）</div>`;
    if(open){
      completedList
        .map(e=>({e,rec:scheduledAll.find(s=>s.originalId===e.id)}))
        .filter(x=>x.rec)
        .sort((a,b)=>new Date(b.rec.scheduledDate)-new Date(a.rec.scheduledDate))
        .forEach(x=>{html+=scheduledCard(x.e,x.rec,true);});
    }
  }

  // 不補課（退半堂）
  if(skippedList.length){
    const open=mkSecOpen.skipped||!!fq;
    html+=`<div class="mk-sec-lbl mk-sec-gap mk-sec-toggle" style="margin-top:24px" onclick="toggleMkSec('skipped')"><span class="mk-sec-arrow">${open?'▾':'▸'}</span>不補課・退半堂（${skippedList.length}）</div>`;
    if(open)skippedList.forEach(e=>{html+=skippedCard(e);});
  }

  c.innerHTML=html;
}

// 系統課堂的不補課標記：直接寫請假紀錄的 makeupSkip 欄
function sysSetMakeupSkip(ev,skipNames){
  const list=getAbsences().slice();
  const rec=list.find(a=>a.occId===ev.id);if(!rec)return;
  rec.makeupSkip=skipNames;
  rec.updatedAt=new Date().toISOString();
  saveAbsences(list);
}
// 標記「不補課」：把請假學生寫進事件隱藏欄位 makeupSkip → 退半堂、不算欠課、移出待安排
async function markMakeupSkip(id){
  const ev=findEventById(id);if(!ev)return;
  const skip=[...new Set([...(ev.makeupSkip||[]),...(ev.absentStudents||[])])];
  if(ev.courseId!=null){
    sysSetMakeupSkip(ev,skip);
    toast('已標記不補課（退半堂）','ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
    return;
  }
  showL('標記不補課...');
  try{
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:id,resource:{extendedProperties:{private:{makeupSkip:JSON.stringify(skip)}}}});
    invalidateEventCache();
    hideL();toast('已標記不補課（退半堂）','ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  }catch(e){hideL();toast('操作失敗：'+(e.result?.error?.message||e.message),'err');}
}
// 改回補課：把這筆的請假學生從 makeupSkip 移除
async function unmarkMakeupSkip(id){
  const ev=findEventById(id);if(!ev)return;
  const skip=(ev.makeupSkip||[]).filter(s=>!(ev.absentStudents||[]).includes(s));
  if(ev.courseId!=null){
    sysSetMakeupSkip(ev,skip);
    toast('已改為補課','ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
    return;
  }
  showL('改為補課...');
  try{
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:id,resource:{extendedProperties:{private:{makeupSkip:skip.length?JSON.stringify(skip):null}}}});
    invalidateEventCache();
    hideL();toast('已改為補課','ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  }catch(e){hideL();toast('操作失敗：'+(e.result?.error?.message||e.message),'err');}
}

async function gotoMakeupEvent(id, ts){
  currentDate=new Date(ts);
  setDateDisplay(currentDate);
  document.getElementById('date-picker').value=toDateStr(currentDate);
  showPanel('courses');
  document.getElementById('nav-courses').classList.add('active');
  document.getElementById('nav-makeup').classList.remove('active');
  await loadToday();
  const card=document.getElementById('cc-'+id);
  if(card){card.scrollIntoView({behavior:'smooth',block:'center'});trigHL(card);}
}

function updateBadge(n){const b=document.getElementById('badge-makeup');b.textContent=n;b.style.display=n>0?'inline':'none';}
function updateMakeupBadge(){const period=getCurrentPeriod();const scheduledIds=new Set(getMakeupScheduled().map(x=>x.originalId));const n=makeupList.filter(e=>!scheduledIds.has(e.id)&&e.startDt>=period.start&&e.startDt<=period.end&&!isPureNoShow(e)&&!isMakeupSkipped(e)).length;updateBadge(n);return n;}

// ── Slot Picker（補課/調課時段選擇器）──
function getEffectiveDur(){
  const d=slotPicker.ev?.durMins||60;
  // 補課維持原時長：練習課、家教一對一（type==='one'）。其餘（一對二 pair、團班 group）砍半堂
  if(slotPicker.mode==='makeup'&&(slotPicker.ev?.type==='practice'||slotPicker.ev?.type==='one'))return d;
  return slotPicker.mode==='makeup'?Math.max(30,Math.floor(d/2)):d;
}

function getEffectiveType(){
  const ev=slotPicker.ev;
  if(slotPicker.mode==='makeup'&&ev.type==='group'){
    const n=ev.absentStudents.length||1;
    return n===1?'one':n===2?'pair':'group';
  }
  return ev.type;
}

function getEffectiveStudentCount(){
  const ev=slotPicker.ev;
  if(slotPicker.mode==='makeup'&&ev.type==='group')return Math.max(1,ev.absentStudents.length);
  return ev.students.length||1;
}

function openSlotPicker(id,mode){
  const ev=findEventById(id);
  if(!ev)return;
  const branch=ev.classroom==='石牌分校'?'石牌':'北投';
  slotPicker={ev,mode,date:null,time:null,room:null,avail:null,branch};
  const d=ev.startDt;
  const ds=`${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）${fmtT(d)}  ⏱ ${fmtDur(ev.durMins)}`;
  document.getElementById('sp-title').textContent=mode==='makeup'?`安排補課：${ev.origTitle}`:`安排調課：${ev.origTitle}`;
  document.getElementById('sp-sub').textContent=(mode==='makeup'?'缺課日期：':'調課日期：')+ds+(ev.teacher?`  👤 ${ev.teacher}`:'');
  renderSpBody();
  document.getElementById('sp-modal').classList.add('open');
}

function closeSlotPicker(){
  document.getElementById('sp-modal').classList.remove('open');
  slotPicker={ev:null,mode:null,date:null,time:null,room:null,avail:null,branch:null};
}

function renderSpBody(){
  const body=document.getElementById('sp-body');
  body.innerHTML='';
  const step=!slotPicker.date?1:!slotPicker.time?2:!slotPicker.room?3:4;
  body.appendChild(buildSpStepper(step));
  body.appendChild(buildSpDateSection());
  if(slotPicker.date)body.appendChild(buildSpTimeSection());
  if(slotPicker.time)body.appendChild(buildSpRoomSection());
  if(slotPicker.room)body.appendChild(buildSpConfirm());
}

// B4 視覺指示 stepper（純反映目前進度，不影響流程）
function buildSpStepper(cur){
  const steps=['日期','時段','教室','確認'];
  const wrap=document.createElement('div');
  wrap.className='sp-stepper';
  wrap.innerHTML=steps.map((s,i)=>{
    const n=i+1,st=n<cur?'done':n===cur?'cur':'todo';
    return`<div class="sp-step sp-step-${st}"><span class="sp-step-dot">${n<cur?'✓':n}</span><span class="sp-step-lbl">${s}</span></div>`;
  }).join('<span class="sp-step-line"></span>');
  return wrap;
}

function buildSpDateSection(){
  const sec=document.createElement('div');
  sec.innerHTML=`<div class="sp-lbl">選擇日期</div><div class="sp-chips"></div>`;
  const chips=sec.querySelector('.sp-chips');
  const today=new Date();today.setHours(0,0,0,0);
  const quickDates=new Set();
  for(let i=0;i<14;i++){
    const d=new Date(today);d.setDate(today.getDate()+i);
    const ds=toDateStr(d);
    quickDates.add(ds);
    const el=document.createElement('div');
    el.className='sp-date'+(slotPicker.date===ds?' sp-sel':'');
    const tag=i===0?'今天':i===1?'明天':'&nbsp;';
    el.innerHTML=`<div class="sp-date-tag">${tag}</div><div class="sp-date-num">${d.getMonth()+1}/${d.getDate()}</div><div class="sp-date-wd">週${WD[d.getDay()]}</div>`;
    el.onclick=()=>selectSpDate(ds);
    chips.appendChild(el);
  }
  const custom=document.createElement('div');
  const isCustomSel=slotPicker.date&&!quickDates.has(slotPicker.date);
  custom.className='sp-date-custom'+(isCustomSel?' sp-sel':'');
  const year=today.getFullYear();
  const selM=isCustomSel?parseInt(slotPicker.date.split('-')[1]):0;
  const selD=isCustomSel?parseInt(slotPicker.date.split('-')[2]):0;
  let mOpts='<option value="">月</option>';
  for(let i=1;i<=12;i++)mOpts+=`<option value="${i}"${selM===i?' selected':''}>${i}月</option>`;
  function daysInMonth(m,y){return new Date(y,m,0).getDate();}
  const maxD=selM?daysInMonth(selM,year):31;
  let dOpts='<option value="">日</option>';
  for(let i=1;i<=maxD;i++)dOpts+=`<option value="${i}"${selD===i?' selected':''}>${i}日</option>`;
  custom.innerHTML=`<div style="font-size:10px;color:var(--tx3)">自選日期</div><div style="display:flex;gap:2px"><select id="sp-cm">${mOpts}</select><select id="sp-cd">${dOpts}</select></div>`;
  function trySelectCustom(){
    const m=custom.querySelector('#sp-cm').value;
    const d=custom.querySelector('#sp-cd').value;
    if(!m||!d)return;
    const ds=`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    selectSpDate(ds);
  }
  custom.querySelector('#sp-cm').onchange=function(){
    const m=parseInt(this.value);
    const dSel=custom.querySelector('#sp-cd');
    const curD=parseInt(dSel.value)||0;
    const max=m?daysInMonth(m,year):31;
    let opts='<option value="">日</option>';
    for(let i=1;i<=max;i++)opts+=`<option value="${i}"${curD===i?' selected':''}>${i}日</option>`;
    dSel.innerHTML=opts;
    trySelectCustom();
  };
  custom.querySelector('#sp-cd').onchange=trySelectCustom;
  chips.appendChild(custom);
  return sec;
}

async function selectSpDate(ds){
  if(slotPicker.date===ds)return;
  slotPicker={...slotPicker,date:ds,time:null,room:null,avail:null};
  const [y,m,d]=ds.split('-').map(Number);
  const dayStart=new Date(y,m-1,d,0,0,0),dayEnd=new Date(y,m-1,d,23,59,59);
  // 空檔改掃系統課表（系統課程＋已排補課/調課場次），不再讀 Google Calendar
  slotPicker.avail=[...expandCoursesForRange(dayStart,dayEnd),...expandMakeupForRange(dayStart,dayEnd)];
  renderSpBody();
}

function overlaps(s1,e1,s2,e2){return s1<e2&&e1>s2;}

function switchSpBranch(b){
  slotPicker={...slotPicker,branch:b,time:null,room:null};
  renderSpBody();
}

function hasSuitableRoomShipai(sStart,sEnd){
  const etype=getEffectiveType();
  const active=slotPicker.avail.filter(e=>e.classroom==='石牌分校'&&!e.isAbsent&&!e.isRescheduled&&overlaps(e.startDt,e.endDt,sStart,sEnd));
  if(etype==='one')return active.filter(e=>e.type==='one').length<4;
  return !active.some(e=>e.type==='group'||e.type==='pair');
}

function getRoomAvail(events,room,sStart,sEnd){
  if(room==='大教室'){
    const pStudents=events.filter(e=>e.type==='practice'&&overlaps(e.startDt,e.endDt,sStart,sEnd))
      .reduce((sum,e)=>sum+(e.students.length||1),0);
    const max1on1=pStudents>=15?4:pStudents>=13?5:6;
    const cur1on1=events.filter(e=>e.type==='one'&&e.classroom==='大教室'&&overlaps(e.startDt,e.endDt,sStart,sEnd)).length;
    const free=max1on1-cur1on1;
    return{available:free>0,free,max:max1on1,pStudents};
  }
  const busy=events.some(e=>e.classroom===room&&overlaps(e.startDt,e.endDt,sStart,sEnd));
  return{available:!busy};
}

function hasSuitableRoom(sStart,sEnd){
  if(slotPicker.branch==='石牌')return hasSuitableRoomShipai(sStart,sEnd);
  const avail=slotPicker.avail;
  const etype=getEffectiveType();
  if(etype==='practice')return getRoomAvail(avail,'大教室',sStart,sEnd).available;
  if(etype==='one'){
    if(getRoomAvail(avail,'大教室',sStart,sEnd).available)return true;
    return ROOMS_SMALL.some(r=>getRoomAvail(avail,r,sStart,sEnd).available);
  }
  const need=etype==='pair'?2:getEffectiveStudentCount();
  return ROOMS_SMALL.some(r=>ROOM_CAP[r]>=need&&getRoomAvail(avail,r,sStart,sEnd).available);
}

function buildSpTimeSection(){
  const sec=document.createElement('div');
  const dur=getEffectiveDur();
  const isPracticeMakeup=getEffectiveType()==='practice'&&slotPicker.mode==='makeup';
  const branchToggle=`<div class="period-tabs sp-seg" style="margin-bottom:10px"><button class="period-tab${slotPicker.branch==='北投'?' active':''}" onclick="switchSpBranch('北投')">北投分校</button><button class="period-tab${slotPicker.branch==='石牌'?' active':''}" onclick="switchSpBranch('石牌')">石牌分校</button></div>`;
  sec.innerHTML=`<div class="sp-lbl">選擇時段（${fmtDur(dur)}${slotPicker.mode==='makeup'&&dur!==slotPicker.ev.durMins?'，補課縮短至原時長一半':''}）</div>${branchToggle}${slotPicker.avail===null?'<div style="color:var(--tx2);font-size:13px">讀取中...</div>':'<div class="sp-chips-wrap"></div>'}`;
  if(!slotPicker.avail)return sec;
  const wrap=sec.querySelector('.sp-chips-wrap');
  const [y,m,d]=slotPicker.date.split('-').map(Number);
  const dow=new Date(y,m-1,d).getDay();
  const isWeekday=dow>=1&&dow<=5;
  const startMin=isWeekday?16*60:9*60;
  const endMin=21*60+30;
  const noRoomEvs=slotPicker.avail.filter(e=>!e.classroom&&!e.isAbsent&&!e.isRescheduled);
  if(noRoomEvs.length>0){
    const w=document.createElement('div');
    w.className='sp-warn';w.style.marginBottom='12px';
    w.textContent=`⚠ ${noRoomEvs.length} 堂課無教室資料，空檔僅供參考：${noRoomEvs.map(e=>e.origTitle).join('、')}`;
    wrap.appendChild(w);
  }
  const isSel=(h,mi)=>slotPicker.time&&slotPicker.time.h===h&&slotPicker.time.mi===mi;
  const mkTime=(h,mi,sub)=>{
    const el=document.createElement('div');
    el.className=`sp-time${isSel(h,mi)?' sp-sel':''}`;
    el.innerHTML=`${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}${sub?`<span class="sp-time-sub">${sub}</span>`:''}`;
    el.onclick=()=>selectSpTime(h,mi);
    return el;
  };
  if(isPracticeMakeup){
    const newStu=slotPicker.ev.absentStudents?.length||1;
    const joinSlots=[],freeSlots=[];
    for(let total=startMin;total<=endMin-dur;total+=30){
      const h=Math.floor(total/60),mi=total%60;
      const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+dur);
      const practEvs=slotPicker.avail.filter(e=>e.type==='practice'&&overlaps(e.startDt,e.endDt,sS,sE));
      if(practEvs.length>0){
        const existing=practEvs.reduce((s,e)=>s+(e.students.length||1),0);
        if(existing+newStu<=16)joinSlots.push({h,mi,remaining:16-existing-newStu});
      }else{
        freeSlots.push({h,mi});
      }
    }
    const addGroup=(label,slots,mkEl,highlight)=>{
      if(!slots.length)return;
      const box=highlight?document.createElement('div'):wrap;
      if(highlight)box.className='sp-practice-hl';
      const lbl=document.createElement('div');lbl.className='sp-group-lbl';lbl.textContent=label;
      const chips=document.createElement('div');chips.className='sp-chips';
      slots.forEach(s=>chips.appendChild(mkEl(s)));
      box.appendChild(lbl);box.appendChild(chips);
      if(highlight)wrap.appendChild(box);
    };
    addGroup('⭐ 可加入現有練習課',joinSlots,({h,mi,remaining})=>mkTime(h,mi,`剩${remaining}席`),true);
    addGroup('獨立時段',freeSlots,({h,mi})=>mkTime(h,mi,null),false);
    if(!joinSlots.length&&!freeSlots.length){
      const empty=document.createElement('div');empty.style.cssText='font-size:13px;color:var(--tx2)';empty.textContent='當天無可用時段';wrap.appendChild(empty);
    }
  }else{
    const chips=document.createElement('div');chips.className='sp-chips';wrap.appendChild(chips);
    for(let total=startMin;total<=endMin-dur;total+=30){
      const h=Math.floor(total/60),mi=total%60;
      const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+dur);
      const ok=hasSuitableRoom(sS,sE);
      const el=document.createElement('div');
      el.className=`sp-time${isSel(h,mi)?' sp-sel':''}${!ok?' sp-na':''}`;
      el.textContent=`${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
      if(ok)el.onclick=()=>selectSpTime(h,mi);
      chips.appendChild(el);
    }
  }
  return sec;
}

function selectSpTime(h,mi){
  slotPicker={...slotPicker,time:{h,mi},room:null};
  renderSpBody();
  setTimeout(()=>{const secs=document.querySelectorAll('#sp-body > div');if(secs[2])secs[2].scrollIntoView({behavior:'smooth',block:'nearest'});},60);
}

function buildSpRoomSection(){
  const sec=document.createElement('div');
  sec.innerHTML=`<div class="sp-lbl">選擇教室</div><div class="sp-chips"></div>`;
  const chips=sec.querySelector('.sp-chips');
  const ev=slotPicker.ev;
  const [y,m,d]=slotPicker.date.split('-').map(Number);
  const {h,mi}=slotPicker.time;
  const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+getEffectiveDur());
  const etype=getEffectiveType();
  // 石牌分校：只顯示石牌分校選項
  if(slotPicker.branch==='石牌'){
    const active=slotPicker.avail.filter(e=>e.classroom==='石牌分校'&&!e.isAbsent&&!e.isRescheduled&&overlaps(e.startDt,e.endDt,sS,sE));
    const eligible=hasSuitableRoomShipai(sS,sE);
    let cap='';
    if(etype==='one'){const cur=active.filter(e=>e.type==='one').length;cap=eligible?`${4-cur} 桌空位`:'已滿';}
    else{cap=eligible?'空閒':'已有團班';}
    const isSel=slotPicker.room==='石牌分校';
    const el=document.createElement('div');
    el.className=`sp-room${isSel?' sp-sel':''}${!eligible?' sp-na':''}`;
    el.innerHTML=`<div class="sp-rname">石牌分校</div><div class="sp-rcap">${cap}</div>`;
    if(eligible)el.onclick=()=>selectSpRoom('石牌分校');
    chips.appendChild(el);
    return sec;
  }
  const rooms=etype==='practice'?['大教室']:etype==='one'?['大教室',...ROOMS_SMALL]:ROOMS_SMALL;
  const sorted=[...rooms].sort((a,b)=>a===ev.classroom?-1:b===ev.classroom?1:0);
  sorted.forEach(room=>{
    const need=etype==='pair'?2:getEffectiveStudentCount();
    if(room==='大教室'&&(etype==='pair'||etype==='group'))return;
    if(room!=='大教室'&&ROOM_CAP[room]<need){}
    const av=getRoomAvail(slotPicker.avail,room,sS,sE);
    const capacityOk=room==='大教室'||ROOM_CAP[room]>=need;
    const eligible=av.available&&capacityOk;
    const isOrig=room===ev.classroom;
    const isSel=slotPicker.room===room;
    const el=document.createElement('div');
    el.className=`sp-room${isSel?' sp-sel':''}${!eligible?' sp-na':''}${isOrig?' sp-orig':''}`;
    let cap='';
    if(room==='大教室'&&ev.type==='one')cap=av.available?`${av.free}桌空位`:'已滿';
    else if(!av.available)cap='已有課';
    else if(!capacityOk)cap=`需${need}人位`;
    else cap=isOrig?'原教室':'空閒';
    el.innerHTML=`<div class="sp-rname">${room}</div><div class="sp-rcap">${cap}</div>`;
    if(eligible)el.onclick=()=>selectSpRoom(room);
    chips.appendChild(el);
  });
  return sec;
}

function selectSpRoom(room){
  slotPicker={...slotPicker,room};
  renderSpBody();
  setTimeout(()=>{const secs=document.querySelectorAll('#sp-body > div');if(secs[3])secs[3].scrollIntoView({behavior:'smooth',block:'nearest'});},60);
}

function buildSpConfirm(){
  const sec=document.createElement('div');
  const ev=slotPicker.ev;
  const [y,m,d]=slotPicker.date.split('-').map(Number);
  const {h,mi}=slotPicker.time;
  const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+getEffectiveDur());
  const ds=`${m}/${d}（週${WD[new Date(y,m-1,d).getDay()]}）${fmtT(sS)}–${fmtT(sE)}`;
  const lbl=slotPicker.mode==='makeup'?'補課':'調課';
  sec.innerHTML=`<div class="sp-cfm">
    <div class="sp-cfm-info"><b>${lbl}時間</b>　${ds}<br><b>教室</b>　${slotPicker.room}</div>
    <button class="btn btns btnp" style="white-space:nowrap" onclick="confirmSlotPicker()">✓ 確認${lbl}</button>
  </div>`;
  return sec;
}

// 確認排補課/調課：純寫系統紀錄（makeupScheduled），不再建 Google Calendar 事件（第 3 刀起）。
// 主頁的補課/調課場次由展開器從紀錄直接長出（expandMakeupForRange）。
async function confirmSlotPicker(){
  const ev=slotPicker.ev;
  const [y,m,d]=slotPicker.date.split('-').map(Number);
  const {h,mi}=slotPicker.time;
  const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+getEffectiveDur());
  const room=slotPicker.room,mode=slotPicker.mode;
  saveMakeupScheduled(ev,sS,sE,room,null,mode==='makeup'?'補課':'調課');
  toast(mode==='makeup'?'補課已安排 🎉':'調課時段已安排 🎉','ok');
  closeSlotPicker();
  await Promise.all([loadToday(),loadWeek()]); // 場次立即長回主頁課表
  renderMakeup();updateMakeupBadge();
}

// ── 補課排程記錄 ──
function getMakeupScheduledLS(){return driveData.makeupScheduled||[];}
function getMakeupScheduled(){return[...makeupMatchMap.entries()].map(([originalId,v])=>({originalId,...v}));}

function saveMakeupScheduled(ev,sS,sE,room,calEventId,calName='補課'){
  const rec={originalId:ev.id,origTitle:ev.origTitle,originalDate:ev.startDt.toISOString(),scheduledDate:sS.toISOString(),scheduledEnd:sE.toISOString(),room,calEventId:calEventId||null,absentStudents:ev.absentStudents||[],calName};
  makeupMatchMap.set(ev.id,{calEventId:calEventId||null,scheduledDate:sS.toISOString(),scheduledEnd:sE.toISOString(),room,origTitle:ev.origTitle,absentStudents:ev.absentStudents||[],calName});
  const list=getMakeupScheduledLS().filter(x=>x.originalId!==ev.id);
  list.push(rec);
  driveData.makeupScheduled=list;
  scheduleDriveSave();
}

async function deleteMakeupScheduled(originalId){
  const rec=makeupMatchMap.get(originalId);
  const calName=rec?.calName||'補課';
  // 舊紀錄（第 3 刀前建的）有對應 Calendar 事件才需要刪；純系統紀錄 calEventId=null 直接跳過
  if(rec?.calEventId&&calendarIds[calName]){
    try{await gapi.client.calendar.events.delete({calendarId:calendarIds[calName],eventId:rec.calEventId});invalidateEventCache();}
    catch(e){console.warn(`刪除${calName}事件失敗`,e);}
  }
  makeupMatchMap.delete(originalId);
  driveData.makeupScheduled=getMakeupScheduledLS().filter(x=>x.originalId!==originalId);
  scheduleDriveSave();
  await Promise.all([loadToday(),loadWeek()]); // 場次從主頁課表移除
  renderMakeup();updateMakeupBadge();
}

// 視窗縮放時重畫教室時間軸（無實際作用因 renderTL 是 no-op，但保留以維持原行為）
window.addEventListener('resize',()=>{if(currentPanel==='courses')renderTL();});
