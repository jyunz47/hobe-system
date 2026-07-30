// 初始化：OAuth、Firebase、導覽、頁面 load 監聽
// 注意：因為這個檔依賴所有其他子系統的函式（loadToday、renderMakeup...），
// HTML 載入順序中 init.js 必須擺最後。

// ── App 模式：?app=dayview 開的桌面日曆視窗（openDayViewWindow）——藏側邊欄/工具列、登入後直達日曆 ──
function isDayApp(){return new URLSearchParams(location.search).get('app')==='dayview';}

// ── 是不是已經在「桌面視窗」裡？＝已安裝的 App，或 ?win=1 開出來的桌面系統視窗。
// 決定設定頁給哪顆鈕：分頁裡給「開啟桌面系統」，桌面視窗裡給「開啟桌面日曆」。──
function isDesktopWin(){
  return isStandalone()||new URLSearchParams(location.search).get('win')==='1';
}

// ── PWA 安裝：攔 beforeinstallprompt 存起來，讓設定頁的「安裝系統到桌面」鈕直接跳原生安裝視窗。
// 事件只在「這個瀏覽器還沒裝過」時才發，所以 .ready 同時當作「還沒裝」的訊號＝鈕才顯示。──
var installPromptEvent=null;
window.addEventListener('beforeinstallprompt',(e)=>{
  e.preventDefault();
  installPromptEvent=e;
  const b=document.querySelector('.dv-installbtn');if(b)b.classList.add('ready');
});
window.addEventListener('appinstalled',()=>{
  installPromptEvent=null;
  const b=document.querySelector('.dv-installbtn');if(b)b.classList.remove('ready');
  if(typeof toast==='function')toast('已安裝到桌面！之後從 Launchpad／Dock 開啟','ok');
});

// ── Page load ──
window.addEventListener('load',()=>{
  if(isDayApp())document.body.classList.add('dv-app'); // manifest 換版＋標題已在 <head> 內處理
  if(isStandalone())document.body.classList.add('dv-standalone'); // 已安裝的 App 視窗：不再顯示安裝鈕
  if(isDesktopWin())document.body.classList.add('dv-deskwin');    // 已在桌面視窗：設定頁改給「開啟桌面日曆」
  initAuth();
  setDateDisplay(currentDate);
  document.getElementById('date-picker').value=toDateStr(currentDate);
});

// ── PWA 獨立視窗模式：popup 開不起來，登入改走整頁 redirect ──
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
}

// ── 登入（Firebase Auth，信箱＋密碼）──
// 2026-07-30 起系統與 Google 完全分家：登入只剩「你是誰」，不經過 Google 也不載入任何 Google API。
// Firebase Auth 的 session 存在 localStorage 且會自動續期，所以「用著用著被踢出去要重登」不會再發生
//（以前那是 Calendar 的 access token 每小時過期造成的）。
// 帳號由管理者在 Firebase Console 建立、走「重設密碼」的信設定密碼，見 mds/新員工加入SOP.md。
function isSignedIn(){try{return !!firebase.auth().currentUser;}catch(_){return false;}}

function initAuth(){
  showL('載入中...');   // 等 Firebase 從 localStorage 還原登入狀態，避免閃一下登入頁
  const em=localStorage.getItem('ghint');
  const ei=document.getElementById('login-email');if(ei&&em)ei.value=em;
  firebase.auth().onAuthStateChanged(async user=>{
    authReady=true;
    if(!user){hideL();showPanel('login');return;}
    await onSignedIn();
  });
}

// Firebase 錯誤碼 → 看得懂的中文
function authErrMsg(e){
  const c=e?.code||'';
  if(c==='auth/invalid-email')return'信箱格式不對';
  if(c==='auth/user-disabled')return'這個帳號已被停用';
  if(c==='auth/user-not-found'||c==='auth/wrong-password'||c==='auth/invalid-credential'||c==='auth/invalid-login-credentials')return'信箱或密碼不對';
  if(c==='auth/too-many-requests')return'嘗試太多次，請稍後再試';
  if(c==='auth/operation-not-allowed')return'Firebase 尚未啟用「電子郵件/密碼」登入方式，請到 Console 開啟';
  if(c==='auth/network-request-failed')return'連不上網路';
  return e?.message||String(e);
}

// 信箱＋密碼登入（登入頁主要路徑）
function signInPassword(){
  const em=(document.getElementById('login-email')?.value||'').trim();
  const pw=document.getElementById('login-pass')?.value||'';
  if(!em||!pw){setLoginErr('請填信箱與密碼');return;}
  setLoginErr('');
  showL('登入中...');
  firebase.auth().signInWithEmailAndPassword(em,pw)
    .then(()=>{localStorage.setItem('ghint',em);})   // 下次自動填信箱
    .catch(e=>{hideL();setLoginErr(authErrMsg(e));});
}

// 設定／重設密碼：寄一封 Firebase 的重設信。
// 原本只用 Google 登入的帳號，走完這封信就會多一組密碼（同一個帳號、同一個 uid），
// 所以「第一次設定密碼」跟「忘記密碼」是同一條路。
function sendResetMail(){
  const em=(document.getElementById('login-email')?.value||'').trim();
  if(!em){setLoginErr('請先填要收信的信箱');return;}
  setLoginErr('');
  showL('寄送中...');
  firebase.auth().sendPasswordResetEmail(em)
    .then(()=>{hideL();toast('設定密碼的信已寄到 '+em+'，點信裡的連結設好密碼再回來登入','ok',true);})
    .catch(e=>{hideL();setLoginErr(authErrMsg(e));});
}

