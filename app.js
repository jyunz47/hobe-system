const CLIENT_ID='729031557572-tjn0hoiph1b0dbkp57lut0l6ekshm629.apps.googleusercontent.com';
const SCOPES='https://www.googleapis.com/auth/calendar';
const DISCOVERY_DOC='https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
const CAL_NAMES=['一般課程','補課','調課','試聽','練習課','加課'];
const MAKEUP_CALS=['一般課程','調課','試聽','練習課','加課']; // exclude 補課

let tokenClient=null,gapiReady=false,gisReady=false;
let tokenRefreshTimer=null;
let calendarIds={};
let currentPanel='login';
let currentDate=new Date();
let dayEvents=[];
let weekEvents=[];
let absState={};
let makeupList=[];
let driveData={studentList:[],makeupScheduled:[]};
let driveSaveTimer=null;
let makeupMatchMap=new Map(); // absenceEventId → {calEventId,scheduledDate,scheduledEnd,room,origTitle,absentStudents}
let selectedWeekEvent=null;
let weekOffset=0; // 0=this week, -1=last week, +1=next week
let selectedWeekDayIdx=null; // 0=Mon..6=Sun, null = default to today

function getSchoolYear(){const now=new Date();return now.getMonth()>=8?now.getFullYear():now.getFullYear()-1;}
function getPeriods(){
  const y=getSchoolYear();
  return[
    {id:'sem1',label:'上學期',start:new Date(y,8,1),end:new Date(y+1,0,31,23,59,59)},
    {id:'winter',label:'寒假',start:new Date(y+1,1,1),end:new Date(y+1,1,28,23,59,59)},
    {id:'sem2',label:'下學期',start:new Date(y+1,2,1),end:new Date(y+1,5,30,23,59,59)},
    {id:'summer',label:'暑假',start:new Date(y+1,6,1),end:new Date(y+1,7,31,23,59,59)},
  ];
}
function detectPeriodId(){const now=new Date();return(getPeriods().find(p=>now>=p.start&&now<=p.end)||getPeriods()[0]).id;}
let currentPeriodId=detectPeriodId();
function switchPeriod(id){currentPeriodId=id;renderMakeup();renderStudents();}
function periodTabsHtml(){return`<div class="period-tabs">${getPeriods().map(p=>`<button class="period-tab${p.id===currentPeriodId?' active':''}" onclick="switchPeriod('${p.id}')">${p.label}</button>`).join('')}</div>`;}
function getCurrentPeriod(){return getPeriods().find(p=>p.id===currentPeriodId)||getPeriods()[0];}

const COLORS={one:'#4A7C8C',pair:'#7C5A8C',group:'#2D5A3D',practice:'#8C6A2D'};
const CAL_COLORS={'一般課程':'#3B82F6','調課':'#EF4444','補課':'#F97316','加課':'#EAB308','試聽':'#22C55E','練習課':'#A855F7'};
function calColor(calName){return CAL_COLORS[calName]||'#9E9A93';}
const WD=['日','一','二','三','四','五','六'];
const ROOM_CAP={'小教室':5,'108':6,'208':6,'309':6};
const ROOMS_SMALL=['小教室','108','208','309'];
let slotPicker={ev:null,mode:null,date:null,time:null,room:null,avail:null};
let heroProgressTimer=null;

// ── Init ──
window.addEventListener('load',()=>{
  const ck=setInterval(()=>{if(window.google&&window.gapi){clearInterval(ck);initAPIs();}},100);
  setDateDisplay(currentDate);
  document.getElementById('date-picker').value=toDateStr(currentDate);
});

async function initAPIs(){
  await new Promise(r=>gapi.load('client',r));
  await gapi.client.init({discoveryDocs:[DISCOVERY_DOC]});
  gapiReady=true;
  tokenClient=google.accounts.oauth2.initTokenClient({
    client_id:CLIENT_ID,scope:SCOPES,
    callback:async(resp)=>{
      if(resp.error){
        hideL();
        if(['interaction_required','user_cancelled','access_denied'].includes(resp.error)){
          if(currentPanel!=='login')toast('授權已過期，請點擊重新授權','inf',true);
        }else{
          toast('授權失敗：'+resp.error,'err');
        }
        return;
      }
      saveToken();
      scheduleTokenRefresh();
      if(currentPanel==='login')await onSignedIn();
      else await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
    }
  });
  gisReady=true;
  const saved=sessionStorage.getItem('gtoken');
  if(saved){
    try{
      const t=JSON.parse(saved);
      const remaining=t.expires_at-Date.now();
      if(remaining>10*60*1000){
        gapi.client.setToken({access_token:t.access_token});
        await onSignedIn();
        return;
      }
    }catch(e){}
    sessionStorage.removeItem('gtoken');
    tokenClient.requestAccessToken({prompt:''});
  }
}

function signIn(){if(!gisReady){toast('系統初始化中...','inf');return;}showL('開啟 Google 授權...');tokenClient.requestAccessToken({prompt:''}); }

function saveToken(){const t=gapi.client.getToken();if(t)sessionStorage.setItem('gtoken',JSON.stringify({access_token:t.access_token,expires_at:Date.now()+3500000}));}

function scheduleTokenRefresh(){
  if(tokenRefreshTimer)clearTimeout(tokenRefreshTimer);
  const stored=sessionStorage.getItem('gtoken');
  if(!stored)return;
  try{
    const t=JSON.parse(stored);
    const delay=Math.max(t.expires_at-Date.now()-5*60*1000,60*1000);
    tokenRefreshTimer=setTimeout(()=>{if(tokenClient&&currentPanel!=='login')tokenClient.requestAccessToken({prompt:''});},delay);
  }catch(e){}
}

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible'||!tokenClient||currentPanel==='login')return;
  const stored=sessionStorage.getItem('gtoken');
  if(!stored){tokenClient.requestAccessToken({prompt:''});return;}
  try{
    const t=JSON.parse(stored);
    if(t.expires_at-Date.now()<5*60*1000)tokenClient.requestAccessToken({prompt:''});
  }catch(e){tokenClient.requestAccessToken({prompt:''});}
});

function signOut(){
  const t=gapi.client.getToken();
  if(t){google.accounts.oauth2.revoke(t.access_token);gapi.client.setToken(null);}
  calendarIds={};dayEvents=[];weekEvents=[];makeupList=[];
  driveData={studentList:[],makeupScheduled:[]};
  firebase.auth().signOut();
  sessionStorage.removeItem('gtoken');
  ['btn-signout','btn-refresh'].forEach(id=>document.getElementById(id).style.display='none');
  setUSt('','未登入','請登入 Google 帳號');
  showPanel('login');
}

async function onSignedIn(){
  hideL();
  scheduleTokenRefresh();
  ['btn-signout','btn-refresh'].forEach(id=>document.getElementById(id).style.display='inline-block');
  try{const info=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+gapi.client.getToken().access_token}}).then(r=>r.json());setUSt('ok',info.email||'已登入','Google 帳號');}catch(e){setUSt('ok','已登入','Google 帳號');}
  await loadFromFirestore();
  await fetchCalIds();
  showPanel('courses');
  await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  updateWeekTitle();
}

