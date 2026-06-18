// 請假面板：標記、選擇學生、確認、取消請假

function buildAbsPanel(e, sfx=''){
  const eid=esc(e.id);
  const pid=eid+sfx; // panel-scoped ID
  const autoType=(e.type==='one'||e.students.length<=1)?'student-auto':'student';
  let html=`<div class="abs-opts" style="margin-bottom:12px">
    <div class="abs-opt" id="ao-t-${pid}" onclick="selAbsType('${eid}','${sfx}','teacher')">👨‍🏫 老師請假</div>
    <div class="abs-opt" id="ao-s-${pid}" onclick="selAbsType('${eid}','${sfx}','${autoType}')">🧑‍🎓 學生請假</div>
  </div>`;
  if((e.type==='pair'||e.type==='group'||e.type==='practice')&&e.students.length>1){
    const availableStudents=e.students.filter(s=>!e.absentStudents.includes(s)&&!e.noShowStudents.includes(s));
    let chips='';
    if(e.type==='practice'&&e.studentGroups?.length>0){
      const groupedStudents=new Set(e.studentGroups.flatMap(g=>g.students));
      e.studentGroups.forEach(g=>{
        const avail=g.students.filter(s=>availableStudents.includes(s));
        if(avail.length===0)return;
        chips+=`<div class="stu-subject-label">${esc(g.subject)}</div>`;
        chips+=avail.map(s=>`<div class="stu-chip" data-eid="${eid}" data-sfx="${sfx}" data-name="${esc(s)}" onclick="toggleChip(this)">${esc(s)}</div>`).join('');
      });
      const ungrouped=availableStudents.filter(s=>!groupedStudents.has(s));
      if(ungrouped.length>0){
        chips+=`<div class="stu-subject-label">其他</div>`;
        chips+=ungrouped.map(s=>`<div class="stu-chip" data-eid="${eid}" data-sfx="${sfx}" data-name="${esc(s)}" onclick="toggleChip(this)">${esc(s)}</div>`).join('');
      }
      if(!chips)chips=`<div style="font-size:12px;color:var(--tx3)">所有學生已請假</div>`;
    }else{
      chips=availableStudents.length>0
        ? availableStudents.map(s=>`<div class="stu-chip" data-eid="${eid}" data-sfx="${sfx}" data-name="${esc(s)}" onclick="toggleChip(this)">${esc(s)}</div>`).join('')
        : `<div style="font-size:12px;color:var(--tx3)">所有學生已請假</div>`;
    }
    html+=`<div class="stu-wrap" id="sw-${pid}" style="display:none">
      <div class="stu-label">選擇請假學生（可多選）</div>
      <div class="stu-chips" id="sc-${pid}">${chips}</div>
    </div>`;
  }
  html+=`<div class="stu-wrap" id="tw-${pid}" style="display:none">
    <div class="stu-label">請假時機（系統已預選，可改）</div>
    <div class="abs-opts" style="margin-bottom:0">
      <div class="abs-opt" id="at-A-${pid}" onclick="selAbsTiming('${eid}','${sfx}','A')">課前 1hr 以上</div>
      <div class="abs-opt" id="at-B-${pid}" onclick="selAbsTiming('${eid}','${sfx}','B')">課前 1hr 內</div>
      <div class="abs-opt" id="at-C-${pid}" onclick="selAbsTiming('${eid}','${sfx}','C')">已開始·曠課</div>
    </div>
  </div>`;
  // 一對二（剛好兩人）：一人請假時，常傾向整堂一起調課以省老師成本 → 提供捷徑導向既有調課流程
  if(e.type==='pair'&&e.students.length===2){
    html+=`<div style="margin:4px 0 10px;font-size:12px;color:var(--tx2)">
      一對二也可改為 <button class="btn btns" style="font-size:12px;padding:3px 10px" onclick="startWholeReschedule('${eid}')">🔄 整堂一起調課</button>（兩人都不缺課、不個別補課、維持原時長）
    </div>`;
  }
  html+=`<div class="abs-confirm">
    <div class="abs-preview" id="ap-${pid}"></div>
    <button class="btn btns" onclick="closeAbsPanel('${eid}','${sfx}')">取消</button>
    <button class="btn btns btnp" onclick="confirmAbs('${eid}','${sfx}')">確認標記</button>
  </div>`;
  return html;
}