function setLoginErr(msg){
  const el=document.getElementById('login-err');if(!el)return;
  el.textContent=msg||'';el.style.display=msg?'block':'none';
}

function signOut(){
  dayEvents=[];weekEvents=[];makeupList=[];
  driveData={studentList:[],makeupScheduled:[],enrollments:[],coursePrices:[],courseSettings:[],courses:[],teachers:[],absences:[]};
  firebase.auth().signOut();
  ['btn-signout','btn-refresh'].forEach(id=>document.getElementById(id).style.display='none');
  setUSt('','未登入','請輸入帳號密碼登入');
  showPanel('login');
}

async function onSignedIn(){
  hideL();
  const u=firebase.auth().currentUser;
  ['btn-signout','btn-refresh'].forEach(id=>document.getElementById(id).style.display='inline-block');
  setUSt('ok',u?.email||'已登入','已登入');
  if(u?.email)localStorage.setItem('ghint',u.email);
  await loadFromFirestore();
  migrateCoursesToEnrollments();
  showPanel('courses');
  await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  updateWeekTitle();
  if(isDayApp()){showPanel('dayview');renderDayView();} // 桌面視窗：登入後直達日檢視（dayEvents 已由 loadToday 備妥）
}

// ── Firebase / Firestore ──
var firebaseConfig={apiKey:'AIzaSyAmrHOH2HadLeklzvOBfVoy-q9cjM94ywU',authDomain:'hobe-494909.firebaseapp.com',projectId:'hobe-494909',storageBucket:'hobe-494909.firebasestorage.app',messagingSenderId:'729031557572',appId:'1:729031557572:web:e48899ee69102898fca491'};
firebase.initializeApp(firebaseConfig);
var db=firebase.firestore();
var SHARED_DOC=db.collection('sharedData').doc('main');

async function loadFromFirestore(){
  driveData={studentList:[],makeupScheduled:[],enrollments:[],coursePrices:[],courseSettings:[],courses:[],teachers:[],absences:[]};
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
        courseSettings:d.courseSettings||[],
        courses:d.courses||[],           // 系統自有課程（2026-07-04 起）——漏讀會導致新增課程按「更新」後消失
        teachers:d.teachers||[],          // 老師檔（同上）
        absences:d.absences||[],          // 系統請假紀錄（2026-07-17 起）——漏讀會導致請假標記消失、甚至被空陣列蓋掉
        enrollmentsMigratedAt:d.enrollmentsMigratedAt||null,
      };
    }
  }catch(e){
    console.error('loadFromFirestore failed',e);
    const denied=e?.code==='permission-denied'||/permission|denied|unauthor/i.test(e?.message||'');
    if(denied)toast('此帳號未獲授權使用系統（白名單、或信箱尚未完成驗證），請聯繫管理員','err',false);
    else toast('讀取雲端資料失敗：'+(e?.message||e),'err');
  }
}

function scheduleDriveSave(){drivePendingSave=true;clearTimeout(driveSaveTimer);driveSaveTimer=setTimeout(saveToFirestore,1500);}

async function saveToFirestore(){
  try{await SHARED_DOC.set(driveData,{merge:true});drivePendingSave=false;}
  catch(e){console.error('saveToFirestore failed',e);}
}

// ── 導覽（側邊欄 panel 切換）──
function switchPanel(id){
  if(!isSignedIn())return;
  showPanel(id);
  if(id==='courses')Promise.all([loadToday(),loadWeek()]);
  if(id==='dayview')loadToday(); // 共用 dayEvents；載完 loadToday 尾端會 renderDayView
  if(id==='makeup')loadMakeup();
  if(id==='students')renderStudents();
  if(id==='teachers')renderTeacherAdmin();
  if(id==='add')initAddPage();
  if(id==='settings')renderSettings();
}

function showPanel(id){
  currentPanel=id;
  ['courses','dayview','makeup','students','teachers','add','settings','login'].forEach(p=>{
    const el=document.getElementById('panel-'+p);
    if(p==='login')el.classList.toggle('active',p===id);
    else el.style.display=p===id?'block':'none';
  });
  document.querySelectorAll('.ni').forEach(el=>el.classList.remove('active'));
  const nav=document.getElementById('nav-'+id);if(nav)nav.classList.add('active');
  const meta={courses:['課程','今日與本週課程'],dayview:['設定','單日課表檢視'],makeup:['待補課/調課清單','找出需要安排補課或調課的課程'],students:['學生管理','請假、補課、欠課紀錄'],teachers:['老師管理','老師名單：改名、在職/離職、刪除'],add:['新增課程/學生','建檔工作站：直接輸入、送出即清空可連續建檔'],settings:['課程管理','系統課程總覽：類型、老師、單價、需登記成績']};
  const[t,s]=meta[id]||['',''];
  document.getElementById('tbt').textContent=t;
  document.getElementById('tbs').textContent=s;
}

async function refreshCurrent(){
  if(!isSignedIn()){toast('尚未登入','inf');return;}
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
