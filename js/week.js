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
// 依 weekOffset 算出目前顯示週的週一（loadWeek 與重繪共用同一套邏輯）
function currentMonday(){
  const now=new Date();
  const day=now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()-(day===0?6:day-1)+weekOffset*7);mon.setHours(0,0,0,0);
  return mon;
}

// 修課登記簿異動後即時重繪今日/本週課程卡（用現有事件資料，不重打 Calendar API）
// 讓卡片名冊（eventRoster 讀登記簿）馬上反映，免得還要手動按「↻ 更新」
function refreshCourseCards(){
  if(typeof dayEvents!=='undefined'&&dayEvents.length&&typeof renderToday==='function')renderToday();
  if(typeof weekEvents!=='undefined'&&weekEvents.length&&typeof renderWeek==='function')renderWeek(currentMonday());
}

async function loadWeek(){
  if(!isSignedIn())return;
  const mon=currentMonday();
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);sun.setHours(23,59,59,999);
  try{
    // 改讀系統自有課表（不再撈 Google Calendar）：系統課程＋已排補課/調課場次
    weekEvents=[...expandCoursesForRange(mon,sun),...expandMakeupForRange(mon,sun)].sort((a,b)=>a.startDt-b.startDt);
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
    const shown = evs.slice(0,3);
    const rest = evs.length - shown.length;
    const items = shown.map(e=>{
      const clr=calIsAccent(e.calName)?calColor(e.calName):'var(--brs)';
      // 小格只放一個字：假／調（原課被移走）／補・調（排出去的場次）
      const mk=mkOccKind(e);
      const nm=esc((e.subject||e.origTitle)+(e.isFullAbsent&&!e.isRescheduled?'·假':e.isRescheduled?'·調':mk?'·'+mk.slice(0,1):''));
      return `<div class="wcell-it"><span class="wcell-dot" style="background:${clr}"></span><span class="wcell-nm">${nm}</span></div>`;
    }).join('');
    return `<button class="wcell${isSel?' w-sel':''}${isToday?' w-today':''}" onclick="selectWeekDay(${di})">
      <div class="wcell-hd"><span class="wcell-wd">${WDL[di].replace('週','')}</span><span class="wcell-dd">${date.getDate()}</span>${isToday?'<span class="wcell-today">今</span>':''}</div>
      <div class="wcell-body">${items||'<div class="wcell-empty">—</div>'}${rest>0?`<div class="wcell-more">+${rest}</div>`:''}</div>
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
    return n>0?`<span style="color:${calInk(cal)};font-weight:500">${n} ${cal}</span>`:'';
  }).join('');

  let html = `<div class="wfocus-hd">
    <div class="wfocus-hd-row">
      <div class="wfocus-date">${focus.date.getMonth()+1}/${focus.date.getDate()} ${WDL[selectedWeekDayIdx]}</div>
      ${isFocusToday?'<span class="wfocus-tag">TODAY</span>':''}
    </div>
    <div class="wfocus-meta"><span>${focus.evs.length-absCnt-reschedCnt} 堂</span>${absCnt>0?`<span class="tsum-abs">${absCnt} 請假</span>`:''}${reschedCnt>0?`<span style="color:${calInk('調課')};font-weight:500">${reschedCnt} 調課</span>`:''}${focusCalTags}</div>
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
  // 跟今日課程卡同一條規則：一般課程走中性灰左緣，其他類別才上色
  const tcv=calIsAccent(e.calName)?calColor(e.calName):'var(--brs)';
  const cls=`tcard t-${e.type}${e.status==='now'?' t-now':''}${e.status==='past'?' t-past':''}${e.isFullAbsent?' t-absent':''}`;
  const stat=
    e.status==='now'?'<span class="tstat tstat-now"><span class="ndot"></span>進行中</span>':
    e.status==='past'?'<span class="tstat tstat-past">已結束</span>':'';
  const roster=eventRoster(e);
  const stuTxt=roster.length===0?'—':roster.length<=2?roster.join('、'):`${roster.length} 人`;
  // 補課／調課場次：標籤放在標籤列（跟課型 pill 同一排），原課日期放下面的細節區
  const mkKind=mkOccKind(e);
  const mkPill=mkKind?`<span class="tstat" style="background:${calTint(e.calName,.18)};color:${calInk(e.calName)}">${mkKind}</span>`:'';
  const mkFromInline=mkOccFromTxt(e)?`<div class="tcard-abs"><span class="l">${mkKind}</span>${esc(mkOccFromTxt(e))}${roster.length?'・'+esc(roster.join('、')):''}</div>`:'';
  const absInline=e.isRescheduled?`<div class="tcard-abs"><span class="l">調課</span>${e.rescheduleReason?esc(e.rescheduleReason):'未輸入原因'}</div>`:
    `${e.isAbsent?`<div class="tcard-abs"><span class="l">請假</span>${e.absType==='老師請假'?'老師請假':esc(e.absentStudents.join('、'))+'請假'}</div>`:''}${e.isNoShow?`<div class="tcard-abs"><span class="l">曠課</span>${esc(e.noShowStudents.join('、'))}</div>`:''}`;
  const noteInline=e.notes?`<div class="tcard-note"><span class="l">備註</span>${esc(e.notes)}</div>`:'';
  const mkSt=getMkSt(e);
  // 別班請假的學生今天併進這堂一起上（第 2 刀）→ 卡上講一行，名冊多的人才有來由
  const joinRows=joinRosterOn(e.id);
  const joinInline=joinRows.length?`<div class="tcard-abs"><span class="l">補課生</span>${esc(joinRows.map(r=>r.name).join('、'))}（${esc(joinRows[0].fromTitle||'')}）</div>`:'';
  const extras=(absInline||noteInline||mkSt||joinInline||mkFromInline)?`<div class="tcard-extras">${noteInline}${mkFromInline}${absInline}${joinInline}${mkSt}</div>`:'';
  return `<div class="${cls}" id="wc-${id}" style="border-left-color:${tcv}" onclick="selectWeekEvent('${id}')">
    <div class="tcard-row">
      <div class="tcard-time">${fmtT(e.startDt)}<span class="dash">—</span>${fmtT(e.endDt)}</div>
      <div class="tcard-dur">${fmtDur(e.durMins)}</div>
      <div class="tcard-tags">
        <span class="tpill t-${e.type}"><span class="pdot"></span>${typeLbl(e.type)}</span>
        ${mkPill}
        ${typeMismatchChip(e)}
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
  selectedWeekEvent=null;
  // 桌面日曆側欄 inspector：視窗裡點名／登成績後，關掉視窗要看到最新狀態
  if(typeof renderDvInspector==='function')renderDvInspector();
}

function selectWeekEventAndCancel(id){
  selectWeekEvent(id);
  // Wait for detail to render then trigger cancel
  setTimeout(()=>cancelAbs(id), 50);
}

// 桌面日曆側欄「調課原因」：開 modal 後自動展開調課面板
// （2026-07-31 起請假／調課併成一顆「✓ 請假/調課」→ 直接開 modal 不預展開，故沒有 …AndAbs 了）
function selectWeekEventAndReschedule(id){
  selectWeekEvent(id);
  setTimeout(()=>toggleReschedulePanel(id),50);
}

// 今日卡「✓ 點名」「✎ 成績」：同樣走 week-modal（2026-07-31 老闆要求：卡上動作一律跳置中視窗）
function selectWeekEventAndAtt(id){
  selectWeekEvent(id);
  setTimeout(()=>toggleAttPanel(id),50);
}
function selectWeekEventAndGrade(id){
  selectWeekEvent(id);
  setTimeout(()=>toggleGradePanel(id),50);
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
  // 點名／成績鈕：與今日卡同條件（可點名的課才有點名；再加「需登記成績」才有成績）
  const attBtn=canAttend(ev)?`<button class="btn btns" onclick="toggleAttPanel('${esc(ev.id)}')">✓ 點名</button>`:'';
  const gradeBtn=canAttend(ev)&&evNeedsGrade(ev)?`<button class="btn btns" onclick="toggleGradePanel('${esc(ev.id)}')">✎ 成績</button>`:'';
  body.innerHTML=`<div class="cc" style="border:none;border-radius:0">
    <div class="cc-main">
      <div class="cc-bar" style="background:${COLORS[ev.type]||'#888'}"></div>
      <div class="cc-body">
        <div class="cc-name">
          <span style="${ev.isFullAbsent?'opacity:.5;text-decoration:line-through':''}">${esc(ev.origTitle)}</span>${ev.isAbsent?`<span style="font-weight:400;font-size:13px;color:var(--dg)">（${ev.absType==='老師請假'?'老師請假':esc(ev.absentStudents.join('、'))+'請假'}）</span>`:''}${ev.isNoShow?`<span style="font-weight:400;font-size:13px;color:var(--dg)">（${esc(ev.noShowStudents.join('、'))}曠課）</span>`:''} ${ev.notes?`<span class="cc-note-inline">${esc(ev.notes)}</span>`:''}
        </div>
        <div class="cc-meta">
          <span>🕐 ${fmtT(ev.startDt)}–${fmtT(ev.endDt)}</span>
          <span>⏱ ${fmtDur(ev.durMins)}</span>
          ${ev.teacher?`<span>👤 ${esc(ev.teacher)}</span>`:''}
          <span style="color:${COLORS[ev.type]};font-weight:500">${typeLbl(ev.type)}${ev.classroom?`・${esc(ev.classroom)}`:''}</span>
          ${ev.isFullAbsent?`<span style="color:var(--dg);font-weight:500">${ev.isRescheduled?('調課'+(ev.rescheduleReason?'：'+esc(ev.rescheduleReason):'')): ev.absType==='老師請假'?'老師請假':esc(ev.absentStudents.join('、'))+'請假'}</span>`:''}
          ${mkOccKind(ev)?`<span style="color:${calInk(ev.calName)};font-weight:500">${mkOccKind(ev)}${mkOccFromTxt(ev)?'・'+esc(mkOccFromTxt(ev)):''}</span>`:''}
          ${mkChipsHtml(ev)}
        </div>
      </div>
      <div class="cc-actions">
        ${ev.isMakeupOcc?`<span style="font-size:12px;color:var(--tx3)">補課／調課場次——要改期到桌面日曆把它拖到新時段，或在待補課清單「取消安排」後重排</span>`:`
        ${ev.isAbsent?`<button class="btn btns btnd" onclick="selectCard(this.closest('.cc'));cancelAbs('${esc(ev.id)}')">取消請假</button>`:''}
        ${ev.isNoShow?`<button class="btn btns btnd" onclick="selectCard(this.closest('.cc'));cancelNoShow('${esc(ev.id)}')">取消曠課</button>`:''}
        ${ev.isRescheduled?`<button class="btn btns btnd" onclick="cancelReschedule('${esc(ev.id)}')">取消調課</button>`:''}
        ${!ev.isRescheduled?`<button class="btn btns" onclick="selectCard(this.closest('.cc'));toggleAbsPanelWeek('${esc(ev.id)}')">🗓 請假</button>`:''}
        <button class="btn btns" onclick="toggleReschedulePanel('${esc(ev.id)}')">↔ ${ev.isRescheduled?(ev.rescheduleReason?'更新調課原因':'輸入調課原因'):'調課'}</button>`}
        ${attBtn}${gradeBtn}
      </div>
    </div>
    <div class="att-panel" id="attp-${esc(ev.id)}" style="display:none"></div>
    <div class="att-panel grade-panel" id="grp-${esc(ev.id)}" style="display:none"></div>
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
  if(show){ // 展開調課時收掉請假／點名／成績面板，避免兩塊同時展開
    document.getElementById('absp-w-'+id)?.classList.remove('open');
    document.getElementById('absp-'+id)?.classList.remove('open');
    closeEventPanels(id,'resched');
  }
  p.style.display=show?'block':'none';
  if(show)document.getElementById('rp-reason-'+id)?.focus();
}

