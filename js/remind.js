// 今日重點（2026-08-11 老闆要求）：課程頁最上面一張卡，把「今天／明天跟平常不一樣的事」擺在一起。
//
// 卡上兩種東西混在同一條時間軸：
//   ① 手寫提醒 —— 系統不可能知道的事（幾點有面試、幾點要回電）。存 sharedData/activity 的 reminders[]
//   ② 系統自動 —— 補課／併班補課／調課場次、整堂請假、試聽／加課。從既有資料現算，不另外存
// 一般課程不進來：這張卡的價值在「只講不一樣的事」，全部列出來就跟下面的今日課程重複了。
//
// 為什麼跟「待辦」分開（老闆 2026-08-11 定案）：待辦是「要處理的事」，會認領、會接力、沒做完就一直在；
// 提醒是「那天要記得的事」，過了那天自然失效。混在一起會讓待辦清單被一次性的行程洗掉。
//
// 資料存在 sharedData/activity（跟動態／待辦同一份文件、同一條 onSnapshot），所以：
//   - 不用改 firestore.rules（sharedData/{docId} 白名單已涵蓋）
//   - 三個人共用、誰寫的誰都看得到，即時同步
//   - 新增走 arrayUnion（不會蓋掉同事同時寫的），改既有那筆才整份寫回
// ⚠️ 保留 RMD_KEEP_DAYS 天，過期的載入時 arrayRemove 清掉（避免撞 Firestore 單文件 1MB 上限）。

var RMD_KEEP_DAYS=30;
var rmdList=[];              // 手寫提醒（含過期的，畫的時候才濾）
var rmdDay=0;                // 卡片正在看哪天：0=今天、1=明天
var rmdAdding=false;
var rmdDraft={text:'',time:''};
var rmdPruned=false;         // 過期提醒一個 session 只清一次
var rmdRenderPending=false;

// 卡片的日期刻意不跟課程頁的日期導覽連動：那個是拿來翻課表的，
// 這張卡是「提醒我」——提醒只跟真實的今天／明天有關，翻到 8/20 的課表不該叫「今日重點」。
function rmdDateOf(off){const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+(off||0));return d;}
function rmdMins(t){const m=/^(\d{1,2}):(\d{2})$/.exec(t||'');return m?(+m[1]*60+ +m[2]):-1;}

// ── 讀：搭 activity.js 的 onSnapshot 便車（同一份文件，不另外開一條監聽）──
function rmdApplySnap(d){
  rmdList=(Array.isArray(d.reminders)?d.reminders:[]).filter(Boolean);
  rmdRenderRemote();
  const cut=toDateStr(rmdDateOf(-RMD_KEEP_DAYS));
  const stale=rmdList.filter(r=>String(r.date||'')<cut);
  if(stale.length&&!rmdPruned){
    rmdPruned=true;
    actDoc().update({reminders:firebase.firestore.FieldValue.arrayRemove(...stale.slice(0,200))}).catch(()=>{});
  }
}

// 改既有那筆（打勾／刪除）只能整份寫回 → 先重讀雲端最新再套改動，把互蓋的窗口壓到最小
async function rmdMutate(mut){
  let list=rmdList;
  try{
    const snap=await actDoc().get();
    if(snap.exists&&Array.isArray(snap.data().reminders))list=snap.data().reminders.filter(Boolean);
  }catch(_){}
  const next=mut(list.map(r=>({...r})));
  if(!next)return;
  rmdList=next;renderRemind();
  try{await actDoc().set({reminders:next},{merge:true});}
  catch(e){toast('提醒沒存上雲端：'+(e?.message||e),'err');}
}

// ── 寫 ──
function rmdSetDay(off){rmdDay=off;renderRemind();}
function rmdToggleAdd(){
  rmdAdding=!rmdAdding;renderRemind();
  if(rmdAdding)requestAnimationFrame(()=>document.getElementById('rmd-inp')?.focus());
}
function rmdDraftSet(k,v){rmdDraft[k]=v;}

async function rmdAdd(){
  const text=(rmdDraft.text||'').trim();
  if(!text)return toast('提醒內容不能是空的','err');
  const email=actMe();
  const rec={id:actNewId(),date:toDateStr(rmdDateOf(rmdDay)),time:rmdDraft.time||'',text,
    by:email,byName:actName(email),createdAt:new Date().toISOString(),
    done:false,doneBy:null,doneName:'',doneAt:null};
  rmdList=[...rmdList,rec];
  rmdDraft={text:'',time:''};
  renderRemind();
  requestAnimationFrame(()=>document.getElementById('rmd-inp')?.focus());   // 連續寫下一則
  try{await actDoc().set({reminders:firebase.firestore.FieldValue.arrayUnion(rec)},{merge:true});}
  catch(e){toast('提醒沒存上雲端：'+(e?.message||e),'err');}
}

