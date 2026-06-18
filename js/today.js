// 今日課程：載入 + 渲染 + 教室時間軸 + hero 卡

async function loadToday(){
  if(!gapi.client.getToken())return;
  showL('讀取今日課程...');
  try{
    const d=currentDate;
    const start=new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0);
    const end=new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59);
    const all=await Promise.all(Object.entries(calendarIds).map(async([name,id])=>{
      try{const r=await cachedEventList({calendarId:id,timeMin:start.toISOString(),timeMax:end.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:200});
      return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));}catch(e){return[];}
    }));
    dayEvents=all.flat().map(parseEv).sort((a,b)=>a.startDt-b.startDt);
    await loadAttendance();
    hideErr('courses');
    renderTL();
    renderToday();
    setUSt('ok',document.getElementById('uname').textContent,fmtDT(new Date())+' 更新');
  }catch(err){showErr('courses','讀取失敗：'+(err.result?.error?.message||err.message));}
  finally{hideL();}
}

// renderTL 是 v2 移除後的 no-op，保留是因為 loadToday 還在呼叫
function renderTL(){/* no-op */}

function selectCard(c){
  document.querySelectorAll('.cc.card-active').forEach(el=>el.classList.remove('card-active'));
  c.classList.remove('highlight');
  c.classList.add('card-active');
}

function trigHL(c){
  document.querySelectorAll('.cc.card-active').forEach(el=>el.classList.remove('card-active'));
  c.classList.remove('highlight');
  void c.offsetWidth;
  c.classList.add('highlight');
  c.addEventListener('animationend',()=>{c.classList.remove('highlight');c.classList.add('card-active');},{once:true});
}

// ── 教室時間軸 ──
function renderTimeline(evs){
  const body=document.getElementById('tl-body');
  if(!body)return;
  const roomEvs=evs.filter(e=>TL_ROOMS.includes(e.classroom)&&!e.isFullAbsent&&!e.isRescheduled);
  if(!roomEvs.length){
    body.innerHTML='<div style="padding:16px;font-size:12px;color:var(--tx3)">今日無教室課程</div>';
    if(tlNowTimer){clearInterval(tlNowTimer);tlNowTimer=null;}
    return;
  }
  let minMin=999,maxMin=0;
  roomEvs.forEach(e=>{
    const s=e.startDt.getHours()*60+e.startDt.getMinutes();
    const en=e.endDt.getHours()*60+e.endDt.getMinutes();
    if(s<minMin)minMin=s;if(en>maxMin)maxMin=en;
  });
  const axisStartH=Math.max(0,Math.floor(minMin/60));
  const axisEndH=Math.min(24,Math.ceil(maxMin/60));
  tlAxisStart=axisStartH*60;
  tlTotalMins=Math.max((axisEndH-axisStartH)*60,120);
  const today=new Date();today.setHours(0,0,0,0);
  const vd=new Date(currentDate);vd.setHours(0,0,0,0);
  const isToday=vd.getTime()===today.getTime();
  const nowMin=isToday?new Date().getHours()*60+new Date().getMinutes():-1;
  const nowPct=nowMin>=0?((nowMin-tlAxisStart)/tlTotalMins*100).toFixed(1):null;
  let ticks='';
  for(let h=axisStartH;h<=axisEndH;h++){
    const p=((h*60-tlAxisStart)/tlTotalMins*100).toFixed(1);
    ticks+=`<span class="tl-tick" style="left:${p}%">${String(h).padStart(2,'0')}:00</span>`;
  }
  const nowHdrLbl=nowPct!==null?`<span class="tl-now-hdr-lbl" id="tl-now-hdr-lbl" style="left:${nowPct}%">▾</span>`:'';
  let vlinePcts=[];
  for(let h=axisStartH+1;h<axisEndH;h++)vlinePcts.push(((h*60-tlAxisStart)/tlTotalMins*100).toFixed(1));
  const vlinesHtml=vlinePcts.map(p=>`<div class="tl-vline" style="left:${p}%"></div>`).join('');
  const nowLineHtml=nowPct!==null?`<div class="tl-now-line" data-tlnow style="left:${nowPct}%"></div>`:'';
  let rowsHtml='';
  TL_ROOMS.forEach(room=>{
    let blocksHtml='';
    roomEvs.filter(e=>e.classroom===room).forEach(e=>{
      const s=e.startDt.getHours()*60+e.startDt.getMinutes();
      const en=e.endDt.getHours()*60+e.endDt.getMinutes();
      const left=((s-tlAxisStart)/tlTotalMins*100).toFixed(1);
      const width=Math.max((en-s)/tlTotalMins*100,1).toFixed(1);
      const clr=calColor(e.calName);
      blocksHtml+=`<div class="tl-block" style="left:${left}%;width:${width}%;background:${clr}" onclick="selectWeekEvent('${esc(e.id)}')"><div class="tl-block-nm">${esc(e.origTitle)}</div><div class="tl-block-t">${fmtT(e.startDt)}</div></div>`;
    });
    rowsHtml+=`<div class="tl-room-lbl">${esc(room)}</div><div class="tl-track">${vlinesHtml}${nowLineHtml}${blocksHtml}</div>`;
  });
  body.innerHTML=`<div class="tl-wrap"><div class="tl-corner"></div><div class="tl-hdr">${ticks}${nowHdrLbl}</div>${rowsHtml}</div>`;
  if(tlNowTimer){clearInterval(tlNowTimer);tlNowTimer=null;}
  if(isToday)tlNowTimer=setInterval(updateTlNow,60000);
}

