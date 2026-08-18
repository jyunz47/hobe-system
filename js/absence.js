// 請假面板：標記、選擇學生、確認、取消請假

function buildAbsPanel(e, sfx=''){
  const eid=esc(e.id);
  const pid=eid+sfx; // panel-scoped ID
  const autoType=(e.type==='one'||e.students.length<=1)?'student-auto':'student';
  let html=`<div class="abs-opts" style="margin-bottom:12px">
    <div class="abs-opt" id="ao-t-${pid}" onclick="selAbsType('${eid}','${sfx}','teacher')">👨‍🏫 老師請假</div>
    <div class="abs-opt" id="ao-s-${pid}" onclick="selAbsType('${eid}','${sfx}','${autoType}')">🧑‍🎓 學生請假</div>
  </div>`;
  if((e.type==='pair'||e.type==='group'||e.type==='practice')&&e.students.length>1){
    // 2026-08-06 起「已經標過的人也列出來」（chip 上標現況）：以前把他們濾掉，
    // 想幫第二個人標不同狀態、或想把某人從請假改成曠課，都得先整堂取消請假重來
    const chip=s=>{
      const mark=(e.noShowStudents||[]).includes(s)?'曠課':(e.absentStudents||[]).includes(s)?'請假':'';
      return`<div class="stu-chip${mark?' stu-chip-marked':''}" data-eid="${eid}" data-sfx="${sfx}" data-name="${esc(s)}" onclick="toggleChip(this)">${esc(s)}${mark?`<span class="stu-chip-tag">${mark}</span>`:''}</div>`;
    };
    let chips='';
    if(e.type==='practice'&&e.studentGroups?.length>0){
      const groupedStudents=new Set(e.studentGroups.flatMap(g=>g.students));
      e.studentGroups.forEach(g=>{
        const inRoster=g.students.filter(s=>e.students.includes(s));
        if(!inRoster.length)return;
        chips+=`<div class="stu-subject-label">${esc(g.subject)}</div>`;
        chips+=inRoster.map(chip).join('');
      });
      const ungrouped=e.students.filter(s=>!groupedStudents.has(s));
      if(ungrouped.length>0){
        chips+=`<div class="stu-subject-label">其他</div>`;
        chips+=ungrouped.map(chip).join('');
      }
    }else{
      chips=e.students.map(chip).join('');
    }
    if(!chips)chips=`<div style="font-size:12px;color:var(--tx3)">這堂還沒有人登記</div>`;
    html+=`<div class="stu-wrap" id="sw-${pid}" style="display:none">
      <div class="stu-label">選擇請假學生（可多選；已標過的人再選一次可以改狀態）</div>
      <div class="stu-chips" id="sc-${pid}">${chips}</div>
    </div>`;
  }
  // 時機區塊改成動態重繪（renderAbsTiming）：選一個人＝三顆大鈕，選多人＝每人一列各自選
  html+=`<div class="stu-wrap" id="tw-${pid}" style="display:none"></div>`;
  // 一對二（剛好兩人）：一人請假時，常傾向整堂一起調課以省老師成本 → 提供捷徑導向既有調課流程
  if(e.type==='pair'&&e.students.length===2){
    html+=`<div style="margin:4px 0 10px;font-size:12px;color:var(--tx2)">
      一對二也可改為 <button class="btn btns" style="font-size:12px;padding:3px 10px" onclick="startWholeReschedule('${eid}')">🔄 整堂一起調課</button>（兩人都不缺課、不個別補課、維持原時長）
    </div>`;
  }
  html+=`<div class="abs-confirm">
    <div class="abs-preview" id="ap-${pid}"></div>
    <button class="btn btns" onclick="closeAbsPanel('${eid}','${sfx}')">取消</button>
    <button class="btn btns btnp" onclick="confirmAbs('${eid}','${sfx}')">確認標記</button>
  </div>`;
  return html;
}

// 一對二「整堂一起調課」：收起請假面板（不關 modal），直接顯示既有調課原因面板
function startWholeReschedule(id){
  document.getElementById('absp-w-'+id)?.classList.remove('open');
  document.getElementById('absp-'+id)?.classList.remove('open');
  const p=document.getElementById('rp-'+id);
  if(p){p.style.display='block';document.getElementById('rp-reason-'+id)?.focus();}
}

