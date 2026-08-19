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

// ── 桌面視窗模式的 body class：隨時可重算 ──
// ⚠️ Chrome 的「Open in app」是把「現有分頁整個搬進 App 視窗」，頁面不會重新載入。
// 所以只在 load 判斷一次的話，搬進 App 之後設定頁還留著「🖥 開啟桌面系統」，要按 Cmd+R 才會變成
// 「⧉ 開啟桌面日曆」（2026-07-30 老闆踩到）。改成監聽 display-mode 變化 + 拿到焦點時重算。
function applyWinMode(){
  if(!document.body)return;
  document.body.classList.toggle('dv-standalone',isStandalone()); // 已安裝的 App 視窗：不再顯示安裝鈕
  document.body.classList.toggle('dv-deskwin',isDesktopWin());    // 已在桌面視窗：設定頁改給「開啟桌面日曆」
}
try{window.matchMedia('(display-mode: standalone)').addEventListener('change',applyWinMode);}catch(_){}
window.addEventListener('focus',applyWinMode);  // 保險：搬進 App 視窗時那個視窗會拿到焦點
document.addEventListener('visibilitychange',()=>{if(!document.hidden)applyWinMode();});

// ── Page load ──
window.addEventListener('load',()=>{
  if(isDayApp())document.body.classList.add('dv-app'); // manifest 換版＋標題已在 <head> 內處理
  applyWinMode();
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
  // 還有沒寫上去的改動就先送（1.5 秒的 debounce 內按登出會剛好卡在這）；不等它回來
  if(drivePendingSave){clearTimeout(driveSaveTimer);saveToFirestore();}
  dayEvents=[];weekEvents=[];makeupList=[];
  driveData=emptyDriveData();
  driveDirty.clear();drivePendingSave=false;clearTimeout(driveSaveTimer);
  unwatchMain();       // 先斷監聽再登出，免得換帳號還聽著舊連線
  unwatchActivity();
  actEvents=[];actTodos=[];actLoaded=false;actHasNew=false;actPruned=false;updateActivityBadge();
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
  showPanel('courses');
  watchMain();      // 掛上課表那包的即時監聽：別台一改自己就跟上（2026-08-19）
  watchActivity();  // 掛上動態／待辦的即時監聽：側欄待辦數一登入就對，之後同事寫什麼自己浮出來
  await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
  updateWeekTitle();
  if(isDayApp()){showPanel('dayview');renderDayView();} // 桌面視窗：登入後直達日檢視（dayEvents 已由 loadToday 備妥）
}

// ── Firebase / Firestore ──
var firebaseConfig={apiKey:'AIzaSyAmrHOH2HadLeklzvOBfVoy-q9cjM94ywU',authDomain:'hobe-494909.firebaseapp.com',projectId:'hobe-494909',storageBucket:'hobe-494909.firebasestorage.app',messagingSenderId:'729031557572',appId:'1:729031557572:web:e48899ee69102898fca491'};
firebase.initializeApp(firebaseConfig);
var db=firebase.firestore();
var SHARED_DOC=db.collection('sharedData').doc('main');

// 把雲端那份套進 driveData。**跳過 driveDirty 裡的欄位**——那幾欄本機有還沒寫上去的改動，
// 被雲端的舊值蓋掉就等於使用者剛做的事憑空消失。回傳這次真的變動的欄位（沒變就不用重畫）。
// ⚠️ DRIVE_KEYS 少一欄＝那欄永遠讀不到（歷史上 courses/teachers/absences 都各漏過一次，
//    症狀是「新增課程按更新後消失」「請假標記被空陣列蓋掉」）。加新欄位記得同步 state.js。
function applyRemoteMain(d){
  const changed=[];
  DRIVE_KEYS.forEach(k=>{
    if(driveDirty.has(k))return;
    const next=(d&&d[k])||[];
    if(JSON.stringify(next)===JSON.stringify(driveData[k]||[]))return;
    driveData[k]=next;changed.push(k);
  });
  return changed;
}

async function loadFromFirestore(){
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
    if(snap.exists)applyRemoteMain(snap.data());
    else driveData=emptyDriveData();
  }catch(e){
    // ⚠️ 讀失敗時**保留本機既有資料**：以前這裡會先把 driveData 清空再讀，一旦讀失敗
    // 就整份留在空的狀態，下一個動作直接把空陣列寫回雲端＝把所有人的資料清光。
    console.error('loadFromFirestore failed',e);
    const denied=e?.code==='permission-denied'||/permission|denied|unauthor/i.test(e?.message||'');
    if(denied)toast('此帳號未獲授權使用系統（白名單、或信箱尚未完成驗證），請聯繫管理員','err',false);
    else toast('讀取雲端資料失敗（畫面上的資料維持原樣）：'+(e?.message||e),'err');
  }
}