function updateTlNow(){
  if(!tlTotalMins)return;
  const nowMin=new Date().getHours()*60+new Date().getMinutes();
  const pct=((nowMin-tlAxisStart)/tlTotalMins*100).toFixed(1);
  const lbl=document.getElementById('tl-now-hdr-lbl');
  if(lbl)lbl.style.left=pct+'%';
  document.querySelectorAll('[data-tlnow]').forEach(el=>el.style.left=pct+'%');
}

// ── Render Today List (V4 card grid + hero) ──
function renderToday(){
  const c=document.getElementById('clist-today');
  const sum=document.getElementById('today-summary');
  const hero=document.getElementById('today-hero');
  if(!dayEvents.length){
    c.innerHTML='<div class="empty" style="grid-column:1/-1">今天沒有課程</div>';
    sum.innerHTML='';hero.innerHTML='';return;
  }
  const now=new Date();
  const today=new Date();today.setHours(0,0,0,0);
  const vd=new Date(currentDate);vd.setHours(0,0,0,0);
  const isToday=vd.getTime()===today.getTime();

  const evs=dayEvents.map(e=>{
    let status='';
    if(e.isFullAbsent)status='absent';
    else if(isToday){
      if(now>=e.endDt)status='past';
      else if(now>=e.startDt)status='now';
      else status='upcoming';
    }
    return{...e,status};
  });

  // Hero: 進行中（可多堂）or 下一堂
  const nowEvs=evs.filter(x=>x.status==='now');
  const nextEv=!nowEvs.length?evs.find(x=>x.status==='upcoming'):null;
  if(isToday&&(nowEvs.length||nextEv)){
    hero.innerHTML=nowEvs.length
      ?nowEvs.map(e=>heroHtml(e,true)).join('')
      :heroHtml(nextEv,false);
  }else{
    hero.innerHTML='';
  }

  // 自動更新所有進行中課程的進度條與時間
  if(heroProgressTimer){clearInterval(heroProgressTimer);heroProgressTimer=null;}
  if(isToday&&nowEvs.length){
    heroProgressTimer=setInterval(()=>{
      const progs=hero.querySelectorAll('.thero-prog');
      if(!progs.length){clearInterval(heroProgressTimer);heroProgressTimer=null;return;}
      progs.forEach(prog=>{
        const start=+prog.dataset.start,end=+prog.dataset.end;
        const totalMin=(end-start)/60000;
        const elapMin=Math.max(0,Math.min(totalMin,(Date.now()-start)/60000));
        const pct=(elapMin/totalMin)*100;
        prog.querySelector('.thero-prog-fill').style.width=pct+'%';
        prog.querySelector('.prog-elap').textContent=`已進行 ${Math.round(elapMin)} 分`;
        prog.querySelector('.prog-remain').textContent=`剩 ${Math.round(totalMin-elapMin)} 分`;
      });
    },30000);
  }

  // Summary
  const total=evs.length;
  const past=evs.filter(x=>x.status==='past').length;
  const absCount=evs.filter(x=>x.isFullAbsent&&!x.isRescheduled).length;
  const reschedCount=evs.filter(x=>x.isRescheduled).length;
  const nowCount=evs.filter(x=>x.status==='now').length;
  const remain=evs.filter(x=>x.status==='upcoming').length;
  let sumHtml=`<span>共 <b>${total}</b> 堂</span>`;
  if(isToday){
    if(past>0)sumHtml+=`<span>已完成 <b>${past}</b></span>`;
    if(nowCount>0)sumHtml+=`<span>進行中 <b style="color:var(--ac)">${nowCount}</b></span>`;
    if(remain>0)sumHtml+=`<span>待上 <b style="color:var(--ac)">${remain}</b></span>`;
  }
  if(absCount>0)sumHtml+=`<span class="tsum-abs">${absCount} 請假</span>`;
  if(reschedCount>0)sumHtml+=`<span style="color:${calColor('調課')};font-weight:500">${reschedCount} 調課</span>`;
  [['補課'],['加課'],['試聽']].forEach(([cal])=>{
    const n=evs.filter(x=>x.calName===cal).length;
    if(n>0)sumHtml+=`<span style="color:${calColor(cal)};font-weight:500">${n} ${cal}</span>`;
  });
  sum.innerHTML=sumHtml;

  c.innerHTML=evs.map(tcardHtml).join('');
  renderTimeline(evs);
}