function rmdDone(id){
  const email=actMe();
  rmdMutate(list=>list.map(r=>{
    if(r.id!==id)return r;
    if(r.done)return{...r,done:false,doneBy:null,doneName:'',doneAt:null};
    return{...r,done:true,doneBy:email,doneName:actName(email),doneAt:new Date().toISOString()};
  }));
}

async function rmdDelete(id){
  const r=rmdList.find(x=>x.id===id);if(!r)return;
  const ok=await uiConfirm({title:'刪掉這則提醒？',ok:'刪掉',danger:true,
    html:`<p class="ask-big">${esc(r.text)}</p><div class="ask-note">刪掉之後救不回來。已經處理完的話按打勾就好，會劃掉留到當天結束。</div>`});
  if(!ok)return;
  rmdMutate(list=>list.filter(x=>x.id!==id));
}

// ── 系統自動撈的那些 ──
// 補課紀錄反查老師：紀錄本身不存老師，從原課堂 id（sys:<courseId>:…）回課程本體拿
function rmdRecTeacher(rec){
  try{
    const m=String(rec.originalId||'').match(/^sys:(\d+):/);
    const co=m?findCourseById(Number(m[1])):null;
    return co?courseTeacherNames(co).join('、'):'';
  }catch(_){return'';}
}

function rmdAutoItems(day){
  const start=new Date(day);start.setHours(0,0,0,0);
  const end=new Date(day);end.setHours(23,59,59,999);
  const out=[];
  // copyTag＝複製成文字時要不要把類別寫進去。「小華　國二數學班」不講「補課」看不懂；
  // 「國二數學班 今天不上」自己就講完了，再加「整堂請假：」只是囉嗦
  const push=(dt,cls,tag,text,sub,evId,copyTag)=>out.push({
    mins:dt.getHours()*60+dt.getMinutes(),time:fmtT(dt),cls,tag,
    text:text||'',sub:sub||'',evId:evId||null,copyTag:!!copyTag});

  // ① 補課／調課場次。刻意直接讀紀錄而不是走 expandMakeupForRange——
  //    併班補課（kind:'join'）不會長成自己的一堂課，只有紀錄裡有，走展開器會漏掉。
  try{
    (driveData.makeupScheduled||[]).map(normalizeMakeupRec).forEach(rec=>{
      const s=new Date(rec.scheduledDate);
      if(!(s>=start&&s<=end))return;
      const isR=rec.calName==='調課';
      const join=isJoinRec(rec);
      const who=(rec.absentStudents||[]).join('、');
      push(s,isR?'resched':'makeup',(join?'併班':'')+(isR?'調課':'補課'),
        `${who?who+'　':''}${rec.origTitle||''}`,
        join?`跟著「${rec.hostTitle||'另一堂課'}」一起上`
            :[rec.room||'',rmdRecTeacher(rec)].filter(Boolean).join('・'),null,true);
    });
  }catch(e){console.warn('rmdAutoItems makeup failed',e);}

  // ② 那天的課堂裡「跟平常不一樣的」。一般課程不進來
  let evs=[];
  try{evs=expandCoursesForRange(start,end);}catch(e){console.warn('rmdAutoItems courses failed',e);}
  evs.forEach(e=>{
    if(e.isRescheduled){
      const rec=getMakeupsFor(e.id)[0];
      const to=rec?new Date(rec.scheduledDate):null;
      push(e.startDt,'resched','調課',`${e.origTitle} 今天不上`,
        to?`已改到 ${fmtD(to)} ${fmtT(to)}`:'還沒安排新時段',e.id);
      return;
    }
    if(e.isFullAbsent){
      const who=(e.absentStudents||[]).join('、');
      const arranged=getMakeupsFor(e.id).length;
      push(e.startDt,'abs',e.absType==='老師請假'?'老師請假':'整堂請假',
        `${e.origTitle} 今天不上`,
        [who?who+' 請假':'',arranged?'':'補課還沒排'].filter(Boolean).join('・'),e.id);
      return;
    }
    if(e.calName==='試聽'||e.calName==='加課'){
      push(e.startDt,e.calName==='試聽'?'trial':'extra',e.calName,e.origTitle,
        [e.classroom||'',e.teacher||''].filter(Boolean).join('・'),e.id,true);
      return;
    }
    // 課照上、只是少了幾個人 → 講誰沒來就好，不重複列這堂課
    const away=[...(e.absentStudents||[]),...(e.noShowStudents||[])];
    if(away.length)push(e.startDt,'abs','請假',`${e.origTitle}　${away.join('、')} 沒來`,
      [e.classroom||'',e.teacher||''].filter(Boolean).join('・'),e.id);
  });
  return out;
}