// ── Firebase / Firestore Sync ──
const firebaseConfig={apiKey:'AIzaSyAmrHOH2HadLeklzvOBfVoy-q9cjM94ywU',authDomain:'hobe-494909.firebaseapp.com',projectId:'hobe-494909',storageBucket:'hobe-494909.firebasestorage.app',messagingSenderId:'729031557572',appId:'1:729031557572:web:e48899ee69102898fca491'};
firebase.initializeApp(firebaseConfig);
const db=firebase.firestore();
const SHARED_DOC=db.collection('sharedData').doc('main');
async function loadFromFirestore(){
  try{
    await firebase.auth().signInAnonymously();
    const snap=await SHARED_DOC.get();
    if(snap.exists){
      const d=snap.data();
      driveData={studentList:d.studentList||[],makeupScheduled:d.makeupScheduled||[]};
    }else{
      driveData={studentList:JSON.parse(localStorage.getItem('studentList')||'[]'),makeupScheduled:JSON.parse(localStorage.getItem('makeupScheduled')||'[]')};
      if(driveData.studentList.length||driveData.makeupScheduled.length)await saveToFirestore();
    }
  }catch(e){
    console.error('loadFromFirestore failed',e);
    driveData={studentList:JSON.parse(localStorage.getItem('studentList')||'[]'),makeupScheduled:JSON.parse(localStorage.getItem('makeupScheduled')||'[]')};
  }
}
function scheduleDriveSave(){clearTimeout(driveSaveTimer);driveSaveTimer=setTimeout(saveToFirestore,1500);}
async function saveToFirestore(){
  try{await SHARED_DOC.set(driveData,{merge:true});}
  catch(e){console.error('saveToFirestore failed',e);}
}

async function fetchCalIds(){
  if(Object.keys(calendarIds).length>0)return;
  try{const l=await gapi.client.calendar.calendarList.list();(l.result.items||[]).forEach(c=>{if(CAL_NAMES.includes(c.summary))calendarIds[c.summary]=c.id;});}catch(e){console.error(e);}
}

// ── Refresh badge only (lightweight) ──
// ── Navigation ──
function switchPanel(id){
  if(!gapi.client.getToken())return;
  showPanel(id);
  if(id==='courses')Promise.all([loadToday(),loadWeek()]);
  if(id==='makeup')loadMakeup();
  if(id==='students')renderStudents();
}

function showPanel(id){
  currentPanel=id;
  ['courses','makeup','students','login'].forEach(p=>{
    const el=document.getElementById('panel-'+p);
    if(p==='login')el.classList.toggle('active',p===id);
    else el.style.display=p===id?'block':'none';
  });
  document.querySelectorAll('.ni').forEach(el=>el.classList.remove('active'));
  const nav=document.getElementById('nav-'+id);if(nav)nav.classList.add('active');
  const meta={courses:['課程','今日與本週課程'],makeup:['待補課/調課清單','找出需要安排補課或調課的課程'],students:['學生管理','請假、補課、欠課紀錄']};
  const[t,s]=meta[id]||['',''];
  document.getElementById('tbt').textContent=t;
  document.getElementById('tbs').textContent=s;
}

function refreshCurrent(){
  if(currentPanel==='courses')Promise.all([loadToday(),loadWeek()]);
  if(currentPanel==='makeup')loadMakeup();
  if(currentPanel==='students')renderStudents();
}

// ── Parse event ──
function cleanDesc(raw){
  if(!raw)return'';
  // Google Calendar web editor can store HTML; normalize to plain text
  return raw
    .replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<\/div>/gi,'\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(c))
    .replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .trim();
}
function parseEv(e){
  const title=e.summary||'';
  const desc=cleanDesc(e.description);
  const descFirstLine=(desc.split('\n')[0]||'');
  const classroomMatch=descFirstLine.match(/(小教室|大教室|108|208|309|石牌分校)/);
  const classroom=classroomMatch?classroomMatch[1]:'';
  const firstLine=descFirstLine.replace(/^\d+\s+/,'').replace(/(小教室|大教室|108|208|309|石牌分校)\s*/g,'').trim();
  const teacher=firstLine;

  // Distinguish student name lines from note lines
  // stripNote: remove parenthetical annotations like (國一) or （國二） before checking
  const stripNote=s=>s.trim().replace(/\([^)]*\)/g,'').replace(/（[^）]*）/g,'').trim();
  const isNameLine=l=>l.split(/[、,，]/).map(stripNote).filter(Boolean)
    .every(p=>p.length<=8&&/^[一-鿿A-Za-z]+$/.test(p));
  const isSubjectLine=l=>{
    if(!l.includes('：'))return false;
    const rest=l.slice(l.indexOf('：')+1);
    return rest.split(/[、,，]/).map(stripNote).filter(Boolean).every(p=>p.length<=8&&/^[一-鿿A-Za-z]+$/.test(p));
  };
  const isStudentLine=l=>isNameLine(l)||isSubjectLine(l);
  const allDescLines=desc.split('\n').slice(1).filter(Boolean);
  const stuLines=allDescLines.filter(isStudentLine);
  const noteLines=allDescLines.filter(l=>!isStudentLine(l));
  const notes=noteLines.join('　').trim();

  // Student groups (for practice courses with 科目：學生 format)
  const studentGroups=stuLines.filter(isSubjectLine).map(l=>{
    const idx=l.indexOf('：');
    return{subject:l.slice(0,idx).trim(),students:l.slice(idx+1).split(/[、,，]/).map(s=>s.trim()).filter(Boolean)};
  });

  // Flat student list
  const stuRaw=stuLines.map(l=>isSubjectLine(l)?l.slice(l.indexOf('：')+1):l).join('、');
  const descStudents=stuRaw?stuRaw.split(/[、,，]/).map(s=>s.trim()).filter(Boolean):[];

  // Course type detection
  const nameOnly=title.replace(/【[^】]*】/g,'').trim();
  let type='group';
  if(/練習課?/.test(title)||e._calName==='練習課'){type='practice';}
  else if(/家教/.test(title)){
    const sp=nameOnly.replace(/家教.*/,'').trim().split(/[\s、]+/).filter(Boolean);
    type=sp.length>=2?'pair':'one';
  }else if(/、/.test(nameOnly)&&/班/.test(nameOnly)){type='pair';}

  // Students: always from description (line 2+)
  const students=descStudents;

  const startDt=new Date(e.start.dateTime||e.start.date);
  const endDt=new Date(e.end.dateTime||e.end.date);

  // Detect reschedule from title: 【調課】 or 【調課：reason】 pattern
  const rescheduleMatch=title.match(/^【調課(?:[：:](.+?))?】/);
  const isRescheduled=!!rescheduleMatch;
  const rescheduleReason=rescheduleMatch?.[1]?.trim()||'';

  // Detect absence from title: 【XXX請假】 pattern
  const absMatch=title.match(/^【(.+?)請假】/);
  const isAbsent=!!absMatch;
  const absentWho=absMatch?absMatch[1]:'';
  const isTeacherAbsent=absentWho==='老師';
  // Absent students list (from title tag)
  const absentStudents=isRescheduled?[...students]:
    (!isAbsent||isTeacherAbsent)?[]:absentWho.split(/[、,，]/).map(s=>s.trim()).filter(Boolean);
  // For practice/group: partial absence = some but not all students absent
  const origTitle=isRescheduled?title.replace(/^【調課(?:[：:].*?)?】/,'').trim():
    (isAbsent?title.replace(/^【.+?請假】/,'').trim():title);
  const absType=isRescheduled?'調課':(isTeacherAbsent?'老師請假':(isAbsent?'學生請假':''));
  const totalStudents=students.length;
  const isPartialAbsent=isAbsent&&!isTeacherAbsent&&totalStudents>0&&absentStudents.length<totalStudents;
  // isFullAbsent: rescheduled, teacher absent, or all students absent
  const isFullAbsent=isRescheduled||(isAbsent&&(isTeacherAbsent||totalStudents===0||absentStudents.length>=totalStudents));

  return{
    id:e.id,title,desc,notes,teacher,classroom,students,studentGroups,type,startDt,endDt,
    durMins:Math.round((endDt-startDt)/60000),
    calId:e._calId,calName:e._calName,
    isAbsent,isPartialAbsent,isFullAbsent,isRescheduled,rescheduleReason,absentWho,absType,absentStudents,
    origTitle,
  };
}