function heroHtml(e,isNow){
  const id=esc(e.id);
  const tcv=calColor(e.calName);
  let prog='';
  if(isNow){
    const total=(e.endDt-e.startDt)/60000;
    const elap=Math.max(0,Math.min(total,(new Date()-e.startDt)/60000));
    const pct=(elap/total)*100;
    prog=`<div class="thero-prog" data-start="${e.startDt.getTime()}" data-end="${e.endDt.getTime()}">
      <div class="thero-prog-bar"><div class="thero-prog-fill" style="width:${pct}%"></div></div>
      <div class="thero-prog-txt"><span class="prog-elap">已進行 ${Math.round(elap)} 分</span><span class="prog-remain">剩 ${Math.round(total-elap)} 分</span></div>
    </div>`;
  }
  const roster=eventRoster(e);
  const stuRest=roster.length>4?` <span class="stu-rest">${esc(roster.slice(0,3).join('、'))}…</span>`:roster.length>0?` <span class="stu-rest">${esc(roster.join('、'))}</span>`:'';
  return `<div class="thero${isNow?'':' next'}" onclick="selectWeekEvent('${id}')">
    <div class="thero-bar" style="background:${tcv}"></div>
    <div class="thero-hd">
      <span class="thero-tag${isNow?'':' up'}">${isNow?'<span class="ndot"></span>進行中':'下一堂'}</span>
      <span class="tpill t-${e.type}"><span class="pdot"></span>${typeLbl(e.type)}</span>
      <div class="thero-time">${fmtT(e.startDt)} – ${fmtT(e.endDt)}<span class="sub">${fmtDur(e.durMins)}</span></div>
    </div>
    <div class="thero-title">${esc(e.origTitle)}</div>
    <div class="thero-meta">
      ${e.teacher?`<span><span class="lbl">授課</span><b>${esc(e.teacher)}</b></span>`:''}
      ${e.classroom?`<span><span class="lbl">教室</span><b>${esc(e.classroom)}</b></span>`:''}
      <span><span class="lbl">學生</span><b>${roster.length} 人</b>${stuRest}</span>
    </div>
    ${e.notes?`<div class="thero-note"><span class="l">備註</span>${esc(e.notes)}</div>`:''}
    ${prog}
  </div>`;
}

function getMkSt(e){
  if(!e.isFullAbsent&&!e.isRescheduled)return'';
  const rec=findMakeupScheduledById(e.id);
  if(rec){const sd=new Date(rec.scheduledDate);return`<div class="tcard-mk mk-arr"><span class="l">${e.isRescheduled?'調課':'補課'}</span>${sd.getMonth()+1}/${sd.getDate()}（${WD[sd.getDay()]}）${fmtT(sd)}</div>`;}
  return`<div class="tcard-mk mk-un">未安排${e.isRescheduled?'調課':'補課'}</div>`;
}

