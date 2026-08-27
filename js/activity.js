// 動態頁：共用待辦板 + 系統事件流（2026-08-03）
//
// 兩件事共用一份 Firestore 文件 sharedData/activity（rules 的 sharedData/{docId} 白名單已涵蓋，不用改 rules）：
//   events[] — 系統自動記的事件，只增不改，寫入一律用 arrayUnion（多人同時操作不會互相蓋掉）
//   todos[]  — 員工自己寫的待辦，共用清單＋可認領（2026-08-03 老闆定案）
//   reminders[] — 今日重點的手寫提醒（2026-08-11 加，程式在 js/remind.js，讀取搭這裡的監聽便車）
//   mkNotes[]   — 待補課卡的處理進度留言（2026-08-12 加，程式在 js/makeup.js，同樣搭便車）
//
// ⚠️ 事件流只記「從上線那天起發生的事」，舊資料補不回來。
// ⚠️ 保留 ACT_KEEP_DAYS 天，過期的在載入時用 arrayRemove 清掉（避免撞 Firestore 單文件 1MB 上限）。
//    刻意用 arrayRemove 而不是整份覆寫——覆寫會把別人同一秒 arrayUnion 進來的事件洗掉。

var ACT_KEEP_DAYS=60;
var actEvents=[];   // 已依時間由舊到新排序
var actTodos=[];
var actLoaded=false;
var actState={filter:'all',showDone:false,draft:'',adding:false,
  progFor:null,progDraft:'',progAll:null,   // 正在加進度的那則／輸入內容／展開全部進度的那則
  dayOpen:{}};                              // 系統動態按天收合：日期字串 → 手動點過的展開狀態
var actUnsub=null;        // onSnapshot 的取消訂閱函式（登出時要叫，不然換帳號還在聽舊資料）
var actPruned=false;      // 過期事件一個 session 只清一次（每次 snapshot 都清會白白多寫）
var actHasNew=false;      // 不在動態頁時，別人做了事 → 側欄長一個小圓點
var actRenderPending=false;

// 登入信箱 → 顯示名。查無就用信箱 @ 前面那段（新同事不改這裡也不會壞）
var STAFF_NAMES={
  'william90525@gmail.com':'William',
  'hobemath@gmail.com':'HOBE',
  'derek74123@gmail.com':'Derek',
  'a0910605275@gmail.com':'文文',
};
function actMe(){try{return firebase.auth().currentUser?.email||'';}catch(_){return'';}}
function actName(email){const e=email||actMe();return STAFF_NAMES[e]||String(e||'').split('@')[0]||'某人';}
// 顯示署名一律拿信箱**現查**，紀錄裡抄的名字只當備胎（給沒存 by 的舊資料）。
// 每筆動態／待辦／提醒／進度在寫入當下就抄了一份顯示名，改 STAFF_NAMES 不會回溯——
// 2026-08-24 老闆踩到：對照表補上「文文」之後，他同一天稍早記的動態還掛著 a0910605275。
// 現查的話整條歷史一起換過來，同一個人不會在同一頁上有兩個名字。
function actWho(by,snapName){return by?actName(by):(String(snapName||'').trim()||'某人');}
// db 在 init.js 才建起來（載入順序最後），所以不能在檔案頂層取 doc，包成函式延後求值
function actDoc(){return db.collection('sharedData').doc('activity');}
function actNewId(){return Date.now()+'-'+Math.random().toString(36).slice(2,7);}

// ── 記一筆事件 ──
// kind：absence（請假曠課）/ makeup（補課調課）/ roster（名單加退）/ course（課程異動）/ student（學生檔）
// text＝主句、target＝對象（哪堂課／哪個學生）、detail＝補充說明
// 記錄失敗一律只 console 警告，絕不打斷主流程——動態少記一行，總比請假標不成好。
// 回傳寫出去的那一筆（沒記成則回 null）——復原時要拿它去 arrayRemove，見 actRemoveEvent。
// 既有呼叫端都不理回傳值，加這個不影響任何一處。
function logAct(kind,text,target,detail){
  const email=actMe();
  if(!email)return null;
  const rec={id:actNewId(),ts:new Date().toISOString(),by:email,byName:actName(email),
    kind:kind||'other',text:String(text||''),target:String(target||''),detail:String(detail||'')};
  actEvents.push(rec);
  try{
    actDoc().set({events:firebase.firestore.FieldValue.arrayUnion(rec)},{merge:true})
      .catch(e=>console.warn('logAct failed',e));
  }catch(e){console.warn('logAct failed',e);}
  if(currentPanel==='activity')renderActivity();
  return rec;
}

