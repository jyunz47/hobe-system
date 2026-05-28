// 本週課程：載入 + 渲染 + 週課程 modal + 調課流程

// ── 週導覽 ──
function updateWeekTitle(){
  const now=new Date();now.setHours(0,0,0,0);
  const day=now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()-(day===0?6:day-1)+weekOffset*7);
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);
  const range=`${mon.getMonth()+1}/${mon.getDate()}～${sun.getMonth()+1}/${sun.getDate()}`;
  const label=weekOffset===0?'本週課程':weekOffset>0?`往後${weekOffset}週（${range}）`:`往前${Math.abs(weekOffset)}週（${range}）`;
  document.getElementById('week-sec-title').textContent=label;
}

function changeWeek(delta){
  if(delta===0) weekOffset=0;
  else weekOffset+=delta;
  selectedWeekDayIdx=null;
  updateWeekTitle();
  closeWeekModal();
  loadWeek();
}

// ── 載入本週 ──
async function loadWeek(){
  if(!gapi.client.getToken())return;
  const now=new Date();
  const day=now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()-(day===0?6:day-1)+weekOffset*7);mon.setHours(0,0,0,0);
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);sun.setHours(23,59,59,999);
  try{
    const all=await Promise.all(Object.entries(calendarIds).map(async([name,id])=>{
      try{const r=await cachedEventList({calendarId:id,timeMin:mon.toISOString(),timeMax:sun.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:500});
      return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));}catch(e){return[];}
    }));
    weekEvents=all.flat().map(parseEv).sort((a,b)=>a.startDt-b.startDt);
    renderWeek(mon);
  }catch(err){console.error('loadWeek',err);}
}

// ── 週視圖 ──
function renderWeek(monday){
  const wsum=document.getElementById('wsum-grid');
  const wfocus=document.getElementById('wfocus');
  const today=new Date();today.setHours(0,0,0,0);
  const WDL=['週一','週二','週三','週四','週五','週六','週日'];

  // Group events by day index
  let todayIdx=-1;
  const days=[];
  for(let di=0;di<7;di++){
    const d=new Date(monday);d.setDate(monday.getDate()+di);d.setHours(0,0,0,0);
    if(d.getTime()===today.getTime())todayIdx=di;
    const e=new Date(d);e.setHours(23,59,59,999);
    const evs=weekEvents.filter(x=>x.startDt>=d&&x.startDt<=e).sort((a,b)=>a.startDt-b.startDt);
    days.push({di,date:d,evs});
  }

  // Default selected day
  if(selectedWeekDayIdx===null||selectedWeekDayIdx<0||selectedWeekDayIdx>6){
    selectedWeekDayIdx = todayIdx>=0 ? todayIdx : 0;
  }

  const maxCount = Math.max(1, ...days.map(d=>d.evs.length));

  // ── Day chips ──
  wsum.innerHTML = days.map(({di,date,evs})=>{
    const isToday = di===todayIdx;
    const isSel   = di===selectedWeekDayIdx;
    const by={one:0,pair:0,group:0,practice:0};
    let absCnt=0;
    evs.forEach(e=>{by[e.type]=(by[e.type]||0)+1;if(e.isFullAbsent)absCnt++;});
    const barH = evs.length>0 ? (evs.length/maxCount)*100 : 0;
    const segs = ['one','pair','group','practice'].filter(t=>by[t]>0).map(t=>{
      return `<div class="wchip-seg s-${t}" style="flex:${by[t]};height:${barH}%"></div>`;
    }).join('') || '<div class="wchip-bar-empty"></div>';
    return `<button class="wchip${isSel?' w-sel':''}${isToday?' w-today':''}" onclick="selectWeekDay(${di})">
      ${isToday?'<span class="w-today-flag">TODAY</span>':''}
      <div>
        <div class="wchip-dn">${WDL[di]}</div>
        <div class="wchip-dd">${date.getMonth()+1}/${date.getDate()}</div>
      </div>
      <div class="wchip-bar">${segs}</div>
      <div class="wchip-num"><span class="n">${evs.length-absCnt}</span><span class="u">堂</span>${absCnt>0?`<span class="abs">${absCnt} 假</span>`:''}</div>
    </button>`;
  }).join('');

  // ── Focus day ──
  const focus = days[selectedWeekDayIdx];
  const isFocusToday = selectedWeekDayIdx===todayIdx;
  const absCnt = focus.evs.filter(e=>e.isFullAbsent&&!e.isRescheduled).length;
  const reschedCnt = focus.evs.filter(e=>e.isRescheduled).length;
  const now=new Date();

  const focusEvs = focus.evs.map(e=>{
    let status='';
    if(e.isFullAbsent)status='absent';
    else if(isFocusToday){
      if(now>=e.endDt)status='past';
      else if(now>=e.startDt)status='now';
      else status='upcoming';
    }
    return{...e,status};
  });

  const focusCalTags=['補課','加課','試聽'].map(cal=>{
    const n=focus.evs.filter(e=>e.calName===cal).length;
    return n>0?`<span style="color:${calColor(cal)};font-weight:500">${n} ${cal}</span>`:'';
  }).join('');

  let html = `<div class="wfocus-hd">
    <div class="wfocus-hd-row">
      <div class="wfocus-date">${focus.date.getMonth()+1}/${focus.date.getDate()} ${WDL[selectedWeekDayIdx]}</div>
      ${isFocusToday?'<span class="wfocus-tag">TODAY</span>':''}
    </div>
    <div class="wfocus-meta"><span>${focus.evs.length-absCnt-reschedCnt} 堂</span>${absCnt>0?`<span class="tsum-abs">${absCnt} 請假</span>`:''}${reschedCnt>0?`<span style="color:${calColor('調課')};font-weight:500">${reschedCnt} 調課</span>`:''}${focusCalTags}</div>
  </div>
  <div class="wfocus-list">`;
  if(focusEvs.length===0){
    html += '<div class="wfocus-empty">當日無課程</div>';
  }else{
    html += focusEvs.map(wcardHtml).join('');
  }
  html += '</div>';
  wfocus.innerHTML = html;
}