function toggleAbsPanelWeek(id){
  const panel=document.getElementById('absp-w-'+id);if(!panel)return;
  const isOpen=panel.classList.contains('open'); // 先判斷再清，否則永遠收不起來
  // 收掉所有面板（調課、點名、成績），確保 modal 裡一次只開一塊
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  const rp=document.getElementById('rp-'+id);if(rp)rp.style.display='none';
  closeEventPanels(id,'abs');
  if(isOpen)return; // 本來開著 → 收合即可
  absState[id]={type:null,students:[]};
  panel.classList.add('open');
  updatePreview(id,'');
}

function closeAbsPanel(id,sfx){
  if(sfx==='-w'){const pw=document.getElementById('absp-w-'+id);if(pw)pw.classList.remove('open');closeWeekModal();}
  else{const p=document.getElementById('absp-'+id);if(p)p.classList.remove('open');}
  document.getElementById('cc-'+id)?.classList.remove('card-active');
}

function selAbsType(id,sfx,type){
  const pid=id+(sfx||'');
  if(!absState[id])absState[id]={type:null,students:[]};
  absState[id].type=type;absState[id].students=[];absState[id].timings={};
  const sc=document.getElementById('sc-'+pid);if(sc)sc.querySelectorAll('.stu-chip').forEach(c=>c.classList.remove('checked'));
  document.getElementById('ao-t-'+pid)?.classList.remove('st','ss');
  document.getElementById('ao-s-'+pid)?.classList.remove('st','ss');
  const tw=document.getElementById('tw-'+pid);
  if(type==='teacher'){
    document.getElementById('ao-t-'+pid)?.classList.add('st');
    const sw=document.getElementById('sw-'+pid);if(sw)sw.style.display='none';
    if(tw)tw.style.display='none';
    absState[id].timing=null;
    updatePreview(id,sfx);
  }else{
    document.getElementById('ao-s-'+pid)?.classList.add('ss');
    if(type==='student'){const sw=document.getElementById('sw-'+pid);if(sw)sw.style.display='block';}
    if(tw)tw.style.display='block';
    absState[id].timing=null;   // 2026-08-06 老闆要求：時機一律不預選，每次自己點
    renderAbsTiming(id,sfx);
    updatePreview(id,sfx);
  }
}

// ── 請假時機：一批人可以各自不同 ──
// 2026-08-06 起**不預選**（以前會依「現在 vs 上課時間」自動帶一個）：時機直接決定要不要排補課、
// 要不要算多收費，猜錯了是安靜地錯，所以寧可每次都讓人自己點。沒點完不給按確認標記。
// state.timing＝這批的共同值（單人課沒有 chip 可選，就只吃這個）；
// state.timings[name]＝某個人的個別選擇。取值一律走 absTimingOf，兩邊才不會各算各的。
var ABS_TIMING_OPTS=[['A','課前 1hr 以上'],['B','課前 1hr 內'],['C','已開始·曠課']];
function absTimingOf(state,name){return(state.timings||{})[name]||state.timing||null;}
// 這次要標的人（student-auto＝單人課，名單就是那一位）
function absTargets(ev,state){
  return state.type==='student-auto'?ev.students.slice(0,1):(state.students||[]);
}
// 選了人但還沒選時機的那幾個（確認前擋下來，不能默默當成「課前 1hr 內」）
function absMissingTiming(ev,state){
  if(state.type==='teacher')return[];
  return absTargets(ev,state).filter(n=>!absTimingOf(state,n));
}

// 重繪時機區塊。選 1 人（或單人課）＝原本的三顆大鈕；選 2 人以上＝每人一列，可各自選
function renderAbsTiming(id,sfx){
  const pid=id+(sfx||''),tw=document.getElementById('tw-'+pid);if(!tw)return;
  const st=absState[id]||{};
  const names=st.type==='student'?(st.students||[]):[];
  const btn=(t,lbl,cur,name)=>`<div class="abs-opt${cur===t?(t==='C'?' st':' ss'):''}" data-eid="${esc(id)}" data-sfx="${sfx||''}" data-t="${t}"${name?` data-name="${esc(name)}"`:''} onclick="pickAbsTiming(this)">${lbl}</div>`;
  if(names.length<=1){
    const cur=names.length?absTimingOf(st,names[0]):st.timing;
    tw.innerHTML=`<div class="stu-label">請假時機</div>
      <div class="abs-opts" style="margin-bottom:0">${ABS_TIMING_OPTS.map(([t,lbl])=>btn(t,lbl,cur,names[0])).join('')}</div>`;
    return;
  }
  tw.innerHTML=`<div class="stu-label">請假時機（每個人分別選）</div>
    <div class="abs-timings">${names.map(n=>`<div class="abs-timing-row">
      <span class="abs-timing-who">${esc(n)}</span>
      <div class="abs-opts" style="margin-bottom:0">${ABS_TIMING_OPTS.map(([t,lbl])=>btn(t,lbl,absTimingOf(st,n),n)).join('')}</div>
    </div>`).join('')}</div>`;
}

