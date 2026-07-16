// 今日課程：載入 + 渲染 + 教室時間軸 + hero 卡

async function loadToday(){
  if(!gapi.client.getToken())return;
  showL('讀取今日課程...');
  try{
    const d=currentDate;
    const start=new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,0,0);
    const end=new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59);
    // 改讀系統自有課表（不再撈 Google Calendar）：展開系統課程成當日課堂
    dayEvents=expandCoursesForRange(start,end).sort((a,b)=>a.startDt-b.startDt);
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
// 哪一列正在輸入遲到分鐘 {eid,sid}（transient UI 狀態）
var attLatePick=null;

function buildAttPanel(e){
  const roster=eventRosterWithId(e);
  if(!roster.length)return'<div class="att-empty">這堂沒有名單</div>';
  const absSet=new Set(e.absentStudents||[]);
  const noShowSet=new Set(e.noShowStudents||[]);
  // 練習課：每人的練習科目顯示在名字旁（來自展開器的 studentGroups）
  const subjOf=new Map();
  (e.studentGroups||[]).forEach(g=>g.students.forEach(nm=>subjOf.set(nm,subjOf.has(nm)?subjOf.get(nm)+'、'+g.subject:g.subject)));
  const subjTag=nm=>subjOf.has(nm)?`<span class="att-subj">${esc(subjOf.get(nm))}</span>`:'';
  const s=attSummary(e);
  // 常態整班都到 → 給「全部到」一鍵；沒到的再個別改
  const head=s.total?`<div class="att-hd">
    <button class="att-allbtn" onclick="event.stopPropagation();markAllHere('${esc(e.id)}')">全部到</button>
    <span class="att-hd-prog">${s.here}/${s.total} 到</span>
  </div>`:'';
  const rows=roster.map(r=>{
    const lock=absSet.has(r.name)?'請假':noShowSet.has(r.name)?'曠課':null;
    if(lock)return`<div class="att-row att-locked"><span class="att-nm struck">${esc(r.name)}${subjTag(r.name)}</span><span class="att-lock">${lock}</span></div>`;
    if(r.studentId==null)return`<div class="att-row att-noid"><span class="att-nm">${esc(r.name)}${subjTag(r.name)}</span><span class="att-hint">需對帳</span></div>`;
    const eid=esc(e.id),sid=r.studentId;
    // 正在輸入遲到分鐘 → 該列換成行內數字輸入
    if(attLatePick&&attLatePick.eid===e.id&&attLatePick.sid===sid){
      const cur=getAtt(e.id,sid)?.lateMin||'';
      return`<div class="att-row att-picking">
        <span class="att-nm">${esc(r.name)}${subjTag(r.name)}</span>
        <span class="att-lateedit">遲到 <input type="number" min="1" inputmode="numeric" class="att-mininput" id="lateinp-${eid}-${sid}" value="${cur}" onclick="event.stopPropagation()" onkeydown="if(event.key==='Enter')saveLate('${eid}',${sid});if(event.key==='Escape')cancelLate('${eid}')"> 分
        <button class="att-min ok" onclick="event.stopPropagation();saveLate('${eid}',${sid})">✓</button>
        <button class="att-min cancel" onclick="event.stopPropagation();cancelLate('${eid}')">✕</button></span>
      </div>`;
    }
    const rec=getAtt(e.id,sid);
    const lateMin=rec&&rec.status==='到'?(rec.lateMin||0):0;
    const onTime=rec&&rec.status==='到'&&!lateMin;
    // 到 = 主要 toggle（高頻）；遲到 = 直接輸入分鐘（次高頻）；曠 = 沒來，跳既有曠課流程（罕見）
    return`<div class="att-row"><span class="att-nm">${esc(r.name)}${subjTag(r.name)}</span>
      <span class="att-seg">
        <button class="att-here${onTime?' on':''}" onclick="event.stopPropagation();onHere('${eid}',${sid})">${onTime?'✓ 到':'到'}</button>
        <button class="att-late${lateMin?' on':''}" onclick="event.stopPropagation();onLate('${eid}',${sid})">${lateMin?'遲 '+lateMin+' 分':'遲到'}</button>
        <button class="att-skip" title="沒來 → 標曠課" onclick="event.stopPropagation();onSkip('${eid}',${sid})">曠</button>
      </span></div>`;
  }).join('');
  return`${head}<div class="att-list">${rows}</div>`;
}
function refreshAttPanel(e){const p=document.getElementById('attp-'+e.id);if(p)p.innerHTML=buildAttPanel(e);}
function refreshAttUI(e){refreshAttPanel(e);const b=document.getElementById('attbadge-'+e.id);if(b)b.outerHTML=attBadgeHtml(e);}