// ── 撤掉一筆已經寫出去的動態（js/undo.js 復原時呼叫）──
// ⚠️ arrayRemove 是「整筆完全相同才刪得掉」，所以傳進來的必須是 logAct 當初回傳的那一筆
//    本尊，不能是重新拼出來、欄位順序或內容差一點的複製品。
// 刻意用 arrayRemove 而不是整份覆寫，理由跟過期清理那段一樣：覆寫會把別人同一秒
// arrayUnion 進來的事件洗掉。
function actRemoveEvent(rec){
  if(!rec||!rec.id)return;
  const i=actEvents.findIndex(e=>e&&e.id===rec.id);
  if(i>=0)actEvents.splice(i,1);
  try{
    actDoc().update({events:firebase.firestore.FieldValue.arrayRemove(rec)})
      .catch(e=>console.warn('[undo] 動態撤不掉（資料已還原，只是動態上那行還在）',e));
  }catch(e){console.warn('[undo] 動態撤不掉',e);}
  if(currentPanel==='activity')renderActivity();
}

// 課堂物件 → 動態裡的對象字串（8/5（二）17:30 大教室 國一數學）
function actEvLabel(ev){
  if(!ev)return'';
  const d=ev.startDt?new Date(ev.startDt):null;
  const when=d?`${fmtD(d)} ${fmtT(d)}`:'';
  return[when,ev.room||'',ev.origTitle||ev.title||''].filter(Boolean).join(' ');
}

// ── 讀取：即時監聽（2026-08-03）──
// 走 onSnapshot 而不是「切進分頁才重讀」：待辦是三個人共用的，別人剛寫的那一行要自己浮出來，
// 不然「按了更新才看到」等於還是要人記得按。這份文件很輕（只有 events/todos 兩個陣列），
// 掛一條長連線的成本遠低於每次切分頁重抓一次。
function watchActivity(){
  if(!isSignedIn()||actUnsub)return;
  try{
    actUnsub=actDoc().onSnapshot(
      snap=>actApplySnap(snap.exists?(snap.data()||{}):{}),
      err=>{
        console.warn('watchActivity failed',err);
        actUnsub=null;
        loadActivity();   // 監聽掛掉就退回一次性讀取，至少畫面上有東西
      });
  }catch(e){console.warn('watchActivity failed',e);loadActivity();}
}
function unwatchActivity(){if(actUnsub){try{actUnsub();}catch(_){}actUnsub=null;}}

// 一次性讀取（監聽掛掉時的備援）
async function loadActivity(){
  if(!isSignedIn())return;
  try{
    const snap=await actDoc().get();
    actApplySnap(snap.exists?(snap.data()||{}):{});
  }catch(e){
    console.warn('loadActivity failed',e);
    actLoaded=true;   // 讀失敗也要讓畫面跑出空狀態，不要卡在「載入中」
    updateActivityBadge();
  }
}

// 雲端資料 → 本機狀態 → 重畫。監聽與一次性讀取共用這一支。
function actApplySnap(d){
  const seen=new Set(actEvents.map(e=>e.id));
  const wasLoaded=actLoaded;
  const all=(Array.isArray(d.events)?d.events:[]).filter(e=>e&&e.ts);
  const cut=Date.now()-ACT_KEEP_DAYS*864e5;
  const stale=all.filter(e=>new Date(e.ts).getTime()<cut);
  actEvents=all.filter(e=>new Date(e.ts).getTime()>=cut).sort((a,b)=>a.ts<b.ts?-1:a.ts>b.ts?1:0);
  actTodos=(Array.isArray(d.todos)?d.todos:[]).filter(Boolean);
  actLoaded=true;
  // 今日重點的手寫提醒住在同一份文件（reminders[]）→ 搭同一條監聽的便車，不另開連線
  if(typeof rmdApplySnap==='function')rmdApplySnap(d);
  // 待補課卡的處理進度也住這裡（mkNotes[]，程式在 js/makeup.js）→ 同一條監聽
  if(typeof mkNotesApplySnap==='function')mkNotesApplySnap(d);
  // 別人做的事、而且我人不在動態頁 → 側欄留個小圓點。自己剛做的不算（自己知道自己做了什麼）
  if(wasLoaded&&currentPanel!=='activity'
     &&actEvents.some(e=>!seen.has(e.id)&&e.by!==actMe()))actHasNew=true;
  updateActivityBadge();
  renderActivityRemote();
  // 過期的清掉（一次最多 200 筆，剩下的下個 session 再清）
  if(stale.length&&!actPruned){
    actPruned=true;
    actDoc().update({events:firebase.firestore.FieldValue.arrayRemove(...stale.slice(0,200))}).catch(()=>{});
  }
}