// 科目字母（方向C 卡片左側方塊）
function subjectLetter(e){
  if(e.type==='practice')return'練';
  const s=(e.subject||e.origTitle||'').trim();
  return s?s[0]:'課';
}
// 點卡展開動作列（手風琴：開一張收其他，順手收已開的請假面板）
function toggleTcard(id){
  const card=document.getElementById('cc-'+id);if(!card)return;
  const willOpen=!card.classList.contains('tc-open');
  document.querySelectorAll('.tcard2.tc-open').forEach(c=>{
    c.classList.remove('tc-open');
    c.querySelector('.abs-panel.open')?.classList.remove('open');
    const ap=c.querySelector('.att-panel');if(ap)ap.style.display='none';
  });
  if(willOpen)card.classList.add('tc-open');
}
function toggleRoster(id){
  const r=document.getElementById('rost-'+id);if(r)r.style.display=r.style.display==='none'?'block':'none';
}

// ── 點名 ──
// 可點名 = 課真的有上：非整堂請假/老師請假、非（被移走的）調課原課、非試聽
function canAttend(e){return !e.isFullAbsent&&!e.isRescheduled&&e.calName!=='試聽';}
// 點名進度：可點人數（排除請假/曠課/無 id）與其中已標「到」數
function attSummary(e){
  const absSet=new Set(e.absentStudents||[]);
  const noShowSet=new Set(e.noShowStudents||[]);
  const markable=eventRosterWithId(e).filter(r=>r.studentId!=null&&!absSet.has(r.name)&&!noShowSet.has(r.name));
  const here=markable.filter(r=>getAtt(e.id,r.studentId)?.status==='到').length;
  return{here,total:markable.length};
}
function attBadgeHtml(e){
  const s=attSummary(e);
  if(!s.total)return'';
  const done=s.here>=s.total;
  return`<span class="tc-badge att-badge${done?' att-done':''}" id="attbadge-${esc(e.id)}">${done?'✓ 點名完成':'點名 '+s.here+'/'+s.total}</span>`;
}
function buildAttPanel(e){
  const roster=eventRosterWithId(e);
  if(!roster.length)return'<div class="att-empty">這堂沒有名單</div>';
  const absSet=new Set(e.absentStudents||[]);
  const noShowSet=new Set(e.noShowStudents||[]);
  const rows=roster.map(r=>{
    const lock=absSet.has(r.name)?'請假':noShowSet.has(r.name)?'曠課':null;
    if(lock)return`<div class="att-row att-locked"><span class="att-nm struck">${esc(r.name)}</span><span class="att-lock">${lock}</span></div>`;
    if(r.studentId==null)return`<div class="att-row att-noid"><span class="att-nm">${esc(r.name)}</span><span class="att-hint">需對帳</span></div>`;
    const rec=getAtt(e.id,r.studentId);
    const here=rec&&rec.status==='到',miss=rec&&rec.status==='未到';
    return`<div class="att-row"><span class="att-nm">${esc(r.name)}</span>
      <span class="att-seg">
        <button class="att-btn${here?' on-here':''}" onclick="event.stopPropagation();onAtt('${esc(e.id)}',${r.studentId},'到')">到</button>
        <button class="att-btn att-miss${miss?' on-miss':''}" onclick="event.stopPropagation();onAtt('${esc(e.id)}',${r.studentId},'未到')">未到</button>
      </span></div>`;
  }).join('');
  return`<div class="att-list">${rows}</div>`;
}
function toggleAttPanel(id){
  const p=document.getElementById('attp-'+id);if(!p)return;
  if(p.style.display!=='none'){p.style.display='none';return;}
  const e=findEventById(id);if(!e)return;
  p.innerHTML=buildAttPanel(e);
  p.style.display='block';
}
function onAtt(eventId,studentId,status){
  const e=findEventById(eventId);if(!e)return;
  const rec=getAtt(eventId,studentId);
  if(rec&&rec.status===status)unmarkAtt(eventId,studentId);
  else markAtt(eventId,e.startDt.toISOString(),studentId,status);
  const p=document.getElementById('attp-'+eventId);if(p)p.innerHTML=buildAttPanel(e);
  const b=document.getElementById('attbadge-'+eventId);if(b)b.outerHTML=attBadgeHtml(e);
}

