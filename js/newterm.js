// ══════════════════════════════════════════════════════════════
// 開學準備（2026-08-27）
// ══════════════════════════════════════════════════════════════
// 【在解什麼】
// 期別交接不是「把名單複製一份」就完事——**課表本身會變**。暑假白天有空所以課排 12:30，
// 開學後孩子要上學，同一門課得改成晚上 19:00；同時有人升學不續、有人新加入。
// 老闆 2026-08-27 的原話：「這種期別交接是一定要做，只是可能在交接前一兩個禮拜就要
// 開始處理了，所以需要可以提早去針對每一堂修課登記做開學後的時間調整與確認」。
//
// 【做法：一門課一列，決定兩件事】
//   ① 開學後幾點上 → 寫成 schedule.phases 的一段「從 9/1 起改為…」
//   ② 誰還續       → 在新期別建立 enrollment
// 兩件事各自獨立完成，可以分很多次做，不用一口氣。
//
// 【進度不另外存，結果本身就是進度】
//   有「從目標期別起始日起」的時段分段 ＝ 時段定好了
//   目標期別有這門課的登記           ＝ 名單定好了
// 少一份要同步的狀態，多裝置也不會對不起來。
//
// ⚠️ 改時段走既有的分段機制（effective-date phases），**不動目標日之前的任何課堂**——
//    過去的課表、名冊、已點的名、堂數全部不變。這是全系統對「隨時間變的東西」的一貫作法。

var ntState={pick:{},collapsed:null};   // courseId → Set(要續的 studentId)；整區收合（null＝自動判斷）
var ntSlotDraft={};                            // courseId → [{weekday,start,end}]（還沒按確認的編輯中時段）

// 距離目標期別開始 28 天內（或已經開始）才顯示——平常不要佔版面。
// 這個提前量是猜的（2026-08-27），老闆實際用一輪之後再調。
var NT_LEAD_DAYS=28;

// 這一期還有幾門課沒辦完（＝上一期有登記、但這一期還沒排好時間或還沒帶名單的）。
// 判斷跟 ntDone 同一套規則，只是不需要先有 target 就算得出來——ntTarget 要靠它決定要辦哪一期。
function ntPendingCount(pid){
  const src=prevYearPeriodId(pid),start=yearPeriodStart(pid);
  if(!src||!start)return 0;
  const srcCids=new Set();
  getEnrollments({periodId:src}).forEach(en=>{if(en.courseId!=null)srcCids.add(en.courseId);});
  if(!srcCids.size)return 0;
  const dstCids=new Set();
  getEnrollments({periodId:pid}).forEach(en=>{if(en.courseId!=null)dstCids.add(en.courseId);});
  let n=0;
  srcCids.forEach(cid=>{
    const co=findCourseById(cid);
    if(!co)return;                              // 課已刪掉，這一區本來就處理不了
    const phases=(co.schedule&&co.schedule.phases)||[];
    const timeDone=phases.some(p=>p&&p.from&&p.from>=start&&Array.isArray(p.slots)&&p.slots.length);
    if(!timeDone||!dstCids.has(cid))n++;
  });
  return n;
}

// ── 要準備哪一期 ──
// 這一期還有沒辦完的、而且下一期還沒逼近 → 繼續辦這一期（9/1 之後的補課式交接）
// 否則 → 準備下一期（開學前一兩週的正常情況）
//
// ⚠️ **不可以用「這一期有沒有登記」當開關**（2026-09-01 老闆踩到）：第一門課一確認，
//    這一期就「有登記」了，目標當場跳到下一期；下一期還很遠、被 28 天門檻擋掉，
//    整區直接消失——剩下的課再也沒有地方可辦。要看的是「還剩幾門沒辦完」。
//
// now＝自帶時鐘（測試用；不傳就是現在）。時間相關的判斷不要讀真實時鐘，否則測試會自己過期。
function ntTarget(now){
  const cur=typeof yearPeriodId==='function'?yearPeriodId():null;
  if(!cur)return null;
  const today=(now?new Date(now):new Date()).setHours(0,0,0,0);
  const days=p=>{const s=p?yearPeriodStart(p):null;return s?Math.round((new Date(s)-today)/864e5):null;};
  const nxt=nextYearPeriodId(cur),dNext=days(nxt);
  const dst=(ntPendingCount(cur)>0&&(dNext==null||dNext>NT_LEAD_DAYS))?cur:nxt;
  const src=prevYearPeriodId(dst);
  if(!dst||!src)return null;
  const start=yearPeriodStart(dst);
  if(!start)return null;
  return{dst,src,start,daysLeft:Math.round((new Date(start)-today)/864e5)};
}