// 一對二「整堂一起調課」：收起請假面板（不關 modal），直接顯示既有調課原因面板
function startWholeReschedule(id){
  document.getElementById('absp-w-'+id)?.classList.remove('open');
  document.getElementById('absp-'+id)?.classList.remove('open');
  const p=document.getElementById('rp-'+id);
  if(p){p.style.display='block';document.getElementById('rp-reason-'+id)?.focus();}
}

function toggleAbsPanelWeek(id){
  const panel=document.getElementById('absp-w-'+id);if(!panel)return;
  const isOpen=panel.classList.contains('open'); // 先判斷再清，否則永遠收不起來
  // 收掉所有面板（含調課面板），確保請假/調課不同時展開
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('[id^="cancel-picker-"]').forEach(p=>p.remove());
  const rp=document.getElementById('rp-'+id);if(rp)rp.style.display='none';
  if(isOpen)return; // 本來開著 → 收合即可
  absState[id]={type:null,students:[]};
  panel.classList.add('open');
  updatePreview(id,'');
}

function toggleAbsPanel(id,ctx){
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('[id^="cancel-picker-"]').forEach(p=>p.remove());
  const panel=document.getElementById('absp-'+id);if(!panel)return;
  const isOpen=panel.classList.contains('open');
  if(isOpen){panel.classList.remove('open');return;}
  absState[id]={type:null,students:[]};
  panel.classList.add('open');
  document.getElementById('ao-t-'+id)?.classList.remove('st','ss');
  document.getElementById('ao-s-'+id)?.classList.remove('st','ss');
  const sw=document.getElementById('sw-'+id);if(sw)sw.style.display='none';
  const tw=document.getElementById('tw-'+id);if(tw)tw.style.display='none';
  ['A','B','C'].forEach(k=>document.getElementById('at-'+k+'-'+id)?.classList.remove('st','ss'));
  const sc=document.getElementById('sc-'+id);if(sc)sc.querySelectorAll('.stu-chip').forEach(c=>c.classList.remove('checked'));
  const ap=document.getElementById('ap-'+id);if(ap)ap.innerHTML='';
}

function closeAbsPanel(id,sfx){
  if(sfx==='-w'){const pw=document.getElementById('absp-w-'+id);if(pw)pw.classList.remove('open');closeWeekModal();}
  else{const p=document.getElementById('absp-'+id);if(p)p.classList.remove('open');}
  document.getElementById('cc-'+id)?.classList.remove('card-active');
}

function selAbsType(id,sfx,type){
  const pid=id+(sfx||'');
  if(!absState[id])absState[id]={type:null,students:[]};
  absState[id].type=type;absState[id].students=[];
  const sc=document.getElementById('sc-'+pid);if(sc)sc.querySelectorAll('.stu-chip').forEach(c=>c.classList.remove('checked'));
  document.getElementById('ao-t-'+pid)?.classList.remove('st','ss');
  document.getElementById('ao-s-'+pid)?.classList.remove('st','ss');
  const tw=document.getElementById('tw-'+pid);
  if(type==='teacher'){
    document.getElementById('ao-t-'+pid)?.classList.add('st');
    const sw=document.getElementById('sw-'+pid);if(sw)sw.style.display='none';
    if(tw)tw.style.display='none';
    absState[id].timing=null;
    updatePreview(id,sfx);
  }else{
    document.getElementById('ao-s-'+pid)?.classList.add('ss');
    if(type==='student'){const sw=document.getElementById('sw-'+pid);if(sw)sw.style.display='block';}
    if(tw)tw.style.display='block';
    const ev=findEventById(id);
    selAbsTiming(id,sfx,ev?defaultTiming(ev):'B'); // 預選 + 內含 updatePreview
  }
}