function updateActivityBadge(){
  document.getElementById('nav-activity')?.classList.toggle('has-new',actHasNew);
  const b=document.getElementById('badge-activity');if(!b)return;
  const n=actTodos.filter(t=>!t.done).length;
  b.textContent=n;b.style.display=n>0?'inline':'none';
}

// 進到動態頁＝看過了，小圓點收掉
function actMarkSeen(){actHasNew=false;updateActivityBadge();}

// ── 待辦寫入 ──
// 新增走 arrayUnion（原子加，不會蓋掉別人同時新增的）。
// 認領／完成／刪除要改既有那筆，只能整份寫回 → 先重讀雲端最新再套改動，把互蓋的窗口壓到最小。
async function actTodoMutate(mut){
  let list=actTodos;
  try{
    const snap=await actDoc().get();
    if(snap.exists&&Array.isArray(snap.data().todos))list=snap.data().todos.filter(Boolean);
  }catch(_){}
  const next=mut(list.map(t=>({...t})));
  if(!next)return;
  actTodos=next;
  renderActivity();updateActivityBadge();
  try{await actDoc().set({todos:next},{merge:true});}
  catch(e){toast('待辦沒存上雲端：'+(e?.message||e),'err');}
}

function actDraft(v){actState.draft=v;}
function actToggleAdd(){
  actState.adding=!actState.adding;
  renderActivity();
  if(actState.adding)requestAnimationFrame(()=>document.getElementById('act-todo-input')?.focus());
}

async function actTodoAdd(){
  const text=(actState.draft||'').trim();
  if(!text)return toast('待辦內容不能是空的','err');
  const email=actMe();
  const rec={id:actNewId(),text,by:email,byName:actName(email),createdAt:new Date().toISOString(),
    claimedBy:null,claimedName:'',claimedAt:null,done:false,doneBy:null,doneName:'',doneAt:null};
  actTodos=[...actTodos,rec];
  actState.draft='';
  renderActivity();updateActivityBadge();
  requestAnimationFrame(()=>document.getElementById('act-todo-input')?.focus());   // 連續輸入下一筆
  try{await actDoc().set({todos:firebase.firestore.FieldValue.arrayUnion(rec)},{merge:true});}
  catch(e){toast('待辦沒存上雲端：'+(e?.message||e),'err');}
}

// ── 狀態（2026-08-03 老闆定：進度串＋三段狀態）──
// 舊待辦沒有 status 欄位 → 由「打勾了沒／有沒有人認領」推導，不用轉檔也不會壞。
// 完成沿用既有的 done:true（不塞進 status），這樣「取消完成」才回得到原本那一段。
var ACT_ST={open:'待處理',doing:'處理中',waiting:'等回覆',done:'完成'};
function todoStatus(t){
  if(!t)return'open';
  if(t.done)return'done';
  if(t.status==='doing'||t.status==='waiting'||t.status==='open')return t.status;
  return t.claimedBy?'doing':'open';
}

// 認領／放掉：已經是自己認領的再按一次＝放掉，讓別人接手
// 認領＝我在推它 → 一律進「處理中」；放掉時「等回覆」保持不動（卡在外部跟誰認領無關）
function actTodoClaim(id){
  const email=actMe();
  actTodoMutate(list=>list.map(t=>{
    if(t.id!==id)return t;
    if(t.claimedBy===email)return{...t,claimedBy:null,claimedName:'',claimedAt:null,
      status:todoStatus(t)==='waiting'?'waiting':'open'};
    return{...t,claimedBy:email,claimedName:actName(email),claimedAt:new Date().toISOString(),status:'doing'};
  }));
}

// 「等回覆」是 toggle：已經是等回覆就切回處理中
function actTodoSetStatus(id,st){
  actTodoMutate(list=>list.map(t=>
    t.id!==id?t:{...t,status:todoStatus(t)===st?'doing':st}));
}

// ── 進度串：接力的關鍵，下一個人靠這個知道前面做到哪 ──
function actProgOpen(id){
  actState.progFor=actState.progFor===id?null:id;
  actState.progDraft='';
  renderActivity();
  if(actState.progFor)requestAnimationFrame(()=>document.getElementById('act-prog-input')?.focus());
}
function actProgDraft(v){actState.progDraft=v;}
function actProgAll(id){actState.progAll=actState.progAll===id?null:id;renderActivity();}