function ntShouldShow(){
  const t=ntTarget();
  if(!t||t.daysLeft>NT_LEAD_DAYS)return false;
  return getEnrollments({periodId:t.src}).length>0;
}

// 這一期要處理的課：來源期別有登記、而且是系統自有課程（有 courseId）
function ntCourses(t){
  const byCourse=new Map();
  getEnrollments({periodId:t.src}).forEach(en=>{
    if(en.courseId==null)return;              // 行事曆時代的舊登記沒有課程本體，這裡處理不了
    if(!byCourse.has(en.courseId))byCourse.set(en.courseId,[]);
    byCourse.get(en.courseId).push(en);
  });
  const out=[];
  byCourse.forEach((ens,cid)=>{
    const co=findCourseById(cid);
    if(!co)return;                            // 課已刪掉
    out.push({co,ens});
  });
  return out.sort((a,b)=>String(courseNameOn(a.co,new Date())).localeCompare(String(courseNameOn(b.co,new Date())),'zh-Hant'));
}

// 這門課的兩件事各自做完了沒
function ntDone(co,t){
  const phases=(co.schedule&&co.schedule.phases)||[];
  const timeDone=phases.some(p=>p&&p.from&&p.from>=t.start&&Array.isArray(p.slots)&&p.slots.length);
  const rosterDone=getEnrollments({periodId:t.dst}).some(en=>en.courseId===co.id);
  return{timeDone,rosterDone};
}

// 目標期別開始那天，這門課現在會是幾點（＝沒特別處理的話，開學後就照這個上）
function ntSlotsOn(co,dayStr){
  const s=co&&co.schedule;
  if(!s||s.mode!=='weekly')return[];
  const ph=_activePhase(_schedulePhases(s),new Date(dayStr));
  return(ph&&ph.slots||[]).filter(x=>x&&x.weekday!=null);
}
function ntSlotTxt(slots){
  if(!slots.length)return'（沒有每週固定時段）';
  return slots.map(s=>`${WEEK_LABEL[Number(s.weekday)]||''} ${s.start}–${s.end}`).join('、');
}

// 編輯中的時段（還沒按確認）：預設帶目標日當天生效的那組
function ntDraft(co,t){
  if(!ntSlotDraft[co.id])ntSlotDraft[co.id]=ntSlotsOn(co,t.start).map(s=>({weekday:Number(s.weekday),start:s.start,end:s.end}));
  return ntSlotDraft[co.id];
}
function ntSlotSet(cid,i,f,v){
  const d=ntSlotDraft[cid];if(!d||!d[i])return;
  d[i][f]=f==='weekday'?parseInt(v,10):v;
}
function ntAddSlot(cid){
  const d=ntSlotDraft[cid];if(!d)return;
  d.push({weekday:1,start:'',end:''});renderNtModal();
}
function ntDelSlot(cid,i){
  const d=ntSlotDraft[cid];if(!d)return;
  d.splice(i,1);renderNtModal();
}
// ── 點一門課 → 置中視窗（2026-08-27 老闆要求，跟課程視窗同一個手感）──
// 原本是就地展開，但那會讓下面的列表整個往下推、每開一門都要重新找位置。
var ntModalId=null;
function ntOpenModal(cid){
  ntModalId=cid;
  document.getElementById('nt-modal-wrap')?.classList.add('open');
  renderNtModal();
}
function ntCloseModal(){
  ntModalId=null;
  document.getElementById('nt-modal-wrap')?.classList.remove('open');
  renderSettings();          // 關掉時把外面那列的狀態籤更新（可能剛確認完）
}
// 視窗內容重畫。改時段／勾學生都只動視窗，不重畫整頁——不然每點一下畫面都在跳
function renderNtModal(){
  if(ntModalId==null)return;
  const t=ntTarget();if(!t)return;
  const item=ntCourses(t).find(x=>x.co.id===ntModalId);
  if(!item){ntCloseModal();return;}
  const ttl=document.getElementById('nt-modal-title');
  if(ttl)ttl.textContent=courseNameOn(item.co,new Date());
  const body=document.getElementById('nt-modal-body');
  if(body)body.innerHTML=ntBodyHtml(item.co,item.ens,t);
}