// ── Build new title ──
function buildTitle(origTitle, type, students){
  if(type==='teacher') return `【老師請假】${origTitle}`;
  if(!students||students.length===0) return null;
  return `【${students.join('、')}請假】${origTitle}`;
}

// ── Load Today ──
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

// ── Week navigation ──
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

// ── Load Week ──
async function loadWeek(){
  if(!gapi.client.getToken())return;
  const now=new Date();
  const day=now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()-(day===0?6:day-1)+weekOffset*7);mon.setHours(0,0,0,0);
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);sun.setHours(23,59,59,999);
  try{
    const all=await Promise.all(Object.entries(calendarIds).map(async([name,id])=>{
      try{const r=await gapi.client.calendar.events.list({calendarId:id,timeMin:mon.toISOString(),timeMax:sun.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:500});
      return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));}catch(e){return[];}
    }));
    weekEvents=all.flat().map(parseEv).sort((a,b)=>a.startDt-b.startDt);
    renderWeek(mon);
  }catch(err){console.error('loadWeek',err);}
}

// ── Timeline (removed in v2 — V4 cards convey timing inline) ──
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

// ── Render Today List (V4 card grid + hero for current/next) ──
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

  // 自動更新所有進行中課程的進度條與時間（一個 timer，各自用自己的 data-start/end 計算）
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
  const remain=evs.filter(x=>x.status==='upcoming'||x.status==='now').length;
  let sumHtml=`<span>共 <b>${total}</b> 堂</span>`;
  if(isToday){
    if(past>0)sumHtml+=`<span>已完成 <b>${past}</b></span>`;
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
  const rec=new Map(getMakeupScheduled().map(s=>[s.originalId,s])).get(e.id);
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
  const absInline=e.isRescheduled?`<div class="tcard-abs"><span class="l">調課</span>${e.rescheduleReason?esc(e.rescheduleReason):'未輸入原因'}</div>`:
    e.isAbsent?`<div class="tcard-abs"><span class="l">請假</span>${e.absType==='老師請假'?'老師請假':esc(e.absentStudents.join('、'))+'請假'}</div>`:'';
  const noteInline=e.notes?`<div class="tcard-note"><span class="l">備註</span>${esc(e.notes)}</div>`:'';
  const mkSt=getMkSt(e);
  const extras=(absInline||noteInline||mkSt)?`<div class="tcard-extras">${noteInline}${absInline}${mkSt}</div>`:'';
  return `<div class="${cls}" id="cc-${id}" style="border-left-color:${tcv}" onclick="selectWeekEvent('${id}')">
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

// ── Weekly View (W4: day summary chips + focus day) ──
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

// Week-list card (same look as today card, but id prefix wc-)
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
  const ev=[...dayEvents,...weekEvents].find(e=>e.id===id);if(!ev)return;
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
          ${(()=>{if(!ev.isFullAbsent&&!ev.isRescheduled)return'';const rec=new Map(getMakeupScheduled().map(s=>[s.originalId,s])).get(ev.id);if(rec){const sd=new Date(rec.scheduledDate);return`<span style="color:#166534;font-weight:500;background:#dcfce7;border:1px solid #86efac;padding:2px 8px;border-radius:4px;font-size:12px">${ev.isRescheduled?'調課':'補課'}：${sd.getMonth()+1}/${sd.getDate()}（${WD[sd.getDay()]}）${fmtT(sd)}${rec.room?' '+esc(rec.room):''}</span>`;}return`<span style="color:#991b1b;font-weight:500;background:#fee2e2;border:1px solid #fca5a5;padding:2px 8px;border-radius:4px;font-size:12px">未安排${ev.isRescheduled?'調課':'補課'}</span>`;})()}
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

function toggleReschedulePanel(id){
  const p=document.getElementById('rp-'+id);if(!p)return;
  const show=p.style.display==='none';
  p.style.display=show?'block':'none';
  if(show)document.getElementById('rp-reason-'+id)?.focus();
}
async function confirmReschedule(id){
  const ev=[...dayEvents,...weekEvents].find(e=>e.id===id);if(!ev)return;
  const reason=(document.getElementById('rp-reason-'+id)?.value||'').trim();
  const newTitle=reason?`【調課：${reason}】${ev.origTitle}`:`【調課】${ev.origTitle}`;
  showL('標記調課...');
  try{
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:ev.id,resource:{summary:newTitle}});
    hideL();toast('已標記調課，請至待補課/調課清單安排新時段','ok');
    closeWeekModal();
    await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  }catch(e){hideL();toast('操作失敗：'+e.message,'err');}
}
async function cancelReschedule(id){
  const ev=[...dayEvents,...weekEvents].find(e=>e.id===id);if(!ev)return;
  showL('取消調課...');
  try{
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:ev.id,resource:{summary:ev.origTitle}});
    if(makeupMatchMap.has(id))await deleteMakeupScheduled(id);
    hideL();toast('已取消調課','ok');
    closeWeekModal();
    await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  }catch(e){hideL();toast('操作失敗：'+e.message,'err');}
}

// ── Absence Panel ──
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
  // Close cancel picker if open
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
  const ev=[...dayEvents,...weekEvents].find(e=>e.id===id);if(!ev)return;
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
  const ev=[...dayEvents,...weekEvents].find(e=>e.id===id);
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
    hideL();toast('已標記：'+newTitle,'ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
    // Refresh week detail panel if it was showing this event
    if(selectedWeekEvent===id) closeWeekModal();
  }catch(err){hideL();toast('更新失敗：'+(err.result?.error?.message||err.message),'err');}
}

function cancelAbs(id){
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  document.querySelectorAll('[id^="cancel-picker-"]').forEach(p=>p.remove());
  const ev=[...dayEvents,...weekEvents].find(e=>e.id===id);if(!ev)return;
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
  // Build picker panel after the course card
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
  const ev=[...dayEvents,...weekEvents].find(e=>e.id===id);if(!ev)return;
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
      // Fully restore
      newTitle=ev.origTitle;
    }else{
      // Remove only the cancelled students from absent list
      const remaining=ev.absentStudents.filter(s=>!cancelStudents.includes(s));
      if(remaining.length===0){
        newTitle=ev.origTitle;
      }else{
        newTitle=`【${remaining.join('、')}請假】${ev.origTitle}`;
      }
    }
    await gapi.client.calendar.events.patch({calendarId:ev.calId,eventId:id,resource:{summary:newTitle}});
    hideL();toast('已取消請假','ok');
    await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
    closeWeekModal();
  }catch(err){hideL();toast('操作失敗：'+(err.result?.error?.message||err.message),'err');}
}

// ── Makeup List ──
async function loadMakeup(silent=false){
  if(!gapi.client.getToken())return;
  if(!silent)showL('讀取待補課/調課清單...');
  try{
    const y=getSchoolYear(),past=new Date(y,8,1),future=new Date(y+1,7,31,23,59,59);
    const calEntries=Object.entries(calendarIds).filter(([name])=>MAKEUP_CALS.includes(name));
    const all=await Promise.all(calEntries.map(async([name,id])=>{
      try{const r=await gapi.client.calendar.events.list({calendarId:id,timeMin:past.toISOString(),timeMax:future.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:500});
      return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));}catch(e){return[];}
    }));
    const SUBJECTS=['數學','英文','理化','物理','化學','國文','生物','歷史','地理','社會','自然','寫作','作文'];
    makeupList=all.flat()
      .filter(e=>/^【.+?請假】/.test(e.summary||'')||/^【調課(?:[：:].*?)?】/.test(e.summary||''))
      .map(e=>{
        const ev=parseEv(e);
        const subject=SUBJECTS.find(s=>ev.origTitle.includes(s))||'其他';
        const extraNote=ev.desc.split('\n').slice(1).filter(Boolean).join(' · ');
        return{...ev,subject,extraNote};
      })
      .sort((a,b)=>a.startDt-b.startDt);
    // Scan 補課 and 調課 calendars to match against absences
    const newMatchMap=new Map();
    for(const calName of['補課','調課']){
      const calId=calendarIds[calName];if(!calId)continue;
      try{
        const mr=await gapi.client.calendar.events.list({calendarId:calId,timeMin:past.toISOString(),timeMax:future.toISOString(),singleEvents:true,orderBy:'startTime',maxResults:500});
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

function renderMakeup(){
  const period=getCurrentPeriod();
  const fs=document.getElementById('f-subject').value;
  const ft=document.getElementById('f-type').value;
  const fq=(document.getElementById('f-search')?.value||'').trim().toLowerCase();
  const now=new Date();
  const scheduledAll=getMakeupScheduled();
  const completedIds=new Set(scheduledAll.filter(s=>new Date(s.scheduledEnd)<now).map(s=>s.originalId));
  const scheduledFutureIds=new Set(scheduledAll.filter(s=>new Date(s.scheduledEnd)>=now).map(s=>s.originalId));

  const allInPeriod=makeupList.filter(e=>e.startDt>=period.start&&e.startDt<=period.end);
  const pendingStatCnt=allInPeriod.filter(e=>!completedIds.has(e.id)&&!scheduledFutureIds.has(e.id)).length;
  const scheduledStatCnt=allInPeriod.filter(e=>scheduledFutureIds.has(e.id)).length;
  const completedStatCnt=allInPeriod.filter(e=>completedIds.has(e.id)).length;

  function matchesFilter(e){
    if(fs&&e.subject!==fs)return false;
    if(ft&&e.absType!==ft)return false;
    if(fq){const hay=(e.origTitle+' '+e.absentWho+' '+e.teacher+' '+(e.absentStudents||[]).join(' ')).toLowerCase();if(!hay.includes(fq))return false;}
    return true;
  }

  const filteredAll=allInPeriod.filter(matchesFilter);
  const pending=filteredAll.filter(e=>!completedIds.has(e.id)&&!scheduledFutureIds.has(e.id));
  const scheduledList=filteredAll.filter(e=>scheduledFutureIds.has(e.id));
  const completedList=filteredAll.filter(e=>completedIds.has(e.id));

  document.getElementById('rc').textContent=`共 ${filteredAll.length} 筆`;

  const topArea=document.getElementById('mk-top-area');
  if(topArea){
    topArea.innerHTML=periodTabsHtml()+`<div class="mk-stats">
      <div class="mk-stat"><div class="mk-stat-icon" style="background:#FFF7ED;color:#F97316">⏰</div><div><div class="mk-stat-num">${pendingStatCnt}</div><div class="mk-stat-lbl">待安排總數</div></div></div>
      <div class="mk-stat"><div class="mk-stat-icon" style="background:#F0FDF4;color:#22C55E">🗓️</div><div><div class="mk-stat-num">${scheduledStatCnt}</div><div class="mk-stat-lbl">已安排</div></div></div>
      <div class="mk-stat"><div class="mk-stat-icon" style="background:#F9FAFB;color:#6B7280">✅</div><div><div class="mk-stat-num">${completedStatCnt}</div><div class="mk-stat-lbl">已完成</div></div></div>
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
    return`<div class="mk-list-card" onclick="openSlotPicker('${esc(e.id)}','${mode}')">
      <div class="mk-list-bar" style="background:${color}"></div>
      <div class="mk-list-body">
        <div class="mk-list-top">
          <span class="mk-list-title">${mkCardTitle(e)}</span>
          ${absBadge(e)}<span class="mk-badge mk-badge-un">未安排</span>
        </div>
        <div class="mk-list-meta">
          <span>📅 ${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）</span>
          <span>🕐 ${fmtT(d)}–${fmtT(de)}</span>
          ${e.classroom?`<span>📍 ${esc(e.classroom)}</span>`:''}
          ${e.teacher?`<span>👤 ${esc(e.teacher)}</span>`:''}
        </div>
      </div>
      <div class="mk-list-actions">
        <button class="mk-btn-arrange" onclick="event.stopPropagation();openSlotPicker('${esc(e.id)}','${mode}')">安排</button>
      </div>
    </div>`;
  }

  function scheduledCard(e,rec,isCompleted){
    const d=e.startDt,de=e.endDt,color=calColor(e.calName);
    const sd=new Date(rec.scheduledDate),se=new Date(rec.scheduledEnd);
    const statusBadge=isCompleted
      ?`<span class="mk-badge mk-badge-done">已完成</span>`
      :`<span class="mk-badge mk-badge-arr">已安排</span>`;
    return`<div class="mk-list-card${isCompleted?' mk-completed':''}">
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

  let html=`<div class="mk-two-col">`;

  // 左欄：待安排
  html+=`<div class="mk-col"><div class="mk-col-hd"><span style="color:#F97316">⏰</span><span class="mk-col-ttl">待安排</span><span class="mk-col-cnt">${pending.length} 筆</span></div>`;
  if(!pending.length){html+=`<div class="empty" style="padding:16px 0">全部已安排 🎉</div>`;}
  else{pending.forEach(e=>{html+=pendingCard(e);});}
  html+=`</div>`;

  // 右欄：已安排
  html+=`<div class="mk-col"><div class="mk-col-hd"><span style="color:var(--ac)">📅</span><span class="mk-col-ttl">已安排</span><span class="mk-col-cnt">${scheduledList.length} 筆</span></div>`;
  if(!scheduledList.length){html+=`<div class="empty" style="padding:16px 0">尚無已安排補課</div>`;}
  else{scheduledList.forEach(e=>{const rec=scheduledAll.find(s=>s.originalId===e.id);if(rec)html+=scheduledCard(e,rec,false);});}
  html+=`</div></div>`;

  // 已完成安排
  if(completedList.length){
    html+=`<div class="mk-sec-lbl mk-sec-gap" style="margin-top:24px">已完成安排（${completedList.length}）</div>`;
    completedList.forEach(e=>{const rec=scheduledAll.find(s=>s.originalId===e.id);if(rec)html+=scheduledCard(e,rec,true);});
  }

  c.innerHTML=html;
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
function updateMakeupBadge(){const period=getCurrentPeriod();const scheduledIds=new Set(getMakeupScheduled().map(x=>x.originalId));const n=makeupList.filter(e=>!scheduledIds.has(e.id)&&e.startDt>=period.start&&e.startDt<=period.end).length;updateBadge(n);return n;}

// ── Date nav ──
function changeDay(d){currentDate=new Date(currentDate.getTime()+d*864e5);setDateDisplay(currentDate);document.getElementById('date-picker').value=toDateStr(currentDate);if(gapi.client.getToken())Promise.all([loadToday(),loadWeek()]);}
function goToday(){currentDate=new Date();setDateDisplay(currentDate);document.getElementById('date-picker').value=toDateStr(currentDate);if(gapi.client.getToken())Promise.all([loadToday(),loadWeek()]);}
function pickDate(val){if(!val)return;const[y,m,d]=val.split('-').map(Number);currentDate=new Date(y,m-1,d);setDateDisplay(currentDate);if(gapi.client.getToken())Promise.all([loadToday(),loadWeek()]);}
function setDateDisplay(d){
  const W=['日','一','二','三','四','五','六'];
  const today=new Date();today.setHours(0,0,0,0);
  const cd=new Date(d);cd.setHours(0,0,0,0);
  const diff=Math.round((cd-today)/864e5);
  const lbl=diff===0?'  今天':diff===1?'  明天':diff===-1?'  昨天':'';
  document.getElementById('date-title').textContent=`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${W[d.getDay()]}）${lbl}`;
}

// ── UI ──
function setUSt(s,n,sub){document.getElementById('udot').className='udot'+(s==='ok'?' ok':s==='busy'?' busy':'');document.getElementById('uname').textContent=n;document.getElementById('usub').textContent=sub;}
function showErr(panel,msg){const el=document.getElementById('err-'+panel);if(el){el.textContent='⚠ '+msg;el.style.display='block';}}
function hideErr(panel){const el=document.getElementById('err-'+panel);if(el)el.style.display='none';}
function showL(m){document.getElementById('lo-txt').textContent=m||'載入中...';document.getElementById('lo').classList.add('open');}
function hideL(){document.getElementById('lo').classList.remove('open');}
function toast(m,t,withReauth){
  const el=document.getElementById('toast');
  el.className='toast t'+t;
  if(withReauth){
    el.innerHTML=(t==='ok'?'✓ ':t==='err'?'✕ ':'ℹ ')+m+' <span style="text-decoration:underline;cursor:pointer;margin-left:6px" onclick="tokenClient.requestAccessToken({prompt:\'\'})">點此授權</span>';
  }else{
    el.textContent=(t==='ok'?'✓ ':t==='err'?'✕ ':'ℹ ')+m;
  }
  el.style.display='block';
  clearTimeout(el._t);
  if(!withReauth)el._t=setTimeout(()=>el.style.display='none',4000);
}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
const typeLbl=t=>t==='one'?'一對一':t==='pair'?'一對二':t==='practice'?'練習課':'團班';
const fmtT=d=>d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
const fmtD=d=>{const W=['日','一','二','三','四','五','六'];return`${d.getMonth()+1}/${d.getDate()}（${W[d.getDay()]}）`;};
const fmtDT=d=>`${d.getMonth()+1}/${d.getDate()} ${fmtT(d)}`;
const fmtDur=m=>{const h=Math.floor(m/60),r=m%60;return h>0?(r>0?`${h}小時${r}分`:`${h}小時`):`${r}分鐘`;};
const toDateStr=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

// ── Slot Picker ──
function getEffectiveDur(){
  const d=slotPicker.ev?.durMins||60;
  if(slotPicker.mode==='makeup'&&slotPicker.ev?.type==='practice')return d;
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
  const ev=[...dayEvents,...weekEvents,...makeupList].find(e=>e.id===id);
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
  body.appendChild(buildSpDateSection());
  if(slotPicker.date)body.appendChild(buildSpTimeSection());
  if(slotPicker.time)body.appendChild(buildSpRoomSection());
  if(slotPicker.room)body.appendChild(buildSpConfirm());
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
  renderSpBody();
  showL('讀取教室資料...');
  const [y,m,d]=ds.split('-').map(Number);
  const dayStart=new Date(y,m-1,d,0,0,0),dayEnd=new Date(y,m-1,d,23,59,59);
  try{
    const all=await Promise.all(Object.entries(calendarIds).map(async([name,id])=>{
      try{const r=await gapi.client.calendar.events.list({calendarId:id,timeMin:dayStart.toISOString(),timeMax:dayEnd.toISOString(),singleEvents:true,orderBy:'startTime'});
      return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));}catch(e){return[];}}));
    slotPicker.avail=all.flat().map(e=>parseEv(e));
  }catch(e){slotPicker.avail=[];}
  hideL();
  renderSpBody();
  setTimeout(()=>sec=>sec&&sec.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
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
  const branchToggle=`<div class="period-tabs" style="margin-bottom:10px"><button class="period-tab${slotPicker.branch==='北投'?' active':''}" onclick="switchSpBranch('北投')">北投分校</button><button class="period-tab${slotPicker.branch==='石牌'?' active':''}" onclick="switchSpBranch('石牌')">石牌分校</button></div>`;
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
    const addGroup=(label,slots,mkEl)=>{
      if(!slots.length)return;
      const lbl=document.createElement('div');lbl.className='sp-group-lbl';lbl.textContent=label;
      const chips=document.createElement('div');chips.className='sp-chips';
      slots.forEach(s=>chips.appendChild(mkEl(s)));
      wrap.appendChild(lbl);wrap.appendChild(chips);
    };
    addGroup('可加入現有練習課',joinSlots,({h,mi,remaining})=>mkTime(h,mi,`剩${remaining}席`));
    addGroup('獨立時段',freeSlots,({h,mi})=>mkTime(h,mi,null));
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
async function confirmSlotPicker(){
  const ev=slotPicker.ev;
  const [y,m,d]=slotPicker.date.split('-').map(Number);
  const {h,mi}=slotPicker.time;
  const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+getEffectiveDur());
  const room=slotPicker.room,mode=slotPicker.mode;
  // Update description classroom
  const lines=(ev.desc||'').split('\n');
  const teacherOnly=(lines[0]||'').replace(/(小教室|大教室|108|208|309)\s*/g,'').trim();
  lines[0]=room+(teacherOnly?' '+teacherOnly:'');
  const newDesc=lines.join('\n');
  showL(mode==='makeup'?'建立補課事件...':'更新課程...');
  try{
    if(mode==='makeup'){
      const calId=calendarIds['補課'];
      if(!calId)throw new Error('找不到補課行事曆');
      const stuLabel=ev.absentStudents&&ev.absentStudents.length>0?ev.absentStudents.join('、'):'';
      const evTitle=stuLabel?`【${stuLabel}補課】${ev.origTitle}`:`【補課】${ev.origTitle}`;
      const resp=await gapi.client.calendar.events.insert({calendarId:calId,resource:{summary:evTitle,description:newDesc||'',extendedProperties:{private:{originalAbsenceId:ev.id}},start:{dateTime:sS.toISOString()},end:{dateTime:sE.toISOString()}}});
      saveMakeupScheduled(ev,sS,sE,room,resp.result.id);
      hideL();toast('補課已安排 🎉','ok');
      closeSlotPicker();
      renderMakeup();updateMakeupBadge();
    }else{
      const rcalId=calendarIds['調課'];
      if(!rcalId)throw new Error('找不到調課行事曆');
      const d=ev.startDt;
      const evTitle=`【${d.getMonth()+1}/${d.getDate()}的調課】${ev.origTitle}`;
      const reasonLine=ev.rescheduleReason?`調課原因：${ev.rescheduleReason}`:'';
      const descParts=[newDesc,reasonLine].filter(Boolean);
      const rescheduleDesc=descParts.join('\n');
      const resp=await gapi.client.calendar.events.insert({calendarId:rcalId,resource:{summary:evTitle,description:rescheduleDesc,extendedProperties:{private:{originalAbsenceId:ev.id}},start:{dateTime:sS.toISOString()},end:{dateTime:sE.toISOString()}}});
      saveMakeupScheduled(ev,sS,sE,room,resp.result.id,'調課');
      hideL();toast('調課時段已安排 🎉','ok');
      closeSlotPicker();
      renderMakeup();updateMakeupBadge();
    }
  }catch(err){hideL();toast('操作失敗：'+(err.result?.error?.message||err.message),'err');}
}
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
  if(rec?.calEventId&&calendarIds[calName]){
    try{await gapi.client.calendar.events.delete({calendarId:calendarIds[calName],eventId:rec.calEventId});}
    catch(e){console.warn(`刪除${calName}事件失敗`,e);}
  }
  makeupMatchMap.delete(originalId);
  driveData.makeupScheduled=getMakeupScheduledLS().filter(x=>x.originalId!==originalId);
  scheduleDriveSave();
  renderMakeup();updateMakeupBadge();
}

window.addEventListener('resize',()=>{if(currentPanel==='courses')renderTL();});

// ── Student Management ──
const GRADES=['國小','國一','國二','國三','高一','高二','高三','大學'];
function getStudentList(){return driveData.studentList||[];}
function saveStudentList(list){driveData.studentList=list;scheduleDriveSave();}

let scanData=null,_scanUnreg=[],_scanReg=[];

async function scanStudentsFromCalendar(){
  if(!Object.keys(calendarIds).length)return toast('請先登入 Google 帳號','err');
  showL('掃描學生中...');
  try{
    const period=getCurrentPeriod();
    const now=period.start;
    const end=period.end;
    const SCAN_CALS=['一般課程','練習課','加課'];
    const all=await Promise.all(
      Object.entries(calendarIds).filter(([n])=>SCAN_CALS.includes(n))
        .map(async([name,id])=>{
          try{
            const r=await gapi.client.calendar.events.list({
              calendarId:id,timeMin:now.toISOString(),timeMax:end.toISOString(),
              singleEvents:true,orderBy:'startTime',maxResults:500
            });
            return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));
          }catch{return[];}
        })
    );
    const events=all.flat().map(e=>parseEv(e)).filter(e=>!e.isRescheduled);
    const map=new Map();
    events.forEach(ev=>{
      (ev.students||[]).forEach(name=>{
        if(!map.has(name))map.set(name,new Set());
        map.get(name).add(ev.origTitle);
      });
    });
    scanData=map;
    hideL();
    renderScanSection();
  }catch(e){hideL();toast('掃描失敗：'+e.message,'err');}
}

function parseScanName(raw){
  const mBefore=raw.match(/^[（(]([^）)]+)[）)]\s*(.+)$/);
  if(mBefore)return{name:mBefore[2].trim(),gradeHint:mBefore[1].trim()};
  const mAfter=raw.match(/^(.+?)\s*[（(]([^）)]+)[）)]$/);
  if(mAfter)return{name:mAfter[1].trim(),gradeHint:mAfter[2].trim()};
  return{name:raw,gradeHint:null};
}

function courseDiffHtml(oldArr,newArr){
  const oldSet=new Set(oldArr),newSet=new Set(newArr);
  const added=newArr.filter(c=>!oldSet.has(c));
  const removed=oldArr.filter(c=>!newSet.has(c));
  if(!added.length&&!removed.length)return'';
  const parts=[];
  if(added.length)parts.push(`<span style="color:#2d9b6a">＋${added.map(esc).join('、')}</span>`);
  if(removed.length)parts.push(`<span style="color:#c0392b">－${removed.map(esc).join('、')}</span>`);
  return`<div style="font-size:11px;margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">${parts.join('')}</div>`;
}

function renderScanSection(){
  const sec=document.getElementById('stu-scan-sec');
  if(!scanData||!scanData.size){sec.style.display='none';return;}
  const list=getStudentList();
  _scanUnreg=[];_scanReg=[];
  [...scanData.entries()].forEach(([rawName,courseSet])=>{
    const{name,gradeHint}=parseScanName(rawName);
    const courses=[...courseSet];
    const matches=gradeHint
      ?list.filter(s=>s.name===name&&s.grade===gradeHint)
      :list.filter(s=>s.name===name);
    if(matches.length)_scanReg.push({rawName,name,gradeHint,courses,matches});
    else _scanUnreg.push({rawName,name,gradeHint,courses});
  });
  const periodLabel=getCurrentPeriod().label;
  let html=`<div class="stu-scan-sec"><div class="stu-scan-hd"><span>🔍 掃描結果（${periodLabel}）</span><button onclick="closeScanSection()">✕</button></div><div class="stu-scan-body">`;
  if(_scanUnreg.length){
    html+=`<div><div class="stu-scan-grp-lbl">尚未建檔（${_scanUnreg.length} 人）</div>`;
    _scanUnreg.forEach(({name,gradeHint,courses},i)=>{
      const opts=GRADES.map(g=>`<option value="${g}"${g===(gradeHint||'國二')?' selected':''}>${g}</option>`).join('');
      const displayName=gradeHint?`${name}（${gradeHint}）`:name;
      html+=`<div class="stu-scan-row">
        <div class="stu-scan-name">${esc(displayName)}</div>
        <div class="stu-scan-courses">${courses.map(esc).join('、')}</div>
        <select class="stu-scan-grade" id="scan-g-${i}">${opts}</select>
        <button class="stu-scan-add" id="scan-a-${i}" onclick="addStudentFromScan(${i})">加入</button>
      </div>`;
    });
    html+=`</div>`;
  }
  if(_scanReg.length){
    html+=`<div><div class="stu-scan-grp-lbl">已在名單（${_scanReg.length} 人）</div>`;
    _scanReg.forEach(({name,gradeHint,courses,matches},ri)=>{
      const displayName=gradeHint?`${name}（${gradeHint}）`:name;
      if(matches.length>1){
        html+=`<div class="stu-scan-exist-row">
          <div class="stu-scan-exist-name">${esc(displayName)} <span class="stu-warn-chip" style="font-size:10px">⚠ 同名</span></div>
          <div class="stu-scan-exist-courses">${courses.map(esc).join('、')}</div>
          <div style="font-size:11px;color:var(--tx3);margin-top:4px">名單中有 ${matches.length} 位同名學生，無法自動區分。請在行事曆備注加上年級，例如「（${esc(matches[0].grade)}）${esc(name)}」。</div>
        </div>`;
      }else{
        const stu=matches[0];
        const changed=(stu.courses||[]).slice().sort().join(',')!==courses.slice().sort().join(',');
        const diff=changed?courseDiffHtml(stu.courses||[],courses):'';
        html+=`<div class="stu-scan-exist-row">
          <div class="stu-scan-exist-name">${esc(displayName)}</div>
          <div class="stu-scan-exist-grade">${esc(stu.grade)}</div>
          <div class="stu-scan-exist-courses">${courses.map(esc).join('、')}${diff}</div>
          ${changed?`<button class="stu-scan-upd" onclick="updateStudentCoursesFromScan(${ri})">更新課程</button>`:'<span style="font-size:11px;color:var(--tx3)">✓ 最新</span>'}
        </div>`;
      }
    });
    html+=`</div>`;
  }
  if(!_scanUnreg.length&&!_scanReg.length){
    html+=`<div style="font-size:13px;color:var(--tx3);padding:4px 0">${periodLabel}沒有找到學生資料，請確認行事曆備注有填寫學生姓名</div>`;
  }
  html+=`</div></div>`;
  sec.innerHTML=html;
  sec.style.display='block';
  sec.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function addStudentFromScan(i){
  const item=_scanUnreg[i];if(!item)return;
  const grade=document.getElementById(`scan-g-${i}`)?.value||'國二';
  const list=getStudentList();
  if(list.some(s=>s.name===item.name&&s.grade===grade)){renderScanSection();return toast(`${item.name}（${grade}）已在名單中`,'inf');}
  list.push({id:Date.now(),name:item.name,grade,courses:item.courses,createdAt:new Date().toISOString()});
  saveStudentList(list);
  const btn=document.getElementById(`scan-a-${i}`);
  if(btn){btn.textContent='✓ 已加入';btn.disabled=true;}
  renderStudents();
  toast(`已新增 ${item.name}（${grade}）`,'ok');
}

function updateStudentCoursesFromScan(ri){
  const item=_scanReg[ri];if(!item)return;
  const list=getStudentList();
  const s=list.find(x=>x.id===item.matches[0].id);if(!s)return;
  s.courses=item.courses;
  saveStudentList(list);
  renderScanSection();renderStudents();
  toast(`已更新 ${s.name} 的課程`,'ok');
}

function updateStudentCoursesByStuId(stuId,ri){
  const item=_scanReg[ri];if(!item)return;
  const list=getStudentList();
  const s=list.find(x=>x.id===stuId);if(!s)return;
  s.courses=item.courses;
  saveStudentList(list);
  renderScanSection();renderStudents();
  toast(`已更新 ${s.name}（${s.grade}）的課程`,'ok');
}

function closeScanSection(){
  scanData=null;_scanUnreg=[];_scanReg=[];
  document.getElementById('stu-scan-sec').style.display='none';
}

function toggleAddStudentForm(){
  const f=document.getElementById('stu-add-form');
  const show=f.style.display==='none';
  f.style.display=show?'flex':'none';
  if(show)document.getElementById('stu-name-input').focus();
}
function addStudent(){
  const name=document.getElementById('stu-name-input').value.trim();
  const grade=document.getElementById('stu-grade-input').value;
  if(!name)return toast('請輸入學生姓名','inf');
  const list=getStudentList();
  if(list.some(s=>s.name===name&&s.grade===grade))return toast('已有同名同年級的學生','inf');
  list.push({id:Date.now(),name,grade,createdAt:new Date().toISOString()});
  saveStudentList(list);
  document.getElementById('stu-name-input').value='';
  toggleAddStudentForm();
  renderStudents();
  toast(`已新增 ${name}（${grade}）`,'ok');
}
function deleteStudent(id){
  if(!confirm('確定刪除這位學生的紀錄？'))return;
  saveStudentList(getStudentList().filter(s=>s.id!==id));
  renderStudents();
}

function getThreshold(pid){return(pid==='sem1'||pid==='sem2')?3:2;}
function getStudentStats(name,periodId){
  const pid=periodId||currentPeriodId;
  const period=getPeriods().find(p=>p.id===pid)||getPeriods()[0];
  const scheduled=getMakeupScheduled();
  const scheduledMap=new Map(scheduled.map(s=>[s.originalId,s]));
  const absences=makeupList.filter(e=>{
    if(!e.startDt||e.startDt<period.start||e.startDt>period.end)return false;
    if(e.absType==='學生請假'||e.absType==='調課')return e.absentStudents?.includes(name);
    if(e.absType==='老師請假')return e.students?.includes(name);
    return false;
  });
  const now=new Date();
  const pairs=absences.map(e=>({absence:e,makeup:scheduledMap.get(e.id)||null}));
  const byCourse={};
  pairs.forEach(({absence:a,makeup:m})=>{
    const c=a.origTitle;
    if(!byCourse[c])byCourse[c]={total:0,owed:0,studentAbs:0,reschedules:0,teacherAbs:0,pairs:[],type:a.type};
    byCourse[c].total++;
    if(!m||new Date(m.scheduledEnd)>=now)byCourse[c].owed++;
    if(a.absType==='學生請假')byCourse[c].studentAbs++;
    else if(a.absType==='調課')byCourse[c].reschedules++;
    else if(a.absType==='老師請假')byCourse[c].teacherAbs++;
    byCourse[c].pairs.push({absence:a,makeup:m});
  });
  const owed=pairs.filter(p=>!p.makeup||new Date(p.makeup.scheduledEnd)>=now).length;
  return{total:pairs.length,made:pairs.filter(p=>p.makeup&&new Date(p.makeup.scheduledEnd)<now).length,owed,pairs,byCourse};
}
function hasThresholdWarning(stats,pid){
  const t=getThreshold(pid||currentPeriodId);
  return Object.values(stats.byCourse).some(c=>c.type==='group'&&c.studentAbs>=t);
}

let stuEditId=null,_editCourses=[];
let mkOpenId=null;

function toggleStudentDetail(id){openStudentModal(id);}

function openStudentModal(id){
  const list=getStudentList();
  const s=list.find(x=>x.id===id);
  if(!s)return;
  const stats=getStudentStats(s.name);
  document.getElementById('stu-modal-name').textContent=s.name;
  document.getElementById('stu-modal-grade').textContent=s.grade;
  const period=getCurrentPeriod();
  const threshold=getThreshold(currentPeriodId);
  const warnCourses=Object.entries(stats.byCourse).filter(([,c])=>c.type==='group'&&c.studentAbs>=threshold);
  const hasReschedules=Object.values(stats.byCourse).some(c=>c.reschedules>0);
  let body='';
  // Per-course absence section
  body+=`<div><div class="stu-modal-sec-lbl">出缺勤（${period.label}）</div>`;
  if(warnCourses.length){
    body+=`<div class="stu-modal-warn">⚠ ${warnCourses.map(([c])=>esc(c)).join('、')} 已達額外收費標準</div>`;
  }
  if(Object.keys(stats.byCourse).length){
    body+=`<table class="stu-course-tbl"><thead><tr><th>課程</th>${hasReschedules?'<th>調課</th>':''}<th>請假</th><th>欠課</th><th></th></tr></thead><tbody>`;
    Object.entries(stats.byCourse).forEach(([course,c])=>{
      const courseWarn=c.type==='group'&&c.studentAbs>=threshold;
      body+=`<tr${courseWarn?' class="warn-row"':''}><td>${esc(course)}</td>${hasReschedules?`<td>${c.reschedules||0}</td>`:''}<td>${c.studentAbs}</td><td>${c.owed}</td><td>${courseWarn?`<span class="warn-badge">⚠ 多收費</span>`:''}</td></tr>`;
    });
    body+=`</tbody></table>`;
    if(stats.owed>0)body+=`<div class="stu-modal-total">欠課合計：${stats.owed} 堂</div>`;
  }else{
    body+=`<div style="font-size:12px;color:var(--tx3)">${period.label}無請假紀錄</div>`;
  }
  body+=`</div>`;
  // Enrolled courses
  const displayCourses=(s.courses||[]).filter(c=>!/^【調課】/.test(c));
  if(displayCourses.length){
    body+=`<div><div class="stu-modal-sec-lbl">課程</div>
      <div class="stu-courses">${displayCourses.map(c=>`<span class="stu-course-tag">${esc(c)}</span>`).join('')}</div></div>`;
  }
  // Individual absence records
  if(stats.pairs.length){
    body+=`<div><div class="stu-modal-sec-lbl">請假紀錄</div>`;
    const _now=new Date();
    body+=stats.pairs.map(({absence:a,makeup:m})=>{
      const absDate=`${a.startDt.getMonth()+1}/${a.startDt.getDate()}（${WD[a.startDt.getDay()]}）`;
      const absTypeLabel=a.absType==='老師請假'?'老師請假':a.absType==='調課'?'調課':'學生請假';
      const isDone=m&&new Date(m.scheduledEnd)<_now;
      const makeupStr=isDone
        ?`<div class="stu-pair-makeup done">✓ 已補課：${new Date(m.scheduledDate).getMonth()+1}/${new Date(m.scheduledDate).getDate()}（${WD[new Date(m.scheduledDate).getDay()]}）</div>`
        :m
        ?`<div class="stu-pair-makeup pending">○ 待上補課：${new Date(m.scheduledDate).getMonth()+1}/${new Date(m.scheduledDate).getDate()}（${WD[new Date(m.scheduledDate).getDay()]}）${fmtT(new Date(m.scheduledDate))}</div>`
        :`<div class="stu-pair-makeup owed link" onclick="jumpToMakeup('${esc(a.id)}')">○ 尚未安排補課</div>`;
      return`<div class="stu-pair"><div class="stu-pair-icon">${isDone?'✓':'○'}</div><div class="stu-pair-body"><div class="stu-pair-course">${esc(a.origTitle)}</div><div class="stu-pair-abs">${absTypeLabel}：${absDate}</div>${makeupStr}</div></div>`;
    }).join('');
    body+=`</div>`;
  }
  document.getElementById('stu-modal-body').innerHTML=body;
  document.getElementById('stu-modal-wrap').classList.add('open');
}

function closeStudentModal(){
  document.getElementById('stu-modal-wrap').classList.remove('open');
}
async function jumpToMakeup(eventId){
  closeStudentModal();
  mkOpenId=eventId;
  showPanel('makeup');
  await loadMakeup();
  setTimeout(()=>{
    const card=document.querySelector('.mk-card-mini.open');
    if(card){card.scrollIntoView({behavior:'smooth',block:'center'});trigHL(card);}
  },50);
}

function toggleMkCard(id){
  mkOpenId=mkOpenId===id?null:id;
  renderMakeup();
}

function toggleStudentEdit(id){
  if(stuEditId===id){cancelStudentEdit();return;}
  stuEditId=id;
  const s=getStudentList().find(x=>x.id===id);
  _editCourses=s?(s.courses||[]).filter(c=>!/^【調課】/.test(c)):[];
  renderStudents();
  requestAnimationFrame(()=>document.getElementById(`edit-name-${id}`)?.focus());
}

function cancelStudentEdit(){
  stuEditId=null;_editCourses=[];
  renderStudents();
}

function saveStudentEdit(id){
  const name=document.getElementById(`edit-name-${id}`)?.value.trim();
  const grade=document.getElementById(`edit-grade-${id}`)?.value;
  if(!name)return toast('姓名不能空白','err');
  const list=getStudentList();
  if(list.some(x=>x.id!==id&&x.name===name))return toast('已有同名學生','err');
  const s=list.find(x=>x.id===id);
  if(!s)return;
  s.name=name;s.grade=grade;s.courses=[..._editCourses];
  saveStudentList(list);
  stuEditId=null;_editCourses=[];
  renderStudents();
  toast(`已更新 ${name} 的資料`,'ok');
}

function buildEditCoursesHtml(id){
  return _editCourses.map((c,i)=>
    `<span class="stu-edit-course-tag">${esc(c)}<button class="rm-course-btn" onclick="removeEditCourse(${i},${id})">✕</button></span>`
  ).join('')+
  `<div class="stu-edit-add-wrap">
    <input id="edit-new-course-${id}" class="stu-edit-new-course" placeholder="新增課程…" onkeydown="if(event.key==='Enter'){event.preventDefault();addEditCourse(${id})}">
    <button class="stu-edit-add-btn" onclick="addEditCourse(${id})">＋</button>
  </div>`;
}

function renderEditCourses(id){
  const el=document.getElementById(`edit-courses-${id}`);
  if(el)el.innerHTML=buildEditCoursesHtml(id);
}

function removeEditCourse(idx,id){
  _editCourses.splice(idx,1);
  renderEditCourses(id);
}

function addEditCourse(id){
  const input=document.getElementById(`edit-new-course-${id}`);
  const val=input?.value.trim();
  if(!val)return;
  if(!_editCourses.includes(val))_editCourses.push(val);
  input.value='';
  renderEditCourses(id);
  input.focus();
}

function renderStudents(){
  const container=document.getElementById('stu-list');
  if(!container)return;
  const list=getStudentList();
  if(!list.length){container.innerHTML=periodTabsHtml()+'<div class="empty">尚未新增學生，點右上角「新增學生」開始</div>';return;}
  const byGrade={};
  GRADES.forEach(g=>{byGrade[g]=[];});
  list.forEach(s=>{if(!byGrade[s.grade])byGrade[s.grade]=[];byGrade[s.grade].push(s);});
  let html=periodTabsHtml();
  GRADES.forEach(grade=>{
    const studs=byGrade[grade]||[];
    if(!studs.length)return;
    html+=`<div class="stu-grade-sec"><div class="stu-grade-lbl">${grade}　${studs.length} 人</div><div class="stu-grid">`;
    studs.forEach(s=>{
      const stats=getStudentStats(s.name);
      const warn=hasThresholdWarning(stats);
      html+=`<div class="stu-card" onclick="toggleStudentDetail(${s.id})">
        <div class="stu-card-actions">
          <button class="stu-card-act-btn" onclick="event.stopPropagation();toggleStudentEdit(${s.id})" title="編輯">✎</button>
          <button class="stu-card-act-btn del" onclick="event.stopPropagation();deleteStudent(${s.id})" title="刪除">✕</button>
        </div>
        <div class="stu-card-name">${esc(s.name)}</div>
        <div class="stu-owed">
          <span class="stu-owed-n${stats.owed>0?' gt0':''}">${stats.owed}</span>
          <span class="stu-owed-l">欠課</span>
          ${warn?'<span class="stu-warn-chip">⚠ 多收費</span>':''}
        </div>
      </div>`;
    });
    html+=`</div>`; // close grid

    // Edit panel
    if(stuEditId!==null&&studs.some(x=>x.id===stuEditId)){
      const s=studs.find(x=>x.id===stuEditId);
      const gradeOpts=GRADES.map(g=>`<option value="${g}"${g===s.grade?' selected':''}>${g}</option>`).join('');
      html+=`<div class="stu-edit-panel"><div class="stu-edit-form">
        <div class="stu-edit-top">
          <input id="edit-name-${s.id}" class="stu-edit-input" value="${esc(s.name)}" placeholder="姓名" maxlength="20">
          <select id="edit-grade-${s.id}" class="stu-edit-select">${gradeOpts}</select>
          <button class="stu-edit-save" onclick="saveStudentEdit(${s.id})">儲存</button>
          <button class="stu-edit-cancel" onclick="cancelStudentEdit()">取消</button>
        </div>
        <div class="stu-edit-courses-row">
          <span class="stu-edit-courses-lbl">課程</span>
          <div id="edit-courses-${s.id}" class="stu-edit-courses-body">${buildEditCoursesHtml(s.id)}</div>
        </div>
      </div></div>`;
    }

    html+=`</div>`; // close grade section
  });
  container.innerHTML=html;
}