function actTodoProgAdd(id){
  const text=(actState.progDraft||'').trim();
  if(!text)return toast('進度內容不能是空的','err');
  const email=actMe();
  const rec={id:actNewId(),text,by:email,byName:actName(email),at:new Date().toISOString()};
  actState.progDraft='';actState.progFor=null;
  actTodoMutate(list=>list.map(t=>{
    if(t.id!==id)return t;
    // 寫進度＝正在推它，「待處理」自動往前進一段；「等回覆」是刻意標的，不動它
    const st=todoStatus(t);
    return{...t,progress:[...(t.progress||[]),rec],status:st==='open'?'doing':(st==='done'?t.status:st)};
  }));
}

function actTodoDone(id){
  const email=actMe();
  actTodoMutate(list=>list.map(t=>{
    if(t.id!==id)return t;
    if(t.done)return{...t,done:false,doneBy:null,doneName:'',doneAt:null};
    return{...t,done:true,doneBy:email,doneName:actName(email),doneAt:new Date().toISOString()};
  }));
}

async function actTodoDelete(id){
  const t=actTodos.find(x=>x.id===id);if(!t)return;
  const ok=await uiConfirm({title:'刪掉這則待辦？',ok:'刪掉',danger:true,
    html:`<p class="ask-big">${esc(t.text)}</p><div class="ask-note ask-warn">刪掉之後救不回來。做完的話建議用打勾，紀錄會留著。</div>`});
  if(!ok)return;
  actTodoMutate(list=>list.filter(x=>x.id!==id));
}

function actToggleDone(){actState.showDone=!actState.showDone;renderActivity();}
function actSetFilter(f){actState.filter=f;renderActivity();}

// ── 畫面 ──
var ACT_KINDS=[
  {id:'all',label:'全部'},
  {id:'absence',label:'請假曠課'},
  {id:'makeup',label:'補課調課'},
  {id:'roster',label:'名單加退'},
  {id:'course',label:'課程異動'},
  {id:'student',label:'學生老師'},
];

// 相對日期標題：今天 / 昨天 / 8/1（五）
function actDayLabel(d){
  const t=new Date();t.setHours(0,0,0,0);
  const x=new Date(d);x.setHours(0,0,0,0);
  const diff=Math.round((x-t)/864e5);
  const base=fmtD(new Date(d));
  return diff===0?`今天 ${base}`:diff===-1?`昨天 ${base}`:base;
}

function renderActivity(){
  const el=document.getElementById('act-wrap');if(!el)return;
  actRenderPending=false;
  el.innerHTML=actTodoHtml()+actFeedHtml();
}

// 遠端推播進來的重畫。整塊 innerHTML 換掉會把游標踢走、中文選字會被打斷，
// 所以正在打字時先擱著，等游標離開輸入框再補畫（同事那邊寫了什麼不急這一秒）。
// 這個分頁裡的哪個輸入框正在被用（新增待辦、加進度都算）
function actTypingEl(){
  const a=document.activeElement;
  if(!a||!/^(INPUT|TEXTAREA)$/.test(a.tagName))return null;
  return document.getElementById('act-wrap')?.contains(a)?a:null;
}
function renderActivityRemote(){
  if(actTypingEl()){actRenderPending=true;return;}
  renderActivity();
}
document.addEventListener('focusout',e=>{
  if(!actRenderPending)return;
  const el=e.target;
  if(el&&/^(INPUT|TEXTAREA)$/.test(el.tagName)&&document.getElementById('act-wrap')?.contains(el))
    setTimeout(()=>{if(!actTypingEl())renderActivity();},0);   // 從一個框跳到另一個框就先別畫
},true);