// 點時機鈕：有 data-name＝只改那個人，沒有＝改這批的預設值
function pickAbsTiming(el){
  const id=el.dataset.eid,sfx=el.dataset.sfx||'',t=el.dataset.t,name=el.dataset.name;
  const st=absState[id]||(absState[id]={type:'student',students:[]});
  st.timings=st.timings||{};
  if(name)st.timings[name]=t;else st.timing=t;
  renderAbsTiming(id,sfx);
  updatePreview(id,sfx);
}

// 程式指定時機（今日卡點名面板按「沒來」直接帶 C）：共同值與目前選到的人一起蓋
function selAbsTiming(id,sfx,t){
  const st=absState[id]||(absState[id]={type:'student',students:[]});
  st.timing=t;st.timings=st.timings||{};
  (st.students||[]).forEach(n=>{st.timings[n]=t;});
  renderAbsTiming(id,sfx);
  updatePreview(id,sfx);
}

function toggleChip(el){
  const id=el.dataset.eid,sfx=el.dataset.sfx||'',name=el.dataset.name;
  const st=absState[id]||(absState[id]={type:'student',students:[]});
  const arr=st.students,idx=arr.indexOf(name);
  st.timings=st.timings||{};
  // 加進來的人不預帶時機（含已經標過的人：要改就自己重點一次，免得手滑把他改掉）
  if(idx>=0){arr.splice(idx,1);delete st.timings[name];}
  else arr.push(name);
  el.classList.toggle('checked',arr.includes(name));
  renderAbsTiming(id,sfx);
  updatePreview(id,sfx);
}

// 依目前面板選擇算出新標題＋時機 map。請假與曠課並存：標一邊保留另一邊，同一人改標會搬組。
// 一批人可以各自不同時機 → 同一次確認就能一人請假、一人曠課
function computeAbsResult(ev,state){
  if(state.type==='teacher')return{title:`【老師請假】${ev.origTitle}`,timing:null,empty:false};
  const newOnes=absTargets(ev,state);
  if(newOnes.length===0)return{empty:true};
  const leave=new Set(ev.isAbsent&&ev.absType!=='老師請假'?ev.absentStudents:[]);
  const noshow=new Set(ev.noShowStudents||[]);
  newOnes.forEach(n=>{leave.delete(n);noshow.delete(n);});       // 先抽離舊組
  newOnes.forEach(n=>{(absTimingOf(state,n)==='C'?noshow:leave).add(n);}); // C→曠課組、A/B→請假組
  let title='';
  if(leave.size)title+=`【${[...leave].join('、')}請假】`;
  if(noshow.size)title+=`【${[...noshow].join('、')}曠課】`;
  title+=ev.origTitle;
  const timing=Object.assign({},ev.absenceTiming||{});           // 保留既有時機
  newOnes.forEach(n=>{timing[n]=absTimingOf(state,n);});
  return{title,timing,empty:false};
}

function updatePreview(id,sfx){
  const pid=id+(sfx||'');
  const state=absState[id]||{};const el=document.getElementById('ap-'+pid);if(!el)return;
  const ev=findEventById(id);if(!ev)return;
  if(!state.type){el.innerHTML='';return;}
  if(state.type!=='teacher'&&!absTargets(ev,state).length){
    el.innerHTML='<span style="color:var(--tx3)">請選擇請假學生</span>';return;
  }
  const miss=absMissingTiming(ev,state);
  if(miss.length){
    el.innerHTML=`<span style="color:var(--tx3)">請選擇${miss.length>1||(state.students||[]).length>1?` ${esc(miss.join('、'))} 的`:''}請假時機</span>`;
    return;
  }
  const res=computeAbsResult(ev,state);
  if(res.empty){el.innerHTML='<span style="color:var(--tx3)">請選擇請假學生</span>';return;}
  const anyNoShow=state.type!=='teacher'&&absTargets(ev,state).some(n=>absTimingOf(state,n)==='C');
  const hint=anyNoShow?'<span style="color:var(--dg);font-size:12px">（曠課：不排補課、不計欠課）</span>':'';
  el.innerHTML=`新標題：<strong>${esc(res.title)}</strong> ${hint}`;
}