// 依「現在 vs 上課時間」預選請假時機：已開始→C(曠課)、距上課<1hr→B、否則A
function defaultTiming(ev){
  const now=Date.now(),start=ev.startDt.getTime();
  if(now>=start)return'C';
  if(start-now<=3600000)return'B';
  return'A';
}
function selAbsTiming(id,sfx,t){
  const pid=id+(sfx||'');
  if(!absState[id])absState[id]={type:'student',students:[]};
  absState[id].timing=t;
  ['A','B','C'].forEach(k=>document.getElementById('at-'+k+'-'+pid)?.classList.remove('st','ss'));
  // C(曠課) 用紅色警示，A/B 用琥珀色
  document.getElementById('at-'+t+'-'+pid)?.classList.add(t==='C'?'st':'ss');
  updatePreview(id,sfx);
}

function toggleChip(el){
  const id=el.dataset.eid,sfx=el.dataset.sfx||'',name=el.dataset.name;
  if(!absState[id])absState[id]={type:'student',students:[]};
  const arr=absState[id].students,idx=arr.indexOf(name);
  if(idx>=0)arr.splice(idx,1);else arr.push(name);
  el.classList.toggle('checked',arr.includes(name));
  updatePreview(id,sfx);
}

// 依目前面板選擇算出新標題＋時機 map。請假與曠課並存：標一邊保留另一邊，同一人改標會搬組
function computeAbsResult(ev,state){
  if(state.type==='teacher')return{title:`【老師請假】${ev.origTitle}`,timing:null,empty:false};
  const newOnes=state.type==='student-auto'?ev.students.slice(0,1):(state.students||[]);
  if(newOnes.length===0)return{empty:true};
  const leave=new Set(ev.isAbsent&&ev.absType!=='老師請假'?ev.absentStudents:[]);
  const noshow=new Set(ev.noShowStudents||[]);
  newOnes.forEach(n=>{leave.delete(n);noshow.delete(n);});       // 先抽離舊組
  if(state.timing==='C')newOnes.forEach(n=>noshow.add(n));        // C→曠課組
  else newOnes.forEach(n=>leave.add(n));                          // A/B→請假組
  let title='';
  if(leave.size)title+=`【${[...leave].join('、')}請假】`;
  if(noshow.size)title+=`【${[...noshow].join('、')}曠課】`;
  title+=ev.origTitle;
  const timing=Object.assign({},ev.absenceTiming||{});           // 保留既有時機
  newOnes.forEach(n=>{timing[n]=state.timing||'B';});
  return{title,timing,empty:false};
}

function updatePreview(id,sfx){
  const pid=id+(sfx||'');
  const state=absState[id]||{};const el=document.getElementById('ap-'+pid);if(!el)return;
  const ev=findEventById(id);if(!ev)return;
  if(!state.type){el.innerHTML='';return;}
  const res=computeAbsResult(ev,state);
  if(res.empty){el.innerHTML='<span style="color:var(--tx3)">請選擇請假學生</span>';return;}
  const hint=state.timing==='C'?'<span style="color:var(--dg);font-size:12px">（曠課：不排補課、不計欠課）</span>':'';
  el.innerHTML=`新標題：<strong>${esc(res.title)}</strong> ${hint}`;
}

async function confirmAbs(id,sfx){
  const state=absState[id];
  const ev=findEventById(id);
  if(!state?.type||!ev)return;
  const res=computeAbsResult(ev,state);
  if(res.empty){toast('請選擇請假學生','inf');return;}
  const newTitle=res.title;
  // Close panels
  const panel=document.getElementById('absp-'+id);if(panel)panel.classList.remove('open');
  const panelW=document.getElementById('absp-w-'+id);if(panelW)panelW.classList.remove('open');
  showL('更新 Google Calendar...');
  try{
    // 把每位學生的請假時機 map 存進隱藏欄位，供日後學費系統讀（老師請假清掉）
    const resource={summary:newTitle};
    resource.extendedProperties={private:{absenceTiming:res.timing&&Object.keys(res.timing).length?JSON.stringify(res.timing):null}};
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:id,resource});
    invalidateEventCache();
    hideL();toast('已標記：'+newTitle,'ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
    if(selectedWeekEvent===id) closeWeekModal();
  }catch(err){hideL();toast('更新失敗：'+(err.result?.error?.message||err.message),'err');}
}

