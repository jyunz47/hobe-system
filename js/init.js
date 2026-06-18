// 初始化：OAuth、Firebase、導覽、頁面 load 監聽
// 注意：因為這個檔依賴所有其他子系統的函式（loadToday、renderMakeup...），
// HTML 載入順序中 init.js 必須擺最後。

// ── Page load ──
window.addEventListener('load',()=>{
  const ck=setInterval(()=>{if(window.google&&window.gapi){clearInterval(ck);initAPIs();}},100);
  setDateDisplay(currentDate);
  document.getElementById('date-picker').value=toDateStr(currentDate);
});

// ── PWA 獨立視窗模式：popup 開不起來，登入/授權一律改走整頁 redirect ──
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
}

// 整頁跳轉到 Google OAuth（implicit flow），授權後帶著 #access_token 跳回
// redirect_uri 是本資料夾根（已在 Cloud Console 白名單），由 index.html 把 hash 轉交回主頁
function redirectSignIn(){
  const state=Math.random().toString(36).slice(2);
  sessionStorage.setItem('oauth_state',state);
  const p=new URLSearchParams({
    client_id:CLIENT_ID,
    redirect_uri:location.origin+location.pathname.replace(/[^/]*$/,''),
    response_type:'token',
    scope:SCOPES+' openid email profile',
    include_granted_scopes:'true',
    state
  });
  const hint=getLoginHint();if(hint)p.set('login_hint',hint); // 預選帳號，少跳一層帳戶選擇器
  location.href='https://accounts.google.com/o/oauth2/v2/auth?'+p;
}

// 登入過的 email：給 GIS / redirect 當 login_hint，避免多帳號時跳「選擇帳戶」
function getLoginHint(){
  try{const e=firebase.auth().currentUser&&firebase.auth().currentUser.email;if(e)return e;}catch(_){}
  return localStorage.getItem('ghint')||'';
}

// 靜默續授權：帶 login_hint 讓 Google 固定用同一帳號悄悄換新 token（多帳號時才不會跳選擇器）
function silentReauth(){
  if(!tokenClient)return;
  const hint=getLoginHint();
  tokenClient.requestAccessToken(hint?{prompt:'',hint}:{prompt:''});
}

// 重新授權：桌面走 GIS 靜默 popup，App 模式走 redirect
function requestReauth(){
  if(isStandalone()){redirectSignIn();return;}
  silentReauth();
}

// 解析 redirect 回來的 #access_token（沒有就回 null）
function consumeOAuthHash(){
  if(!location.hash.includes('access_token')&&!location.hash.includes('error='))return null;
  const h=new URLSearchParams(location.hash.slice(1));
  history.replaceState(null,'',location.pathname+location.search);
  if(h.get('error')){toast('授權失敗：'+h.get('error'),'err');return null;}
  if(h.get('state')!==sessionStorage.getItem('oauth_state')){toast('授權回應驗證失敗，請重新登入','err');return null;}
  sessionStorage.removeItem('oauth_state');
  return {access_token:h.get('access_token'),expires_in:+h.get('expires_in')||3599};
}

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
  // App 模式 redirect 回來：hash 裡有 token，優先處理
  const rtok=consumeOAuthHash();
  if(rtok){
    showL('登入中...');
    gapi.client.setToken({access_token:rtok.access_token});
    localStorage.setItem('gtoken',JSON.stringify({access_token:rtok.access_token,expires_at:Date.now()+rtok.expires_in*1000-60000}));
    scheduleTokenRefresh();
    try{
      const cred=firebase.auth.GoogleAuthProvider.credential(null,rtok.access_token);
      await firebase.auth().signInWithCredential(cred);
    }catch(e){hideL();toast('登入失敗：'+(e?.message||e),'err');return;}
    await onSignedIn();
    return;
  }
  // localStorage 的 token 撐得過重開瀏覽器；還在有效期就直接還原登入
  const saved=localStorage.getItem('gtoken');
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
    localStorage.removeItem('gtoken');
  }
  // 沒有有效 token，但 Firebase（localStorage）還記得登入 → 自動靜默續授權，省掉手動點登入
  // App 模式靜默 popup 不可用，留給使用者手動點（避免 reload 就被整頁跳走）
  if(isStandalone())return;
  const user=await new Promise(resolve=>{
    const unsub=firebase.auth().onAuthStateChanged(u=>{unsub();resolve(u);});
  });
  if(user&&tokenClient){
    showL('登入中...');
    silentReauth(); // 帶 login_hint 靜默續授權；失敗（需互動）時 callback 會 hideL 並停在登入頁
  }
}

// 登入：用單一 Firebase popup 同時取得 Firebase auth + Google Calendar OAuth token
// 避免兩個 popup 連環觸發時，第二個被瀏覽器擋（user gesture 在 await 後失效）
function signIn(){
  if(!gisReady){toast('系統初始化中...','inf');return;}
  // App 模式：popup 不可用，整頁跳轉授權
  if(isStandalone()){showL('前往 Google 授權...');redirectSignIn();return;}
  showL('開啟 Google 登入...');
  doSignIn().catch(e=>{
    hideL();
    if(e?.code==='auth/popup-closed-by-user'||e?.code==='auth/cancelled-popup-request')return;
    if(e?.code==='auth/popup-blocked'){toast('彈窗被瀏覽器封鎖，請允許彈窗後重試','err');return;}
    toast('登入失敗：'+(e?.message||e),'err');
  });
}

