// 初始化：OAuth、Firebase、導覽、頁面 load 監聽
// 注意：因為這個檔依賴所有其他子系統的函式（loadToday、renderMakeup...），
// HTML 載入順序中 init.js 必須擺最後。

// ── Page load ──
window.addEventListener('load',()=>{
  const ck=setInterval(()=>{if(window.google&&window.gapi){clearInterval(ck);initAPIs();}},100);
  setDateDisplay(currentDate);
  document.getElementById('date-picker').value=toDateStr(currentDate);
});

// ── Google Identity Services + GAPI Calendar ──
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

function signIn(){
  if(!gisReady){toast('系統初始化中...','inf');return;}
  ensureFirebaseAuth().then(()=>{
    showL('開啟 Google Calendar 授權...');
    tokenClient.requestAccessToken({prompt:''});
  }).catch(e=>{
    if(e?.code==='auth/popup-closed-by-user'||e?.code==='auth/cancelled-popup-request')return;
    if(e?.code==='auth/popup-blocked'){toast('彈窗被瀏覽器封鎖，請允許彈窗後重試','err');return;}
    toast('Firebase 登入失敗：'+(e?.message||e),'err');
  });
}

async function ensureFirebaseAuth(){
  if(firebase.auth().currentUser)return;
  const provider=new firebase.auth.GoogleAuthProvider();
  await firebase.auth().signInWithPopup(provider);
}

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

// 切回分頁時若 token 快過期就重新請求
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
  openAddCourse();
  await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  updateWeekTitle();
}

// ── Firebase / Firestore ──
var firebaseConfig={apiKey:'AIzaSyAmrHOH2HadLeklzvOBfVoy-q9cjM94ywU',authDomain:'hobe-494909.firebaseapp.com',projectId:'hobe-494909',storageBucket:'hobe-494909.firebasestorage.app',messagingSenderId:'729031557572',appId:'1:729031557572:web:e48899ee69102898fca491'};
firebase.initializeApp(firebaseConfig);
var db=firebase.firestore();
var SHARED_DOC=db.collection('sharedData').doc('main');

async function loadFromFirestore(){
  driveData={studentList:[],makeupScheduled:[]};
  try{
    // 等 Firebase 從 localStorage 還原登入狀態（cmd+R 後 currentUser 起初是 null）
    if(!firebase.auth().currentUser){
      await new Promise(resolve=>{
        const unsub=firebase.auth().onAuthStateChanged(u=>{unsub();resolve(u);});
      });
    }
    if(!firebase.auth().currentUser){
      toast('請重新登入以同步雲端資料','inf',true);
      return;
    }
    const snap=await SHARED_DOC.get();
    if(snap.exists){
      const d=snap.data();
      driveData={studentList:d.studentList||[],makeupScheduled:d.makeupScheduled||[]};
    }
  }catch(e){
    console.error('loadFromFirestore failed',e);
    const denied=e?.code==='permission-denied'||/permission|denied|unauthor/i.test(e?.message||'');
    if(denied)toast('此 Google 帳號未獲授權使用系統，請聯繫管理員加入白名單','err',false);
    else toast('讀取雲端資料失敗：'+(e?.message||e),'err');
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

// ── 導覽（側邊欄 panel 切換）──
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