// 系統課堂：把面板選擇寫進 driveData.absences（與 computeAbsResult 同語意：
// 標一邊保留另一邊、同一人改標會搬組；老師請假清空學生兩組）
function sysApplyAbsence(ev,state){
  const idOf=new Map(eventRosterWithId(ev).map(r=>[r.name,r.studentId]));
  const list=getAbsences().slice();
  let rec=list.find(a=>a.occId===ev.id);
  if(!rec){
    rec={id:Date.now(),occId:ev.id,courseId:ev.courseId,date:ev.startDt.toISOString(),
      teacherAbsent:false,leave:[],noShow:[],makeupSkip:[],createdAt:new Date().toISOString()};
    list.push(rec);
  }
  if(state.type==='teacher'){rec.teacherAbsent=true;rec.leave=[];rec.noShow=[];}
  else{
    const newOnes=absTargets(ev,state);
    rec.leave=(rec.leave||[]).filter(x=>!newOnes.includes(x.name));
    rec.noShow=(rec.noShow||[]).filter(x=>!newOnes.includes(x.name));
    newOnes.forEach(n=>{
      // 面板已擋掉「沒選時機」（confirmAbs），這裡的 ||'B' 只是給程式呼叫端的保底，不寫 null 進資料庫
      const t=absTimingOf(state,n)||'B';
      if(t==='C')rec.noShow.push({studentId:idOf.get(n)??null,name:n});
      else rec.leave.push({studentId:idOf.get(n)??null,name:n,timing:t});
    });
    // 改成曠課的人不留不補課標記（那個標記只對請假有意義）
    rec.makeupSkip=(rec.makeupSkip||[]).filter(n=>(rec.leave||[]).some(x=>x.name===n));
  }
  rec.updatedAt=new Date().toISOString();
  saveAbsences(list);
}

// 標記請假／曠課 → 記一筆動態（js/activity.js）。時機三段照面板的字，同事才對得起來
var ABS_TIMING_LBL={A:'課前 1 小時以上',B:'課前 1 小時內',C:'已開始'};
function logAbsenceAct(ev,state){
  if(typeof logAct!=='function')return;
  if(state.type==='teacher'){logAct('absence','標記 老師請假',actEvLabel(ev),'整堂不上');return;}
  // 一批人可能各自不同時機 → 同時機的併成一則，不同的各記一則（動態才看得出誰是曠課）
  const byT=new Map();
  absTargets(ev,state).forEach(n=>{
    const t=absTimingOf(state,n);
    if(!byT.has(t))byT.set(t,[]);
    byT.get(t).push(n);
  });
  byT.forEach((who,t)=>{
    const noShow=t==='C';
    logAct('absence',`標記 ${who.join('、')} ${noShow?'曠課':'請假'}`,actEvLabel(ev),
      noShow?'曠課：不排補課、不計欠課':(ABS_TIMING_LBL[t]||''));
  });
}