// 全部到：把所有可點學生標「準時到」（排除請假/曠課/無 id）
function markAllHere(eventId){
  const e=findEventById(eventId);if(!e)return;
  const absSet=new Set(e.absentStudents||[]);
  const noShowSet=new Set(e.noShowStudents||[]);
  eventRosterWithId(e).forEach(r=>{
    if(r.studentId==null||absSet.has(r.name)||noShowSet.has(r.name))return;
    markAtt(e.id,e.startDt.toISOString(),r.studentId,'到',0);
  });
  attLatePick=null;
  refreshAttUI(e);
}
function toggleAttPanel(id){
  const p=document.getElementById('attp-'+id);if(!p)return;
  if(p.style.display!=='none'){p.style.display='none';return;}
  const e=findEventById(id);if(!e)return;
  attLatePick=null;
  p.innerHTML=buildAttPanel(e);
  p.style.display='block';
}
// 到：toggle 準時到（再點一次取消）
function onHere(eventId,studentId){
  const e=findEventById(eventId);if(!e)return;
  const rec=getAtt(eventId,studentId);
  if(rec&&rec.status==='到'&&!(rec.lateMin>0))unmarkAtt(eventId,studentId);
  else markAtt(eventId,e.startDt.toISOString(),studentId,'到',0);
  attLatePick=null;
  refreshAttUI(e);
}
// 遲到：就地展開行內數字輸入框（無系統跳窗、無快捷）
function onLate(eventId,studentId){
  attLatePick={eid:eventId,sid:studentId};
  const e=findEventById(eventId);if(e)refreshAttPanel(e);
  const inp=document.getElementById('lateinp-'+eventId+'-'+studentId);
  if(inp){inp.focus();inp.select();}
}
function saveLate(eventId,studentId){
  const e=findEventById(eventId);if(!e)return;
  const inp=document.getElementById('lateinp-'+eventId+'-'+studentId);
  const v=parseInt(inp?.value,10);
  if(!(v>0)){toast('請輸入大於 0 的分鐘數','inf');inp?.focus();return;}
  markAtt(eventId,e.startDt.toISOString(),studentId,'到',v);
  attLatePick=null;
  refreshAttUI(e);
}
function cancelLate(eventId){attLatePick=null;const e=findEventById(eventId);if(e)refreshAttPanel(e);}
// 沒來＝曠課：開 modal、預選該生 + 時機 C(已開始·曠課)，只待按「確認標記」
function onSkip(eventId,studentId){
  const e=findEventById(eventId);if(!e)return;
  const r=eventRosterWithId(e).find(x=>x.studentId===studentId);
  const name=r?r.name:null;if(!name)return;
  selectWeekEvent(eventId);
  setTimeout(()=>{
    const sfx='-w';
    toggleAbsPanelWeek(eventId);              // 展開請假/曠課面板
    selAbsType(eventId,sfx,'student');        // 學生請假（含 timing 預選，下面覆蓋）
    absState[eventId].students=[name];        // 指定該生
    const sc=document.getElementById('sc-'+eventId+sfx);
    if(sc)sc.querySelectorAll('.stu-chip').forEach(c=>c.classList.toggle('checked',c.dataset.name===name));
    selAbsTiming(eventId,sfx,'C');            // 時機 C＝已開始·曠課（含 updatePreview）
  },60);
}

