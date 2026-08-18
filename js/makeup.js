// 待補課/調課清單 + 補課媒合 + slot picker（日期→時段→教室→確認）

// 底部「已完成安排」「不補課」區塊預設收合，點標題展開；搜尋時強制展開
var mkSecOpen={completed:false,skipped:false};
function toggleMkSec(key){mkSecOpen[key]=!mkSecOpen[key];renderMakeup();}
// 點頂部「已完成」統計卡 → 展開已完成區塊並捲過去
function jumpToMkCompleted(){
  if(!mkSecOpen.completed){mkSecOpen.completed=true;renderMakeup();}
  document.getElementById('mk-sec-completed')?.scrollIntoView({behavior:'smooth',block:'start'});
}

// 科目認定：課程本體的 subject 欄優先，沒填就從課名撈關鍵字。
// 清單篩選（populateMkFilters）與併班補課的「同科目」判斷共用這一份，兩邊才不會各認各的。
var MK_SUBJECTS=['數學','英文','理化','物理','化學','國文','生物','歷史','地理','社會','自然','寫作','作文'];
// 回傳科目名，認不出來就空字串（decorate 會再補成「其他」）
function mkSubjectOf(ev){
  if(!ev)return'';
  if(ev.subject&&MK_SUBJECTS.includes(ev.subject))return ev.subject;
  return MK_SUBJECTS.find(s=>String(ev.origTitle||'').includes(s))||'';
}

// ── 待安排的處理進度（2026-08-12）──
// 「打去問了，媽媽說要等爸爸回，週三前給答覆」這種只有人腦知道的狀態，寫在卡上，三個人都看得到。
// 跟待辦的進度串是同一件事、同一套畫面（.act-prog*），只是掛在請假紀錄上而不是待辦上。
//
// 住哪：sharedData/activity 的新欄位 mkNotes[]（跟待辦 todos[]、今日重點 reminders[] 同一份文件），
// 搭 activity.js 那條 onSnapshot 的便車 → 不用改 firestore.rules、不另開連線、同事寫的即時浮出來。
// 寫入走 arrayUnion＝兩個人同一秒寫也不會互相蓋掉（跟事件流同一個理由）。
// ⚠ 用 occId 當鑰匙而不是塞進 driveData.absences：那份資料是補課帳的分母來源，
//   多一個會被人隨手改的欄位進去，之後每個算帳的地方都要多想一次。
var mkNotes=[];   // {id, occId, text, by, byName, at}
// 正在寫的那筆／寫在哪個畫面／輸入內容／展開全部的那筆。
// ⚠ openIn 不能省：待補課清單與桌面日曆側欄是同一份 DOM（切分頁只是 display:none），
//   兩邊的輸入框如果同名，focus 會跑去那個看不見的框裡（打字打到空氣）
var mkNoteState={openFor:null,openIn:'list',draft:'',allFor:null};
var mkNotesPruned=false;
var MK_NOTE_KEEP_DAYS=180;   // 比動態的 60 天長：一筆請假可能拖很久才排掉，進度不該先蒸發

// 雲端 → 本機（activity.js 的 actApplySnap 每次 snapshot 都會叫這支）
function mkNotesApplySnap(d){
  const all=(Array.isArray(d.mkNotes)?d.mkNotes:[]).filter(n=>n&&n.occId&&n.at);
  const cut=Date.now()-MK_NOTE_KEEP_DAYS*864e5;
  const stale=all.filter(n=>new Date(n.at).getTime()<cut);
  mkNotes=all.filter(n=>new Date(n.at).getTime()>=cut).sort((a,b)=>(a.at<b.at?-1:a.at>b.at?1:0));
  // 正在打字時先別重畫：整塊 innerHTML 換掉會把游標踢走、中文選字被打斷（跟動態頁同一個處理）
  if(!mkNoteTyping())mkNotesRefresh();
  if(stale.length&&!mkNotesPruned){
    mkNotesPruned=true;
    actDoc().update({mkNotes:firebase.firestore.FieldValue.arrayRemove(...stale.slice(0,200))}).catch(()=>{});
  }
}
function mkNoteTyping(){return String(document.activeElement?.id||'').startsWith('mk-note-input');}
function mkNotesFor(occId){return mkNotes.filter(n=>n.occId===occId);}
// 留言畫在兩個地方（待補課清單、桌面日曆側欄），重畫的是「現在看得到的那個」
function mkNotesRefresh(){
  if(currentPanel==='makeup')renderMakeup();
  else if(currentPanel==='dayview'&&typeof renderDvInspector==='function')renderDvInspector();
}

function mkNoteOpen(id,where){
  const w=where||'list';
  const same=mkNoteState.openFor===id&&mkNoteState.openIn===w;
  mkNoteState.openFor=same?null:id;
  mkNoteState.openIn=w;
  mkNoteState.draft='';
  mkNotesRefresh();
  if(mkNoteState.openFor)requestAnimationFrame(()=>document.getElementById('mk-note-input-'+w)?.focus());
}
function mkNoteDraft(v){mkNoteState.draft=v;}
function mkNoteAll(id){mkNoteState.allFor=mkNoteState.allFor===id?null:id;mkNotesRefresh();}

async function mkNoteAdd(occId){
  const text=(mkNoteState.draft||'').trim();
  if(!text)return toast('進度內容不能是空的','err');
  const email=actMe();
  const rec={id:actNewId(),occId,text,by:email,byName:actName(email),at:new Date().toISOString()};
  mkNotes=[...mkNotes,rec];
  mkNoteState.draft='';mkNoteState.openFor=null;
  mkNotesRefresh();
  try{await actDoc().set({mkNotes:firebase.firestore.FieldValue.arrayUnion(rec)},{merge:true});}
  catch(e){toast('進度沒存上雲端：'+(e?.message||e),'err');}
}

// 刪掉一整則（輸入錯了、或串太長想清掉其中一則）。
// 寫入走 arrayRemove（原子刪那一筆）而不是「整份寫回」——整份寫回會把別人同一秒
// arrayUnion 進來的留言洗掉。真正動手的部分抽成同步函式，確認視窗只是門口。
function mkNoteRemove(id){
  const n=mkNotes.find(x=>x.id===id);if(!n)return null;
  mkNotes=mkNotes.filter(x=>x.id!==id);
  mkNotesRefresh();
  try{
    actDoc().update({mkNotes:firebase.firestore.FieldValue.arrayRemove(n)})
      .catch(e=>toast('進度沒刪掉：'+(e?.message||e),'err'));
  }catch(e){toast('進度沒刪掉：'+(e?.message||e),'err');}
  return n;
}
async function mkNoteDel(id){
  const n=mkNotes.find(x=>x.id===id);if(!n)return;
  const ok=await uiConfirm({title:'刪掉這則進度？',ok:'刪掉',danger:true,
    html:`<p class="ask-big">${esc(n.text)}</p>
      <div class="ask-note">${esc(n.byName||'某人')} 寫於 ${fmtDT(new Date(n.at))}。刪掉之後救不回來。</div>`});
  if(!ok)return;
  mkNoteRemove(id);
}

// 進度串：**一則一行**（時間・誰・內容 擠同一行），卡片本來就擠，不佔第二行。
// 預設只露最新那則，點「前面還有 N 則」才展開全部。
// editable＝待安排卡與桌面日曆側欄（可以寫）；已安排／已完成／不補課的卡只顯示既有的，不給再寫
// （同一筆課在兩區各出現一次，兩邊都放輸入框會撞到同一個 DOM id）。刪除到處都給。
// where＝這串畫在哪（'list' 待補課清單／'dv' 桌面日曆側欄），決定輸入框的 id 與重畫誰
function mkNotesHtml(e,editable,where){
  const w=where||'list';
  const all=mkNotesFor(e.id);
  const open=editable&&mkNoteState.openFor===e.id&&mkNoteState.openIn===w;
  if(!all.length&&!open)return'';
  const expanded=mkNoteState.allFor===e.id;
  const show=expanded?all:all.slice(-1);
  const hidden=all.length-show.length;
  const items=show.map(p=>`
    <div class="mk-note-item">
      <span class="mk-note-meta">${fmtDT(new Date(p.at))} <b class="mk-note-who">${esc(p.byName||'某人')}</b></span>
      <span class="mk-note-text">${esc(p.text)}</span>
      <button class="mk-note-del" onclick="mkNoteDel('${esc(p.id)}')" title="刪掉這則">✕</button>
    </div>`).join('');
  // 卡片本身點下去＝開安排視窗，所以進度串這一整塊要把點擊擋下來
  return`<div class="mk-note" onclick="event.stopPropagation()">
    ${hidden>0?`<button class="mk-note-more" onclick="mkNoteAll('${esc(e.id)}')">▸ 前面還有 ${hidden} 則</button>`:''}
    ${items}
    ${expanded&&all.length>1?`<button class="mk-note-more" onclick="mkNoteAll('${esc(e.id)}')">▾ 收合</button>`:''}
    ${open?`<div class="mk-note-add">
      <input id="mk-note-input-${w}" class="act-add-inp" value="${esc(mkNoteState.draft)}" placeholder="處理到哪了？例：問過小明媽媽，週三前回覆哪天能補"
        oninput="mkNoteDraft(this.value)" onkeydown="if(enterSubmit(event))mkNoteAdd('${esc(e.id)}')">
      <button class="btn btns btnp" onclick="mkNoteAdd('${esc(e.id)}')">記下來</button>
    </div>`:''}
  </div>`;
}