function actTodoHtml(){
  const open=actTodos.filter(t=>!t.done);
  const done=actTodos.filter(t=>t.done).sort((a,b)=>(b.doneAt||'')<(a.doneAt||'')?-1:1);
  const rows=open.length
    ? open.map(actTodoRow).join('')
    : `<div class="act-empty">目前沒有待辦。有事情要交接、要提醒同事，就按上面「＋ 新增待辦」寫一行。</div>`;
  return`
  <div class="set-card">
    <div class="sec-hd">待辦${open.length?`（${open.length}）`:''}<span class="sec-hd-line"></span>
      <button class="btn btns ${actState.adding?'':'btnp'}" style="flex-shrink:0" onclick="actToggleAdd()">${actState.adding?'收起':'＋ 新增待辦'}</button>
    </div>
    <p class="set-card-sub">所有員工共用一張清單。誰都可以寫，看到自己要處理的就按「我來處理」把名字掛上（同一件事不會兩個人一起做）。做到一半按「＋ 加進度」寫一行交代做到哪，下一個人接手就看得懂；卡在等家長回覆就按「等回覆」。做完打勾，收在下面、紀錄留著。</p>
    ${actState.adding?`
    <div class="act-add">
      <input id="act-todo-input" class="act-add-inp" value="${esc(actState.draft)}" placeholder="例：小明媽媽說要換時段，記得回電"
        oninput="actDraft(this.value)" onkeydown="if(enterSubmit(event))actTodoAdd()">
      <button class="btn btns btnp" onclick="actTodoAdd()">加進待辦</button>
    </div>
    <div class="act-add-hint">按兩次 Enter 也可以送出；送出後欄位清空，可以連著寫下一則。</div>`:''}
    <div class="act-todos">${rows}</div>
    ${done.length?`
    <button class="act-done-toggle" onclick="actToggleDone()">${actState.showDone?'▾':'▸'} 已完成（${done.length}）</button>
    ${actState.showDone?`<div class="act-todos act-todos-done">${done.map(actTodoRow).join('')}</div>`:''}`:''}
  </div>`;
}

// 進度串：預設只露最後 2 筆（一則跑久了會很長），點「前面還有 N 筆」展開全部
function actProgHtml(t){
  const all=(t.progress||[]).slice().sort((a,b)=>(a.at||'')<(b.at||'')?-1:1);
  if(!all.length)return'';
  const expanded=actState.progAll===t.id;
  const show=(expanded||all.length<=3)?all:all.slice(-2);
  const hidden=all.length-show.length;
  const items=show.map(p=>`
    <div class="act-prog-item">
      <div class="act-prog-meta">${fmtDT(new Date(p.at))} <b>${esc(actWho(p.by,p.byName))}</b></div>
      <div class="act-prog-text">${esc(p.text)}</div>
    </div>`).join('');
  return`<div class="act-prog">
    ${hidden>0?`<button class="act-prog-more" onclick="actProgAll('${esc(t.id)}')">▸ 前面還有 ${hidden} 筆</button>`:''}
    ${expanded&&all.length>3?`<button class="act-prog-more" onclick="actProgAll('${esc(t.id)}')">▾ 收合</button>`:''}
    ${items}
  </div>`;
}

function actTodoRow(t){
  const me=actMe();
  const st=todoStatus(t);
  const mine=t.claimedBy&&t.claimedBy===me;
  const claim=t.done?''
    :t.claimedBy
      ?`<button class="act-claim ${mine?'mine':'taken'}" onclick="actTodoClaim('${esc(t.id)}')" title="${mine?'再按一次＝放掉，讓別人接手':'已有人認領，按了會改掛你'}">${esc(actWho(t.claimedBy,t.claimedName||'有人'))} 處理中</button>`
      :`<button class="act-claim" onclick="actTodoClaim('${esc(t.id)}')">我來處理</button>`;
  const meta=t.done
    ?`${esc(actWho(t.by,t.byName))} 寫於 ${fmtD(new Date(t.createdAt))} · <b>${esc(actWho(t.doneBy,t.doneName))}</b> 於 ${fmtD(new Date(t.doneAt||t.createdAt))} 完成`
    :`${esc(actWho(t.by,t.byName))} 寫於 ${fmtD(new Date(t.createdAt))}`;
  const acts=t.done?'':`
    <button class="act-prog-btn" onclick="actProgOpen('${esc(t.id)}')">${actState.progFor===t.id?'收起':'＋ 加進度'}</button>
    ${claim}
    <button class="act-wait${st==='waiting'?' on':''}" onclick="actTodoSetStatus('${esc(t.id)}','waiting')" title="${st==='waiting'?'再按一次＝改回處理中':'卡在家長／外部回覆時標這個'}">等回覆</button>`;
  return`
  <div class="act-todo st-${st}${t.done?' done':''}">
    <button class="act-check${t.done?' on':''}" onclick="actTodoDone('${esc(t.id)}')" title="${t.done?'取消完成':'標記完成'}">${t.done?'✓':''}</button>
    <div class="act-todo-body">
      <div class="act-todo-text">${esc(t.text)}</div>
      <div class="act-todo-meta"><span class="act-status st-${st}">${ACT_ST[st]}</span>${meta}</div>
      ${actProgHtml(t)}
      ${actState.progFor===t.id?`
      <div class="act-prog-add">
        <input id="act-prog-input" class="act-add-inp" value="${esc(actState.progDraft)}" placeholder="做到哪了？例：已聯絡媽媽，要問過爸爸，週三前回覆"
          oninput="actProgDraft(this.value)" onkeydown="if(enterSubmit(event))actTodoProgAdd('${esc(t.id)}')">
        <button class="btn btns btnp" onclick="actTodoProgAdd('${esc(t.id)}')">記下來</button>
      </div>`:''}
    </div>
    <div class="act-todo-act">${acts}<button class="act-del" onclick="actTodoDelete('${esc(t.id)}')" title="刪掉這則">✕</button></div>
  </div>`;
}