function selectWeekDay(idx){
  selectedWeekDayIdx = idx;
  const now=new Date();now.setHours(0,0,0,0);
  const day=now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()-(day===0?6:day-1)+weekOffset*7);mon.setHours(0,0,0,0);
  renderWeek(mon);
}

// 週課程卡（樣式與今日卡片一致，id prefix wc-）
function wcardHtml(e){
  const id=esc(e.id);
  const tcv=calColor(e.calName);
  const cls=`tcard t-${e.type}${e.status==='now'?' t-now':''}${e.status==='past'?' t-past':''}${e.isFullAbsent?' t-absent':''}`;
  const stat=
    e.status==='now'?'<span class="tstat tstat-now"><span class="ndot"></span>進行中</span>':
    e.status==='past'?'<span class="tstat tstat-past">已結束</span>':'';
  const stuTxt=e.students.length===0?'—':e.students.length<=2?e.students.join('、'):`${e.students.length} 人`;
  const absInline=e.isRescheduled?`<div class="tcard-abs"><span class="l">調課</span>${e.rescheduleReason?esc(e.rescheduleReason):'未輸入原因'}</div>`:
    e.isAbsent?`<div class="tcard-abs"><span class="l">請假</span>${e.absType==='老師請假'?'老師請假':esc(e.absentStudents.join('、'))+'請假'}</div>`:'';
  const noteInline=e.notes?`<div class="tcard-note"><span class="l">備註</span>${esc(e.notes)}</div>`:'';
  const mkSt=getMkSt(e);
  const extras=(absInline||noteInline||mkSt)?`<div class="tcard-extras">${noteInline}${absInline}${mkSt}</div>`:'';
  return `<div class="${cls}" id="wc-${id}" style="border-left-color:${tcv}" onclick="selectWeekEvent('${id}')">
    <div class="tcard-row">
      <div class="tcard-time">${fmtT(e.startDt)}<span class="dash">—</span>${fmtT(e.endDt)}</div>
      <div class="tcard-dur">${fmtDur(e.durMins)}</div>
      <div class="tcard-tags">
        <span class="tpill t-${e.type}"><span class="pdot"></span>${typeLbl(e.type)}</span>
        ${stat}
      </div>
    </div>
    <div class="tcard-title${e.isFullAbsent?' struck':''}">${esc(e.origTitle)}</div>
    <div class="tcard-meta">
      ${e.teacher?`<span><span class="lbl">授課</span><b>${esc(e.teacher)}</b></span>`:''}
      ${e.classroom?`<span><span class="lbl">教室</span><b>${esc(e.classroom)}</b></span>`:''}
      <span><span class="lbl">學生</span><b>${esc(stuTxt)}</b></span>
    </div>
    ${extras}
  </div>`;
}