// 標記調課：寫請假紀錄的調課旗標（同一筆紀錄、與請假/曠課並存）
async function confirmReschedule(id){
  const ev=findEventById(id);if(!ev)return;
  const reason=(document.getElementById('rp-reason-'+id)?.value||'').trim();
  const list=getAbsences().slice();
  let rec=list.find(a=>a.occId===id);
  if(!rec){
    rec={id:Date.now(),occId:id,courseId:ev.courseId,date:ev.startDt.toISOString(),
      teacherAbsent:false,leave:[],noShow:[],makeupSkip:[],createdAt:new Date().toISOString()};
    list.push(rec);
  }
  rec.resched=true;rec.reschedReason=reason;
  rec.updatedAt=new Date().toISOString();
  saveAbsences(list);
  // 動態（2026-08-13 補）：請假／曠課／不補課／排補課／取消補課本來都有記，就調課這一對漏了
  logAct('absence','標記調課',actEvLabel(ev),
    ['整堂移走，待安排新時段',reason&&`原因：${reason}`].filter(Boolean).join('・'));
  toast('已標記調課','ok');
  closeWeekModal();
  await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
  // 標記完直接問要不要排新時段（2026-08-13）——以前只丟一句「請至待補課清單安排」，
  // 要自己換頁把剛剛那筆找回來。重新讀完才問，選時段的空檔判斷才看得到這筆調課
  if(typeof offerArrangeNow==='function')await offerArrangeNow(id,'reschedule');
}