// ── 整區收合 ──
// 預設是「還有沒辦完的就攤開、全部辦完就收起來」，但只要手動點過就以手動的為準。
// 這樣開學前一直看得到待辦，辦完之後它自己讓開，又不會硬性覆蓋使用者的選擇。
function ntAutoCollapsed(t,items){
  if(!items.length)return true;
  return items.every(x=>{const d=ntDone(x.co,t);return d.timeDone&&d.rosterDone;});
}
function ntCollapsed(t,items){
  return ntState.collapsed===null?ntAutoCollapsed(t,items):ntState.collapsed;
}
function ntToggleCollapse(){
  const t=ntTarget();
  ntState.collapsed=!(t?ntCollapsed(t,ntCourses(t)):false);
  renderSettings();
}

// 誰要續（預設全續）
function ntPicked(co,ens){
  if(!ntState.pick[co.id])ntState.pick[co.id]=new Set(ens.map(en=>en.studentId));
  return ntState.pick[co.id];
}
function ntToggleStu(cid,sid){
  const set=ntState.pick[cid];if(!set)return;
  if(set.has(sid))set.delete(sid);else set.add(sid);
  renderNtModal();
}
function ntPickAll(cid,on){
  const t=ntTarget();if(!t)return;
  const item=ntCourses(t).find(x=>x.co.id===cid);if(!item)return;
  ntState.pick[cid]=on?new Set(item.ens.map(en=>en.studentId)):new Set();
  renderNtModal();
}

// 這門課已經排到目標期別之後的補課／調課場次——改了時段它們不會跟著動，要提醒
function ntFutureMakeups(co,t){
  const pre='sys:'+co.id+':';
  return(driveData.makeupScheduled||[]).filter(r=>{
    if(!r||!String(r.originalId||'').startsWith(pre))return false;
    const d=r.scheduledDate?toDateStr(new Date(r.scheduledDate)):'';
    return d>=t.start;
  });
}