// 手寫 + 自動，合成一條時間軸。沒填時間的（整天）排最前面
function rmdItemsFor(off){
  const ds=toDateStr(rmdDateOf(off));
  const notes=rmdList.filter(r=>r.date===ds).map(r=>({
    mins:rmdMins(r.time),time:r.time||'',cls:'note',tag:'提醒',
    text:r.text||'',sub:`${actWho(r.by,r.byName)} 記的`,rec:r}));
  return [...notes,...rmdAutoItems(rmdDateOf(off))].sort((a,b)=>a.mins-b.mins);
}

// 還欠著的補課——放今天那頁，提醒去排。數法跟側欄的待補課數字**同一支**
//（makeup.js mkPendingTotal：這學期開始起算、往後不設上限），兩處不會各數各的
function rmdPendingCount(now){
  try{return mkPendingTotal(now);}catch(_){return 0;}
}

// ── 複製成文字：直接貼 LINE 提醒老師（老闆 2026-08-11 要求）──
function rmdCopyText(){
  const d=rmdDateOf(rmdDay);
  const items=rmdItemsFor(rmdDay).filter(it=>!(it.rec&&it.rec.done));
  const lines=[`${rmdDay===1?'明天 ':''}${fmtD(d)} 重點`];
  items.forEach(it=>lines.push(
    `${it.time||'整天'}　${it.copyTag?it.tag+'：':''}${it.text}${it.sub&&it.cls!=='note'?`（${it.sub}）`:''}`));
  if(!items.length)lines.push('（沒有特別的事）');
  return lines.join('\n');
}
async function rmdCopy(){
  const txt=rmdCopyText();
  try{
    await navigator.clipboard.writeText(txt);
    toast('已複製，可以直接貼給老師','ok');
  }catch(_){
    // 舊 Safari／非安全連線沒有 clipboard API → 退回選取式複製
    const ta=document.createElement('textarea');
    ta.value=txt;ta.style.position='fixed';ta.style.top='-999px';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');toast('已複製，可以直接貼給老師','ok');}
    catch(e){toast('這台裝置不給程式複製，請長按選取','err');}
    document.body.removeChild(ta);
  }
}

// ── 畫面 ──
// 同事那邊剛寫的提醒推進來時，整塊 innerHTML 換掉會把游標踢走、中文選字被打斷
//（跟 activity.js 同一個坑、同一種解法）→ 正在打字就先擱著，離開輸入框再補畫
function rmdTypingEl(){
  const a=document.activeElement;
  if(!a||!/^(INPUT|TEXTAREA)$/.test(a.tagName))return null;
  return document.getElementById('remind-card')?.contains(a)?a:null;
}
function rmdRenderRemote(){
  if(rmdTypingEl()){rmdRenderPending=true;return;}
  renderRemind();
}
document.addEventListener('focusout',e=>{
  if(!rmdRenderPending)return;
  const el=e.target;
  if(el&&/^(INPUT|TEXTAREA)$/.test(el.tagName)&&document.getElementById('remind-card')?.contains(el))
    setTimeout(()=>{if(!rmdTypingEl()){rmdRenderPending=false;renderRemind();}},0);
},true);