// ── 取消請假流程 ──
function cancelAbs(id){
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('[id^="cancel-picker-"]').forEach(p=>p.remove());
  const ev=findEventById(id);if(!ev)return;
  if(ev.type==='one'||ev.absentStudents.length<=1){
    doCancel(id,ev,[]);
    return;
  }
  showCancelPicker(ev);
}

function showCancelPicker(ev){
  const id=ev.id;
  const existing=document.getElementById('cancel-picker-'+id);
  if(existing){existing.classList.toggle('open');return;}
  const card=document.getElementById('cc-'+id)||document.getElementById('wc-'+id);
  if(!card)return;
  const picker=document.createElement('div');
  picker.id='cancel-picker-'+id;
  picker.className='abs-panel open';
  picker.style.borderTop='1px solid var(--br)';
  picker.innerHTML=`
    <div class="abs-title">選擇要取消請假的學生</div>
    <div class="stu-chips" id="cancel-chips-${esc(id)}">${
      ev.absentStudents.map(s=>`<div class="stu-chip" data-name="${esc(s)}" onclick="this.classList.toggle('checked')">${esc(s)}</div>`).join('')
    }</div>
    <div class="abs-confirm" style="margin-top:10px">
      <div class="abs-preview" style="font-size:12px;color:var(--tx2)">取消選取學生的請假狀態</div>
      <button class="btn btns" onclick="document.getElementById('cancel-picker-${esc(id)}').remove();document.getElementById('cc-${esc(id)}')?.classList.remove('card-active');closeWeekModal()">取消</button>
      <button class="btn btns btnp" onclick="confirmCancel('${esc(id)}')">確認取消請假</button>
    </div>`;
  const weekModal=document.getElementById('week-modal');
  const absWeekPanel=document.getElementById('absp-w-'+id);
  const absTodayPanel=document.getElementById('absp-'+id);
  if(weekModal&&weekModal.classList.contains('open')&&selectedWeekEvent===id&&absWeekPanel){
    absWeekPanel.after(picker);
  } else if(absTodayPanel){
    absTodayPanel.after(picker);
  } else if(card){
    card.after(picker);
  }
}

async function confirmCancel(id){
  const ev=findEventById(id);if(!ev)return;
  const picker=document.getElementById('cancel-picker-'+id);if(!picker)return;
  const toCancel=[...picker.querySelectorAll('.stu-chip.checked')].map(el=>el.dataset.name);
  if(toCancel.length===0){toast('請選擇要取消請假的學生','inf');return;}
  picker.remove();
  doCancel(id,ev,toCancel);
}

// 組標題＋修剪後的時機 map（保留指定的請假/曠課名單），供取消流程共用
function rebuildAbsTitle(ev,leaveArr,noShowArr){
  let title='';
  if(leaveArr.length)title+=`【${leaveArr.join('、')}請假】`;
  if(noShowArr.length)title+=`【${noShowArr.join('、')}曠課】`;
  title+=ev.origTitle;
  const keep=new Set([...leaveArr,...noShowArr]);
  const timing={};
  Object.entries(ev.absenceTiming||{}).forEach(([k,v])=>{if(keep.has(k))timing[k]=v;});
  return{title,extProp:{private:{absenceTiming:Object.keys(timing).length?JSON.stringify(timing):null}}};
}