// 呼叫時把改到的欄位名帶上，例如 scheduleDriveSave('absences')。
// 不帶＝保守回退成「整包都算改過」，跟舊行為一樣（漏帶只會多寫，不會漏寫）。
function scheduleDriveSave(...keys){
  (keys.length?keys.flat():DRIVE_KEYS).forEach(k=>driveDirty.add(k));
  drivePendingSave=true;
  clearTimeout(driveSaveTimer);
  driveSaveTimer=setTimeout(saveToFirestore,1500);
}

async function saveToFirestore(){
  if(!driveDirty.size){drivePendingSave=false;return;}
  const sending=[...driveDirty];
  driveDirty.clear();   // 先清：寫的這段時間又改到的欄位要留在集合裡、下一發再送
  const payload={};
  sending.forEach(k=>{payload[k]=driveData[k]||[];});
  try{
    await SHARED_DOC.set(payload,{merge:true});
    drivePendingSave=driveDirty.size>0;
  }catch(e){
    console.error('saveToFirestore failed',e);
    sending.forEach(k=>driveDirty.add(k));   // 還回去，不然這批改動就這樣無聲消失
    drivePendingSave=true;
    toast('存到雲端失敗，改動只在這台裝置上：'+(e?.message||e),'err',true);
  }
}

// ── 別台改了就跟上（sharedData/main 的即時監聽，2026-08-19）──
// 以前這份資料只有登入與按 ↻ 時抄一次，中間別台做的事完全看不到；配上「整包寫回」
// 就會互相蓋掉。動態／待辦（sharedData/activity）早就走 onSnapshot，這裡補上同一套。
function watchMain(){
  if(!isSignedIn()||mainUnsub)return;
  try{
    mainUnsub=SHARED_DOC.onSnapshot(snap=>{
      if(!snap.exists)return;
      // 自己剛寫出去、伺服器還沒確認的那一發回音：資料就是本機這份，不用理
      if(snap.metadata.hasPendingWrites)return;
      onMainRemote(snap.data());
    },err=>{
      console.error('main onSnapshot failed',err);
      mainUnsub=null;   // 監聽掉了就退回舊行為（按 ↻ 更新），不影響其他功能
    });
  }catch(e){console.error('watchMain failed',e);}
}
function unwatchMain(){
  if(mainUnsub){try{mainUnsub();}catch(_){}mainUnsub=null;}
  clearInterval(mainRepaintTimer);mainRepaintTimer=null;mainRepaintPending=false;
}

// 畫面上是不是正在編輯？是的話先別重畫，不然打到一半的表單／點名面板會被抽掉。
function isEditingNow(){
  if(currentPanel==='add')return true;                       // 建檔工作站：整頁都是打字中的表單
  if(document.querySelector('.stu-modal-wrap.open'))return true; // 學生／課程／價格／確認視窗
  if(document.querySelector('#sp-modal.open'))return true;   // 排補課選時段
  if(document.querySelector('#week-modal.open'))return true;  // 週視圖課堂視窗
  if(document.querySelector('.abs-panel.open'))return true;   // 卡內的請假／調課／點名／成績面板
  if(document.querySelector('#lo.open'))return true;          // 有別的載入正在跑，等它
  return false;
}

async function onMainRemote(d){
  const changed=applyRemoteMain(d);
  if(!changed.length)return;
  if(changed.includes('makeupScheduled'))rebuildMakeupMatchMap();
  if(isEditingNow()){
    // 正在編輯 → 資料已經進 driveData 了（安全的，dirty 欄位不會被動到），只是先不重畫。
    // 用輪詢等它關掉：關閉的路徑太多，逐個掛 hook 遲早漏一個。
    if(!mainRepaintPending){
      mainRepaintPending=true;
      toast('別台更新了：'+changed.map(k=>DRIVE_LABEL[k]||k).join('、')+'（關掉目前的視窗後會自動更新）','inf');
      clearInterval(mainRepaintTimer);
      mainRepaintTimer=setInterval(()=>{
        if(isEditingNow())return;
        clearInterval(mainRepaintTimer);mainRepaintTimer=null;
        repaintFromRemote();
      },1500);
    }
    return;
  }
  toast('別台更新了：'+changed.map(k=>DRIVE_LABEL[k]||k).join('、'),'inf');
  await repaintFromRemote();
}