async function doSignIn(){
  // Case 1：Firebase 已登入（localStorage 還原），只需 Calendar token
  // 走 GIS silent refresh，已授權過的話不會跳 popup
  if(firebase.auth().currentUser){
    silentReauth();
    return;
  }
  // Case 2：全新登入，combined popup 一次拿 Firebase auth + Calendar OAuth token
  const provider=new firebase.auth.GoogleAuthProvider();
  provider.addScope(SCOPES); // 'https://www.googleapis.com/auth/calendar'
  const result=await firebase.auth().signInWithPopup(provider);
  const accessToken=result.credential?.accessToken;
  if(!accessToken)throw new Error('登入成功但沒拿到 Calendar 授權，請重試');
  gapi.client.setToken({access_token:accessToken});
  saveToken();
  scheduleTokenRefresh();
  await onSignedIn();
}

function saveToken(){const t=gapi.client.getToken();if(t)localStorage.setItem('gtoken',JSON.stringify({access_token:t.access_token,expires_at:Date.now()+3500000}));}

function scheduleTokenRefresh(){
  if(tokenRefreshTimer)clearTimeout(tokenRefreshTimer);
  const stored=localStorage.getItem('gtoken');
  if(!stored)return;
  try{
    const t=JSON.parse(stored);
    const delay=Math.max(t.expires_at-Date.now()-5*60*1000,60*1000);
    tokenRefreshTimer=setTimeout(()=>{
      if(currentPanel==='login')return;
      // App 模式不能在使用中整頁跳走（會打斷操作），改提示讓使用者挑時機
      if(isStandalone()){toast('授權即將過期','inf',true);return;}
      silentReauth();
    },delay);
  }catch(e){}
}

// 切回分頁時若 token 快過期就重新請求
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState!=='visible'||!gisReady||currentPanel==='login')return;
  const stored=localStorage.getItem('gtoken');
  if(!stored){requestReauth();return;}
  try{
    const t=JSON.parse(stored);
    if(t.expires_at-Date.now()<5*60*1000)requestReauth();
  }catch(e){requestReauth();}
});

function signOut(){
  const t=gapi.client.getToken();
  if(t){google.accounts.oauth2.revoke(t.access_token);gapi.client.setToken(null);}
  calendarIds={};dayEvents=[];weekEvents=[];makeupList=[];
  driveData={studentList:[],makeupScheduled:[],enrollments:[],coursePrices:[]};
  firebase.auth().signOut();
  localStorage.removeItem('gtoken');
  ['btn-signout','btn-refresh'].forEach(id=>document.getElementById(id).style.display='none');
  setUSt('','未登入','請登入 Google 帳號');
  showPanel('login');
}

async function onSignedIn(){
  hideL();
  scheduleTokenRefresh();
  ['btn-signout','btn-refresh'].forEach(id=>document.getElementById(id).style.display='inline-block');
  try{const info=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+gapi.client.getToken().access_token}}).then(r=>r.json());setUSt('ok',info.email||'已登入','Google 帳號');if(info.email)localStorage.setItem('ghint',info.email);}catch(e){setUSt('ok','已登入','Google 帳號');}
  await loadFromFirestore();
  migrateCoursesToEnrollments();
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
  driveData={studentList:[],makeupScheduled:[],enrollments:[],coursePrices:[]};
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
      driveData={
        studentList:d.studentList||[],
        makeupScheduled:d.makeupScheduled||[],
        enrollments:d.enrollments||[],
        coursePrices:d.coursePrices||[],
        enrollmentsMigratedAt:d.enrollmentsMigratedAt||null,
      };
    }
  }catch(e){
    console.error('loadFromFirestore failed',e);
    const denied=e?.code==='permission-denied'||/permission|denied|unauthor/i.test(e?.message||'');
    if(denied)toast('此 Google 帳號未獲授權使用系統，請聯繫管理員加入白名單','err',false);
    else toast('讀取雲端資料失敗：'+(e?.message||e),'err');
  }
}

function scheduleDriveSave(){drivePendingSave=true;clearTimeout(driveSaveTimer);driveSaveTimer=setTimeout(saveToFirestore,1500);}

async function saveToFirestore(){
  try{await SHARED_DOC.set(driveData,{merge:true});drivePendingSave=false;}
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

// token 是否已過期（gapi 沒 token、或 localStorage 記錄的 expires_at 已到）
function isTokenExpired(){
  if(!gapi.client.getToken())return true;
  try{
    const t=JSON.parse(localStorage.getItem('gtoken')||'null');
    return !t||t.expires_at<=Date.now();
  }catch(e){return true;}
}

async function refreshCurrent(){
  // token 過期：明確提示 + 給重新授權連結，不再靜默失敗
  if(isTokenExpired()){
    toast('授權已過期','inf',true);
    return;
  }
  showL('更新中…');
  try{
    if(drivePendingSave)await saveToFirestore();   // 先把本機待存改動寫上去，避免被雲端舊值蓋掉
    await loadFromFirestore();                       // 三頁都先重讀雲端最新（學生／修課／補課）
    if(currentPanel==='courses')await Promise.all([loadToday(),loadWeek()]);
    else if(currentPanel==='makeup'){await loadMakeup(true);populateMkFilters();renderMakeup();}
    else if(currentPanel==='students')renderStudents();
    hideL();toast('已更新','ok');
  }catch(e){
    hideL();toast('更新失敗：'+(e?.message||e),'err');
  }
}