// ── 確認一門課 ──
async function ntConfirm(cid){
  const t=ntTarget();if(!t)return;
  const item=ntCourses(t).find(x=>x.co.id===cid);if(!item)return;
  const {co,ens}=item;
  const done=ntDone(co,t);
  const draft=ntDraft(co,t);
  const picked=[...ntPicked(co,ens)];
  const name=courseNameOn(co,new Date());

  // 時段有沒有真的改動（跟目標日當天現行的比）
  const nowSlots=ntSlotsOn(co,t.start);
  const clean=draft.filter(s=>s.start&&s.end&&s.weekday!=null);
  for(const s of clean)if(s.end<=s.start)return toast('結束時間要晚於開始時間','err');
  const changed=JSON.stringify(clean.map(s=>[Number(s.weekday),s.start,s.end]))
              !==JSON.stringify(nowSlots.map(s=>[Number(s.weekday),s.start,s.end]));

  if(!changed&&done.rosterDone)return toast('這門課已經準備好了','inf');
  if(changed&&!clean.length)return toast('至少要留一個完整時段（星期＋開始＋結束）','err');

  const mk=ntFutureMakeups(co,t);
  const ok=await uiConfirm({title:'確認這門課的開學安排',ok:'確認',
    html:`<p class="ask-big">${esc(name)}</p>
      ${changed?`<div class="ask-list">
        <div>上課時間　<b>${esc(coDateMD(t.start))} 起</b>改為</div>
        <div>${esc(ntSlotTxt(clean))}</div>
        <div class="ask-sub">${esc(coDateMD(t.start))} 之前的課堂完全不受影響。</div>
      </div>`:''}
      ${done.rosterDone?'':`<p>${picked.length} 位學生帶到 <b>${esc(yearPeriodLabel(t.dst))}</b>${picked.length<ens.length?`（${ens.length-picked.length} 位不續）`:''}。</p>`}
      ${mk.length?`<div class="ask-note ask-warn">這門課有 <b>${mk.length}</b> 場補課／調課已經排在 ${esc(coDateMD(t.start))} 之後，<b>它們的時間不會跟著改</b>（照排定當時記的）。改完記得去待補課清單看一下。</div>`:''}`});
  if(!ok)return;

  const undoTok=typeof undoBegin==='function'?undoBegin(['courses','enrollments']):null;
  const acts=[];

  if(changed){
    const list=getCourses().slice();
    const idx=list.findIndex(c=>c.id===co.id);
    if(idx>=0){
      const c=JSON.parse(JSON.stringify(list[idx]));
      c.schedule=c.schedule||{mode:'weekly',slots:[],phases:[]};
      c.schedule.phases=(c.schedule.phases||[]).filter(p=>!(p&&p.from===t.start));   // 同一天只留一段
      c.schedule.phases.push({from:t.start,slots:clean.map(s=>({weekday:Number(s.weekday),start:s.start,end:s.end}))});
      c.schedule.phases.sort((a,b)=>String(a.from).localeCompare(String(b.from)));
      list[idx]=c;
      saveCourses(list);
      acts.push(logAct('course','改了上課時間（開學準備）',name,
        `${coDateMD(t.start)} 起：${ntSlotTxt(nowSlots)} → ${ntSlotTxt(clean)}`));
    }
  }

  if(!done.rosterDone&&picked.length){
    const add=ens.filter(en=>picked.includes(en.studentId)).map(en=>makeEnrollment({
      studentId:en.studentId,courseTitle:en.courseTitle,periodId:t.dst,
      price:en.price,courseId:en.courseId,practiceSubject:en.practiceSubject||'',note:en.note||'',
      // startDate/endDate 不帶：那是上一期的期中加退，新的一期從頭開始
    }));
    saveEnrollments([...getEnrollments(),...add]);
    acts.push(logAct('roster','帶入名單（開學準備）',name,
      `${add.length} 位到 ${yearPeriodLabel(t.dst)}${picked.length<ens.length?`・${ens.length-picked.length} 位不續`:''}`));
  }

  delete ntSlotDraft[co.id];
  ntCloseModal();             // 確認完就關視窗回到清單（renderSettings 在裡面）
  toast(`「${name}」開學安排已確認`,'ok');
  if(isSignedIn())await Promise.all([loadToday(),loadWeek()]);
  renderSettings();
  if(typeof undoOffer==='function')undoOffer(undoTok,{
    label:`確認了「${name}」的開學安排`,act:acts.filter(Boolean),
    redraw:async()=>{if(isSignedIn())await Promise.all([loadToday(),loadWeek()]);renderSettings();}});
}

// ── 畫面 ──
function ntHtml(){
  if(!ntShouldShow())return'';
  const t=ntTarget();
  const items=ntCourses(t);
  if(!items.length)return'';

  const pending=items.filter(x=>{const d=ntDone(x.co,t);return !(d.timeDone&&d.rosterDone);});
  const ready=items.length-pending.length;
  const when=t.daysLeft>0?`還有 ${t.daysLeft} 天`:(t.daysLeft===0?'就是今天':`已經開始 ${-t.daysLeft} 天`);
  const shut=ntCollapsed(t,items);

  // 收起來時只留標題那一行：還剩幾門沒辦、什麼時候開學
  if(shut){
    return`<div class="nt-wrap shut">
      <div class="nt-top" onclick="ntToggleCollapse()">
        <div class="nt-title">🎒 開學準備 — ${esc(yearPeriodLabel(t.dst))}</div>
        <div class="nt-count">${pending.length?`還有 <b>${pending.length}</b> 門要處理`:'全部就緒'}・${esc(coDateMD(t.start))} 開始（${when}）</div>
        <span class="nt-arrow">›</span>
      </div>
    </div>`;
  }

  // 一門課一列，點了開置中視窗（內容在 ntBodyHtml）
  const rows=items.map(({co,ens})=>{
    const d=ntDone(co,t);
    const allDone=d.timeDone&&d.rosterDone;
    const cur=ntSlotsOn(co,t.start);
    return`<div class="nt-row${allDone?' done':''}" onclick="ntOpenModal(${co.id})">
      <span class="nt-name">${esc(courseNameOn(co,new Date()))}</span>
      <span class="nt-chip${d.timeDone?' on':''}" title="開學後的上課時間">⏰ ${d.timeDone?'時間已定':'時間未定'}</span>
      <span class="nt-chip${d.rosterDone?' on':''}" title="新學期的名單">👥 ${d.rosterDone?'名單已定':'名單未定'}</span>
      <span class="nt-cur">${esc(ntSlotTxt(cur))}</span><span class="nt-arrow">›</span>
    </div>`;
  }).join('');

  return`<div class="nt-wrap">
    <div class="nt-top" onclick="ntToggleCollapse()">
      <div class="nt-title">🎒 開學準備 — ${esc(yearPeriodLabel(t.dst))}</div>
      <div class="nt-count">${ready} / ${items.length} 門已就緒</div>
      <span class="nt-arrow">⌄</span>
    </div>
    <div class="nt-note">${esc(coDateMD(t.start))} 開始（${when}）。暑假白天上的課，開學後多半要改晚上——一門一門把新的上課時間與名單定好，<b>可以分很多次做</b>。
      改時間走「從 ${esc(coDateMD(t.start))} 起」的分段，<b>不會動到之前的任何課堂</b>（過去的課表、名冊、點名、堂數都不變）。</div>
    <div class="nt-list">${rows}</div>
  </div>`;
}