// ── 請假次數提醒 ──
// 學生卡片的「⚠ 多收費」是事後才看得到的標籤，這裡把同一條門檻搬到「標記當下」先攔一下，
// 同事馬上知道要跟家長講收費。計數口徑跟那個標籤一致：只算「學生自己請假」
//（調課、老師請假、曠課都不算，因為 leave[] 裡本來就只有請假的人），同一門課、同一期別內累計。
// 期別看「這堂課的日期」落在哪期，不是學生頁上面選的分頁。
// 「同一門課」怎麼認：兩邊都認得出課程編號就比編號（課程改名也對得上），
// 否則退回比課名。會沒有編號的是補課/調課場次與舊行事曆搬遷的快照紀錄；
// 後者回填過就有 legacyCourseId（見 tools/backfill-courseid.js）。
// ⚠ 退回比課名時，同名的不同課會被當成同一門（例如三門都叫「國二數學班」）→ 次數會多算。
function courseKeyOf(e){return e.courseId??e.legacyCourseId??null;}
function sameCourseAs(a,b){
  const ka=courseKeyOf(a),kb=courseKeyOf(b);
  return(ka!=null&&kb!=null)?ka===kb:(a.origTitle||'')===(b.origTitle||'');
}
// 這位學生在這門課、這個期別內請過幾次假。
// 資料源用 makeupList（＝學生卡片「⚠ 多收費」讀的同一份），兩邊數字才對得起來；
// 名單比對優先用 studentId（從原始紀錄取），同名學生不互相污染，舊紀錄沒 id 才退回比名字。
function countStudentLeaves(ev,studentId,name,period,excludeOccId){
  if(!period)return 0;
  const recByOcc=new Map(getAbsences().map(a=>[a.occId,a]));
  return makeupList.filter(e=>{
    if(e.id===excludeOccId)return false;
    if(!e.startDt||e.startDt<period.start||e.startDt>period.end)return false;
    if(e.absType!=='學生請假')return false;   // 調課、老師請假不算；純曠課的 absType 是空字串
    if(!sameCourseAs(e,ev))return false;
    const leave=(recByOcc.get(e.id)||{}).leave;
    return leave?leave.some(x=>(studentId!=null&&x.studentId!=null)?x.studentId===studentId:x.name===name)
                :(e.absentStudents||[]).includes(name);
  }).length;
}

// 這次要標記的人裡，哪些人算完會達到門檻。回傳 [{name,count}]，空陣列＝不用跳提醒
function leaveThresholdWarnings(ev,state){
  if(state.type==='teacher')return[];                     // 老師請假不計多收費
  const period=periodOfDate(ev.startDt);
  if(!period)return[];
  const threshold=getThreshold(period.id);
  const idOf=new Map(eventRosterWithId(ev).map(r=>[r.name,r.studentId]));
  // 同一批裡標成曠課的人不算（一人請假一人曠課時，只有請假那個要提醒）
  const newOnes=absTargets(ev,state).filter(n=>absTimingOf(state,n)!=='C');
  return newOnes
    .map(n=>({name:n,count:countStudentLeaves(ev,idOf.get(n)??null,n,period,ev.id)+1}))
    .filter(x=>x.count>=threshold)
    .map(x=>Object.assign(x,{period,threshold}));
}

async function confirmAbs(id,sfx){
  const state=absState[id];
  const ev=findEventById(id);
  if(!state?.type||!ev)return;
  const res=computeAbsResult(ev,state);
  if(res.empty){toast('請選擇請假學生','inf');return;}
  // 時機不預選（2026-08-06）→ 沒點的人不能默默當成「課前 1hr 內」，補課與多收費都靠它
  const miss=absMissingTiming(ev,state);
  if(miss.length){toast(`請選擇 ${miss.join('、')} 的請假時機`,'inf');return;}
  const warns=leaveThresholdWarnings(ev,state);
  if(warns.length){
    const p=warns[0].period,t=warns[0].threshold;
    const lines=warns.map(w=>`<div style="margin:4px 0">・<b>${esc(w.name)}</b>　${esc(ev.origTitle)}　第 <b>${w.count}</b> 次請假</div>`).join('');
    const ok=await uiConfirm({
      title:'⚠ 請假次數提醒',
      html:`<div style="font-size:13.5px;line-height:1.7">
        <div style="margin-bottom:8px">以下學生標記後會達到 <b>${esc(p.label)}</b> 的多收費門檻（${t} 次）：</div>
        ${lines}
        <div style="margin-top:10px;color:var(--tx2);font-size:12.5px">記得跟家長確認收費。仍要標記請按下面的按鈕。</div>
      </div>`,
      ok:'仍要標記'});
    if(!ok)return;
  }
  const newTitle=res.title;
  // Close panels
  const panel=document.getElementById('absp-'+id);if(panel)panel.classList.remove('open');
  const panelW=document.getElementById('absp-w-'+id);if(panelW)panelW.classList.remove('open');
  sysApplyAbsence(ev,state);
  // 從請假改標成曠課的人：原本排好的補課要跟著撤（曠課不排補課）
  if(state.type!=='teacher'){
    const toNoShow=absTargets(ev,state).filter(n=>absTimingOf(state,n)==='C'&&(ev.absentStudents||[]).includes(n));
    if(toNoShow.length&&typeof dropMakeupsForNoShow==='function')dropMakeupsForNoShow(ev.id,toNoShow);
  }
  // 這次標記後「要排補課」的人＝時機 A/B（C＝曠課不排補課）。老師請假＝整堂補，沒有個別名單
  const needMk=state.type==='teacher'?[]:absTargets(ev,state).filter(n=>absTimingOf(state,n)!=='C');
  const offer=state.type==='teacher'||needMk.length>0;
  logAbsenceAct(ev,state);
  toast('已標記：'+newTitle,'ok');
  await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
  if(selectedWeekEvent===id) closeWeekModal();
  // 標記完直接問要不要排補課（2026-08-13）——以前只丟 toast，要自己換頁去待補課清單找回這筆。
  // 重新讀完才問：選時段要拿新的請假狀態算空檔
  if(offer&&typeof offerArrangeNow==='function')await offerArrangeNow(id,'makeup');
}