function tcardHtml(e){
  const id=esc(e.id);
  const tcv=calColor(e.calName);
  const roster=eventRoster(e);
  const letter=subjectLetter(e);
  const avCls=e.isRescheduled?' av-resched':e.type==='practice'?' av-practice':'';
  const stat=
    e.status==='now'?'<span class="tc-badge tc-badge-now"><span class="ndot"></span>進行中</span>':
    e.status==='past'?'<span class="tc-badge tc-badge-past">已結束</span>':'';
  let badge='';
  if(e.isRescheduled)badge=`<span class="tc-badge tc-badge-resched">調課</span>`;
  else if(e.isAbsent)badge=`<span class="tc-badge tc-badge-abs">${e.absType==='老師請假'?'老師請假':'請假'}</span>`;
  else if(e.isNoShow)badge=`<span class="tc-badge tc-badge-abs">曠課</span>`;
  const mkBadge=(()=>{if(!e.isFullAbsent&&!e.isRescheduled)return'';const rec=findMakeupScheduledById(e.id);return rec?`<span class="tc-badge tc-badge-arr">✓ 已安排</span>`:`<span class="tc-badge tc-badge-un">未安排</span>`;})();
  // 動作列：請假內嵌（今日情境面板），調課走 week-modal 避免 rp-${id} 撞車
  let acts='';
  if(e.isRescheduled)acts=`<button class="tc-act" onclick="event.stopPropagation();selectWeekEvent('${id}')">看調課安排</button><button class="tc-act danger" onclick="event.stopPropagation();cancelReschedule('${id}')">取消調課</button>`;
  else if(e.isAbsent)acts=`<button class="tc-act danger" onclick="event.stopPropagation();cancelAbs('${id}')">取消請假</button>`;
  else if(e.isNoShow)acts=`<button class="tc-act danger" onclick="event.stopPropagation();cancelNoShow('${id}')">取消曠課</button>`;
  else acts=`<button class="tc-act" onclick="event.stopPropagation();toggleAbsPanel('${id}')">🗓 標記請假</button><button class="tc-act" onclick="event.stopPropagation();selectWeekEvent('${id}')">↔ 調課</button>`;
  // 能點名的課：點名面板已列出名冊，不再放「名單」鈕（避免重複）；
  // 不能點名的課（試聽/整堂請假/調課原課）沒有點名面板 → 保留「名單」鈕當唯一名冊入口
  const attBtn=canAttend(e)?`<button class="tc-act" onclick="event.stopPropagation();toggleAttPanel('${id}')">✓ 點名</button>`:'';
  const rosterBtn=canAttend(e)?'':`<button class="tc-act roster" onclick="event.stopPropagation();toggleRoster('${id}')">名單 <b>${roster.length}</b></button>`;
  const cls=`tcard2 t-${e.type}${e.status==='now'?' t-now':''}${e.status==='past'?' t-past':''}${e.isFullAbsent?' t-absent':''}${e.isRescheduled?' t-resched':''}`;
  return `<div class="${cls}" id="cc-${id}" style="--tcv:${tcv}">
    <div class="tcard2-head" onclick="toggleTcard('${id}')">
      <div class="tcard2-av${avCls}">${esc(letter)}</div>
      <div class="tcard2-info">
        <div class="tcard2-name"><span class="tcard2-title${e.isFullAbsent?' struck':''}">${esc(e.origTitle)}</span>${badge}${mkBadge}${stat}${canAttend(e)?attBadgeHtml(e):''}${typeMismatchChip(e)}</div>
        <div class="tcard2-sub">${e.classroom?esc(e.classroom)+' · ':''}${e.teacher?esc(e.teacher)+' · ':''}${roster.length} 人${e.type==='practice'?' · 自習':''}</div>
      </div>
      <div class="tcard2-time"><b>${fmtT(e.startDt)}</b><span>${fmtT(e.endDt)}</span></div>
      <span class="tcard2-chev">▾</span>
    </div>
    <div class="tcard2-actions">${acts}${attBtn}${rosterBtn}</div>
    <div class="tcard2-roster" id="rost-${id}" style="display:none">${roster.length?esc(roster.join('、')):'（無名單）'}</div>
    <div class="att-panel" id="attp-${id}" style="display:none"></div>
    <div class="abs-panel" id="absp-${id}">${buildAbsPanel(e,'')}</div>
  </div>`;
}