// 取消調課：清調課旗標（已排的新時段一併取消），紀錄清空即刪
// 跟取消請假一樣先跳置中視窗（2026-08-04）——以前是按了就走，已排好的新時段會無聲消失
async function cancelReschedule(id){
  const ev=findEventById(id);if(!ev)return;
  if(!await uiConfirm({title:'取消調課',
    html:`要取消這堂的調課嗎？<div class="ask-sub">${esc(actEvLabel(ev))}</div>${makeupWarnHtml(id,true)}`,
    ok:'確認取消調課',danger:true}))return;
  let list=getAbsences().slice();
  const rec=list.find(a=>a.occId===id);
  if(rec){
    rec.resched=false;rec.reschedReason='';
    rec.updatedAt=new Date().toISOString();
    if(!rec.teacherAbsent&&!(rec.leave||[]).length&&!(rec.noShow||[]).length)list=list.filter(a=>a!==rec);
    saveAbsences(list);
  }
  // 動態要在撤場次之前記：deleteMakeupsForOcc 自己也會記一筆「取消調課場次」，
  // 兩筆合起來才講得完整（先撤了幾場、再還原成正常上課）
  const had=getMakeupsFor(id).length;
  logAct('absence','取消調課',actEvLabel(ev),
    had?`還原為正常上課，一併撤掉已排的 ${had} 場`:'還原為正常上課');
  await deleteMakeupsForOcc(id);   // 調課排出去的時段一併撤（一堂可能不只一場）
  toast('已取消調課','ok');
  closeWeekModal();
  await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
  refreshMakeupPanel(); // 從待補課清單按的話，那張卡要當場消失
}