// ── 週課程 modal ──
function closeWeekModal(){
  document.getElementById('week-modal').classList.remove('open');
  document.querySelectorAll('.week-course.selected').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('[id^="cancel-picker-"]').forEach(p=>p.remove());
  selectedWeekEvent=null;
}

function selectWeekEventAndCancel(id){
  selectWeekEvent(id);
  // Wait for detail to render then trigger cancel
  setTimeout(()=>cancelAbs(id), 50);
}

function selectWeekEvent(id){
  const ev=findEventById(id);if(!ev)return;
  // Deselect previous
  document.querySelectorAll('.week-course.selected').forEach(el=>el.classList.remove('selected'));
  const wc=document.getElementById('wc-'+id);if(wc)wc.classList.add('selected');
  selectedWeekEvent=id;
  absState[id]={type:null,students:[]};
  const modal=document.getElementById('week-modal');
  const body=document.getElementById('week-modal-body');
  document.getElementById('week-modal-title').textContent=`${fmtD(ev.startDt)} ${fmtT(ev.startDt)}–${fmtT(ev.endDt)}`;
  modal.classList.add('open');
  body.innerHTML=`<div class="cc" style="border:none;border-radius:0">
    <div class="cc-main">
      <div class="cc-bar" style="background:${COLORS[ev.type]||'#888'}"></div>
      <div class="cc-body">
        <div class="cc-name">
          <span style="${ev.isFullAbsent?'opacity:.5;text-decoration:line-through':''}">${esc(ev.origTitle)}</span>${ev.isAbsent?`<span style="font-weight:400;font-size:13px;color:var(--dg)">（${ev.absType==='老師請假'?'老師請假':esc(ev.absentStudents.join('、'))+'請假'}）</span>`:''} ${ev.notes?`<span class="cc-note-inline">${esc(ev.notes)}</span>`:''}
        </div>
        <div class="cc-meta">
          <span>🕐 ${fmtT(ev.startDt)}–${fmtT(ev.endDt)}</span>
          <span>⏱ ${fmtDur(ev.durMins)}</span>
          ${ev.teacher?`<span>👤 ${esc(ev.teacher)}</span>`:''}
          <span style="color:${COLORS[ev.type]};font-weight:500">${typeLbl(ev.type)}${ev.classroom?`・${esc(ev.classroom)}`:''}</span>
          ${ev.isFullAbsent?`<span style="color:var(--dg);font-weight:500">${ev.isRescheduled?('調課'+(ev.rescheduleReason?'：'+esc(ev.rescheduleReason):'')): ev.absType==='老師請假'?'老師請假':esc(ev.absentStudents.join('、'))+'請假'}</span>`:''}
          ${(()=>{if(!ev.isFullAbsent&&!ev.isRescheduled)return'';const rec=findMakeupScheduledById(ev.id);if(rec){const sd=new Date(rec.scheduledDate);return`<span style="color:#166534;font-weight:500;background:#dcfce7;border:1px solid #86efac;padding:2px 8px;border-radius:4px;font-size:12px">${ev.isRescheduled?'調課':'補課'}：${sd.getMonth()+1}/${sd.getDate()}（${WD[sd.getDay()]}）${fmtT(sd)}${rec.room?' '+esc(rec.room):''}</span>`;}return`<span style="color:#991b1b;font-weight:500;background:#fee2e2;border:1px solid #fca5a5;padding:2px 8px;border-radius:4px;font-size:12px">未安排${ev.isRescheduled?'調課':'補課'}</span>`;})()}
        </div>
      </div>
      <div class="cc-actions">
        ${ev.isAbsent?`<button class="btn btns btnd" onclick="selectCard(this.closest('.cc'));cancelAbs('${esc(ev.id)}')">取消請假</button>`:''}
        ${ev.isRescheduled?`<button class="btn btns btnd" onclick="cancelReschedule('${esc(ev.id)}')">取消調課</button>`:''}
        ${!ev.isRescheduled?`<button class="btn btns" onclick="selectCard(this.closest('.cc'));toggleAbsPanelWeek('${esc(ev.id)}')">標記請假</button>`:''}
        <button class="btn btns" onclick="toggleReschedulePanel('${esc(ev.id)}')">${ev.isRescheduled?(ev.rescheduleReason?'更新調課原因':'輸入調課原因'):'調課'}</button>
      </div>
    </div>
    <div class="abs-panel" id="absp-w-${esc(ev.id)}">${buildAbsPanel(ev,'-w')}</div>
    <div class="reschedule-panel" id="rp-${esc(ev.id)}" style="display:none">
      <div style="padding:12px 14px;border-top:1px solid var(--br);display:flex;flex-direction:column;gap:8px">
        <label style="font-size:12px;color:var(--tx3)">調課原因（選填，建議填寫）</label>
        <input type="text" id="rp-reason-${esc(ev.id)}" placeholder="例：學生家族旅遊" value="${ev.rescheduleReason?esc(ev.rescheduleReason):''}" style="border:1px solid var(--br);border-radius:var(--rs);padding:6px 10px;font-size:13px;width:100%">
        <div style="display:flex;gap:6px">
          <button class="btn btns btnp" style="font-size:12px" onclick="confirmReschedule('${esc(ev.id)}')">確認調課</button>
          <button class="btn btns" style="font-size:12px" onclick="toggleReschedulePanel('${esc(ev.id)}')">取消</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ── 調課 ──
function toggleReschedulePanel(id){
  const p=document.getElementById('rp-'+id);if(!p)return;
  const show=p.style.display==='none';
  p.style.display=show?'block':'none';
  if(show)document.getElementById('rp-reason-'+id)?.focus();
}

async function confirmReschedule(id){
  const ev=findEventById(id);if(!ev)return;
  const reason=(document.getElementById('rp-reason-'+id)?.value||'').trim();
  const newTitle=reason?`【調課：${reason}】${ev.origTitle}`:`【調課】${ev.origTitle}`;
  showL('標記調課...');
  try{
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:ev.id,resource:{summary:newTitle}});
    invalidateEventCache();
    hideL();toast('已標記調課，請至待補課/調課清單安排新時段','ok');
    closeWeekModal();
    await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  }catch(e){hideL();toast('操作失敗：'+e.message,'err');}
}

async function cancelReschedule(id){
  const ev=findEventById(id);if(!ev)return;
  showL('取消調課...');
  try{
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:ev.id,resource:{summary:ev.origTitle}});
    invalidateEventCache();
    if(makeupMatchMap.has(id))await deleteMakeupScheduled(id);
    hideL();toast('已取消調課','ok');
    closeWeekModal();
    await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  }catch(e){hideL();toast('操作失敗：'+e.message,'err');}
}
