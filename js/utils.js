// UI helpers + 格式化 + 日期切換
// const 在跨 script 不共用，arrow function 改成 function 宣告（會掛到 window）

// ── 格式化 ──
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function typeLbl(t){return t==='one'?'一對一':t==='pair'?'一對二':t==='practice'?'練習課':'團班';}
// 標題判成「家教一對一」但備註卻有 ≥2 位學生 → 標題八成寫錯（一對一不該有兩人）。回傳警告 chip
function typeMismatchChip(e){
  if(e.courseId!=null)return''; // 系統課類型是明確設定的，不做「標題猜型」警告
  if(e.type!=='one'||(e.students?.length||0)<2)return'';
  return`<span class="tpill" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5" title="標題判為「家教一對一」，但備註有 ${e.students.length} 位學生。若是一對二請把標題寫成「○、○家教」，團班請用「○○班」">⚠ 標題/人數不符</span>`;
}
function fmtT(d){return d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');}
function fmtD(d){const W=['日','一','二','三','四','五','六'];return`${d.getMonth()+1}/${d.getDate()}（${W[d.getDay()]}）`;}
function fmtDT(d){return`${d.getMonth()+1}/${d.getDate()} ${fmtT(d)}`;}
function fmtDur(m){const h=Math.floor(m/60),r=m%60;return h>0?(r>0?`${h}小時${r}分`:`${h}小時`):`${r}分鐘`;}
function toDateStr(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}

// ── Enter 鍵：中文選字那一下不算「送出」（2026-07-31）──
// 注音／拼音選完字按 Enter 是「確認選字」，瀏覽器照樣送出 keydown，
// 直接聽 key==='Enter' 會把字送出去當表單確認。組字中的那一下 isComposing=true
// （舊版 WebKit 只給 keyCode 229），兩個都擋掉才乾淨。
function isEnterKey(e){return e&&e.key==='Enter'&&!e.isComposing&&e.keyCode!==229;}
// 這一下 Enter 是「中文選字」（輸入法組字中）
function isComposingEnter(e){return e&&e.key==='Enter'&&(e.isComposing||e.keyCode===229);}

// ── 兩段式 Enter（2026-07-31 老闆要求）──
// 規則：不管中文英數，**總共按兩次 Enter 才送出**。
//   英數：第一下待命 → 第二下送出
//   中文：選字那一下就算第一下（輸入法照樣收字，我們不攔）→ 第二下送出
// 待命 4 秒內有效，繼續打字／點別處／換欄位都取消。
// 待命時**不給任何畫面提示**（2026-07-31 老闆要求拿掉氣泡，嫌吵）。
// 回傳 true＝這一下是「確認送出」，呼叫端才動作；輸入框的 onkeydown 一律 if(enterSubmit(event)){…}
var _enterArm={el:null,t:0,timer:null};
function enterSubmit(e,el){
  if(!e||e.key!=='Enter')return false;
  const node=el||e.target;
  // 選字那一下：不 preventDefault（攔了輸入法會收不了字），只把它當第一段待命
  if(isComposingEnter(e)){enterArm(node);return false;}
  e.preventDefault();                       // 真正的 Enter：兩段都吃掉預設行為（避免換行／送表單）
  if(_enterArm.el===node&&Date.now()-_enterArm.t<4000){enterDisarm();return true;}
  enterArm(node);
  return false;
}
function enterArm(node){
  enterDisarm();
  _enterArm={el:node,t:Date.now(),timer:setTimeout(enterDisarm,4000)};
}
function enterDisarm(){
  if(_enterArm.timer)clearTimeout(_enterArm.timer);
  _enterArm={el:null,t:0,timer:null};
}
// 繼續打字／點別處／離開欄位 → 待命取消（避免「上一個 Enter」隔很久還算數）
document.addEventListener('keydown',e=>{if(_enterArm.el&&e.key!=='Enter'&&e.key!=='Escape')enterDisarm();},true);
document.addEventListener('pointerdown',()=>{if(_enterArm.el)enterDisarm();},true);
document.addEventListener('focusout',e=>{if(_enterArm.el&&e.target===_enterArm.el)enterDisarm();},true);

// ── 練習課科目分類（2026-07-31 老闆定）──
// 「數學＋理化」都練＝一種類別「數理」，不是兩科；其餘科目照原樣列（數學＋理化＋英文＝「數理、英文」）。
// 只動顯示與分組，enrollment 存的仍是原本的「數學、理化」兩個標籤（chip 照舊點選、要改回來不用動資料）。
function pracSubjSplit(s){return String(s||'').split(/[、,，]/).map(x=>x.trim()).filter(Boolean);}
function pracSubjCats(subjects){
  const list=[...new Set(Array.isArray(subjects)?subjects.map(x=>String(x||'').trim()).filter(Boolean):pracSubjSplit(subjects))];
  if(!(list.includes('數學')&&list.includes('理化')))return list;
  return['數理',...list.filter(s=>s!=='數學'&&s!=='理化')];
}
function pracSubjLabel(subjects){return pracSubjCats(subjects).join('、');}

// ── 載入指示 / Toast / 錯誤橫條 ──
function setUSt(s,n,sub){document.getElementById('udot').className='udot'+(s==='ok'?' ok':s==='busy'?' busy':'');document.getElementById('uname').textContent=n;document.getElementById('usub').textContent=sub;}
function showErr(panel,msg){const el=document.getElementById('err-'+panel);if(el){el.textContent='⚠ '+msg;el.style.display='block';}}
function hideErr(panel){const el=document.getElementById('err-'+panel);if(el)el.style.display='none';}
function showL(m){document.getElementById('lo-txt').textContent=m||'載入中...';document.getElementById('lo').classList.add('open');}
function hideL(){document.getElementById('lo').classList.remove('open');}
// sticky＝重要訊息不自動收（要使用者看到才走），其餘 4 秒自動消失
function toast(m,t,sticky){
  const el=document.getElementById('toast');
  el.className='toast t'+t;
  el.textContent=(t==='ok'?'✓ ':t==='err'?'✕ ':'ℹ ')+m;
  el.style.display='block';
  clearTimeout(el._t);
  if(!sticky)el._t=setTimeout(()=>el.style.display='none',4000);
}

// ── 確認視窗（系統自己的，取代瀏覽器原生 confirm）──
// 原生 confirm 會被瀏覽器畫成「localhost:8080 says」那種系統警示，看起來像系統外的東西，
// 而且只能吐純文字。這個長得跟其他視窗一樣，可以排版、可以標紅（危險操作）。
// 用法：if(!await uiConfirm({title:'退掉這門課？',html:'…',ok:'退掉',danger:true}))return;
//      呼叫端的資料記得自己 esc()（html 是原樣塞進去的）
var _askResolve=null;
function uiConfirm(o){
  o=o||{};
  return new Promise(res=>{
    const wrap=document.getElementById('ask-modal-wrap');
    if(!wrap){res(window.confirm(o.title||'確定要執行嗎？'));return;} // 保底：視窗不在就退回原生
    document.getElementById('ask-modal-title').textContent=o.title||'確認';
    document.getElementById('ask-modal-body').innerHTML=o.html||'';
    const ok=document.getElementById('ask-modal-ok');
    ok.textContent=o.ok||'確定';
    ok.className='btn btns '+(o.danger?'btn-danger':'btnp');
    document.getElementById('ask-modal-cancel').textContent=o.cancel||'取消';
    _askResolve=res;
    wrap.classList.add('open');
    setTimeout(()=>ok.focus(),30);
  });
}
function askClose(v){
  const wrap=document.getElementById('ask-modal-wrap');if(!wrap)return;
  wrap.classList.remove('open');
  const r=_askResolve;_askResolve=null;
  if(r)r(!!v);
}
// Enter＝照做、Esc＝取消（跟原生 confirm 的手感一樣）
window.addEventListener('keydown',e=>{
  if(!_askResolve)return;
  if(e.key==='Escape'){e.preventDefault();askClose(false);}
  else if(isEnterKey(e)){e.preventDefault();askClose(true);}
});

// ── 日期切換 ──
function changeDay(d){currentDate=new Date(currentDate.getTime()+d*864e5);setDateDisplay(currentDate);document.getElementById('date-picker').value=toDateStr(currentDate);if(isSignedIn())Promise.all([loadToday(),loadWeek()]);}
function goToday(){currentDate=new Date();setDateDisplay(currentDate);document.getElementById('date-picker').value=toDateStr(currentDate);if(isSignedIn())Promise.all([loadToday(),loadWeek()]);}
function pickDate(val){if(!val)return;const[y,m,d]=val.split('-').map(Number);currentDate=new Date(y,m-1,d);setDateDisplay(currentDate);if(isSignedIn())Promise.all([loadToday(),loadWeek()]);}
function setDateDisplay(d){
  const W=['日','一','二','三','四','五','六'];
  const today=new Date();today.setHours(0,0,0,0);
  const cd=new Date(d);cd.setHours(0,0,0,0);
  const diff=Math.round((cd-today)/864e5);
  const lbl=diff===0?'  今天':diff===1?'  明天':diff===-1?'  昨天':'';
  document.getElementById('date-title').textContent=`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${W[d.getDay()]}）${lbl}`;
}