// 練習課名單（卡片點開直接看，2026-07-16 老闆要求）：年級 → 科目 → 學生（兩層分類）
// 年級照低→高；科目照常用科目順序（CF_PRAC_SUBJECTS），自訂科目排後、未填科目最後
// 一位學生練多科會在每個科目各出現一次（與課程管理視窗「名單總覽」同格式）
function pracRosterHtml(e){
  if(e.type!=='practice')return'';
  const byId=new Map(getStudentList().map(s=>[s.id,s]));
  let rows=[]; // {name,grade,subjects:'數學、理化'}
  if(e.courseId!=null){ // 系統課：登記簿直接有 studentId + 練習科目
    rows=getEnrollments({periodId:yearPeriodId()}).filter(en=>en.courseId===e.courseId)
      .map(en=>{const s=byId.get(en.studentId);return{name:s?s.name:'(未知)',grade:s?.grade||'',subjects:en.practiceSubject||''};});
  }else{ // 行事曆課（過渡期）：科目來自備註分組、年級靠唯一同名對出
    const subjOf=new Map();
    (e.studentGroups||[]).forEach(g=>g.students.forEach(nm=>subjOf.set(nm,subjOf.has(nm)?subjOf.get(nm)+'、'+g.subject:g.subject)));
    rows=(e.students||[]).map(nm=>{const m=getStudentList().filter(s=>s.name===nm);return{name:nm,grade:m.length===1?(m[0].grade||''):'',subjects:subjOf.get(nm)||''};});
  }
  if(!rows.length)return'';
  const byGrade=new Map();
  rows.forEach(r=>{const g=r.grade||'未填年級';if(!byGrade.has(g))byGrade.set(g,[]);byGrade.get(g).push(r);});
  const gOrder=g=>{const i=GRADES.indexOf(g);return i<0?99:i;};
  const sOrder=s=>{if(s==='未填科目')return 999;const i=CF_PRAC_SUBJECTS.indexOf(s);return i<0?99:i;};
  return `<div class="tcard2-prac">${[...byGrade.entries()].sort((a,b)=>gOrder(a[0])-gOrder(b[0])).map(([g,list])=>{
    const bySubj=new Map(); // 該年級內：科目 → 名字們
    list.forEach(r=>{
      const subjects=(r.subjects||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean);
      (subjects.length?subjects:['未填科目']).forEach(subj=>{
        if(!bySubj.has(subj))bySubj.set(subj,[]);
        bySubj.get(subj).push(r.name);
      });
    });
    const subjLines=[...bySubj.entries()].sort((a,b)=>sOrder(a[0])-sOrder(b[0]))
      .map(([subj,names])=>`<div class="prac-subj-line"><span class="prac-subj-lbl">${esc(subj)}</span>${esc(names.join('、'))}</div>`).join('');
    return `<div class="prac-grade-row"><span class="prac-grade">${esc(g)}</span><div class="prac-subj-lines">${subjLines}</div></div>`;
  }).join('')}</div>`;
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
  else if(e.isAbsent){
    // 老師請假固定字樣；學生請假比照曠課：多人顯示誰請假、一對一只顯示「請假」
    const as=e.absentStudents||[];
    badge=`<span class="tc-badge tc-badge-abs">${e.absType==='老師請假'?'老師請假':(e.type==='one'||!as.length?'請假':esc(as.join('、'))+' 請假')}</span>`;
  }
  else if(e.isNoShow){
    // 多人課顯示誰曠課；一對一（單人）名字多餘 → 只顯示「曠課」
    const ns=e.noShowStudents||[];
    badge=`<span class="tc-badge tc-badge-abs">${e.type==='one'||!ns.length?'曠課':esc(ns.join('、'))+' 曠課'}</span>`;
  }
  const mkBadge=(()=>{if(!e.isFullAbsent&&!e.isRescheduled)return'';const rec=findMakeupScheduledById(e.id);return rec?`<span class="tc-badge tc-badge-arr">✓ 已安排</span>`:`<span class="tc-badge tc-badge-un">未安排</span>`;})();
  // 動作列：請假內嵌（今日情境面板），調課走 week-modal 避免 rp-${id} 撞車
  let acts='';
  if(e.courseId!=null){ // 系統課堂：請假已接系統儲存（第 2 刀）；調課待第 3 刀
    if(e.isAbsent)acts=`<button class="tc-act danger" onclick="event.stopPropagation();cancelAbs('${id}')">取消請假</button>`;
    else if(e.isNoShow)acts=`<button class="tc-act danger" onclick="event.stopPropagation();cancelNoShow('${id}')">取消曠課</button>`;
    else acts=`<button class="tc-act" onclick="event.stopPropagation();selectWeekEventAndAbs('${id}')">🗓 標記請假</button>`;
  }
  else if(e.isRescheduled)acts=`<button class="tc-act" onclick="event.stopPropagation();selectWeekEvent('${id}')">看調課安排</button><button class="tc-act danger" onclick="event.stopPropagation();cancelReschedule('${id}')">取消調課</button>`;
  else if(e.isAbsent)acts=`<button class="tc-act danger" onclick="event.stopPropagation();cancelAbs('${id}')">取消請假</button>`;
  else if(e.isNoShow)acts=`<button class="tc-act danger" onclick="event.stopPropagation();cancelNoShow('${id}')">取消曠課</button>`;
  else acts=`<button class="tc-act" onclick="event.stopPropagation();selectWeekEventAndAbs('${id}')">🗓 標記請假</button><button class="tc-act" onclick="event.stopPropagation();selectWeekEventAndReschedule('${id}')">↔ 調課</button>`;
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
        <div class="tcard2-sub">${e.classroom?esc(e.classroom)+' · ':''}${e.teacher?esc(e.teacher)+' · ':''}${roster.length} 人</div>
      </div>
      <div class="tcard2-time"><b>${fmtT(e.startDt)}</b><span>${fmtT(e.endDt)}</span></div>
      <span class="tcard2-chev">▾</span>
    </div>
    <div class="tcard2-actions">${acts}${attBtn}${rosterBtn}</div>
    ${pracRosterHtml(e)}
    <div class="tcard2-roster" id="rost-${id}" style="display:none">${roster.length?esc(roster.join('、')):'（無名單）'}</div>
    <div class="att-panel" id="attp-${id}" style="display:none"></div>
  </div>`;
}