// ── 取消請假流程 ──
// 2026-08-04 起一律跳置中視窗（跟課卡其他動作同一個手感，也不用管這顆鈕長在哪一頁）：
// 單人／老師請假＝確認視窗，多人＝視窗裡挑要取消誰。原本插在卡片下方的選人面板已拿掉。
async function cancelAbs(id){
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  const ev=findEventById(id);if(!ev)return;
  if(ev.type==='one'||ev.absentStudents.length<=1){
    await doCancel(id,ev,[]);
    return;
  }
  const picked=await pickUndoStudents(ev.absentStudents,{
    title:'取消請假',lbl:'選擇要取消請假的學生（可多選）',ok:'確認取消請假',
    extra:makeupWarnHtml(id,false)});
  if(picked)await doCancel(id,ev,picked,true);
}

// 視窗裡的選人器（取消請假／取消曠課共用）：沒勾人不關視窗、勾好的不會因為提示而不見
async function pickUndoStudents(names,o){
  let sel=[];
  for(;;){
    const chips=names.map(s=>`<div class="stu-chip${sel.includes(s)?' checked':''}" data-name="${esc(s)}" onclick="this.classList.toggle('checked')">${esc(s)}</div>`).join('');
    const ok=await uiConfirm({title:o.title,ok:o.ok,danger:true,
      html:`<div class="abs-title" style="margin-bottom:8px">${o.lbl}</div>
        <div class="stu-chips" id="ask-pick-chips">${chips}</div>${o.extra||''}`});
    if(!ok)return null;
    sel=[...document.querySelectorAll('#ask-pick-chips .stu-chip.checked')].map(el=>el.dataset.name);
    if(sel.length)return sel;
    toast('請至少選一位學生','inf');
  }
}

// 已排好的補課／調課會被連帶撤掉 → 確認視窗裡要講清楚是哪一場
// definite=true：這次一定會撤（單人取消）；false：要看等下勾了誰（多人選人器）
function makeupWarnHtml(id,definite){
  const recs=getMakeupsFor(id);if(!recs.length)return'';
  const what=esc(recs[0].calName||'補課');
  const lines=recs.map(rec=>{
    const s=new Date(rec.scheduledDate);
    const who=(rec.absentStudents||[]).join('、');
    return`<div>・${recs.length>1&&who?esc(who)+'　':''}<b>${fmtD(s)} ${fmtT(s)}${rec.room?'　'+esc(rec.room):''}</b></div>`;
  }).join('');
  return`<div class="ask-note ask-warn" style="margin-top:12px">⚠ 這堂已排好${recs.length>1?` ${recs.length} 場`:''}${what}：${lines}${definite?`取消後這${recs.length>1?'些':'場'}${what}會一併移除。`:`補課場次上的人若都不請假了，那場${what}會一併移除。`}</div>`;
}

