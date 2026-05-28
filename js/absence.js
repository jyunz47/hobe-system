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
    const availableStudents=e.students.filter(s=>!e.isAbsent||!e.absentStudents.includes(s));
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
  html+=`<div class="abs-confirm">
    <div class="abs-preview" id="ap-${pid}"></div>
    <button class="btn btns" onclick="closeAbsPanel('${eid}','${sfx}')">取消</button>
    <button class="btn btns btnp" onclick="confirmAbs('${eid}','${sfx}')">確認標記</button>
  </div>`;
  return html;
}

function toggleAbsPanelWeek(id){
  // Close all panels
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('[id^="cancel-picker-"]').forEach(p=>p.remove());
  const panel=document.getElementById('absp-w-'+id);if(!panel)return;
  const isOpen=panel.classList.contains('open');
  if(isOpen){panel.classList.remove('open');return;}
  absState[id]={type:null,students:[]};
  const cpw=document.getElementById('cancel-picker-'+id);if(cpw)cpw.remove();
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
  if(type==='teacher'){document.getElementById('ao-t-'+pid)?.classList.add('st');const sw=document.getElementById('sw-'+pid);if(sw)sw.style.display='none';}
  else{document.getElementById('ao-s-'+pid)?.classList.add('ss');if(type==='student'){const sw=document.getElementById('sw-'+pid);if(sw)sw.style.display='block';}}
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

function updatePreview(id,sfx){
  const pid=id+(sfx||'');
  const state=absState[id]||{};const el=document.getElementById('ap-'+pid);if(!el)return;
  const ev=findEventById(id);if(!ev)return;
  if(!state.type){el.innerHTML='';return;}
  if(state.type==='teacher'){
    el.innerHTML=`新標題：<strong>${esc(buildTitle(ev.origTitle,'teacher',[]))}</strong>`;
    return;
  }
  // Merge already-absent students + newly selected
  const existing=ev.isAbsent&&ev.absType!=='老師請假'?ev.absentStudents:[];
  const newOnes=state.type==='student-auto'?ev.students.slice(0,1):state.students;
  const merged=[...new Set([...existing,...newOnes])];
  if(merged.length===0){el.innerHTML='<span style="color:var(--tx3)">請選擇請假學生</span>';return;}
  const newT=`【${merged.join('、')}請假】${ev.origTitle}`;
  el.innerHTML=`新標題：<strong>${esc(newT)}</strong>`;
}

async function confirmAbs(id,sfx){
  const state=absState[id];
  const ev=findEventById(id);
  if(!state?.type||!ev)return;
  const existing=ev.isAbsent&&ev.absType!=='老師請假'?ev.absentStudents:[];
  const newOnes=state.type==='student-auto'?ev.students.slice(0,1):state.students;
  const merged=state.type==='teacher'?[]:([...new Set([...existing,...newOnes])]);
  const newTitle=state.type==='teacher'?`【老師請假】${ev.origTitle}`:(merged.length===0?null:`【${merged.join('、')}請假】${ev.origTitle}`);
  if(!newTitle){toast('請選擇請假學生','inf');return;}
  // Close panels
  const panel=document.getElementById('absp-'+id);if(panel)panel.classList.remove('open');
  const panelW=document.getElementById('absp-w-'+id);if(panelW)panelW.classList.remove('open');
  showL('更新 Google Calendar...');
  try{
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:id,resource:{summary:newTitle}});
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
  if(ev.type==='one'||ev.absentStudents.length===0){
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

async function doCancel(id,ev,cancelStudents){
  showL('恢復課程標題...');
  try{
    let newTitle;
    if(cancelStudents.length===0||ev.type==='one'){
      newTitle=ev.origTitle;
    }else{
      const remaining=ev.absentStudents.filter(s=>!cancelStudents.includes(s));
      if(remaining.length===0){
        newTitle=ev.origTitle;
      }else{
        newTitle=`【${remaining.join('、')}請假】${ev.origTitle}`;
      }
    }
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:id,resource:{summary:newTitle}});
    invalidateEventCache();
    hideL();toast('已取消請假','ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
    closeWeekModal();
  }catch(err){hideL();toast('操作失敗：'+(err.result?.error?.message||err.message),'err');}
}