// 一件事一行：時間 │色條│ 標籤 內容 · 補充。
// 動作鈕（打勾／刪）平常藏起來、滑到那一行才浮出來——三個 ✕ 一直亮著會讓整條變吵
function rmdRowHtml(it){
  const time=it.time?`<span class="rmd-t">${esc(it.time)}</span>`:`<span class="rmd-t rmd-t-all">整天</span>`;
  const r=it.rec;
  const acts=r?`<span class="rmd-acts">
      <button class="rmd-check${r.done?' on':''}" onclick="event.stopPropagation();rmdDone('${esc(r.id)}')" title="${r.done?'取消完成':'處理完了'}">${r.done?'✓':''}</button>
      <button class="rmd-del" onclick="event.stopPropagation();rmdDelete('${esc(r.id)}')" title="刪掉這則">✕</button>
    </span>`:'';
  const click=it.evId?` onclick="selectWeekEvent('${esc(it.evId)}')" style="cursor:pointer"`:'';
  return`<div class="rmd-row k-${esc(it.cls)}${r&&r.done?' done':''}"${r?'':click}>
    ${time}<span class="rmd-bar"></span>
    <span class="rmd-tag">${esc(it.tag)}</span>
    <span class="rmd-body">${esc(it.text)}${it.sub?` <span class="rmd-sub">· ${esc(it.sub)}</span>`:''}</span>
    ${acts}
  </div>`;
}

// 收合狀態記在這台裝置（不進雲端：這是「我這台想不想看到」，不是共用資料）
function rmdCollapsed(){try{return localStorage.getItem('rmdCollapsed')==='1';}catch(_){return false;}}
function rmdToggleCollapse(){
  try{localStorage.setItem('rmdCollapsed',rmdCollapsed()?'0':'1');}catch(_){}
  renderRemind();
}

function renderRemind(){
  const el=document.getElementById('remind-card');if(!el)return;
  rmdRenderPending=false;
  const items=rmdItemsFor(rmdDay);
  const undone=it=>!(it.rec&&it.rec.done);
  const collapsed=rmdCollapsed();
  const tabs=[0,1].map(off=>{
    const n=rmdItemsFor(off).filter(undone).length;
    return`<button class="rmd-tab${rmdDay===off?' on':''}" onclick="rmdSetDay(${off})">${off?'明天':'今天'}${n?`<span class="rmd-tab-n">${n}</span>`:''}</button>`;
  }).join('');
  const pend=rmdDay===0?rmdPendingCount():0;
  const pendBtn=pend?`<button class="rmd-pend" onclick="switchPanel('makeup')" title="去待補課清單排">⚠ ${pend} 筆沒排補課</button>`:'';
  // 收起時只留一行摘要——還是看得到今天有什麼，只是不佔版面
  if(collapsed){
    const sum=items.filter(undone).map(it=>`${it.time||'整天'} ${it.text}`).join('・')||'沒有特別的事';
    el.innerHTML=`<div class="rmd-wrap"><div class="rmd-hd">
      <button class="rmd-ttl" onclick="rmdToggleCollapse()" title="展開"><span class="rmd-arrow">▸</span>重點提醒</button>
      <span class="rmd-sum">${esc(sum)}</span>${pendBtn}
    </div></div>`;
    return;
  }
  const body=items.length
    ? items.map(rmdRowHtml).join('')
    : `<div class="rmd-empty">${rmdDay?'明天':'今天'}沒有特別的事。要記得的事按右邊「＋」寫一行。</div>`;
  el.innerHTML=`
  <div class="rmd-wrap">
    <div class="rmd-hd">
      <button class="rmd-ttl" onclick="rmdToggleCollapse()" title="收起"><span class="rmd-arrow">▾</span>重點提醒</button>
      <div class="rmd-tabs">${tabs}</div>
      <div class="rmd-gap"></div>
      ${pendBtn}
      <button class="rmd-btn" onclick="rmdCopy()" title="複製成文字，可以直接貼 LINE 給老師">⧉ 複製</button>
      <button class="rmd-btn" onclick="rmdToggleAdd()" title="記一件${rmdDay?'明天':'今天'}要注意的事">${rmdAdding?'收起':'＋ 記一件事'}</button>
    </div>
    ${rmdAdding?`
    <div class="rmd-add">
      <input type="time" class="rmd-add-time" value="${esc(rmdDraft.time)}" oninput="rmdDraftSet('time',this.value)" title="幾點（可以不填）">
      <input id="rmd-inp" class="rmd-add-inp" value="${esc(rmdDraft.text)}" placeholder="例：15:00 面試 王小明媽媽／記得回電給陳爸爸"
        oninput="rmdDraftSet('text',this.value)" onkeydown="if(enterSubmit(event))rmdAdd()">
      <button class="rmd-add-go" onclick="rmdAdd()">記到${rmdDay?'明天':'今天'}</button>
    </div>
    <div class="rmd-add-hint">時間可以不填（不填就當「整天」排最前面）。送出後欄位清空，可以連著寫下一則。</div>`:''}
    <div class="rmd-list">${body}</div>
  </div>`;
}