// 置中視窗的內容：定開學後的時段、勾誰還續
function ntBodyHtml(co,ens,t){
    const d=ntDone(co,t);
    const cur=ntSlotsOn(co,t.start);
    const draft=ntDraft(co,t);
    const picked=ntPicked(co,ens);
    const slotRows=draft.map((sl,i)=>`<div class="nt-slot">
      <select onchange="ntSlotSet(${co.id},${i},'weekday',this.value)">
        ${WEEK_ORDER.map(wd=>`<option value="${wd}"${Number(sl.weekday)===wd?' selected':''}>${WEEK_LABEL[wd]}</option>`).join('')}
      </select>
      <input type="text" readonly class="tp-input" placeholder="開始" value="${esc(sl.start)}" onclick="tpForInput(this)" onchange="ntSlotSet(${co.id},${i},'start',this.value)">
      <span class="nt-dash">–</span>
      <input type="text" readonly class="tp-input" placeholder="結束" value="${esc(sl.end)}" onclick="tpForInput(this)" onchange="ntSlotSet(${co.id},${i},'end',this.value)">
      ${draft.length>1?`<button class="co-stu-x" title="移除" onclick="ntDelSlot(${co.id},${i})">✕</button>`:''}
    </div>`).join('');

    const stuRows=ens.map(en=>{
      const stu=(getStudentList()||[]).find(s=>s.id===en.studentId);
      const on=picked.has(en.studentId);
      const off=stu&&stu.status&&stu.status!=='在學';
      return`<label class="nt-stu${on?' on':''}${off?' warn':''}">
        <input type="checkbox" ${on?'checked':''} onchange="ntToggleStu(${co.id},${en.studentId})">
        ${esc(stu?stu.name:'#'+en.studentId)}${off?`<span class="nt-stu-warn">${esc(stu.status)}</span>`:''}
      </label>`;
    }).join('');

    const mk=ntFutureMakeups(co,t);
    return`<div class="nt-modal-in">
      <div class="nt-sec">開學後的上課時間<span class="nt-sec-sub">現在是 ${esc(ntSlotTxt(cur))}${d.timeDone?'（已經設過 '+esc(coDateMD(t.start))+' 起的新時段）':''}</span></div>
      ${slotRows}
      <button class="nt-add" onclick="ntAddSlot(${co.id})">＋ 再一個時段</button>
      ${mk.length?`<div class="nt-warn">⚠ 這門課有 ${mk.length} 場補課／調課排在 ${esc(coDateMD(t.start))} 之後，改時間不會動到它們</div>`:''}
      <div class="nt-sec">誰還續
        <span class="nt-sec-sub">${picked.size} / ${ens.length}</span>
        <button class="nt-mini" onclick="ntPickAll(${co.id},true)">全選</button>
        <button class="nt-mini" onclick="ntPickAll(${co.id},false)">全不選</button>
      </div>
      ${d.rosterDone?`<div class="nt-note">名單已經帶到 ${esc(yearPeriodLabel(t.dst))} 了，這裡的勾選不會再送一次。要加退請到課程視窗。</div>`:''}
      <div class="nt-stus">${stuRows}</div>
      <div class="nt-acts"><button class="btn btns btnp" onclick="ntConfirm(${co.id})">確認這門</button></div>
    </div>`;
}
