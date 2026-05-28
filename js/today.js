// 今日課程：載入 + 渲染 + 教室時間軸 + hero 卡

async function loadToday(){
  if(!gapi.client.getToken())return;
  showL('讀取今日課程...');
  try{
    const d=currentDate;
    const start=new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0);
    const end=new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59);
    const all=await Promise.all(Object.entries(calendarIds).map(async([name,id])=>{
      try{const r=await gapi.client.calendar.events.list({calendarId:id,timeMin:start.toISOString(),timeMax:end.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:200});
      return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));}catch(e){return[];}
    }));
    dayEvents=all.flat().map(parseEv).sort((a,b)=>a.startDt-b.startDt);
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
      blocksHtml+=`<div class="tl-block" style="left:${left}%;width:${width}%;background:${clr}28;border-left:2.5px solid ${clr}" onclick="selectWeekEvent('${esc(e.id)}')"><div class="tl-block-nm">${esc(e.origTitle)}</div><div class="tl-block-t">${fmtT(e.startDt)}</div></div>`;
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
  const stuRest=e.students.length>4?` <span class="stu-rest">${esc(e.students.slice(0,3).join('、'))}…</span>`:e.students.length>0?` <span class="stu-rest">${esc(e.students.join('、'))}</span>`:'';
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
      <span><span class="lbl">學生</span><b>${e.students.length} 人</b>${stuRest}</span>
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

function tcardHtml(e){
  const id=esc(e.id);
  const tcv=calColor(e.calName);
  const cls=`tcard t-${e.type}${e.status==='now'?' t-now':''}${e.status==='past'?' t-past':''}${e.isFullAbsent?' t-absent':''}`;
  const stat=
    e.status==='now'?'<span class="tstat tstat-now"><span class="ndot"></span>進行中</span>':
    e.status==='past'?'<span class="tstat tstat-past">已結束</span>':'';
  const stuTxt=e.students.length===0?'—':e.students.length<=2?e.students.join('、'):`${e.students.length} 人`;
  const absInline=e.isRescheduled?`<div class="tcard-abs"><span class="l">調課</span>${e.rescheduleReason?esc(e.rescheduleReason):'未輸入原因'}</div>`:'';
  const noteInline=e.notes?`<div class="tcard-note"><span class="l">備註</span>${esc(e.notes)}</div>`:'';
  const mkSt=getMkSt(e);
  const extras=(absInline||noteInline||mkSt)?`<div class="tcard-extras">${noteInline}${absInline}${mkSt}</div>`:'';
  const absTitleEl=e.isRescheduled
    ?`<span class="mk-badge mk-badge-reschedule">調課</span>`
    :e.isAbsent
      ?`<span class="tcard-abs"><span class="l">請假</span>${e.absType==='老師請假'?'老師請假':esc(e.absentStudents.join('、'))+'請假'}</span>`
      :'';
  const stBadge=(()=>{if(!e.isFullAbsent&&!e.isRescheduled)return'';const rec=findMakeupScheduledById(e.id);return rec?`<span class="mk-badge mk-badge-arr">已安排</span>`:`<span class="mk-badge mk-badge-un">未安排</span>`;})();
  return `<div class="${cls}" id="cc-${id}" style="border-left-color:${tcv}" onclick="selectWeekEvent('${id}')">
    <div class="tcard-row">
      <div class="tcard-time">${fmtT(e.startDt)}<span class="dash">—</span>${fmtT(e.endDt)}</div>
      <div class="tcard-dur">${fmtDur(e.durMins)}</div>
      <div class="tcard-tags">
        <span class="tpill t-${e.type}"><span class="pdot"></span>${typeLbl(e.type)}</span>
        ${stat}
      </div>
    </div>
    <div class="tcard-title-row">
      <span class="tcard-title${e.isFullAbsent?' struck':''}">${esc(e.origTitle)}</span>
      ${absTitleEl}${stBadge}
    </div>
    <div class="tcard-meta">
      ${e.teacher?`<span><span class="lbl">授課</span><b>${esc(e.teacher)}</b></span>`:''}
      ${e.classroom?`<span><span class="lbl">教室</span><b>${esc(e.classroom)}</b></span>`:''}
      <span><span class="lbl">學生</span><b>${esc(stuTxt)}</b></span>
    </div>
    ${extras}
  </div>`;
}