// 重畫目前這頁（不顯示載入遮罩——這是背景同步，不該蓋住使用者的畫面）
async function repaintFromRemote(){
  mainRepaintPending=false;
  try{
    await loadMakeup(true);   // 側欄待補課數不管在哪一頁都要對
    if(currentPanel==='courses')await Promise.all([loadToday(true),loadWeek()]);
    else if(currentPanel==='dayview')await loadToday(true);   // loadToday 尾端會 renderDayView
    else if(currentPanel==='makeup'){populateMkFilters();renderMakeup();}
    else if(currentPanel==='students')renderStudents();
    else if(currentPanel==='teachers')renderTeacherAdmin();
    else if(currentPanel==='settings')renderSettings();
  }catch(e){console.error('repaintFromRemote failed',e);}
}

// ── 導覽（側邊欄 panel 切換）──
function switchPanel(id){
  if(!isSignedIn())return;
  showPanel(id);
  if(id==='courses')Promise.all([loadToday(),loadWeek()]);
  if(id==='dayview')loadToday(); // 共用 dayEvents；載完 loadToday 尾端會 renderDayView
  if(id==='makeup')loadMakeup();
  // 動態／待辦靠 onSnapshot 一直是最新的，切進來只要畫＋把「有新動態」的圓點收掉；
  // 監聽沒掛上（斷線／權限）才退回一次性讀取
  if(id==='activity'){actMarkSeen();renderActivity();if(!actUnsub)watchActivity();}
  if(id==='students')renderStudents();
  if(id==='teachers')renderTeacherAdmin();
  if(id==='add')initAddPage();
  if(id==='settings')renderSettings();
}

function showPanel(id){
  currentPanel=id;
  ['courses','dayview','makeup','students','teachers','add','settings','activity','login'].forEach(p=>{
    const el=document.getElementById('panel-'+p);
    if(p==='login')el.classList.toggle('active',p===id);
    else el.style.display=p===id?'block':'none';
  });
  document.querySelectorAll('.ni').forEach(el=>el.classList.remove('active'));
  const nav=document.getElementById('nav-'+id);if(nav)nav.classList.add('active');
  const meta={courses:['課程','今日與本週課程'],dayview:['設定','單日課表檢視'],makeup:['待補課/調課清單','找出需要安排補課或調課的課程'],students:['學生管理','請假、補課、欠課紀錄'],teachers:['老師管理','老師名單：改名、在職/離職、刪除'],add:['新增課程/學生','建檔工作站：直接輸入、送出即清空可連續建檔'],settings:['課程管理','系統課程總覽：類型、老師、單價、需登記成績'],activity:['動態與待辦','系統發生了什麼事＋全員共用的待辦清單']};
  const[t,s]=meta[id]||['',''];
  document.getElementById('tbt').textContent=t;
  document.getElementById('tbs').textContent=s;
}

async function refreshCurrent(){
  if(!isSignedIn()){toast('尚未登入','inf');return;}
  showL('更新中…');
  try{
    if(drivePendingSave){clearTimeout(driveSaveTimer);await saveToFirestore();} // 先把本機待存改動寫上去，避免被雲端舊值蓋掉
    await loadFromFirestore();                       // 三頁都先重讀雲端最新（學生／修課／補課）
    if(!mainUnsub)watchMain();                       // 監聽斷過（斷網／權限）就趁這次重新掛上
    if(currentPanel==='courses')await Promise.all([loadToday(),loadWeek()]);
    else if(currentPanel==='makeup'){await loadMakeup(true);populateMkFilters();renderMakeup();}
    else if(currentPanel==='students')renderStudents();
    else if(currentPanel==='activity'){if(!actUnsub)await loadActivity();renderActivity();}   // 有監聽就已經是最新的
    hideL();toast('已更新','ok');
  }catch(e){
    hideL();toast('更新失敗：'+(e?.message||e),'err');
  }
}