function actRowHtml(e){
  const d=new Date(e.ts);
  return`
  <div class="act-row k-${esc(e.kind)}">
    <span class="act-dot"></span>
    <div class="act-row-body">
      <div class="act-row-line"><b>${esc(actWho(e.by,e.byName))}</b> ${esc(e.text)}</div>
      ${e.target||e.detail?`<div class="act-row-sub">${esc(e.target)}${e.target&&e.detail?' · ':''}${e.detail?`<span class="act-row-detail">${esc(e.detail)}</span>`:''}</div>`:''}
    </div>
    <div class="act-row-time">${fmtT(d)}</div>
  </div>`;
}

// 某一天要不要展開。手動點過就照使用者的意思，沒點過就用預設：
// 只有今天是攤開的，過去的日子收起來（老闆 2026-08-04 要求：跨過那天就自動收）。
// 今天剛好沒動態時，改攤開最新的那一天——不然整頁都是收合的，看起來像壞掉。
function actDayIsOpen(key,defKey){
  const v=actState.dayOpen[key];
  return v===undefined?key===defKey:v;
}
function actToggleDay(key,defKey){
  actState.dayOpen[key]=!actDayIsOpen(key,defKey);
  renderActivity();
}

function actFeedHtml(){
  const chips=ACT_KINDS.map(k=>
    `<button class="act-chip${actState.filter===k.id?' on':''}" onclick="actSetFilter('${k.id}')">${k.label}</button>`).join('');
  const list=actEvents
    .filter(e=>actState.filter==='all'||e.kind===actState.filter)
    .slice().reverse();   // 最新在最上面
  let body='';
  if(!actLoaded)body=`<div class="act-empty">載入中…</div>`;
  else if(!list.length)body=`<div class="act-empty">${actEvents.length?'這個分類還沒有紀錄。':'還沒有任何紀錄。從現在起，請假、排補課、加退學生、改課程時間都會自動記在這裡（只記從上線那天起發生的事，舊的補不回來）。'}</div>`;
  else{
    // 依天分組（list 已是新→舊，所以組的順序也是新→舊）
    const groups=[],at=new Map();
    list.forEach(e=>{
      const k=toDateStr(new Date(e.ts));
      if(!at.has(k)){at.set(k,groups.length);groups.push({key:k,items:[]});}
      groups[at.get(k)].items.push(e);
    });
    const today=toDateStr(new Date());
    const defKey=at.has(today)?today:groups[0].key;
    body=groups.map(g=>{
      const open=actDayIsOpen(g.key,defKey);
      return`<div class="act-day-grp">
        <button class="act-day${open?' open':''}" onclick="actToggleDay('${g.key}','${defKey}')">
          <span class="act-day-arrow">${open?'▾':'▸'}</span>
          <span class="act-day-lbl">${actDayLabel(new Date(g.items[0].ts))}</span>
          <span class="act-day-n">${g.items.length} 筆</span>
        </button>
        ${open?`<div class="act-day-body">${g.items.map(actRowHtml).join('')}</div>`:''}
      </div>`;
    }).join('');
  }
  return`
  <div class="set-card">
    <div class="sec-hd">系統動態<span class="sec-hd-line"></span></div>
    <p class="set-card-sub">誰、什麼時候、對哪堂課做了什麼。系統自己記，不用人手動寫。<b>只有今天是攤開的</b>，過去的日子收起來，點日期那一列展開。保留最近 ${ACT_KEEP_DAYS} 天。</p>
    <div class="act-chips">${chips}</div>
    <div class="act-feed">${body}</div>
  </div>`;
}