async function doCancel(id,ev,cancelStudents){
  showL('恢復課程標題...');
  try{
    // 取消請假：清掉指定（或全部）請假學生，保留既有曠課群組
    const remaining=(cancelStudents.length===0||ev.type==='one')?[]:ev.absentStudents.filter(s=>!cancelStudents.includes(s));
    const {title,extProp}=rebuildAbsTitle(ev,remaining,ev.noShowStudents||[]);
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:id,resource:{summary:title,extendedProperties:extProp}});
    invalidateEventCache();
    hideL();toast('已取消請假','ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
    closeWeekModal();
  }catch(err){hideL();toast('操作失敗：'+(err.result?.error?.message||err.message),'err');}
}

// ── 取消曠課流程（與取消請假對稱）：單人直接取消、多人跳選人 picker，只動曠課群組 ──
function cancelNoShow(id){
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('[id^="cancel-picker-"]').forEach(p=>p.remove());
  const ev=findEventById(id);if(!ev)return;
  if((ev.noShowStudents||[]).length<=1){
    doCancelNoShow(id,ev,[]);
    return;
  }
  showNoShowCancelPicker(ev);
}

function showNoShowCancelPicker(ev){
  const id=ev.id;
  const pickerId='cancel-picker-ns-'+id; // 共用 cancel-picker- 前綴，方便一起清掉
  const existing=document.getElementById(pickerId);
  if(existing){existing.classList.toggle('open');return;}
  const card=document.getElementById('cc-'+id)||document.getElementById('wc-'+id);
  if(!card)return;
  const picker=document.createElement('div');
  picker.id=pickerId;
  picker.className='abs-panel open';
  picker.style.borderTop='1px solid var(--br)';
  picker.innerHTML=`
    <div class="abs-title">選擇要取消曠課的學生</div>
    <div class="stu-chips">${
      ev.noShowStudents.map(s=>`<div class="stu-chip" data-name="${esc(s)}" onclick="this.classList.toggle('checked')">${esc(s)}</div>`).join('')
    }</div>
    <div class="abs-confirm" style="margin-top:10px">
      <div class="abs-preview" style="font-size:12px;color:var(--tx2)">取消選取學生的曠課狀態</div>
      <button class="btn btns" onclick="document.getElementById('${pickerId}').remove();document.getElementById('cc-${esc(id)}')?.classList.remove('card-active');closeWeekModal()">取消</button>
      <button class="btn btns btnp" onclick="confirmCancelNoShow('${esc(id)}')">確認取消曠課</button>
    </div>`;
  const weekModal=document.getElementById('week-modal');
  const absWeekPanel=document.getElementById('absp-w-'+id);
  const absTodayPanel=document.getElementById('absp-'+id);
  if(weekModal&&weekModal.classList.contains('open')&&selectedWeekEvent===id&&absWeekPanel){
    absWeekPanel.after(picker);
  } else if(absTodayPanel){
    absTodayPanel.after(picker);
  } else if(card){
    card.after(picker);
  }
}

async function confirmCancelNoShow(id){
  const ev=findEventById(id);if(!ev)return;
  const picker=document.getElementById('cancel-picker-ns-'+id);if(!picker)return;
  const toCancel=[...picker.querySelectorAll('.stu-chip.checked')].map(el=>el.dataset.name);
  if(toCancel.length===0){toast('請選擇要取消曠課的學生','inf');return;}
  picker.remove();
  doCancelNoShow(id,ev,toCancel);
}

async function doCancelNoShow(id,ev,cancelStudents){
  showL('取消曠課...');
  try{
    // 取消曠課：清掉指定（或全部）曠課學生，保留既有請假群組
    const remaining=(cancelStudents.length===0)?[]:(ev.noShowStudents||[]).filter(s=>!cancelStudents.includes(s));
    const leave=ev.isAbsent&&ev.absType!=='老師請假'?ev.absentStudents:[];
    const {title,extProp}=rebuildAbsTitle(ev,leave,remaining);
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:id,resource:{summary:title,extendedProperties:extProp}});
    invalidateEventCache();
    hideL();toast('已取消曠課','ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
    closeWeekModal();
  }catch(err){hideL();toast('操作失敗：'+(err.result?.error?.message||err.message),'err');}
}