// ── 載入補課清單 + 媒合 ──
async function loadMakeup(silent=false){
  if(!isSignedIn())return;
  if(!silent)showL('讀取待補課/調課清單...');
  try{
    const decorate=ev=>({...ev,
      subject:mkSubjectOf(ev)||'其他',
      extraNote:(ev.desc||'').split('\n').slice(1).filter(Boolean).join(' · ')});
    // 清單來源＝系統請假紀錄（driveData.absences）：系統課堂的請假/曠課/調課，
    // 以及第 4 刀從舊行事曆搬進來的快照紀錄。不再掃 Google Calendar。
    makeupList=sysAbsenceEvents().map(decorate).sort((a,b)=>a.startDt-b.startDt);
    // 已排的補課/調課＝系統紀錄本身（第 3 刀起排補課只寫紀錄、不建 Calendar 事件）
    rebuildMakeupMatchMap();
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

// 純曠課事件（只有曠課、沒有請假/調課）→ 收進 makeupList 供學生統計用，但不該出現在待補課清單
function isPureNoShow(e){return e.isNoShow&&!e.isAbsent&&!e.isRescheduled;}
// 這筆請假是否已決定「不補課」（請假學生全在 makeupSkip 名單）→ 退半堂、不算欠課、不進待安排
function isMakeupSkipped(e){
  return (e.absentStudents?.length>0)&&e.absentStudents.every(s=>(e.makeupSkip||[]).includes(s));
}
// 課前1hr內請假、且補/不補有學費分歧 → 待與家長確認（補 +半堂、不補 −半堂）
// 適用：一對一家教(one)、一對二(pair 兩人，沒一起調課成功而走個別補課的)。團班不適用
function needsMakeupDecision(e){
  if(e.absType!=='學生請假')return false; // 只有學生請假才有補/不補分歧（調課/老師請假不算）
  const small=e.type==='one'||(e.type==='pair'&&(e.students?.length||0)===2);
  return small&&(e.absentStudents||[]).some(s=>(e.absenceTiming||{})[s]==='B');
}

// 老師請假的請假名單是空的（整堂不上、沒有個別學生要補）→ 用「這堂排了沒」判斷，不數人頭
function mkByHead(e){return(e.absentStudents||[]).length>0;}
// 這筆能不能「拆給不同的人分開排」。老師請假（沒有個別名單）與**調課**都不行——
// 調課是整堂移走、全班跟著走，沒有「只搬走某幾個人」這回事。
// ⚠ 調課的 absentStudents 是**現算的全名冊**（見 schedule.js _absFields）：拿它數人頭的話，
// 調課排好之後只要插班一個新同學，就會多冒出一個「還沒排」的人，卡片無聲跳回待安排。
function mkSplittable(e){return e.absType!=='調課'&&mkByHead(e);}
function mkPendingCount(e){return mkSplittable(e)?mkPendingNames(e).length:(getMakeupsFor(e.id).length?0:1);}
// 這堂總共要排幾人份（扣掉決定不補課的）。老師請假／調課不數人頭＝1 份。
// 待補課卡、今日卡、週檢視、桌面日曆的「已安排 N/總」共用這個分母
function mkTotalCount(e){return mkSplittable(e)?(e.absentStudents||[]).filter(n=>!(e.makeupSkip||[]).includes(n)).length:1;}
// 一筆請假的四種狀態。多人請假只排了一部分＝還是 pending（卡片會標「已安排 1/3」）
function mkStatusOf(e,now){
  const recs=getMakeupsFor(e.id);
  if(!recs.length)return isMakeupSkipped(e)?'skipped':'pending';
  if(mkPendingCount(e)>0)return'pending';
  const owed=mkOwedMins(e);
  return recs.every(r=>mkRecEnd(r,owed)<now)?'completed':'scheduled';
}

// 這位學生在這堂請假底下對應的補課場次。一堂可以排好幾場，只認名單含他的那場——
// 不然「三人請假、只幫小明排了」會讓小華小美的欠課數也一起被消掉（安靜地少算）。
// 老師請假的場次沒有個別名單（整堂補）→ 退回這堂的第一場。
function makeupForStudent(e,name){
  const recs=getMakeupsFor(e.id);
  if(!recs.length)return null;
  return recs.find(r=>(r.absentStudents||[]).includes(name))||(mkSplittable(e)?null:recs[0]);
}

// 「補課排哪天」的小標籤，一場一顆＋沒排完再補一顆紅的。
// 週檢視課卡與桌面日曆側欄共用（以前各自寫一份、都假設只有一場）
function mkChipsHtml(ev){
  if(!ev.isFullAbsent&&!ev.isRescheduled)return'';
  const lbl=ev.isRescheduled?'調課':'補課';
  const okCss='color:#5C7E6A;font-weight:500;background:#EDF0EA;border:1px solid #CFE0D5;padding:2px 8px;border-radius:6px;font-size:12px';
  const noCss='color:#C0504A;font-weight:500;background:#F8EDEA;border:1px solid #E8C5BF;padding:2px 8px;border-radius:6px;font-size:12px';
  const recs=getMakeupsFor(ev.id);
  if(!recs.length)return`<span style="${noCss}">未安排${lbl}</span>`;
  const chips=recs.map(rec=>{
    const sd=new Date(rec.scheduledDate);
    const who=(rec.absentStudents||[]).join('、');
    const where=mkWhereTxt(rec);
    return`<span style="${okCss}">${lbl}${recs.length>1&&who?'・'+esc(who):''}：${sd.getMonth()+1}/${sd.getDate()}（${WD[sd.getDay()]}）${fmtT(sd)}${where?' '+esc(where):''}</span>`;
  }).join('');
  // 這裡一定已經有場次（沒有的話上面就 return 了）→ 講「未排完」而不是「未安排」：
  // 剩下的可能是還沒排的人，也可能是時數只補了一半的人
  const left=mkPendingNames(ev);
  return chips+(left.length?`<span style="${noCss}">${esc(left.join('、'))} 未排完${lbl}</span>`:'');
}

// ── 跨學年的期別分頁（2026-08-13 老闆回報）──
// 期別分頁是照**今天所在的學年**現算的（state.js getPeriods），四顆只涵蓋 9/1～隔年 8/31。
// 8 月標一堂 9/12 的調課 → 落在四顆之外，切遍每個分頁都找不到它，整筆等於在系統裡消失。
// 補法：四顆基本分頁之外，凡是「還有沒排完的補課／調課」但落在四顆之外的期別，
// 自己長一顆分頁出來（例：「2026學年 上學期（1）」），排完就自動消失——分頁存在＝那邊還有事。
// ⚠ 這種分頁**只換這一頁在看哪一段日期**（mkPeriodSel），不動 currentPeriodId：
//   那個變數同時是修課登記簿／點名／成績的 Firestore 文件 key，動它名冊會整片查不到。
var mkPeriodSel=null;   // null＝跟著四顆基本分頁（currentPeriodId）；否則＝額外分頁的期別物件

// 目前這一頁在看哪一段（renderMakeup 的唯一期別入口）
function mkViewPeriod(){return mkPeriodSel||getCurrentPeriod();}

// 落在四顆基本分頁之外、還有沒排完的補課／調課 → 該期別長一顆分頁（附還欠幾筆）
function mkExtraPeriods(){
  const base=getPeriods(),now=new Date();
  const map=new Map();
  makeupList.forEach(e=>{
    if(isPureNoShow(e))return;
    if(base.some(p=>e.startDt>=p.start&&e.startDt<=p.end))return;   // 四顆裡本來就看得到
    if(mkStatusOf(e,now)!=='pending')return;                        // 排完的不長分頁
    const p=periodRangeOfDate(e.startDt);
    const hit=map.get(p.id);
    if(hit)hit.n++;else map.set(p.id,{...p,n:1});
  });
  // 正在看的那顆即使剛剛排完（n 掉到 0）也要留著，不然分頁會在腳下消失
  if(mkPeriodSel&&!map.has(mkPeriodSel.id))map.set(mkPeriodSel.id,{...mkPeriodSel,n:0});
  return[...map.values()].sort((a,b)=>a.start-b.start);
}

function mkPeriodTabsHtml(){
  const tab=(id,label,active,title)=>`<button class="period-tab${active?' active':''}"${title?` title="${title}"`:''} onclick="switchMkPeriod('${esc(id)}')">${label}</button>`;
  const base=getPeriods().map(p=>tab(p.id,p.label,!mkPeriodSel&&p.id===currentPeriodId)).join('');
  const extra=mkExtraPeriods().map(p=>tab(p.id,`${p.label}${p.n?`（${p.n}）`:''}`,
    !!mkPeriodSel&&mkPeriodSel.id===p.id,'這一期還有沒排完的補課／調課')).join('');
  return`<div class="period-tabs">${base}${extra}</div>`;
}

function switchMkPeriod(id){
  const ex=mkExtraPeriods().find(p=>p.id===id);
  if(ex){mkPeriodSel=ex;renderMakeup();return;}   // 額外分頁：只換這一頁的視野
  mkPeriodSel=null;switchPeriod(id);              // 四顆基本分頁：維持原本行為（學生頁也跟著換）
}

function renderMakeup(){
  const period=mkViewPeriod();
  const fs=document.getElementById('f-subject').value;
  const ft=document.getElementById('f-type').value;
  const fq=(document.getElementById('f-search')?.value||'').trim().toLowerCase();
  const now=new Date();

  // 純曠課事件雖收在 makeupList（供學生統計），但不進補課清單
  const allInPeriod=makeupList.filter(e=>e.startDt>=period.start&&e.startDt<=period.end&&!isPureNoShow(e));
  const statusOf=new Map(allInPeriod.map(e=>[e.id,mkStatusOf(e,now)]));
  const cnt=st=>allInPeriod.filter(e=>statusOf.get(e.id)===st).length;
  // 排到一半（還欠人，但已經排掉幾場）＝兩邊都算：待安排要提醒還欠人、已安排要看得到排好的場次
  const isPartial=e=>statusOf.get(e.id)==='pending'&&getMakeupsFor(e.id).length>0;
  const pendingStatCnt=cnt('pending'),
        scheduledStatCnt=cnt('scheduled')+allInPeriod.filter(isPartial).length,
        completedStatCnt=cnt('completed');

  function matchesFilter(e){
    if(fs&&e.subject!==fs)return false;
    if(ft&&e.absType!==ft)return false;
    if(fq){const hay=(e.origTitle+' '+e.absentWho+' '+e.teacher+' '+(e.absentStudents||[]).join(' ')).toLowerCase();if(!hay.includes(fq))return false;}
    return true;
  }

  const filteredAll=allInPeriod.filter(matchesFilter);
  const byStatus=st=>filteredAll.filter(e=>statusOf.get(e.id)===st);
  const pending=byStatus('pending'),scheduledList=byStatus('scheduled'),
        completedList=byStatus('completed'),skippedList=byStatus('skipped');
  const partialList=pending.filter(isPartial);

  document.getElementById('rc').textContent=`共 ${filteredAll.length} 筆`;

  const topArea=document.getElementById('mk-top-area');
  if(topArea){
    topArea.innerHTML=mkPeriodTabsHtml()+`<div class="mk-stats">
      <div class="mk-stat mk-stat-pending"><div class="mk-stat-icon">⏰</div><div><div class="mk-stat-num">${pendingStatCnt}</div><div class="mk-stat-lbl">待安排</div></div></div>
      <div class="mk-stat mk-stat-arr"><div class="mk-stat-icon">🗓️</div><div><div class="mk-stat-num">${scheduledStatCnt}</div><div class="mk-stat-lbl">已安排</div></div></div>
      <div class="mk-stat mk-stat-done mk-stat-link" onclick="jumpToMkCompleted()" title="點擊查看已完成安排"><div class="mk-stat-icon">✅</div><div><div class="mk-stat-num">${completedStatCnt}</div><div class="mk-stat-lbl">已完成</div></div></div>
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

  // 撤銷來源狀態：請假→取消請假、調課→取消調課（跟今日卡／週視窗同一套函式）
  // 都跳置中視窗：單人＝確認、多人＝視窗裡挑要取消誰（見 absence.js cancelAbs）
  function undoBtn(e){
    if(e.absType==='調課')return`<button class="mk-btn-cancel" onclick="event.stopPropagation();cancelReschedule('${esc(e.id)}')">取消調課</button>`;
    if(!e.isAbsent)return'';
    return`<button class="mk-btn-cancel" onclick="event.stopPropagation();cancelAbs('${esc(e.id)}')">取消請假</button>`;
  }

  // 一場已排的補課／調課（一堂請假可以有好幾場，每場補不同的人）。
  // 已經上完的那場不給取消（跟「已完成」區同一個口徑：課都上完了不給改）
  function mkSessionRow(e,rec){
    const sd=new Date(rec.scheduledDate),se=new Date(rec.scheduledEnd);
    const done=se<now;
    const who=(rec.absentStudents||[]).join('、');
    const join=isJoinRec(rec);
    const acts=done?'':`<button class="mk-btn-cancel" onclick="event.stopPropagation();deleteMakeupScheduled('${esc(rec.id)}')">取消安排</button>`;
    return`<div class="mk-list-makeup">
      <span class="mk-list-makeup-lbl">${join?'併班補課':(e.absType==='調課'?'調課':'補課')}${who&&mkSplittable(e)?`・${esc(who)}`:''}：</span>
      <span>${sd.getMonth()+1}/${sd.getDate()}（${WD[sd.getDay()]}）</span>
      <span class="mk-dot">•</span>
      <span>${fmtT(sd)}–${fmtT(se)}</span>
      ${join?`<span class="mk-dot">•</span><span>👥 併入 ${esc(rec.hostTitle||'另一堂課')}</span>`:''}
      ${rec.room?`<span class="mk-dot">•</span><span>📍 ${esc(rec.room)}</span>`:''}
      ${rec.teacherNames?`<span class="mk-dot">•</span><span>👤 ${esc(rec.teacherNames)}</span>`:''}
      ${done?'<span class="mk-dot">•</span><span style="color:var(--tx3)">已上完</span>':''}
      ${acts?`<span class="mk-row-acts">${acts}</span>`:''}
    </div>`;
  }

  function pendingCard(e){
    const d=e.startDt,de=e.endDt,color=calColor(e.calName);
    const mode=e.absType==='調課'?'reschedule':'makeup';
    const tutorB=needsMakeupDecision(e); // 課前1hr內、補/不補待確認（一對一家教 / 個別補課的一對二）
    const recs=getMakeupsFor(e.id);
    // 排到一半的卡片要講清楚還差什麼，不然看起來跟完全沒排一樣。
    // 「一半」有兩種：多人請假只排掉幾個人、以及同一個人的時數只補了一部分（第 3 刀）
    const st=mkStBadgeInfo(e);
    const stBadge=`<span class="mk-badge ${st.cls}">${st.txt}</span>`;
    const waitWho=mkWaitTxt(e);
    return`<div class="mk-list-card${tutorB?' mk-confirm':''}" id="mk-${esc(e.id)}" onclick="startMakeupArrange('${esc(e.id)}','${mode}')">
      <div class="mk-list-bar" style="background:${color}"></div>
      <div class="mk-list-body">
        <div class="mk-list-top">
          <span class="mk-list-title">${mkCardTitle(e)}</span>
          ${absBadge(e)}${stBadge}${tutorB?'<span class="mk-badge" style="background:#F8EDEA;color:#C0504A;border:1px solid #E8C5BF" title="課前1小時內請假，補課要與家長確認。去排補課＝補（多收半堂）；不補則退半堂">⚠ 待確認補課</span>':''}
        </div>
        <div class="mk-list-meta">
          <span>📅 ${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）</span>
          <span>🕐 ${fmtT(d)}–${fmtT(de)}</span>
          ${e.classroom?`<span>📍 ${esc(e.classroom)}</span>`:''}
          ${e.teacher?`<span>👤 ${esc(e.teacher)}</span>`:''}
        </div>
        ${recs.length&&waitWho.length?`<div class="mk-list-wait">還沒排完：<b>${esc(waitWho.join('、'))}</b>（已排好的那幾場在下面「已安排」區）</div>`:''}
        ${mkNotesHtml(e,true)}
      </div>
      <div class="mk-list-actions">
        <button class="act-prog-btn" onclick="event.stopPropagation();mkNoteOpen('${esc(e.id)}','list')">${mkNoteState.openFor===e.id&&mkNoteState.openIn==='list'?'收起':'＋ 加進度'}</button>
        ${tutorB?`<button class="mk-btn-cancel" style="font-size:12px;padding:5px 10px;margin-left:0" onclick="event.stopPropagation();markMakeupSkip('${esc(e.id)}')">不補課</button>`:''}
        ${undoBtn(e)}
        <button class="mk-btn-arrange" onclick="event.stopPropagation();startMakeupArrange('${esc(e.id)}','${mode}')">${recs.length?'排剩下的':'安排'}</button>
      </div>
    </div>`;
  }

  function skippedCard(e){
    const d=e.startDt,de=e.endDt,color=calColor(e.calName);
    return`<div class="mk-list-card mk-completed" id="mk-${esc(e.id)}">
      <div class="mk-list-bar" style="background:${color}"></div>
      <div class="mk-list-body">
        <div class="mk-list-top">
          <span class="mk-list-title">${mkCardTitle(e)}</span>
          <span class="mk-badge" style="background:var(--sf2);color:var(--tx2);border:1px solid var(--br)">不補課・退半堂</span>
        </div>
        <div class="mk-list-meta">
          <span>📅 ${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）</span>
          <span>🕐 ${fmtT(d)}–${fmtT(de)}</span>
          ${e.teacher?`<span>👤 ${esc(e.teacher)}</span>`:''}
        </div>
        ${mkNotesHtml(e,false)}
      </div>
      <div class="mk-list-actions">
        <button class="mk-btn-cancel" onclick="unmarkMakeupSkip('${esc(e.id)}')">改為補課</button>
        ${undoBtn(e)}
      </div>
    </div>`;
  }

  // isPartial：這筆其實還在「待安排」區（還有人沒排完），只是把已排好的那幾場也放來這裡露臉
  // → 卡片 id 要跟待安排那張錯開，不然同頁兩個一樣的 id
  function scheduledCard(e,recs,isCompleted,isPartial){
    const d=e.startDt,de=e.endDt,color=calColor(e.calName);
    const st=isPartial?mkStBadgeInfo(e):null;
    const statusBadge=isCompleted
      ?`<span class="mk-badge mk-badge-done">✓ 已完成</span>`
      :isPartial
      ?`<span class="mk-badge ${st.cls}">${st.txt}</span>`
      :`<span class="mk-badge mk-badge-arr">✓ 已安排${recs.length>1?` ${recs.length} 場`:''}</span>`;
    const waitWho=isPartial?mkWaitTxt(e):[];
    return`<div class="mk-list-card${isCompleted?' mk-completed':' mk-arr'}" id="${isPartial?'mk-arr-':'mk-'}${esc(e.id)}">
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
        ${recs.map(r=>mkSessionRow(e,r)).join('')}
        ${waitWho.length?`<div class="mk-list-wait">還沒排完：<b>${esc(waitWho.join('、'))}</b>（去上面「待安排」區排）</div>`:''}
        ${mkNotesHtml(e,false)}
      </div>
    </div>`;
  }

  let html='';

  // 待安排
  html+=`<div class="mk-sec"><div class="mk-sec-head"><span class="mk-sec-dot" style="background:#EE9F3C"></span>待安排<span class="mk-sec-pill">${pending.length}</span></div>`;
  if(!pending.length){html+=`<div class="empty" style="padding:14px 0">全部已安排 🎉</div>`;}
  else{pending.forEach(e=>{html+=pendingCard(e);});}
  html+=`</div>`;

  // 已安排：排完的整筆，加上「排到一半」那幾筆已排好的場次（2026-08-11 老闆：排好的就該出現在這區）。
  // 排到一半的那筆同時留在待安排區（還欠人），所以會在兩區各出現一次——這是刻意的
  const arrList=scheduledList.concat(partialList).sort((a,b)=>a.startDt-b.startDt);
  html+=`<div class="mk-sec"><div class="mk-sec-head"><span class="mk-sec-dot" style="background:#6B8F7A"></span>已安排<span class="mk-sec-pill">${arrList.length}</span></div>`;
  if(!arrList.length){html+=`<div class="empty" style="padding:14px 0">尚無已安排補課</div>`;}
  else{arrList.forEach(e=>{const recs=getMakeupsFor(e.id);if(recs.length)html+=scheduledCard(e,recs,false,statusOf.get(e.id)==='pending');});}
  html+=`</div>`;

  // 已完成安排（最近完成的在上）
  if(completedList.length){
    const open=mkSecOpen.completed||!!fq;
    html+=`<div id="mk-sec-completed" class="mk-sec-lbl mk-sec-gap mk-sec-toggle" style="margin-top:24px" onclick="toggleMkSec('completed')"><span class="mk-sec-arrow">${open?'▾':'▸'}</span>已完成安排（${completedList.length}）</div>`;
    if(open){
      completedList
        .map(e=>({e,recs:getMakeupsFor(e.id)}))
        .filter(x=>x.recs.length)
        // 最近完成的在上：多場的話看最後一場
        .sort((a,b)=>new Date(b.recs[b.recs.length-1].scheduledDate)-new Date(a.recs[a.recs.length-1].scheduledDate))
        .forEach(x=>{html+=scheduledCard(x.e,x.recs,true);});
    }
  }

  // 不補課（退半堂）
  if(skippedList.length){
    const open=mkSecOpen.skipped||!!fq;
    html+=`<div class="mk-sec-lbl mk-sec-gap mk-sec-toggle" style="margin-top:24px" onclick="toggleMkSec('skipped')"><span class="mk-sec-arrow">${open?'▾':'▸'}</span>不補課・退半堂（${skippedList.length}）</div>`;
    if(open)skippedList.forEach(e=>{html+=skippedCard(e);});
  }

  c.innerHTML=html;
}

// 系統課堂的不補課標記：直接寫請假紀錄的 makeupSkip 欄
function sysSetMakeupSkip(ev,skipNames){
  const list=getAbsences().slice();
  const rec=list.find(a=>a.occId===ev.id);if(!rec)return;
  rec.makeupSkip=skipNames;
  rec.updatedAt=new Date().toISOString();
  saveAbsences(list);
}
// 標記「不補課」：把請假學生寫進事件隱藏欄位 makeupSkip → 退半堂、不算欠課、移出待安排
async function markMakeupSkip(id){
  const ev=findEventById(id);if(!ev)return;
  const skip=[...new Set([...(ev.makeupSkip||[]),...(ev.absentStudents||[])])];
  sysSetMakeupSkip(ev,skip);
  logAct('makeup',`標記 ${(ev.absentStudents||[]).join('、')} 不補課`,actEvLabel(ev),'退半堂、不算欠課、移出待安排');
  toast('已標記不補課（退半堂）','ok');
  await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
}
// 改回補課：把這筆的請假學生從 makeupSkip 移除
async function unmarkMakeupSkip(id){
  const ev=findEventById(id);if(!ev)return;
  const skip=(ev.makeupSkip||[]).filter(s=>!(ev.absentStudents||[]).includes(s));
  sysSetMakeupSkip(ev,skip);
  logAct('makeup',`把 ${(ev.absentStudents||[]).join('、')} 改回要補課`,actEvLabel(ev),'重新回到待安排清單');
  toast('已改為補課','ok');
  await Promise.all([loadToday(),loadWeek(),loadMakeup()]);
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
// 側欄紅點＝本期還有幾筆沒排完（只排掉一部分人的也算，跟清單「待安排」區同一個判斷）
// 側欄紅色數字的起算點＝**今天所在期別**的第一天，往後不設上限
// （＝這學期 + 之後所有學期的加總，2026-08-13 老闆定）。兩個方向都是刻意的：
//   · 不設上限 → 8 月標的 9 月調課才數得到（綁單一期別的話數字不會動，等於從沒提醒過）
//   · 有下限   → 上個學期沒處理完的舊帳不再一直吵；要查舊帳去清單切那一期的分頁
// ⚠ 起算點看**今天**，不是上面選的分頁——分頁切來切去，側欄數字不該跟著跳。
// ⚠ 閏年 2/29 卡在寒假（2/1–2/28）與下學期（3/1）之間的縫裡，periodOfDate 會回 null →
//   這裡改用「開始日已經過了的最後一段」，寧可多算也不要漏算。
function mkCountFromDate(now){
  const t=now||new Date(),ps=getPeriods();
  return (ps.filter(p=>p.start<=t).pop()||ps[0]).start;
}
// 還沒排的補課／調課有幾筆（側欄數字與今日頁提醒共用同一支，口徑只有這一份）
function mkPendingTotal(now){
  const t=now||new Date(),from=mkCountFromDate(t);
  return makeupList.filter(e=>e.startDt>=from&&!isPureNoShow(e)&&mkStatusOf(e,t)==='pending').length;
}
function updateMakeupBadge(now){const n=mkPendingTotal(now);updateBadge(n);return n;}

// ── 標記完請假／調課，原地接上排補課（2026-08-13 老闆要求）──
// 以前標記完只丟一句 toast 就結束，要排補課得自己換頁去待補課清單、在一堆卡片裡把
// 剛剛那筆找回來——系統當下明明就知道是誰、哪一堂、欠多久，卻要人重講一次。
// 這裡問一句就直接把選時段視窗開起來；按「晚點再排」＝跟以前完全一樣（紀錄照樣進清單）。
// 走 startMakeupArrange 而不是直接開視窗，是為了跟待補課清單那顆「安排」走同一條路
// （多人請假一樣會先問「這次要幫誰排」），不另長一套行為。
async function offerArrangeNow(id,mode){
  if(typeof startMakeupArrange!=='function')return;
  const ev=findEventById(id);
  if(!ev)return;
  if(!mkPendingCount(ev))return;   // 這堂該排的都排完了（多人請假分批標時會遇到）就別再問
  // 顯示的名字用「還沒排的人」而不是「這次剛標的人」——按下去之後真正會被排的就是這一批，
  // 兩邊講的人不一樣的話，視窗說要補甲、下一步卻列出甲乙丙
  const names=mkSplittable(ev)?mkPendingNames(ev):[];
  const isResched=mode==='reschedule';
  const sub=`${esc(ev.origTitle)}　${fmtD(ev.startDt)} ${fmtT(ev.startDt)}`;
  const line=isResched?'整堂移到新的時段'
    :names.length?`要補的人：<b>${esc(names.join('、'))}</b>`:'整堂補課';
  const ok=await uiConfirm({
    title:isResched?'要現在排調課時段嗎？':'要現在排補課嗎？',
    html:`<div class="abs-title" style="margin-bottom:8px">${sub}</div>
      <div style="font-size:13.5px;line-height:1.7">${line}</div>
      <div class="ask-note" style="margin-top:10px">日期上會直接標出哪幾天排得進去（已扣掉教室、老師、學生自己的課）。
        現在不排也沒關係，這筆已經進<b>待補課/調課清單</b>，隨時可以回去排。</div>`,
    ok:'好，選時段',cancel:'晚點再排'});
  if(!ok)return;
  await startMakeupArrange(id,mode);
}

// ── 安排補課的入口：多人請假時先問「這次要幫誰排」──
// 2026-08-05 起補課可以拆開排（三人同缺 → 各排各的時段），所以按「安排」不再直接跳時段選擇器。
// 只剩一個人、或整堂性質的（老師請假、調課）沒得挑，直接進時段選擇器。
async function startMakeupArrange(id,mode){
  const e=findEventById(id);if(!e)return;
  const pend=mkPendingNames(e);
  if(mode==='reschedule'||!mkSplittable(e)||pend.length<=1){
    openSlotPicker(id,mode,pend.length?pend:null);
    return;
  }
  const picked=await pickMakeupStudents(e,pend);
  if(picked)openSlotPicker(id,mode,picked);
}

// 選人視窗：**預設一個都不選、自己挑**（2026-08-05 老闆定；一度做成預設全選，
// 但全亮的樣子跟「你剛剛選的」分不出來）。整團一起補按「全選」一下就好。
// chip 前面的 ✓ 與上面的即時計數留著，選了誰一眼看得出來。
function mkPickToggle(el){el.classList.toggle('checked');mkPickSync();}
function mkPickAll(on){
  document.querySelectorAll('#ask-pick-chips .stu-chip').forEach(c=>c.classList.toggle('checked',on));
  mkPickSync();
}
function mkPickSync(){
  const all=[...document.querySelectorAll('#ask-pick-chips .stu-chip')];
  const n=all.filter(c=>c.classList.contains('checked')).length;
  const el=document.getElementById('mk-pick-n');if(el)el.textContent=n;
}

async function pickMakeupStudents(e,names){
  let sel=[];
  for(;;){
    const chips=names.map(s=>`<div class="stu-chip${sel.includes(s)?' checked':''}" data-name="${esc(s)}" onclick="mkPickToggle(this)"><span class="mk-pick-tick">✓</span>${esc(s)}</div>`).join('');
    const ok=await uiConfirm({title:'這次要幫誰排補課？',ok:'下一步：選時段',
      html:`<div class="abs-title" style="margin-bottom:8px">${esc(e.origTitle)}　${fmtD(e.startDt)} ${fmtT(e.startDt)} 請假</div>
        <div class="mk-pick-head">
          <span>已選 <b id="mk-pick-n">${sel.length}</b> / ${names.length} 人</span>
          <span class="mk-pick-acts">
            <button type="button" class="btn btns" onclick="mkPickAll(true)">全選</button>
            <button type="button" class="btn btns" onclick="mkPickAll(false)">全不選</button>
          </span>
        </div>
        <div class="stu-chips" id="ask-pick-chips">${chips}</div>
        <div class="ask-note" style="margin-top:12px">挑這次要一起補的人（整團一起補按<b>全選</b>）。沒選到的留在待安排，可以另外排別的時段。</div>`});
    if(!ok)return null;
    sel=[...document.querySelectorAll('#ask-pick-chips .stu-chip.checked')].map(el=>el.dataset.name);
    if(sel.length)return sel;
    toast('請至少選一位學生','inf');
  }
}

// ── Slot Picker（補課/調課時段選擇器）──
// 這次要補的人（可能只是請假名單的一部分）。時長、課型、教室容量都看這一份，不看整堂請假名單
function spStudents(){
  const s=slotPicker.students;
  return(s&&s.length)?s:(slotPicker.ev?.absentStudents||[]);
}

// 一場補課／調課「預設」多長。純函式版（不吃 slotPicker），時數帳的分母也用它——
// 分母跟預設值同一個數字，所以「照預設排一場」＝剛好補完，行為跟拆分之前一致。
// 補課維持原時長：練習課、家教一對一（type==='one'）。其餘（一對二 pair、團班 group）砍半堂。
function calcMakeupDur(ev,mode){
  const d=ev?.durMins||60;
  if(mode!=='makeup')return d;                       // 調課＝整堂移走，原長
  if(ev?.type==='practice'||ev?.type==='one')return d;
  return Math.max(30,Math.floor(d/2));
}
// 自訂時段每一列自己帶長度，不走這支（見 spCustomRange）
function getEffectiveDur(){return calcMakeupDur(slotPicker.ev,slotPicker.mode);}

function getEffectiveType(){
  const ev=slotPicker.ev;
  if(slotPicker.mode==='makeup'&&ev.type==='group'){
    const n=spStudents().length||1;
    return n===1?'one':n===2?'pair':'group';
  }
  return ev.type;
}

function getEffectiveStudentCount(){
  const ev=slotPicker.ev;
  if(slotPicker.mode==='makeup'&&ev.type==='group')return Math.max(1,spStudents().length);
  return ev.students.length||1;
}

// students＝這次要補的人（null＝整堂請假名單）；recId＝改期既有那場（null＝新排一場）
function openSlotPicker(id,mode,students,recId){
  const ev=findEventById(id);
  if(!ev)return;
  const branch=ev.classroom==='石牌分校'?'石牌':'北投';
  // teacherId：null＝原班老師（預設）；選了別人就存那位的 id。改期既有那場時沿用它上次選的人
  const prevRec=recId?findMakeupRec(recId):null;
  const prevT=(prevRec&&Array.isArray(prevRec.teacherIds)&&prevRec.teacherIds.length)?prevRec.teacherIds[0]:null;
  slotPicker={ev,mode,date:null,time:null,room:null,avail:null,branch,students:students||null,recId:recId||null,join:null,custom:null,teacherId:prevT};
  spAvailCache={};spDayCache={};   // 逐日展開／逐日空檔統計的快取：換一筆請假就作廢
  const d=ev.startDt;
  const ds=`${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）${fmtT(d)}  ⏱ ${fmtDur(ev.durMins)}`;
  const who=mkSplittable(ev)?spStudents():[];
  document.getElementById('sp-title').textContent=(mode==='makeup'?'安排補課：':'安排調課：')
    +(who.length?`${who.join('、')} — ${ev.origTitle}`:ev.origTitle);
  document.getElementById('sp-sub').textContent=(mode==='makeup'?'缺課日期：':'調課日期：')+ds+(ev.teacher?`  👤 ${ev.teacher}`:'');
  renderSpBody();
  document.getElementById('sp-modal').classList.add('open');
}

function closeSlotPicker(){
  document.getElementById('sp-modal').classList.remove('open');
  slotPicker={ev:null,mode:null,date:null,time:null,room:null,avail:null,branch:null,students:null,recId:null,join:null,custom:null,teacherId:null};
  spAvailCache={};spDayCache={};
}

// ── 這場補課／調課誰來上（2026-08-11 老闆要求）──
// 預設原班老師，可以換人。換的當下時段要重算——老師是「灰不灰」的判斷條件之一，
// 先照原老師挑好時段再換人的話，撞課檢查等於白做。
function spTeacherRef(){
  const ev=slotPicker.ev;
  if(slotPicker.teacherId==null)return ev;   // 原班老師：整包沿用課堂本身（含舊資料只有名字的情況）
  return{...ev,teacherIds:[slotPicker.teacherId],teacher:teacherNameById(slotPicker.teacherId)};
}
// 存進紀錄用：原老師＝不存（跟著母課程走，之後課程換老師補課也跟著換），換過人才存快照
function spTeacherPick(){
  if(slotPicker.teacherId==null)return null;
  return{ids:[slotPicker.teacherId],names:teacherNameById(slotPicker.teacherId)};
}
function setSpTeacher(v){
  const id=v===''?null:Number(v);
  slotPicker={...slotPicker,teacherId:id,time:null,room:null};
  renderSpBody();
}

// 併班補課只對「學生請假的補課」開放：調課是整堂移走、老師請假沒有個別名單，
// 兩者都沒有「把某幾個人塞進別班」這回事
function spCanJoin(){
  return slotPicker.mode==='makeup'&&mkSplittable(slotPicker.ev)&&spStudents().length>0;
}

function renderSpBody(){
  const body=document.getElementById('sp-body');
  if(!body)return;   // 視窗還沒開／測試環境沒有 DOM：狀態改完就好，不用重畫
  body.innerHTML='';
  const joined=!!slotPicker.join;
  const custom=!!slotPicker.custom;
  const step=custom?1:!slotPicker.date?1:joined?3:!slotPicker.time?2:!slotPicker.room?3:4;
  body.appendChild(buildSpStepper(step,joined,custom));
  // 自訂展開時獨占畫面：每一列自己帶日期，用不到下面的「選擇日期」
  if(custom){body.appendChild(buildSpCustomSection());return;}
  // 收合時只是一行入口，擺在「選擇日期」**之前**（2026-08-10 老闆要求）——
  // 自訂根本不吃上面選的日期，擺在後面會讓人以為要先選一天才能自訂
  body.appendChild(buildSpCustomSection());
  body.appendChild(buildSpDateSection());
  if(slotPicker.date&&spCanJoin())body.appendChild(buildSpJoinSection());
  if(joined){body.appendChild(buildSpConfirm());return;} // 併班＝時間教室都跟主課，不用再選
  if(slotPicker.date)body.appendChild(buildSpTimeSection());
  if(slotPicker.time)body.appendChild(buildSpRoomSection());
  if(slotPicker.room)body.appendChild(buildSpConfirm());
}

// B4 視覺指示 stepper（純反映目前進度，不影響流程）
function buildSpStepper(cur,joined,custom){
  // 自訂沒有「選日期」這一步——日期在每一列裡面
  const steps=custom?['自訂時段','確認']:joined?['日期','併班','確認']:['日期','時段','教室','確認'];
  const wrap=document.createElement('div');
  wrap.className='sp-stepper';
  wrap.innerHTML=steps.map((s,i)=>{
    const n=i+1,st=n<cur?'done':n===cur?'cur':'todo';
    return`<div class="sp-step sp-step-${st}"><span class="sp-step-dot">${n<cur?'✓':n}</span><span class="sp-step-lbl">${s}</span></div>`;
  }).join('<span class="sp-step-line"></span>');
  return wrap;
}

function buildSpDateSection(){
  const sec=document.createElement('div');
  sec.innerHTML=`<div class="sp-lbl">選擇日期</div><div class="sp-date-sum"></div><div class="sp-chips"></div>`;
  const chips=sec.querySelector('.sp-chips');
  const today=new Date();today.setHours(0,0,0,0);
  const quickDates=new Set();
  const open=[];      // 這 14 天裡排得進去的（給上面那行摘要用）
  let joinDays=0;
  for(let i=0;i<14;i++){
    const d=new Date(today);d.setDate(today.getDate()+i);
    const ds=toDateStr(d);
    quickDates.add(ds);
    const sum=spDaySummary(ds);
    if(sum.n)open.push({d,sum});
    if(sum.join)joinDays++;
    const el=document.createElement('div');
    el.className='sp-date'+(slotPicker.date===ds?' sp-sel':'')+((sum.n||sum.join)?'':' sp-date-full');
    const tag=i===0?'今天':i===1?'明天':'&nbsp;';
    // 併班優先標（零旋鈕、最省事的一條路），沒得併才標可排時段數
    const badge=sum.join?`<div class="sp-date-av sp-av-join">⭐併</div>`
      :sum.n?`<div class="sp-date-av">${sum.n}</div>`
      :`<div class="sp-date-av sp-av-0">滿</div>`;
    el.title=sum.join?`可併進 ${sum.join} 堂現有的課`:sum.n?`${sum.n} 個可排時段，最早 ${sum.first}`:'當天沒有整段空檔';
    el.innerHTML=`<div class="sp-date-tag">${tag}</div><div class="sp-date-num">${d.getMonth()+1}/${d.getDate()}</div><div class="sp-date-wd">週${WD[d.getDay()]}</div>${badge}`;
    el.onclick=()=>selectSpDate(ds);
    chips.appendChild(el);
  }
  // 摘要行：要打電話問老師／家長「哪天可以」時，這一行直接照著念
  const sumEl=sec.querySelector('.sp-date-sum');
  const parts=[];
  if(open.length){
    const f=open[0];
    parts.push(`<b>${open.length}</b> 天排得進去，最早 <b>${f.d.getMonth()+1}/${f.d.getDate()}（${WD[f.d.getDay()]}）${f.sum.first}</b>`);
  }
  if(joinDays)parts.push(`<span class="sp-sum-join">⭐ ${joinDays} 天可併進現有的課</span>`);
  sumEl.className='sp-date-sum'+(open.length||joinDays?'':' sp-date-sum-none');
  sumEl.innerHTML=parts.length?`接下來 14 天：${parts.join('　・　')}`
    :'接下來 14 天都沒有整段空檔——可用上面的「自訂時段」自己指定，系統只警告不擋';
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
  slotPicker={...slotPicker,date:ds,time:null,room:null,avail:null,join:null,custom:null};
  // 空檔改掃系統課表（系統課程＋已排補課/調課場次），不再讀 Google Calendar。
  // 走 spAvailFor：跟自訂各列共用同一份快取，改期時排除自己那筆的規則也只寫一處
  slotPicker.avail=spAvailFor(ds);
  renderSpBody();
}

// ── 併班補課：選一堂當天的課，讓這幾個人進去一起上 ──
// 選了就跳過「時段／教室」——時間、教室都跟著主課走，沒得挑
function selectSpJoin(occId){
  slotPicker={...slotPicker,join:slotPicker.join===occId?null:occId,time:null,room:null,custom:null};
  renderSpBody();
}

// 只列三個條件全中的（同科目＋同年級＋同老師）。差一項就不列——
// 2026-08-10 老闆定：「三個條件都不滿足就不用列了」，沒有「攤開看全部」那條路。
// 一堂都沒有時只留一行灰字（讓人知道系統找過了），下面的「選時段 → 選教室」照走。
function buildSpJoinSection(){
  const sec=document.createElement('div');
  const ev=slotPicker.ev,who=spStudents();
  const list=mkJoinCandidates(ev,slotPicker.avail,who).filter(c=>c.exact);
  const crit=mkJoinCriteriaTxt(ev,who);
  if(!list.length){
    sec.innerHTML=`<div class="sp-join-empty">當天沒有可以併班的課${crit?`（找的是${esc(crit)}）`:''}——往下選時段另開一場</div>`;
    return sec;
  }
  sec.innerHTML=`<div class="sp-lbl">⭐ 併進當天的課${crit?`（${esc(crit)}）`:''}</div>
    <div class="sp-join-note">${esc(who.join('、'))} 直接進那堂一起上，<b>不另開場次</b>。只列<b>同科目、同年級、同老師</b>的課；進度合不合請自己看。</div>
    <div class="sp-join-list"></div>
    <div class="sp-join-or">或　另開一場補課 ↓</div>`;
  const box=sec.querySelector('.sp-join-list');
  list.forEach(({occ})=>{
    const roster=eventRoster(occ);
    const already=roster.filter(n=>who.includes(n));
    const addN=who.filter(n=>!roster.includes(n)).length;
    const cap=ROOM_CAP[occ.classroom];
    const over=cap&&roster.length+addN>cap;
    // 併班也要看學生那時段有沒有別的課（只警告不擋——併班本來就是人工判斷進度的路）
    const stuBusy=mkStudentBusyAt(who,slotPicker.avail,occ.startDt,occ.endDt,[occ.id,ev.id]);
    const el=document.createElement('div');
    el.className='sp-join'+(slotPicker.join===occ.id?' sp-sel':'');
    el.innerHTML=`<div class="sp-join-t">${esc(occ.origTitle)}</div>
      <div class="sp-join-m">${fmtT(occ.startDt)}–${fmtT(occ.endDt)}${occ.classroom?'・'+esc(occ.classroom):''}${occ.teacher?'・'+esc(occ.teacher):''}</div>
      <div class="sp-join-m">名單 ${roster.length} 人 → <b>${roster.length+addN} 人</b>${over?`<span class="sp-join-w">⚠ 超過 ${esc(occ.classroom)} 上限 ${cap}</span>`:''}${already.length?`<span class="sp-join-w">${esc(already.join('、'))} 已在名單</span>`:''}</div>
      ${stuBusy.length?`<div class="sp-join-m"><span class="sp-join-w">⚠ ${esc(mkStudentBusyTxt(who,stuBusy))}</span></div>`:''}`;
    el.onclick=()=>selectSpJoin(occ.id);
    box.appendChild(el);
  });
  return sec;
}

function overlaps(s1,e1,s2,e2){return s1<e2&&e1>s2;}

// ── 老師有沒有空（第 3 刀補的漏洞，2026-08-10）──
// 在這之前空檔判斷只看教室，老師從頭到尾只拿來顯示文字——所以系統會推薦「那位老師
// 正在隔壁班上課」的時段，排下去才發現撞人。老師身分比對沿用併班那套（先 teacherIds、
// 舊資料才退回比名字），一邊完全沒老師資料時不當作衝突。
// 回傳撞到的那幾堂（空陣列＝有空），呼叫端自己決定要擋還是只警告。
function mkTeacherBusyAt(ev,avail,sS,sE){
  const ids=mkTeacherIds(ev),names=mkTeacherNames(ev);
  if(!ids.size&&!names.size)return[];
  return (avail||[]).filter(o=>{
    if(o.id===ev.id)return false;
    if(o.isFullAbsent||o.isRescheduled)return false;   // 整堂沒上＝老師其實有空
    if(!overlaps(o.startDt,o.endDt,sS,sE))return false;
    const oi=mkTeacherIds(o);
    if(ids.size&&oi.size)return _setsHit(ids,oi);
    const on=mkTeacherNames(o);
    return on.size&&names.size&&_setsHit(names,on);
  });
}

// ── 學生有沒有空（2026-08-11 老闆要求）──
// 教室、老師都看了，就差學生自己：以前系統會推薦「這孩子那時段本來就有另一堂課」的時段。
// 比對用名字（課堂名冊就是名字陣列）。三種情況不算撞：整堂沒上（老師請假／調課移走）、
// 他那堂本來就請假／曠課（人是空的）、以及正在改期的那場自己。
// 併班補課的人不長自己一堂（見 expandMakeupForRange），所以主課的名冊要另外把他們加回來。
// 回傳撞到的那幾堂（空陣列＝有空），呼叫端自己決定要擋還是只警告。
function mkStudentBusyAt(names,avail,sS,sE,skipIds){
  const who=(names||[]).filter(Boolean);
  if(!who.length)return[];
  const skip=new Set([].concat(skipIds||[]).filter(Boolean));
  return (avail||[]).filter(o=>{
    if(skip.has(o.id))return false;
    if(o.isFullAbsent||o.isRescheduled)return false;
    if(!overlaps(o.startDt,o.endDt,sS,sE))return false;
    const roster=new Set(o.students||[]);
    joinRecsOn(o.id).forEach(r=>(r.absentStudents||[]).forEach(n=>roster.add(n)));
    const free=new Set([...(o.absentStudents||[]),...(o.noShowStudents||[])]);
    return who.some(n=>roster.has(n)&&!free.has(n));
  });
}
// 「阿明 8/12 15:00 有課：高二數學班」這種說明字串，時段提示與自訂列共用
function mkStudentBusyTxt(names,busy){
  const who=(names||[]).filter(Boolean);
  const hit=busy.map(o=>{
    const stuck=who.filter(n=>{
      const roster=new Set(o.students||[]);
      joinRecsOn(o.id).forEach(r=>(r.absentStudents||[]).forEach(x=>roster.add(x)));
      const free=new Set([...(o.absentStudents||[]),...(o.noShowStudents||[])]);
      return roster.has(n)&&!free.has(n);
    });
    return`${stuck.join('、')}那時段有課：${o.origTitle}（${fmtT(o.startDt)}–${fmtT(o.endDt)}）`;
  });
  return hit.join('；');
}

function switchSpBranch(b){
  slotPicker={...slotPicker,branch:b,time:null,room:null};
  renderSpBody();
}

// ── 日期列直接標「那天排不排得進去」（2026-08-13 老闆要求）──
// 以前 14 顆日期長得一模一樣，哪天有空完全看不出來——要回答家長「哪天可以補」，
// 只能一顆一顆點進去看時段列，等於一次決策要按十幾下。
// 空檔判斷（教室夠不夠／老師撞不撞課／學生自己那時段有沒有別堂課）本來就寫好了，
// 只是要等你選了某一天才跑；這裡把**完全同一套判斷**提前對每一天各跑一次，結果標回日期上。
// ⚠ 刻意共用 hasSuitableRoom／mkTeacherBusyAt／mkStudentBusyAt 而不另寫一份簡化版：
//    日期上寫「3 個時段」點進去卻全灰，比沒有這個標記更糟。
// 回傳 {n:可排時段數, first:'19:00' 最早那個, join:可併班的課數}
var spDayCache={};
function spDaySummary(ds){
  const ev=slotPicker.ev;
  const out={n:0,first:null,join:0};
  if(!ev||!ds)return out;
  // 分校與老師一換，答案就不一樣（兩者都是灰不灰的判斷條件），所以都進快取鍵
  const key=`${ds}|${slotPicker.branch}|${slotPicker.teacherId}`;
  if(spDayCache[key])return spDayCache[key];
  const avail=spAvailFor(ds);
  const dur=getEffectiveDur();
  const who=spStudents();
  const [y,m,d]=ds.split('-').map(Number);
  const {start:startMin,end:endMin}=bizHoursOn(new Date(y,m-1,d));
  if(spCanJoin())out.join=mkJoinCandidates(ev,avail,who).filter(c=>c.exact).length;
  const isPracticeMakeup=getEffectiveType()==='practice'&&slotPicker.mode==='makeup';
  const newStu=who.length||1;
  const tRef=spTeacherRef();
  for(let total=startMin;total<=endMin-dur;total+=30){
    const h=Math.floor(total/60),mi=total%60;
    const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+dur);
    let ok;
    if(isPracticeMakeup){
      // 練習課補課：跟 buildSpTimeSection 同規則——有現成練習課就看塞不塞得下 16 人，沒有就是獨立時段
      const practEvs=avail.filter(e=>e.type==='practice'&&overlaps(e.startDt,e.endDt,sS,sE));
      ok=practEvs.length?practEvs.reduce((s,e)=>s+(e.students.length||1),0)+newStu<=16:true;
    }else{
      ok=hasSuitableRoom(sS,sE,avail)
        &&!mkTeacherBusyAt(tRef,avail,sS,sE).length
        &&!mkStudentBusyAt(who,avail,sS,sE,ev.id).length;
    }
    if(ok){
      out.n++;
      if(!out.first)out.first=`${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
    }
  }
  spDayCache[key]=out;
  return out;
}

// avail 省略＝看目前選的那一天（slotPicker.avail）。日期列要對 14 天各算一次，
// 所以改成可以外面餵當天的課表進來，不然只能算「已經點開的那天」
function hasSuitableRoomShipai(sStart,sEnd,availIn){
  const etype=getEffectiveType();
  const active=(availIn||slotPicker.avail).filter(e=>e.classroom==='石牌分校'&&!e.isAbsent&&!e.isRescheduled&&overlaps(e.startDt,e.endDt,sStart,sEnd));
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

function hasSuitableRoom(sStart,sEnd,availIn){
  if(slotPicker.branch==='石牌')return hasSuitableRoomShipai(sStart,sEnd,availIn);
  const avail=availIn||slotPicker.avail;
  const etype=getEffectiveType();
  if(etype==='practice')return getRoomAvail(avail,'大教室',sStart,sEnd).available;
  if(etype==='one'){
    if(getRoomAvail(avail,'大教室',sStart,sEnd).available)return true;
    return ROOMS_SMALL.some(r=>getRoomAvail(avail,r,sStart,sEnd).available);
  }
  const need=etype==='pair'?2:getEffectiveStudentCount();
  return ROOMS_SMALL.some(r=>ROOM_CAP[r]>=need&&getRoomAvail(avail,r,sStart,sEnd).available);
}

// 「上課老師」下拉，擺在選時段的最上面：換人 → 下面整排時段跟著用新老師的行事曆重算
function buildSpTeacherHtml(){
  const ev=slotPicker.ev;
  const orig=[...mkTeacherNames(ev)].join('、');
  const all=(typeof getTeachers==='function'?getTeachers():[]);
  const cur=slotPicker.teacherId;
  // 在職的都列；已經選到的那位就算後來離職也要留著，不然下拉會顯示成別人
  const list=all.filter(t=>(t.status||'在職')==='在職'||t.id===cur);
  const opts=`<option value=""${cur==null?' selected':''}>${orig?esc(orig)+'（原老師）':'原老師（未設定）'}</option>`
    +list.map(t=>`<option value="${t.id}"${cur===t.id?' selected':''}>${esc(t.name)}${(t.status||'在職')!=='在職'?'（已離職）':''}</option>`).join('');
  return`<div class="sp-teacher"><span class="sp-teacher-lbl">上課老師</span>
    <select class="sp-teacher-sel" onchange="setSpTeacher(this.value)">${opts}</select>
    ${cur!=null?`<span class="sp-teacher-note">已改由 ${esc(teacherNameById(cur))} 上這一場（原${orig?` ${esc(orig)}`:'課老師'}）</span>`:''}</div>`;
}

function buildSpTimeSection(){
  const sec=document.createElement('div');
  const dur=getEffectiveDur();
  const isPracticeMakeup=getEffectiveType()==='practice'&&slotPicker.mode==='makeup';
  const branchToggle=`<div class="period-tabs sp-seg" style="margin-bottom:10px"><button class="period-tab${slotPicker.branch==='北投'?' active':''}" onclick="switchSpBranch('北投')">北投分校</button><button class="period-tab${slotPicker.branch==='石牌'?' active':''}" onclick="switchSpBranch('石牌')">石牌分校</button></div>`;
  sec.innerHTML=`<div class="sp-lbl">選擇時段（${fmtDur(dur)}${slotPicker.mode==='makeup'&&dur!==slotPicker.ev.durMins?'，補課縮短至原時長一半':''}）</div>${buildSpTeacherHtml()}${branchToggle}${slotPicker.avail===null?'<div style="color:var(--tx2);font-size:13px">讀取中...</div>':'<div class="sp-chips-wrap"></div>'}`;
  if(!slotPicker.avail)return sec;
  const wrap=sec.querySelector('.sp-chips-wrap');
  const [y,m,d]=slotPicker.date.split('-').map(Number);
  const {start:startMin,end:endMin}=bizHoursOn(new Date(y,m-1,d)); // 營業時間見 state.js BIZ_HOURS
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
    const newStu=spStudents().length||1;
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
    const addGroup=(label,slots,mkEl,highlight)=>{
      if(!slots.length)return;
      const box=highlight?document.createElement('div'):wrap;
      if(highlight)box.className='sp-practice-hl';
      const lbl=document.createElement('div');lbl.className='sp-group-lbl';lbl.textContent=label;
      const chips=document.createElement('div');chips.className='sp-chips';
      slots.forEach(s=>chips.appendChild(mkEl(s)));
      box.appendChild(lbl);box.appendChild(chips);
      if(highlight)wrap.appendChild(box);
    };
    addGroup('⭐ 可加入現有練習課',joinSlots,({h,mi,remaining})=>mkTime(h,mi,`剩${remaining}席`),true);
    addGroup('獨立時段',freeSlots,({h,mi})=>mkTime(h,mi,null),false);
    if(!joinSlots.length&&!freeSlots.length){
      const empty=document.createElement('div');empty.style.cssText='font-size:13px;color:var(--tx2)';empty.textContent='當天無可用時段';wrap.appendChild(empty);
    }
  }else{
    const chips=document.createElement('div');chips.className='sp-chips';wrap.appendChild(chips);
    const who=spStudents();
    const tRef=spTeacherRef(),tName=[...mkTeacherNames(tRef)].join('、');
    let busyN=0,stuBusyN=0;
    for(let total=startMin;total<=endMin-dur;total+=30){
      const h=Math.floor(total/60),mi=total%60;
      const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+dur);
      const roomOk=hasSuitableRoom(sS,sE);
      // 老師撞課的時段一樣灰掉：推薦路徑只給乾淨的選項，真要硬排走下面的「自訂時段」
      const busy=roomOk?mkTeacherBusyAt(tRef,slotPicker.avail,sS,sE):[];
      // 學生自己那時段有課的也灰掉（2026-08-11）——排了他也來不了
      const stuBusy=(roomOk&&!busy.length)?mkStudentBusyAt(who,slotPicker.avail,sS,sE,slotPicker.ev.id):[];
      const ok=roomOk&&!busy.length&&!stuBusy.length;
      if(busy.length)busyN++;
      if(stuBusy.length)stuBusyN++;
      const el=document.createElement('div');
      el.className=`sp-time${isSel(h,mi)?' sp-sel':''}${!ok?' sp-na':''}`;
      el.textContent=`${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`;
      // 灰掉的原因：以前只塞 title（要滑鼠停著才看得到，平板根本沒有 hover）。
      // 2026-08-11 改成點下去就在下面那行講原因，桌機平板都看得到；title 留著給桌機快速偷看
      const why=busy.length?`${tName}那時段有課：${busy.map(o=>o.origTitle).join('、')}`
        :stuBusy.length?mkStudentBusyTxt(who,stuBusy)
        :!roomOk?'那時段沒有合適的空教室':'';
      if(why)el.title=why;
      if(ok)el.onclick=()=>selectSpTime(h,mi);
      else el.onclick=()=>showSpWhy(`${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')} 不能排：${why}`);
      chips.appendChild(el);
    }
    const note=document.createElement('div');
    note.className='sp-time-note';
    note.id='sp-time-note';
    const why=['沒有合適空教室'];
    if(busyN>0)why.push(`${tName||'該老師'}那時段有課`);
    if(stuBusyN>0)why.push(`${who.join('、')||'學生'}那時段自己有課`);
    note.textContent=`灰掉的時段＝${why.join('，或')}${busyN+stuBusyN>0?'（點灰色的看是哪一堂）':''}`;
    note.dataset.def=note.textContent;
    wrap.appendChild(note);
  }
  return sec;
}

// 點灰掉的時段：就地把原因寫在下面那行說明（平板沒有 hover，title 看不到）。
// 再點空白處或選別的時段就會回到預設說明——這行本來就會隨重畫回原樣
function showSpWhy(txt){
  const note=document.getElementById('sp-time-note');
  if(!note)return;
  note.textContent='⚠ '+txt;
  note.classList.add('sp-time-note-hit');
}

function selectSpTime(h,mi){
  slotPicker={...slotPicker,time:{h,mi},room:null};
  renderSpBody();
  // 捲到剛長出來的那一段。以前抓 #sp-body 的第 N 個子節點，有併班區或自訂入口就會偏掉
  setTimeout(()=>document.querySelector('.sp-room-sec')?.scrollIntoView({behavior:'smooth',block:'nearest'}),60);
}

function buildSpRoomSection(){
  const sec=document.createElement('div');
  sec.className='sp-room-sec';
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
  setTimeout(()=>document.querySelector('.sp-cfm-sec')?.scrollIntoView({behavior:'smooth',block:'nearest'}),60);
}

// ── 自訂時段（第 3 刀，2026-08-10）──
// 推薦空堂只給「整半點 × 系統算的長度 × 判定合格的教室」三選一都沒得改。要把一堂請假
// 拆成幾場補足（老闆講的典型用法：掛在自己下次上課的前後），那三項都得能自己填。
// 這裡**不擋任何組合**，只把老師撞課／教室已有課／超出營業時間／超過教室人數現場算給你看。
// 推薦空堂那條路一步沒少，這是併存的第三條（併班＝零旋鈕、推薦＝系統挑、自訂＝你說了算）。
// **一次排好幾場**（2026-08-10 老闆要求）：每一列自己帶日期／開始／時長／教室，
// 上面即時算「該補 2小時｜已填 1小時30分｜還差 30分」，按一次確認全部存進去。
// 一堂請假拆成幾場補足本來就要跨好幾天，一場一場走完整個流程太蠢。

// 自訂路徑不篩教室（篩選是推薦路徑的事），兩個分校全列。從 state.js 的常數長出來，
// 之後加教室只要改 ROOMS_SMALL 一處
function spAllRooms(){
  const list=['大教室',...ROOMS_SMALL,'石牌分校'];
  // 舊資料可能帶著不在清單裡的教室名，補進去才不會「下拉顯示的」跟「實際會存的」對不起來
  const extra=spCustomRows().map(r=>r.room).filter(r=>r&&!list.includes(r));
  return [...new Set([...extra,...list])];
}
function minToHHMM(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
function spCustomRows(){return (slotPicker.custom&&slotPicker.custom.rows)||[];}

// 每一列的日期都可能不同 → 各自要一份當天的課表。逐日展開有成本，同一天只算一次。
var spAvailCache={};
function spAvailFor(ds){
  if(!ds)return[];
  if(spAvailCache[ds])return spAvailCache[ds];
  const [y,m,d]=ds.split('-').map(Number);
  const s=new Date(y,m-1,d,0,0,0),e=new Date(y,m-1,d,23,59,59);
  // 改期既有那場時要把它自己排除，否則會跟自己比對出「這時段已有課」
  const list=[...expandCoursesForRange(s,e),...expandMakeupForRange(s,e)]
    .filter(o=>!slotPicker.recId||o.makeupRecId!==slotPicker.recId);
  spAvailCache[ds]=list;
  return list;
}

// 這次要補的人「還差幾分鐘」＝第一列時長的預設值。多人一起排時取最欠的那位（一場要夠他）。
// 改期既有那場時，它自己的時數不算進「已補」，否則預設會變 0。
function spRemainMins(){
  const ev=slotPicker.ev,owed=mkOwedMins(ev),who=spStudents();
  if(!mkSplittable(ev)||!who.length)return owed;   // 調課／老師請假＝整堂，沒有逐人時數
  const skip=slotPicker.recId;
  const doneOf=n=>getMakeupsFor(ev.id)
    .filter(r=>r.id!==skip&&(r.absentStudents||[]).includes(n))
    .reduce((s,r)=>s+mkRecMins(r,owed),0);
  const mx=Math.max(...who.map(n=>Math.max(0,owed-doneOf(n))));
  return mx>0?mx:owed;
}
// 這幾列加起來填了幾分鐘（面板抬頭的「已填」）
function spFilledMins(){return spCustomRows().reduce((n,r)=>n+(r.dur>0?r.dur:0),0);}

// 「貼在自己下次上課的前／後」——老闆講的典型形態。只找那一列日期當天**同一門課**的
// 課堂：老師人已經在那裡、教室也是那間，接前接後最省事。
function spAdjacentOptions(dur,ds){
  const ev=slotPicker.ev;
  if(ev.courseId==null||!(dur>0))return[];
  const out=[];
  spAvailFor(ds).forEach(o=>{
    if(o.courseId!==ev.courseId||o.id===ev.id||o.isFullAbsent||o.isRescheduled)return;
    const b=new Date(o.startDt.getTime()-dur*60000);
    const a=new Date(o.endDt.getTime()+dur*60000);
    out.push({lbl:`貼在 ${fmtT(o.startDt)} 那堂前`,sub:`${fmtT(b)}–${fmtT(o.startDt)}`,h:b.getHours(),mi:b.getMinutes(),room:o.classroom||''});
    out.push({lbl:`貼在 ${fmtT(o.endDt)} 那堂後`,sub:`${fmtT(o.endDt)}–${fmtT(a)}`,h:o.endDt.getHours(),mi:o.endDt.getMinutes(),room:o.classroom||''});
  });
  return out;
}

// 新一列的初值：日期沿用上一列（多半是同一週的另一天，改起來近），時間跟原本那堂同一個鐘點
function spNewRow(prev){
  const ev=slotPicker.ev,d0=ev.startDt;
  const left=Math.max(0,spRemainMins()-spFilledMins());
  // 自訂在「選擇日期」之前，所以上面不一定選過日期 → 沒有就用今天當起點
  return{date:(prev&&prev.date)||slotPicker.date||toDateStr(new Date()),h:d0.getHours(),mi:d0.getMinutes(),
    dur:left>0?left:spRemainMins(),room:(prev&&prev.room)||ev.classroom||ROOMS_SMALL[0]};
}
// 教室夠不夠：**每間教室的規則不一樣，不能一律「有課就算撞」**。
// 大教室本來就同時擺好幾桌家教＋一堂練習課（可用桌數看當下練習課人數），
// 石牌分校是「同時段一組團班、或最多四組一對一」，只有小教室／108／208／309 才是一次一堂。
// 所以這裡沿用推薦路徑那套判斷（getRoomAvail／石牌規則），不自己另寫一份——
// 2026-08-10 老闆回報：排大教室、位子明明夠，卻被硬提醒「這時段已有課」。
function spRoomIssue(room,avail,sS,sE){
  if(!room)return null;
  const need=spStudents().length||1;
  if(room==='大教室'){
    // 多人補課是「借整間大教室」，不佔家教桌 → 不套桌數規則（大教室裝得下）
    if(need>1)return null;
    const av=getRoomAvail(avail,'大教室',sS,sE);
    return av.available?null:`大教室家教桌已滿（練習課 ${av.pStudents} 人 → 上限 ${av.max} 桌）`;
  }
  if(room==='石牌分校'){
    const active=avail.filter(o=>o.classroom==='石牌分校'&&!o.isFullAbsent&&!o.isRescheduled&&overlaps(o.startDt,o.endDt,sS,sE));
    if(need<=1)return active.filter(o=>o.type==='one').length>=4?'石牌分校同時段家教已滿（上限 4 組）':null;
    return active.some(o=>o.type==='group'||o.type==='pair')?'石牌分校這時段已有團班':null;
  }
  const clash=avail.filter(o=>o.classroom===room&&!o.isFullAbsent&&!o.isRescheduled&&overlaps(o.startDt,o.endDt,sS,sE));
  if(clash.length)return`${room} 這時段已有：${clash.map(o=>o.origTitle).join('、')}`;
  const cap=ROOM_CAP[room];
  return cap&&need>cap?`${room} 坐得下 ${cap} 人，這場有 ${need} 人`:null;
}
function spCustomRange(r){
  const [y,m,d]=String(r.date||'').split('-').map(Number);
  if(!y)return null;
  const sS=new Date(y,m-1,d,r.h,r.mi);
  return{sS,sE:new Date(sS.getTime()+r.dur*60000)};
}
// 一列的風險清單（只講不擋）。六種：日期沒填、老師撞課、學生自己那時段有課、教室已有課、
// 超過教室人數、超出營業時間，再加一種只有多列才會有的：跟自己另一列撞在一起
function spCustomIssues(r,idx){
  const ev=slotPicker.ev,out=[];
  if(!(r.dur>0))return['時長要大於 0 分鐘'];
  const rng=spCustomRange(r);
  if(!rng)return['請選日期'];
  const {sS,sE}=rng;
  const avail=spAvailFor(r.date);
  const tRef=spTeacherRef();
  const busy=mkTeacherBusyAt(tRef,avail,sS,sE);
  if(busy.length)out.push(`${[...mkTeacherNames(tRef)].join('、')||'這位老師'}這時段有課：${busy.map(o=>o.origTitle).join('、')}`);
  const stuBusy=mkStudentBusyAt(spStudents(),avail,sS,sE,ev.id);
  if(stuBusy.length)out.push(mkStudentBusyTxt(spStudents(),stuBusy));
  const roomIssue=spRoomIssue(r.room,avail,sS,sE);
  if(roomIssue)out.push(roomIssue);
  const [y,m,d]=r.date.split('-').map(Number);
  const {start,end}=bizHoursOn(new Date(y,m-1,d));
  const sMin=r.h*60+r.mi;
  if(sMin<start||sMin+r.dur>end)out.push(`超出當天營業時間（${minToHHMM(start)}–${minToHHMM(end)}）`);
  // 同一位老師、同一批學生，兩列撞在一起就是不可能的安排（這幾列都還沒存，avail 看不到彼此）
  spCustomRows().forEach((o,i)=>{
    if(i===idx||!(o.dur>0))return;
    const or=spCustomRange(o);
    if(or&&overlaps(sS,sE,or.sS,or.sE))out.push(`跟第 ${i+1} 場自己撞在一起`);
  });
  return out;
}
// 全部列的問題（確認前總覽用）
function spAllIssues(){
  const out=[];
  spCustomRows().forEach((r,i)=>spCustomIssues(r,i).forEach(t=>out.push(`第 ${i+1} 場：${t}`)));
  return out;
}

function spOpenCustom(){
  slotPicker={...slotPicker,custom:{rows:[]},time:null,room:null,join:null};
  slotPicker.custom.rows=[spNewRow(null)];
  renderSpBody();
  setTimeout(()=>document.querySelector('.sp-custom-sec')?.scrollIntoView({behavior:'smooth',block:'nearest'}),60);
}
function spCloseCustom(){slotPicker={...slotPicker,custom:null};renderSpBody();}
function spAddRow(){
  const rows=spCustomRows();
  slotPicker.custom={rows:[...rows,spNewRow(rows[rows.length-1])]};
  renderSpBody();
}
function spDelRow(i){
  const rows=spCustomRows().filter((_,x)=>x!==i);
  slotPicker.custom={rows:rows.length?rows:[spNewRow(null)]};
  renderSpBody();
}
function spCustomQuick(i,j){
  const rows=spCustomRows().slice();const r=rows[i];if(!r)return;
  const o=spAdjacentOptions(r.dur,r.date)[j];if(!o)return;
  rows[i]={...r,h:o.h,mi:o.mi,room:o.room||r.room};
  slotPicker.custom={rows};
  renderSpBody();
}
// 欄位改動只重畫那一列的提示與抬頭／確認，不重畫整個 body——重畫會讓輸入框失焦、打一半的字跳掉
function spCustomEdit(i){
  const rows=spCustomRows().slice();const r=rows[i];if(!r)return;
  const q=id=>document.getElementById(id+'-'+i);
  const t=q('sp-c-time')?.value||'';
  const [hh,mm]=t.split(':').map(Number);
  const dur=parseInt(q('sp-c-dur')?.value,10);
  rows[i]={date:q('sp-c-date')?.value||r.date,
    h:isNaN(hh)?r.h:hh,mi:isNaN(mm)?r.mi:mm,
    dur:isNaN(dur)?0:dur,room:q('sp-c-room')?.value||''};
  slotPicker.custom={rows};
  spCustomRefresh();
}
// 一列的提示區＋快速填入（快速填入的時間是從日期與時長算的，兩者一改就要重算，
// 否則標籤寫 18:00–19:00、按下去卻套用 17:30）
function spRowRefresh(i){
  const r=spCustomRows()[i];if(!r)return;
  const q=document.getElementById('sp-c-quick-'+i);
  if(q)q.innerHTML=spAdjacentOptions(r.dur,r.date).map((o,j)=>
    `<div class="sp-quick" onclick="spCustomQuick(${i},${j})"><div class="sp-quick-l">${esc(o.lbl)}</div><div class="sp-quick-s">${esc(o.sub)}</div></div>`).join('');
  const box=document.getElementById('sp-c-issue-'+i);
  if(box)box.innerHTML=spCustomIssues(r,i).map(t=>`<div class="sp-warn">⚠ ${esc(t)}</div>`).join('');
  const rng=spCustomRange(r);
  const sum=document.getElementById('sp-c-sum-'+i);
  if(sum)sum.textContent=rng&&r.dur>0?`${fmtD(rng.sS)} ${fmtT(rng.sS)}–${fmtT(rng.sE)}・${fmtDur(r.dur)}`:'';
}
function spCustomRefresh(){
  spCustomRows().forEach((_,i)=>spRowRefresh(i));
  const head=document.getElementById('sp-c-head');
  const owed=spRemainMins(),filled=spFilledMins(),left=owed-filled;
  if(head)head.innerHTML=`<span>還要補 <b>${fmtDur(owed)}</b></span><span class="sp-c-sep">｜</span>`
    +`<span>已填 <b>${fmtDur(filled)}</b></span><span class="sp-c-sep">｜</span>`
    +(left>0?`<span class="sp-c-left">還差 ${fmtDur(left)}</span>`
      :left<0?`<span class="sp-c-over">多填 ${fmtDur(-left)}</span>`
      :`<span class="sp-c-ok">✓ 剛好補滿</span>`);
  const out=document.getElementById('sp-c-out');if(!out)return;
  const rows=spCustomRows();
  const issues=spAllIssues();
  const lbl=slotPicker.mode==='makeup'?'補課':'調課';
  const bad=rows.some(r=>!(r.dur>0)||!spCustomRange(r));
  out.innerHTML=`<div class="sp-cfm">
      <div class="sp-cfm-info"><b>一次排 ${rows.length} 場</b>　共 ${fmtDur(filled)}
        ${issues.length?`<br><span class="sp-cfm-warn">${issues.length} 項提醒不會擋你，確認就照排</span>`:''}</div>
      <button class="btn btns btnp" style="white-space:nowrap"${bad?' disabled':''} onclick="confirmSlotPicker()">✓ 確認排 ${rows.length} 場${lbl}</button>
    </div>`;
}

function buildSpCustomSection(){
  const sec=document.createElement('div');
  sec.className='sp-custom-sec';
  if(!slotPicker.custom){
    sec.innerHTML=`<div class="sp-custom-open" onclick="spOpenCustom()">⚙ 自訂時段　<span>一次排好幾場、拆開補足時數；日期時間教室全部自己填</span></div>`;
    return sec;
  }
  const rows=spCustomRows();
  const roomOpts=r=>spAllRooms().map(x=>`<option value="${esc(x)}"${r.room===x?' selected':''}>${esc(x)}</option>`).join('');
  sec.innerHTML=`<div class="sp-lbl">⚙ 自訂時段<button class="sp-custom-x" onclick="spCloseCustom()">回推薦時段</button></div>
    <div class="sp-custom-note">一次把幾場都填好，按一次就全部排定。這裡的組合<b>不會被擋</b>，撞老師／撞學生／撞教室／超時只會標出來給你看。</div>
    ${buildSpTeacherHtml()}
    <div class="sp-c-head" id="sp-c-head"></div>
    ${rows.map((r,i)=>`<div class="sp-c-row" id="sp-c-row-${i}">
      <div class="sp-c-rowhd"><span class="sp-c-no">第 ${i+1} 場</span><span class="sp-c-sum" id="sp-c-sum-${i}"></span>
        ${rows.length>1?`<button class="sp-c-del" onclick="spDelRow(${i})" title="刪掉這一場">✕</button>`:''}</div>
      <div class="sp-custom-row">
        <label>日期<input type="date" id="sp-c-date-${i}" value="${esc(r.date||'')}"></label>
        <label>開始<input type="time" id="sp-c-time-${i}" value="${minToHHMM(r.h*60+r.mi)}"></label>
        <label>時長（分鐘）<input type="number" id="sp-c-dur-${i}" min="5" step="5" value="${r.dur}"></label>
        <label>教室<select id="sp-c-room-${i}">${roomOpts(r)}</select></label>
      </div>
      <div class="sp-custom-quick" id="sp-c-quick-${i}"></div>
      <div id="sp-c-issue-${i}"></div>
    </div>`).join('')}
    <div class="sp-c-add" onclick="spAddRow()">＋ 再加一場</div>
    <div id="sp-c-out"></div>`;
  rows.forEach((_,i)=>['sp-c-date','sp-c-time','sp-c-dur','sp-c-room'].forEach(id=>{
    const el=sec.querySelector('#'+id+'-'+i);
    if(el){el.oninput=()=>spCustomEdit(i);el.onchange=()=>spCustomEdit(i);}
  }));
  setTimeout(spCustomRefresh,0);   // 抬頭與各列的提示要等節點進 DOM 才抓得到
  return sec;
}

function buildSpConfirm(){
  const sec=document.createElement('div');
  sec.className='sp-cfm-sec';
  const ev=slotPicker.ev;
  // 併班：時間、教室都是主課的，只確認「併進哪一堂」
  if(slotPicker.join){
    const host=(slotPicker.avail||[]).find(o=>o.id===slotPicker.join);
    if(!host){sec.innerHTML='<div class="sp-warn">那堂課不見了，請重選</div>';return sec;}
    const who=spStudents();
    sec.innerHTML=`<div class="sp-cfm">
      <div class="sp-cfm-info"><b>併入</b>　${esc(host.origTitle)}<br>
        <b>時間</b>　${host.startDt.getMonth()+1}/${host.startDt.getDate()}（週${WD[host.startDt.getDay()]}）${fmtT(host.startDt)}–${fmtT(host.endDt)}<br>
        <b>教室</b>　${esc(host.classroom||'未設定')}<br>
        <b>補課學生</b>　${esc(who.join('、'))}</div>
      <button class="btn btns btnp" style="white-space:nowrap" onclick="confirmSlotPicker()">✓ 確認併班補課</button>
    </div>`;
    return sec;
  }
  const [y,m,d]=slotPicker.date.split('-').map(Number);
  const {h,mi}=slotPicker.time;
  const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+getEffectiveDur());
  const ds=`${m}/${d}（週${WD[new Date(y,m-1,d).getDay()]}）${fmtT(sS)}–${fmtT(sE)}`;
  const lbl=slotPicker.mode==='makeup'?'補課':'調課';
  const tName=[...mkTeacherNames(spTeacherRef())].join('、');
  sec.innerHTML=`<div class="sp-cfm">
    <div class="sp-cfm-info"><b>${lbl}時間</b>　${ds}<br><b>教室</b>　${slotPicker.room}${tName?`<br><b>老師</b>　${esc(tName)}${slotPicker.teacherId!=null?'（改由他上這一場）':''}`:''}</div>
    <button class="btn btns btnp" style="white-space:nowrap" onclick="confirmSlotPicker()">✓ 確認${lbl}</button>
  </div>`;
  return sec;
}

// 確認排補課/調課：純寫系統紀錄（makeupScheduled），不再建 Google Calendar 事件（第 3 刀起）。
// 主頁的補課/調課場次由展開器從紀錄直接長出（expandMakeupForRange）。
async function confirmSlotPicker(){
  const ev=slotPicker.ev;
  const mode=slotPicker.mode;
  if(slotPicker.join){
    const host=(slotPicker.avail||[]).find(o=>o.id===slotPicker.join);
    if(!host){toast('那堂課不見了，請重選','inf');return;}
    saveMakeupJoin(ev,host,spStudents(),slotPicker.recId);
    toast('併班補課已安排 🎉','ok');
    closeSlotPicker();
    await Promise.all([loadToday(),loadWeek()]);
    renderMakeup();updateMakeupBadge();
    return;
  }
  const lbl=mode==='makeup'?'補課':'調課';
  // ── 自訂：一次把幾場全部存進去（每一列一筆紀錄）──
  if(slotPicker.custom){
    const rows=spCustomRows();
    if(rows.some(r=>!(r.dur>0)||!spCustomRange(r))){toast('每一場都要填日期與時長','inf');return;}
    const issues=spAllIssues();
    // 有警告才多問一次：乾淨的組合不該多一道手續，撞到東西的則要你點頭
    if(issues.length&&!await uiConfirm({
      title:`這 ${rows.length} 場裡有 ${issues.length} 項衝突，還是要排？`,
      html:issues.map(t=>`<div style="margin:4px 0">⚠ ${esc(t)}</div>`).join('')
        +'<div style="margin-top:8px;color:var(--tx2);font-size:13px">系統不擋你，但排下去課表上就會這樣長。</div>',
      ok:'照排',danger:true}))return;
    // 第一列沿用被改期的那筆（recId），其餘各自新開一筆
    rows.forEach((r,i)=>{
      const{sS,sE}=spCustomRange(r);
      saveMakeupScheduled(ev,sS,sE,r.room,null,lbl,spStudents(),i===0?slotPicker.recId:null,spTeacherPick());
    });
    // 硬排的組合留一筆帳：之後看課表覺得「怎麼會撞在一起」時查得到是誰、什麼時候按的
    if(issues.length)logAct('makeup',`自訂時段（有衝突仍排定 ${rows.length} 場）`,
      rows.map(r=>{const{sS,sE}=spCustomRange(r);return`${fmtD(sS)} ${fmtT(sS)}–${fmtT(sE)} ${r.room||''}`.trim();}).join('／'),
      issues.join('；'));
    toast(rows.length>1?`已排定 ${rows.length} 場${lbl} 🎉`:`${lbl}已安排 🎉`,'ok');
    closeSlotPicker();
    await Promise.all([loadToday(),loadWeek()]);
    renderMakeup();updateMakeupBadge();
    return;
  }
  const [y,m,d]=slotPicker.date.split('-').map(Number);
  const {h,mi}=slotPicker.time;
  const sS=new Date(y,m-1,d,h,mi),sE=new Date(y,m-1,d,h,0,0);sE.setMinutes(mi+getEffectiveDur());
  saveMakeupScheduled(ev,sS,sE,slotPicker.room,null,lbl,spStudents(),slotPicker.recId,spTeacherPick());
  toast(mode==='makeup'?'補課已安排 🎉':'調課時段已安排 🎉','ok');
  closeSlotPicker();
  await Promise.all([loadToday(),loadWeek()]); // 場次立即長回主頁課表
  renderMakeup();updateMakeupBadge();
}

// ── 補課排程記錄 ──
// 2026-08-05 起「一堂請假 → 多場補課」：每場自己一個 id、自己帶一份名單（absentStudents＝
// 這場補的人，不是整堂請假的人）。以前是 originalId 當唯一鍵，三人同缺只能一起排同一個時段。
function getMakeupScheduledLS(){return driveData.makeupScheduled||[];}
function mkNewRecId(){return'mk_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7);}

// 舊資料（一堂一筆、沒有 id）讀進來時補上 id，語意不變：那一筆就是「補全部請假學生」的那場。
// 純讀取端補值，不主動改寫 Firestore；下次存檔時新形狀自然帶上去。
function normalizeMakeupRec(rec){
  return rec.id?rec:{...rec,id:rec.originalId};
}
// ── 時數帳（第 3 刀，2026-08-10 老闆拍板「改看時數，自動算」）──
// 為什麼要有：一堂 2 小時的家教請假，可以拆成兩場 1 小時補足（多半貼在原本上課時間前後）。
// 舊算法「名單含他＝補完了」會在排完第一場 1 小時就把那筆移出清單，剩下的 1 小時安靜消失。
// 改成算分鐘：排出去的場次時長相加 ≥ 該補時數才算補完。
//
// 分母＝系統原本就會給的那一場有多長（團班砍半、家教／練習課原長；調課整堂移走＝原長）。
// 所以「不拆、照預設排一場」的結果跟以前一模一樣，只是現在拆得開。
function mkModeOf(e){return e.absType==='調課'?'reschedule':'makeup';}
// 分母在**排的當下**定案，寫進每一筆安排裡凍結（saveMakeupScheduled/saveMakeupJoin 的 owedMins）。
// ⚠ 為什麼一定要凍：分母是現算的——課型看「那天在籍幾個人」（滾動判型）、課長看課程本體的時段。
// 排完之後有人退班／插班／換期別看清單／改上課時間，分母就會偷偷變大，
// 已經排好的補課會無聲跳回「待安排」（2026-08-10 老闆回報的 bug）。
// 舊紀錄沒有 owedMins → 照舊現算，語意不變。
function mkOwedMins(e){
  const frozen=getMakeupsFor(e.id).find(r=>r.owedMins>0);
  return frozen?frozen.owedMins:calcMakeupDur(e,mkModeOf(e));
}
// 這一場什麼時候上完。舊紀錄可能沒存 scheduledEnd → 用開始時間＋該補時數推，
// 免得 Invalid Date 讓「已完成／已補」的判斷永遠是 false
function mkRecEnd(rec,owed){
  const e=new Date(rec.scheduledEnd);
  if(!isNaN(e.getTime()))return e;
  return new Date(new Date(rec.scheduledDate).getTime()+(owed>0?owed:60)*60000);
}
// 這一場補了幾分鐘。併班＝跟著主課上完整堂進度，一律算補滿（第 2 刀語意不變，
// 主課比較短也不會硬生生欠一截出來）
function mkRecMins(rec,owed){
  if(isJoinRec(rec))return owed;
  const s=new Date(rec.scheduledDate),e=new Date(rec.scheduledEnd);
  const m=Math.round((e-s)/60000);
  // 算不出時長的舊紀錄（沒存 scheduledEnd）→ 照第 3 刀之前的語意當作補滿，
  // 不然全部舊安排會一夕之間變成「補到一半」跳回清單
  return m>0?m:owed;
}
// 某人在這堂請假底下已經補了幾分鐘。onlyDone＝只算「已經上完」的場次（欠課消帳用；
// 排了但還沒上的仍算欠著，跟學生統計原本的口徑一致）
function mkDoneMinsFor(occId,name,owed,onlyDone,now){
  const t=now||new Date();
  return getMakeupsFor(occId)
    .filter(r=>(r.absentStudents||[]).includes(name))
    .filter(r=>!onlyDone||mkRecEnd(r,owed)<t)
    .reduce((n,r)=>n+mkRecMins(r,owed),0);
}
// 這堂請假還沒排完補課的人：時數沒補滿的、扣掉決定不補課的。
// 老師請假的 absentStudents 是空的（見 schedule.js _absFields），走 mkByHead 那條不數人頭。
function mkPendingNames(e){
  const skip=new Set(e.makeupSkip||[]);
  const owed=mkOwedMins(e);
  return (e.absentStudents||[]).filter(n=>!skip.has(n)&&mkDoneMinsFor(e.id,n,owed)<owed);
}
// 這位學生這堂請假「補完了沒」（已上完的場次相加 ≥ 該補時數）——學生統計的欠課消帳用。
// 拆多場之後不能只看「第一場上完沒」：先上完的那半堂會把整筆欠課提前消掉。
function mkMadeUpBy(e,name,now){
  const t=now||new Date();
  const owed0=mkOwedMins(e);
  if(!mkSplittable(e)){const r=getMakeupsFor(e.id)[0];return !!r&&mkRecEnd(r,owed0)<t;}
  const owed=owed0;
  return mkDoneMinsFor(e.id,name,owed,true,t)>=owed;
}
// 「已補 60 分／2 小時」這種進度，卡片與清單共用
function mkProgressTxt(e,name){
  const owed=mkOwedMins(e);
  const done=mkDoneMinsFor(e.id,name,owed);
  return{owed,done,left:Math.max(0,owed-done)};
}
// 待補課卡的狀態標籤。單人（家教等）直接講時數——講「0/1 人」沒有資訊量；
// 多人講人數，但「有人補到一半、還沒有人補滿」時改講「補到一半」，免得看起來像完全沒排。
function mkStBadgeInfo(e){
  const total=mkTotalCount(e),doneN=Math.max(0,total-mkPendingCount(e));
  // 不數人頭的（老師請假／調課）：只有「排了沒」，講「1/1」沒有資訊量
  if(!mkSplittable(e))return doneN>0?{cls:'mk-badge-part',txt:'已安排'}:{cls:'mk-badge-un',txt:'未安排'};
  const who=(e.absentStudents||[]).filter(n=>!(e.makeupSkip||[]).includes(n));
  if(who.length===1){
    const p=mkProgressTxt(e,who[0]);
    return p.done>0?{cls:'mk-badge-part',txt:`已補 ${fmtDur(p.done)}／${fmtDur(p.owed)}`}:{cls:'mk-badge-un',txt:'未安排'};
  }
  if(doneN>0)return{cls:'mk-badge-part',txt:`已安排 ${doneN}/${total} 人`};
  return who.some(n=>mkProgressTxt(e,n).done>0)?{cls:'mk-badge-part',txt:'補到一半'}:{cls:'mk-badge-un',txt:'未安排'};
}
// 「還沒排完」那行：補到一半的人要講還差多少，完全沒排的只列名字
function mkWaitTxt(e){
  if(!mkSplittable(e))return[];
  return mkPendingNames(e).map(n=>{
    const p=mkProgressTxt(e,n);
    return p.done>0?`${n}（已補 ${fmtDur(p.done)}，還差 ${fmtDur(p.left)}）`:n;
  });
}

// ── 補課／調課場次的標記（2026-08-12 老闆要求）──
// 排好的場次在今日／本週／桌面日曆本來就是一張正常的課程卡（schedule.js expandMakeupForRange
// 從紀錄長出來），但卡上沒有任何字說它是補課——週三晚上突然多一堂「國二數學班」時
// 分不出是補課還是課表排錯。類別就住在課堂物件的 calName（'補課'／'調課'），
// 這兩支是唯一的判斷入口，今日卡／週卡／週小格／詳情視窗／桌面日曆五個畫面共用。
function mkOccKind(e){return e&&e.isMakeupOcc?(e.calName==='調課'?'調課':'補課'):'';}
// 這場是替哪一堂排的（原課堂的日期時間）。makeupFromDate 由展開器帶上；
// 舊紀錄若沒存 originalDate 就回空字串（只出標籤、不硬掰日期）
function mkOccFromWhen(e){
  if(!mkOccKind(e)||!e.makeupFromDate)return'';
  const d=new Date(e.makeupFromDate);
  return isNaN(d.getTime())?'':`${fmtD(d)}${fmtT(d)}`;
}
// 卡片副標用的完整句子：「原課 8/11（二）19:00」
function mkOccFromTxt(e){const w=mkOccFromWhen(e);return w?`原課 ${w}`:'';}

// ── 併班補課（第 2 刀，2026-08-05 老闆拍板）──
// 請假的學生直接「進另一堂同進度的班一起上」，不另開一場。進度由人判斷——
// 系統只負責把當天同科目的課列出來，不加「進度分組」這種會過期的欄位。
// 資料形狀刻意跟一般補課共用：kind:'join' + hostOccId，時間/教室照抄那堂主課，
// 所以待補課清單、學生統計、欠課消帳、已完成判斷全部沿用原本那套，不必各自特判。
// 唯二的差別：① expandMakeupForRange 不為它另長一堂（否則課表會多出一筆重複的課）
//             ② 那些人疊進主課的名冊（點名／成績／日曆都看得到，標「補」）
function isJoinRec(rec){return !!rec&&rec.kind==='join';}
// 這堂主課（hostOccId）今天多了哪些併班補課的紀錄
function joinRecsOn(hostOccId){
  if(!hostOccId)return[];
  return getMakeupScheduledLS().map(normalizeMakeupRec).filter(r=>isJoinRec(r)&&r.hostOccId===hostOccId);
}
// 補課學生的 studentId：優先查來源請假紀錄的雙存欄位（同名終結），
// 查不到才退回學生檔的唯一同名比對（兩個同名就給 null，寧可不給也不要點錯人）
function mkStudentIdOf(rec,name){
  const ab=getAbsences().find(a=>a.occId===rec.originalId);
  const hit=ab&&[...(ab.leave||[]),...(ab.noShow||[])].find(x=>x.name===name);
  if(hit&&hit.studentId!=null)return hit.studentId;
  const same=getStudentList().filter(s=>s.name===name);
  return same.length===1?same[0].id:null;
}
// 這堂主課今天多收幾個補課生（課卡標一顆「+N 補課生」用）
function joinCountOn(hostOccId){
  return joinRecsOn(hostOccId).reduce((n,r)=>n+((r.absentStudents||[]).length),0);
}
// 主課名冊要疊上去的那幾列（形狀對齊 eventRosterWithId：{studentId,name}＋來源標記）
function joinRosterOn(hostOccId){
  const out=[];
  joinRecsOn(hostOccId).forEach(rec=>(rec.absentStudents||[]).forEach(n=>{
    out.push({studentId:mkStudentIdOf(rec,n),name:n,join:true,fromTitle:rec.origTitle,recId:rec.id});
  }));
  return out;
}

// ── 「同一種課」的三個條件（2026-08-10 老闆補的）──
// 光同科目太寬：高二數學的學生請假，只該看到「同一個老師的高二數學班」。
// 年級課程本體沒這個欄位（自動命名的「高二數學班」是從名單長出來的字），所以現算：
// 那堂在籍學生的年級集合。混年級的課會有多個年級，只要交集到就算同年級。
function mkGradeSet(occ,names){
  const byId=new Map(getStudentList().map(s=>[s.id,s]));
  const out=new Set();
  eventRosterWithId(occ).forEach(r=>{
    if(names&&!names.includes(r.name))return;
    const g=byId.get(r.studentId)?.grade;
    if(g)out.add(g);
  });
  return out;
}
// 老師身分：兩邊都是系統課就比 teacherIds（老師改名也對得上），
// 有一邊是舊行事曆快照（沒有課程本體）才退回比名字。一邊完全沒老師資料時不當作「不合」。
function _setsHit(a,b){for(const x of a)if(b.has(x))return true;return false;}
// 老師身分集合。自帶 teacherIds 的優先（補課場次換過老師、以及 slot picker 現選的那位），
// 其餘照母課程反查——2026-08-11 加，以前補課場次沒有 courseId，撞課檢查對它只能比名字
function mkTeacherIds(occ){
  if(Array.isArray(occ?.teacherIds)&&occ.teacherIds.length)return new Set(occ.teacherIds.map(id=>'t:'+id));
  const co=(occ.courseId!=null&&typeof findCourseById==='function')?findCourseById(occ.courseId):null;
  return new Set(co?courseTeacherIds(co).map(id=>'t:'+id):[]);
}
function mkTeacherNames(occ){return new Set(String(occ.teacher||'').split('、').filter(Boolean));}
function mkSameTeacher(a,b){
  const ia=mkTeacherIds(a),ib=mkTeacherIds(b);
  if(ia.size&&ib.size)return _setsHit(ia,ib);
  const na=mkTeacherNames(a),nb=mkTeacherNames(b);
  return(!na.size||!nb.size)?true:_setsHit(na,nb);
}

// 併班補課的候選主課：那天有哪些課可以讓這幾個人插進去一起上。
// 先篩掉「插進去也上不了」的：自己那堂、整堂沒上的（請假/調課）、試聽、
// 練習課（它本來就有自己的「加入現有練習課」路徑）、以及人已經在名單上的那堂。
// 剩下的每一堂標記三個條件對不對得上（科目／年級／老師）。
// **預設只顯示三者全中的**（exact）；差一項就要人自己按「顯示當天全部」才看得到，
// 每張卡上會寫清楚差在哪。進度合不合仍然是人看的，系統不猜。
function mkJoinCandidates(ev,avail,students){
  const subj=mkSubjectOf(ev);
  const grades=mkGradeSet(ev,students&&students.length?students:null);
  const who=students||[];
  return (avail||[]).filter(o=>{
    if(o.id===ev.id||o.courseId==null)return false;
    if(o.isFullAbsent||o.isRescheduled)return false;
    if(o.calName==='試聽'||o.type==='practice')return false;
    const roster=new Set(eventRoster(o));
    return who.some(n=>!roster.has(n));   // 全都已經在名單上＝沒得補
  }).map(o=>{
    // 有一邊算不出年級／老師時不當作「不合」（舊資料常缺），只有兩邊都有值才比
    const og=mkGradeSet(o,null);
    const sameSubject=!!subj&&mkSubjectOf(o)===subj;
    const sameGrade=!grades.size||!og.size||_setsHit(grades,og);
    const sameTeacher=mkSameTeacher(ev,o);
    return{occ:o,sameSubject,sameGrade,sameTeacher,exact:sameSubject&&sameGrade&&sameTeacher};
  }).sort((a,b)=>(b.exact-a.exact)||(b.sameSubject-a.sameSubject)||(a.occ.startDt-b.occ.startDt));
}
// 「高二數學・王老師」這種描述字串，給併班區的標題與空狀態用
function mkJoinCriteriaTxt(ev,students){
  const grade=[...mkGradeSet(ev,students&&students.length?students:null)].join('／');
  const head=grade+(mkSubjectOf(ev)||'');
  return[head,[...mkTeacherNames(ev)].join('、')].filter(Boolean).join('・');
}

// 存一筆併班補課。recId＝改掛到另一堂（沿用同一筆），省略＝新排一場
function saveMakeupJoin(ev,host,students,recId){
  const who=(students||[]).slice();
  const list=getMakeupScheduledLS().map(normalizeMakeupRec);
  const prev=recId?list.find(x=>x.id===recId):null;
  const rec={id:recId||mkNewRecId(),kind:'join',originalId:ev.id,hostOccId:host.id,
    hostTitle:host.origTitle,origTitle:ev.origTitle,owedMins:mkOwedMins(ev),
    originalDate:ev.startDt.toISOString(),
    scheduledDate:host.startDt.toISOString(),scheduledEnd:host.endDt.toISOString(),
    room:host.classroom||'',calEventId:null,absentStudents:who,calName:'補課'};
  driveData.makeupScheduled=[...list.filter(x=>x.id!==rec.id),rec];
  rebuildMakeupMatchMap();
  scheduleDriveSave();
  logAct('makeup',`${prev?'改了':'排好'}${who.length?` ${who.join('、')} 的`:''}併班補課`,
    `${fmtD(host.startDt)} ${fmtT(host.startDt)} ${host.classroom||''} ${host.origTitle}`.trim(),
    `跟著這堂一起上、不另開場次（原課堂 ${fmtD(ev.startDt)} ${fmtT(ev.startDt)} ${ev.origTitle||''}）`.trim());
}
// 待補課清單／課卡／側欄講「這場排在哪」時共用：併班的講「併入○○」，一般的講教室
function mkWhereTxt(rec){
  return isJoinRec(rec)?`併入 ${rec.hostTitle||'另一堂課'}`:(rec.room||'');
}

// students＝這一場補誰（省略就吃事件的全部請假學生，維持舊呼叫端語意）
// recId＝改期既有的那場；省略＝新排一場
// teacher＝{ids:[老師id], names:'姓名'}＝這場換人上；null＝原班老師（不存欄位，跟著母課程走）；
// undefined（沒傳）＝沿用這筆原本存的（桌面日曆拖曳改時間走這條，不該把老師洗掉）
function saveMakeupScheduled(ev,sS,sE,room,calEventId,calName='補課',students,recId,teacher){
  const who=(students||ev.absentStudents||[]).slice();
  const list=getMakeupScheduledLS().map(normalizeMakeupRec);
  const prev=recId?list.find(x=>x.id===recId):null;   // 改時段：動態要講得出差別
  const t=teacher===undefined
    ?(prev&&prev.teacherIds?{ids:prev.teacherIds,names:prev.teacherNames||''}:null)
    :teacher;
  const rec={id:recId||mkNewRecId(),originalId:ev.id,origTitle:ev.origTitle,
    // 該補幾分鐘：排的當下算一次就凍在這裡（見 mkOwedMins 的說明）
    owedMins:mkOwedMins(ev),
    originalDate:ev.startDt.toISOString(),scheduledDate:sS.toISOString(),scheduledEnd:sE.toISOString(),
    room,calEventId:calEventId||null,absentStudents:who,calName,
    ...(t&&t.ids&&t.ids.length?{teacherIds:t.ids.slice(),teacherNames:t.names||''}:{})};
  driveData.makeupScheduled=[...list.filter(x=>x.id!==rec.id),rec];
  rebuildMakeupMatchMap();
  scheduleDriveSave();
  // 動態：排定／改時段（補課與調課共用這支，calName 就是類別）
  logAct('makeup',`${prev?'改了':'排好'}${who.length?` ${who.join('、')} 的`:''}${calName}`,
    `${fmtD(sS)} ${fmtT(sS)}–${fmtT(sE)} ${room||''} ${ev.origTitle||''}${rec.teacherNames?` 👤${rec.teacherNames}`:''}`.trim(),
    prev?`原本排在 ${fmtD(new Date(prev.scheduledDate))} ${fmtT(new Date(prev.scheduledDate))} ${prev.room||''}`
        :`原課堂 ${fmtD(ev.startDt)} ${fmtT(ev.startDt)}`);
}

// makeupScheduled → makeupMatchMap（occId → 場次陣列）。存檔與載入共用同一支，
// 免得兩邊各自維護 map 又漏掉一處。
function rebuildMakeupMatchMap(){
  makeupMatchMap=new Map();
  getMakeupScheduledLS().map(normalizeMakeupRec).forEach(rec=>{
    const r={...rec,calName:rec.calName||'補課'};
    if(!makeupMatchMap.has(rec.originalId))makeupMatchMap.set(rec.originalId,[]);
    makeupMatchMap.get(rec.originalId).push(r);
  });
}

// 取消單一場補課（recId＝那場自己的 id，不是請假課堂的 id）
async function deleteMakeupScheduled(recId){
  const prev=findMakeupRec(recId);   // 刪掉之前先抄，動態才講得出取消的是哪一場
  driveData.makeupScheduled=getMakeupScheduledLS().map(normalizeMakeupRec).filter(x=>x.id!==recId);
  rebuildMakeupMatchMap();
  scheduleDriveSave();
  if(prev){
    const s=new Date(prev.scheduledDate);
    logAct('makeup',`取消${(prev.absentStudents||[]).length?` ${prev.absentStudents.join('、')} 的`:''}${prev.calName||'補課'}`,
      `${fmtD(s)} ${fmtT(s)} ${prev.room||''} ${prev.origTitle||''}`.trim(),'回到待安排清單');
  }
  await Promise.all([loadToday(),loadWeek()]); // 場次從主頁課表移除
  renderMakeup();updateMakeupBadge();
}

// 取消這堂請假／調課排出去的**所有**場次（取消調課用：整堂移走的那場一定要跟著撤）
async function deleteMakeupsForOcc(occId){
  const recs=getMakeupsFor(occId);
  if(!recs.length)return;
  driveData.makeupScheduled=getMakeupScheduledLS().map(normalizeMakeupRec).filter(x=>x.originalId!==occId);
  rebuildMakeupMatchMap();
  scheduleDriveSave();
  recs.forEach(prev=>{
    const s=new Date(prev.scheduledDate);
    logAct('makeup',`取消${(prev.absentStudents||[]).length?` ${prev.absentStudents.join('、')} 的`:''}${prev.calName||'補課'}`,
      `${fmtD(s)} ${fmtT(s)} ${prev.room||''} ${prev.origTitle||''}`.trim(),'回到待安排清單');
  });
  await Promise.all([loadToday(),loadWeek()]);
  renderMakeup();updateMakeupBadge();
}

// 取消請假後同步已排的補課（absence.js doCancel 呼叫）：
// 那場補的人全都不請假了 → 整場移除（不然主頁會留一場沒來由的課）；只撤部分人 → 那場名單跟著縮小。
// 跟 cancelReschedule 的處置對齊（取消調課也會把已排時段撤掉）。多場各自判斷。
function syncMakeupOnLeaveCancel(occId){
  const recs=getMakeupsFor(occId);if(!recs.length)return;
  const ab=getAbsences().find(a=>a.occId===occId);
  const remain=new Set(((ab&&ab.leave)||[]).map(x=>x.name));
  const stillResched=!!(ab&&ab.resched);
  const removed=[];
  const kept=getMakeupScheduledLS().map(normalizeMakeupRec).filter(rec=>{
    if(rec.originalId!==occId)return true;
    // 調課場次的名單是全名冊，請假撤光不代表調課要撤 → 只要那堂還在調課就留著
    if(stillResched)return true;
    const left=(rec.absentStudents||[]).filter(n=>remain.has(n));
    if(!left.length){removed.push(rec);return false;}
    rec.absentStudents=left;
    return true;
  });
  driveData.makeupScheduled=kept;
  rebuildMakeupMatchMap();
  scheduleDriveSave();
  removed.forEach(prev=>{
    const s=new Date(prev.scheduledDate);
    logAct('makeup',`取消${(prev.absentStudents||[]).length?` ${prev.absentStudents.join('、')} 的`:''}${prev.calName||'補課'}`,
      `${fmtD(s)} ${fmtT(s)} ${prev.room||''} ${prev.origTitle||''}`.trim(),'原本的請假已取消，這場一併移除');
  });
}

// 把某幾個人「從請假改標成曠課」時，他們原本排好的補課要跟著撤（曠課不排補課）——
// 不然主頁會留一場沒來由的課。整堂性質的場次（老師請假／調課，名單是空的）不歸這裡管。
// 跟 syncMakeupOnLeaveCancel 分開寫：那支看的是「還有誰在請假」，這支只動被點名的那幾個。
function dropMakeupsForNoShow(occId,names){
  if(!names.length||!getMakeupsFor(occId).length)return;
  const removed=[];
  const kept=getMakeupScheduledLS().map(normalizeMakeupRec).filter(rec=>{
    if(rec.originalId!==occId)return true;
    const who=rec.absentStudents||[];
    if(!who.length)return true;
    const left=who.filter(n=>!names.includes(n));
    if(left.length===who.length)return true;    // 這場沒補到被改標的人
    if(!left.length){removed.push(rec);return false;}
    rec.absentStudents=left;
    return true;
  });
  driveData.makeupScheduled=kept;
  rebuildMakeupMatchMap();
  scheduleDriveSave();
  removed.forEach(prev=>{
    const s=new Date(prev.scheduledDate);
    logAct('makeup',`取消${(prev.absentStudents||[]).length?` ${prev.absentStudents.join('、')} 的`:''}${prev.calName||'補課'}`,
      `${fmtD(s)} ${fmtT(s)} ${prev.room||''} ${prev.origTitle||''}`.trim(),'改標成曠課，這場一併移除');
  });
}

// 視窗縮放時重畫教室時間軸（無實際作用因 renderTL 是 no-op，但保留以維持原行為）
window.addEventListener('resize',()=>{if(currentPanel==='courses')renderTL();});