// 取消請假：從請假紀錄移除（保留曠課群組），紀錄清空即刪整筆
// preConfirmed：多人選人器本身就是確認視窗，不用再問第二次
async function doCancel(id,ev,cancelStudents,preConfirmed){
  const clearAll=(cancelStudents.length===0||ev.type==='one');
  // 動態要記「取消了誰的請假」——名單得在改資料之前先抄下來
  const undone=clearAll?(ev.absType==='老師請假'?['老師']:(ev.absentStudents||[])):cancelStudents;
  // 取消後還有沒有人請假：全清空的話，已排好的補課會跟著撤（確認視窗要寫出來）
  const remainAfter=clearAll?[]:(ev.absentStudents||[]).filter(n=>!cancelStudents.includes(n));
  if(!preConfirmed){
    const whoTxt=ev.absType==='老師請假'?'老師請假':`${undone.join('、')} 的請假`;
    const warn=(!remainAfter.length&&!ev.isRescheduled)?makeupWarnHtml(id,true):'';
    if(!await uiConfirm({title:'取消請假',
      html:`要取消 <b>${esc(whoTxt)}</b> 嗎？<div class="ask-sub">${esc(actEvLabel(ev))}</div>${warn}`,
      ok:'確認取消請假',danger:true}))return;
  }
  let list=getAbsences().slice();
  const rec=list.find(a=>a.occId===id);
  if(rec){
    rec.teacherAbsent=clearAll?false:rec.teacherAbsent;
    rec.leave=clearAll?[]:(rec.leave||[]).filter(x=>!cancelStudents.includes(x.name));
    rec.makeupSkip=(rec.makeupSkip||[]).filter(n=>(rec.leave||[]).some(x=>x.name===n)); // 不再請假的人不留不補課標記
    rec.updatedAt=new Date().toISOString();
    if(!rec.teacherAbsent&&!(rec.leave||[]).length&&!(rec.noShow||[]).length&&!rec.resched)list=list.filter(a=>a!==rec);
    saveAbsences(list);
  }
  syncMakeupOnLeaveCancel(id); // 已排的補課跟著撤掉／名單縮小
  if(undone.length)logAct('absence',`取消 ${undone.join('、')} 的請假`,actEvLabel(ev),'');
  toast('已取消請假','ok');
  await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
  closeWeekModal();
  refreshMakeupPanel();
}

// 從待補課清單按取消請假／取消曠課時，清單自己要重畫（loadMakeup(true) 是靜默的、不重畫）
function refreshMakeupPanel(){
  if(currentPanel!=='makeup')return;
  populateMkFilters();renderMakeup();updateMakeupBadge();
}

// ── 取消曠課流程（與取消請假對稱）：一樣跳置中視窗，單人＝確認、多人＝視窗裡挑人 ──
async function cancelNoShow(id){
  document.querySelectorAll('.abs-panel.open').forEach(p=>p.classList.remove('open'));
  const ev=findEventById(id);if(!ev)return;
  if((ev.noShowStudents||[]).length<=1){
    await doCancelNoShow(id,ev,[]);
    return;
  }
  const picked=await pickUndoStudents(ev.noShowStudents,{
    title:'取消曠課',lbl:'選擇要取消曠課的學生（可多選）',ok:'確認取消曠課'});
  if(picked)await doCancelNoShow(id,ev,picked,true);
}

// 取消曠課：從曠課群組移除（保留請假群組），紀錄清空即刪整筆
async function doCancelNoShow(id,ev,cancelStudents,preConfirmed){
  const undone=cancelStudents.length?cancelStudents:(ev.noShowStudents||[]);   // 同 doCancel：改資料前先抄名單
  if(!preConfirmed){
    if(!await uiConfirm({title:'取消曠課',
      html:`要取消 <b>${esc(undone.join('、'))} 的曠課</b> 嗎？<div class="ask-sub">${esc(actEvLabel(ev))}</div>`,
      ok:'確認取消曠課',danger:true}))return;
  }
  let list=getAbsences().slice();
  const rec=list.find(a=>a.occId===id);
  if(rec){
    rec.noShow=(cancelStudents.length===0)?[]:(rec.noShow||[]).filter(x=>!cancelStudents.includes(x.name));
    rec.updatedAt=new Date().toISOString();
    if(!rec.teacherAbsent&&!(rec.leave||[]).length&&!(rec.noShow||[]).length&&!rec.resched)list=list.filter(a=>a!==rec);
    saveAbsences(list);
  }
  if(undone.length)logAct('absence',`取消 ${undone.join('、')} 的曠課`,actEvLabel(ev),'');
  toast('已取消曠課','ok');
  await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
  closeWeekModal();
  refreshMakeupPanel();
}
