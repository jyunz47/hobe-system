// 桌面日曆（Apple 風行事曆）：Day／Week／Month 三種檢視、垂直時間軸＋彩色課程塊、
// 重疊自動 cascade 疊放、日檢視可「依教室分欄」、點空白處直接新增課程、亮／深色切換。
//
// 資料一律現算：由 schedule.js 的展開器（系統課表＋補課場次）依當前檢視的日期範圍展開，
// 不依賴 today.js 的 dayEvents，所以週／月檢視翻到任何一週都拿得到課。
// 點課塊＝selectWeekEvent 開既有詳情視窗（靠 state.js 的 findEventById 找得到 dvEvents）。

var DV_HOUR_H=62; // 每小時像素高
var DV_MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DV_WDE=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var DV_WDS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
var DV_ADD_MINS=90;      // 點空白新增課程時預設的課堂長度
var DV_SNAP=15;          // 點空白時把時間吸附到 15 分鐘
var DV_MONTH_CHIPS=3;    // 月檢視每格最多列幾筆，其餘收成「還有 N 堂」

// ── 檢視偏好（記在瀏覽器，換分頁/重開都留著）──
var dvView=localStorage.getItem('dvView')||'day';        // 'day' | 'week' | 'month'
var dvRooms=localStorage.getItem('dvRooms')==='1';       // 日檢視：一間教室一欄
var dvLight=localStorage.getItem('dvLight')==='1';       // 亮色主題

function dvSetView(v){dvView=v;localStorage.setItem('dvView',v);renderDayView();}
function dvToggleRooms(){dvRooms=!dvRooms;localStorage.setItem('dvRooms',dvRooms?'1':'0');renderDayView();}
function dvToggleTheme(){dvLight=!dvLight;localStorage.setItem('dvLight',dvLight?'1':'0');renderDayView();}

// hex → rgba（底色疊半透明色塊）
function _dvTint(hex,a){
  const {r,g,b}=_dvRGB(hex);return`rgba(${r},${g},${b},${a})`;
}
function _dvRGB(hex){
  const h=String(hex||'').replace('#','');
  const n=h.length===3?h.split('').map(c=>c+c).join(''):h;
  return{r:parseInt(n.slice(0,2),16)||0,g:parseInt(n.slice(2,4),16)||0,b:parseInt(n.slice(4,6),16)||0};
}
// f>0 往白色混（深色底要亮字），f<0 往黑色壓（亮色底要深字）
function _dvShift(hex,f){
  const {r,g,b}=_dvRGB(hex);
  const m=f>=0?v=>Math.round(v+(255-v)*f):v=>Math.round(v*(1+f));
  return`rgb(${m(r)},${m(g)},${m(b)})`;
}
// 課塊配色：深色底要亮字亮邊，亮色底要深字深邊——同一組色票兩種算法
function _dvColors(calName,faded){
  const base=calColor(calName);
  const lite=dvLight?-.30:.18, txt=dvLight?-.48:.55;
  const tint=dvLight?(faded?.07:.16):(faded?.10:.30);
  return{bar:_dvShift(base,lite),txt:_dvShift(base,txt),bg:_dvTint(base,tint)};
}
// 12 小時制：1PM / 6:30PM
function _dvAP(d){
  let h=d.getHours();const m=d.getMinutes();const ap=h<12?'AM':'PM';h=h%12;if(h===0)h=12;
  return m?`${h}:${String(m).padStart(2,'0')}${ap}`:`${h}${ap}`;
}
function _dvSameDay(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function _dvMidnight(d){const x=new Date(d);x.setHours(0,0,0,0);return x;}
// 該週的週一（桌面日曆固定週一起算，跟「本週課程」一致）
function _dvMonday(d){
  const x=_dvMidnight(d),dow=x.getDay();
  x.setDate(x.getDate()-(dow===0?6:dow-1));return x;
}

// 把 HOBE 系統安裝成桌面 App。桌面上只該有這一個 App——桌面日曆是從它裡面開的視窗，
// 不再另外安裝（以前那個「HOBE 日檢視」App 就是這樣多出來的）。
// 這顆鈕平常藏著，只有瀏覽器真的發了安裝事件（＝還沒裝過）才加 .ready 冒出來。
function dvInstall(){
  if(installPromptEvent){
    installPromptEvent.prompt();
    installPromptEvent.userChoice.finally(()=>{
      installPromptEvent=null;
      const b=document.querySelector('.dv-installbtn');if(b)b.classList.remove('ready');
    });
    return;
  }
  if(typeof toast==='function')toast('沒跳出安裝視窗：Chrome 點網址列右邊的安裝圖示（顯示「Open in app」＝已經裝過了）；Safari 用「檔案 → 加入 Dock」','inf');
}

// 開一個置中的獨立視窗（沒有網址列／分頁列）。同 origin 沿用登入，不用重登。
function _dvOpenWin(query,name){
  const w=Math.min(1240,(screen.availWidth||1440)-80);
  const h=Math.min(900,(screen.availHeight||900)-80);
  const left=Math.round(((screen.availWidth||1440)-w)/2);
  const top=Math.round(((screen.availHeight||900)-h)/2);
  const win=window.open(location.pathname+query,name,`popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if(!win){if(typeof toast==='function')toast('視窗被瀏覽器擋下，請允許此網站的彈出視窗','err');return null;}
  win.focus();return win;
}

// 兩層桌面流程：
//   瀏覽器分頁 →「🖥 開啟桌面系統」→ 完整系統的桌面視窗（?win=1）
//   桌面系統視窗／已安裝的 App → 設定 →「⧉ 開啟桌面日曆」→ 滿版日曆浮窗（?app=dayview）
// 分頁裡不給「開啟桌面日曆」：老闆的用法是先進桌面系統，日曆從那裡開。
//
// ⚠️ 網頁「無法」用程式叫起已安裝的 App——那是網址列「Open in app」的權限，瀏覽器刻意不開放給 JS
//（否則任何網站都能亂開你電腦上的 App）。所以這顆鈕做次好的事：
//   還沒安裝 → 直接跳原生安裝視窗，裝完 Chrome 會自己用 App 視窗開起來
//   已經安裝 → 開一個外觀相同的桌面視窗，並提示「Open in app → 一律用 App 開啟」可以一勞永逸
function openSystemWindow(){
  if(installPromptEvent){dvInstall();return;} // 還沒裝：裝了就直接有 App 視窗
  _dvOpenWin('?win=1','hobe-app');
  if(typeof toast==='function')toast('要用桌面上那個 App 開：點網址列右邊「Open in app」，勾「一律用應用程式開啟」，之後這個網址會自動進 App','inf');
}
function openDayViewWindow(){_dvOpenWin('?app=dayview','hobe-dayview');}

// ── 導覽 ──
// 設定日期並重載（主頁的今日/本週也跟著換日，維持與系統其他頁一致）
function dvNav(d){
  currentDate=d;
  if(typeof setDateDisplay==='function')setDateDisplay(currentDate);
  const dp=document.getElementById('date-picker');if(dp)dp.value=toDateStr(currentDate);
  if(isSignedIn())Promise.all([loadToday(),loadWeek()]);
  else renderDayView();
}
// ‹ › 依當前檢視位移一格：日＝1 天、週＝7 天、月＝1 個月
function dvShift(delta){
  const d=new Date(currentDate);
  if(dvView==='day')d.setDate(d.getDate()+delta);
  else if(dvView==='week')d.setDate(d.getDate()+delta*7);
  else return dvShiftMonth(delta);
  dvNav(d);
}
function dvGoToday(){dvNav(new Date());}
function dvShiftMonth(delta){
  const d=new Date(currentDate);d.setDate(1);d.setMonth(d.getMonth()+delta);
  const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(currentDate.getDate(),last));
  dvNav(d);
}
// 從週／月檢視點某一天 → 跳到那天的日檢視
function dvOpenDay(y,m,dd){
  dvView='day';localStorage.setItem('dvView','day');
  dvNav(new Date(y,m,dd));
}

// ── 點空白處新增課程 ──
// 開「＋ 新增課程」置中 modal（跟課程管理 ✎ 編輯同一張表單），時段／教室先填好。
// ⚠️ 刻意不切換到「新增課程/學生」分頁：桌面日曆視窗（?app=dayview）沒有側欄與工具列，
// 切過去就回不來了（2026-07-30 老闆實際踩到）。modal 有 ✕ 可關，不會變死路。
// 預設「每週重複」＋那天的星期（補習班多數課是週課）；要改單日或改時間在表單裡調。
function dvAddAt(y,m,dd,mins,room){
  if(!isSignedIn())return;
  const d=new Date(y,m,dd);
  const raw=Number(mins);
  const s=Number.isFinite(raw)
    ? Math.max(0,Math.min(24*60-DV_ADD_MINS,Math.round(raw/DV_SNAP)*DV_SNAP))
    : 16*60;   // 換算不出時間時退回常見的開課時間，至少不會填出壞值
  const hhmm=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  cfState={...cfBlank(),target:'modal',mode:'weekly',
    slots:[{weekday:d.getDay(),start:hhmm(s),end:hhmm(s+DV_ADD_MINS),date:toDateStr(d)}],
    room:room||''};
  renderCourseForm();
  document.getElementById('cf-modal-wrap').classList.add('open');
  if(typeof toast==='function')toast(`帶入：每週${WD[d.getDay()]} ${hhmm(s)}–${hhmm(s+DV_ADD_MINS)}${room?'・'+room:''}（都可以改）`,'inf');
}

// ── 資料：依當前檢視的範圍現算課堂 ──
function dvRange(){
  const d=currentDate;
  if(dvView==='week'){
    const s=_dvMonday(d),e=new Date(s);e.setDate(s.getDate()+6);e.setHours(23,59,59,999);
    return{start:s,end:e};
  }
  if(dvView==='month'){
    const s=_dvMonday(new Date(d.getFullYear(),d.getMonth(),1)); // 月格從週一起算，前後補鄰月
    const e=new Date(s);e.setDate(s.getDate()+41);e.setHours(23,59,59,999);
    return{start:s,end:e};
  }
  const s=_dvMidnight(d),e=new Date(s);e.setHours(23,59,59,999);
  return{start:s,end:e};
}
function dvLoadEvents(){
  const {start,end}=dvRange();
  dvEvents=[...expandCoursesForRange(start,end),...expandMakeupForRange(start,end)]
    .sort((a,b)=>a.startDt-b.startDt);
  return {start,end};
}

// ── 重疊 cascade（Apple 疊法）──
// 先分群（transitive overlap）→ 群內貪婪配「層」→ 每層往右縮排一點、都延伸到右緣、後者疊在前者上。
// 結果是每堂課露出左邊一條可點的縮排，而不是等寬切成一條條細長條（真實密集資料下名字會被切掉）。
function _dvCascade(items){
  items.sort((a,b)=>a.s-b.s||b.en-a.en);
  const clusters=[];let cur=[],curEnd=-1;
  for(const it of items){if(cur.length&&it.s>=curEnd){clusters.push(cur);cur=[];curEnd=-1;}cur.push(it);curEnd=Math.max(curEnd,it.en);}
  if(cur.length)clusters.push(cur);
  for(const cl of clusters){
    const layerEnd=[];
    for(const it of cl){
      let placed=false;
      for(let i=0;i<layerEnd.length;i++){if(it.s>=layerEnd[i]){it.lv=i;layerEnd[i]=it.en;placed=true;break;}}
      if(!placed){it.lv=layerEnd.length;layerEnd.push(it.en);}
    }
    const n=layerEnd.length;
    const indent=n<=1?0:Math.min(22,60/n);   // 每層往右縮排的百分比
    cl.forEach(it=>{it.left=it.lv*indent;it.width=100-it.left;});
  }
  return items;
}

// ── 時間軸範圍：包住所有課，至少 3 小時 ──
function _dvAxis(evs){
  if(!evs.length){const h=new Date().getHours();return{h0:Math.max(0,h-1),h1:Math.min(24,Math.max(h+5,3))};}
  const mn=Math.min(...evs.map(e=>e.startDt.getHours()*60+e.startDt.getMinutes()));
  const mx=Math.max(...evs.map(e=>e.endDt.getHours()*60+e.endDt.getMinutes()));
  let h0=Math.max(0,Math.floor(mn/60)),h1=Math.min(24,Math.ceil(mx/60));
  if(h1-h0<3)h1=Math.min(24,h0+3);
  return{h0,h1};
}
function _dvHoursHtml(h0,h1){
  let s='';
  for(let h=h0;h<h1;h++){
    let hh=h%12;if(hh===0)hh=12;const ap=h<12?'AM':'PM';const lab=h===12?'Noon':`${hh} ${ap}`;
    s+=`<div class="dv-hour" style="height:${DV_HOUR_H}px"><span class="dv-hour-lbl">${lab}</span></div>`;
  }
  return s;
}

// ── 單一課塊的 HTML（day／week 共用）──
function _dvEvHtml(it,axisStart,isToday,now){
  const e=it.e;
  const top=(it.s-axisStart)/60*DV_HOUR_H,hgt=Math.max((it.en-it.s)/60*DV_HOUR_H,22);
  const faded=e.isFullAbsent||e.isRescheduled;
  const {bar,txt,bg}=_dvColors(e.calName,faded);
  let stat='';if(!faded&&isToday){if(now>=e.endDt)stat='past';else if(now>=e.startDt)stat='now';}
  // 重複課（每週排程）標 ↻；補課/調課場次與指定日期單場不標
  const co=(e.courseId!=null&&typeof findCourseById==='function')?findCourseById(e.courseId):null;
  const isRepeat=!!(co&&co.schedule&&co.schedule.mode!=='dates')&&!e.isMakeupOcc;
  const badge=
    e.isRescheduled?'<span class="dv-ev-badge">調課</span>':
    (e.isMakeupOcc&&e.calName==='補課')?'<span class="dv-ev-badge">補課</span>':
    e.isAbsent?'<span class="dv-ev-badge">請假</span>':
    e.isNoShow?'<span class="dv-ev-badge">曠課</span>':'';
  const cls='dv-ev'+(faded?' dv-faded':'')+(stat==='now'?' dv-now':'')+(stat==='past'?' dv-past':'')+(hgt<40?' dv-short':'');
  const sub=[`${_dvAP(e.startDt)} – ${_dvAP(e.endDt)}`];
  if(!(dvView==='day'&&dvRooms)&&e.classroom)sub.push(esc(e.classroom)); // 已依教室分欄時不重複寫教室
  if(hgt>=76&&e.teacher)sub.push(esc(e.teacher));
  const meta=hgt>=42?`<div class="dv-ev-meta">${sub.join(' · ')}</div>`:'';
  return`<div class="${cls}" style="top:${top}px;height:${hgt-2}px;left:calc(${it.left.toFixed(2)}% + 2px);width:calc(${it.width.toFixed(2)}% - 4px);z-index:${2+(it.lv||0)};border-left-color:${bar};background:${bg};color:${txt}" onclick="event.stopPropagation();selectWeekEvent('${esc(e.id)}')" title="${esc(e.origTitle)}">`
    +`${isRepeat?`<span class="dv-ev-rep" style="color:${bar}">↻</span>`:''}`
    +`<div class="dv-ev-title${faded?' struck':''}">${esc(e.origTitle)}${badge}</div>${meta}</div>`;
}

// ── 分欄時間軸（day 與 week 共用）──
// cols：[{date, room, evs}]；每欄各自 cascade，點欄背景＝在那個日期／時間／教室新增課程
function _dvRenderColumns(cols,axis){
  const grid=document.getElementById('dv-grid');
  const {h0,h1}=axis,axisStart=h0*60,totalH=(h1-h0)*DV_HOUR_H;
  const now=new Date(),today=_dvMidnight(now);
  const w=100/cols.length;
  let colsHtml='';
  cols.forEach((c,i)=>{
    const isToday=_dvSameDay(c.date,today);
    const items=_dvCascade(c.evs.map(e=>({e,s:e.startDt.getHours()*60+e.startDt.getMinutes(),en:e.endDt.getHours()*60+e.endDt.getMinutes()})));
    const evHtml=items.map(it=>_dvEvHtml(it,axisStart,isToday,now)).join('');
    // 點空白：用點擊位置換算成分鐘（offsetY ÷ 每小時高）
    const hit=`<div class="dv-col-hit" onclick="dvAddAt(${c.date.getFullYear()},${c.date.getMonth()},${c.date.getDate()},${axisStart}+event.offsetY/${DV_HOUR_H}*60,'${esc(c.room||'')}')"></div>`;
    let nowHtml='';
    if(isToday){
      const nm=now.getHours()*60+now.getMinutes();
      if(nm>=axisStart&&nm<=h1*60)nowHtml=`<div class="dv-now-line" style="top:${((nm-axisStart)/60*DV_HOUR_H).toFixed(1)}px"></div>`;
    }
    colsHtml+=`<div class="dv-col" style="left:${(i*w).toFixed(4)}%;width:${w.toFixed(4)}%">${hit}${evHtml}${nowHtml}</div>`;
  });
  grid.style.height=totalH+'px';
  grid.innerHTML=`<div class="dv-hours">${_dvHoursHtml(h0,h1)}</div><div class="dv-events">${colsHtml}</div>`;
}

function _dvEmpty(msg){
  const g=document.getElementById('dv-grid');g.style.height='';
  g.innerHTML=`<div class="dv-empty">${msg}　·　點時間軸空白處可新增課程</div>`;
}

// ── 日檢視 ──
function _dvRenderDay(evs){
  const d=currentDate;
  const md=document.getElementById('dv-h-md'),yr=document.getElementById('dv-h-yr'),wd=document.getElementById('dv-h-wd');
  if(md)md.textContent=`${DV_MON[d.getMonth()]} ${d.getDate()},`;
  if(yr)yr.textContent=d.getFullYear();
  if(wd)wd.textContent=DV_WDE[d.getDay()];
  const head=document.getElementById('dv-colhd');

  if(!dvRooms){
    if(head)head.style.display='none';
    if(!evs.length)return _dvEmpty('這天沒有課程');
    return _dvRenderColumns([{evs,date:d,room:''}],_dvAxis(evs));
  }
  // 依教室分欄：只列「當天真的有課」的教室，順序照 COURSE_ROOMS；沒填教室的收成最後一欄
  const cols=COURSE_ROOMS.filter(r=>evs.some(e=>e.classroom===r))
    .map(r=>({room:r,label:r,date:d,evs:evs.filter(e=>e.classroom===r)}));
  const noRoom=evs.filter(e=>!COURSE_ROOMS.includes(e.classroom));
  if(noRoom.length)cols.push({room:'',label:'未指定教室',date:d,evs:noRoom});
  if(!cols.length){if(head)head.style.display='none';return _dvEmpty('這天沒有課程');}
  if(head){
    head.style.display='flex';
    head.innerHTML=cols.map(c=>`<div class="dv-colhd-c plain"><b>${esc(c.label)}</b><span>${c.evs.length} 堂</span></div>`).join('');
  }
  _dvRenderColumns(cols,_dvAxis(evs));
}

// ── 週檢視：七天並排，共用一條時間軸 ──
function _dvRenderWeek(evs,start){
  const end=new Date(start);end.setDate(start.getDate()+6);
  const md=document.getElementById('dv-h-md'),yr=document.getElementById('dv-h-yr'),wd=document.getElementById('dv-h-wd');
  const sameMon=start.getMonth()===end.getMonth();
  if(md)md.textContent=`${DV_MON[start.getMonth()].slice(0,3)} ${start.getDate()} – ${sameMon?'':DV_MON[end.getMonth()].slice(0,3)+' '}${end.getDate()},`;
  if(yr)yr.textContent=end.getFullYear();
  if(wd)wd.textContent=`共 ${evs.length} 堂`;

  const today=_dvMidnight(new Date()),sel=_dvMidnight(currentDate);
  const cols=[];
  for(let i=0;i<7;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);
    cols.push({date:d,room:'',evs:evs.filter(e=>_dvSameDay(e.startDt,d))});
  }
  const head=document.getElementById('dv-colhd');
  if(head){
    head.style.display='flex';
    head.innerHTML=cols.map(c=>{
      const cls='dv-colhd-c'+(_dvSameDay(c.date,today)?' today':'')+(_dvSameDay(c.date,sel)?' sel':'');
      return`<div class="${cls}" onclick="dvOpenDay(${c.date.getFullYear()},${c.date.getMonth()},${c.date.getDate()})" title="看這天的日檢視">${DV_WDS[c.date.getDay()]}<b>${c.date.getDate()}</b></div>`;
    }).join('');
  }
  if(!evs.length)return _dvEmpty('這一週沒有課程');
  _dvRenderColumns(cols,_dvAxis(evs));
}

// ── 月檢視：6×7 日格，每格列課程 chip ──
function _dvRenderMonth(evs,start){
  const d=currentDate;
  const md=document.getElementById('dv-h-md'),yr=document.getElementById('dv-h-yr'),wd=document.getElementById('dv-h-wd');
  if(md)md.textContent=DV_MON[d.getMonth()];
  if(yr)yr.textContent=d.getFullYear();
  if(wd)wd.textContent=`本月共 ${evs.filter(e=>e.startDt.getMonth()===d.getMonth()).length} 堂`;

  const head=document.getElementById('dv-colhd');
  if(head){
    head.style.display='flex';
    head.classList.add('flush');   // 月檢視沒有時間軸刻度欄，表頭不留那 52px
    head.innerHTML=['MON','TUE','WED','THU','FRI','SAT','SUN']
      .map(x=>`<div class="dv-colhd-c plain">${x}</div>`).join('');
  }
  const byDay=new Map();
  evs.forEach(e=>{const k=toDateStr(e.startDt);if(!byDay.has(k))byDay.set(k,[]);byDay.get(k).push(e);});

  const today=toDateStr(new Date()),sel=toDateStr(d),thisMon=d.getMonth();
  let cells='';
  for(let i=0;i<42;i++){
    const cd=new Date(start);cd.setDate(start.getDate()+i);
    const ds=toDateStr(cd);
    const list=(byDay.get(ds)||[]).sort((a,b)=>a.startDt-b.startDt);
    const cls='dv-mcell'+(cd.getMonth()!==thisMon?' mute':'')+(ds===today?' today':(ds===sel?' sel':''));
    const chips=list.slice(0,DV_MONTH_CHIPS).map(e=>{
      const faded=e.isFullAbsent||e.isRescheduled;
      const {bar,txt,bg}=_dvColors(e.calName,faded);
      return`<div class="dv-mchip${faded?' struck':''}" style="border-left-color:${bar};background:${bg};color:${txt}" onclick="event.stopPropagation();selectWeekEvent('${esc(e.id)}')" title="${esc(e.origTitle)}">${_dvAP(e.startDt)} ${esc(e.origTitle)}</div>`;
    }).join('');
    const more=list.length>DV_MONTH_CHIPS?`<div class="dv-mmore">還有 ${list.length-DV_MONTH_CHIPS} 堂</div>`:'';
    cells+=`<div class="${cls}" onclick="dvOpenDay(${cd.getFullYear()},${cd.getMonth()},${cd.getDate()})" title="看這天的日檢視"><span class="dv-mnum">${cd.getDate()}</span>${chips}${more}</div>`;
  }
  const grid=document.getElementById('dv-grid');
  grid.style.height='';
  grid.innerHTML=`<div class="dv-month">${cells}</div>`;
}

// ── 右側迷你月曆（currentDate 當月；點日切換、今日紅圈、選定日灰圈）──
function renderMiniMonth(){
  const box=document.getElementById('dv-mini');if(!box)return;
  const lbl=document.getElementById('dv-mini-label');
  const d=currentDate,year=d.getFullYear(),month=d.getMonth();
  if(lbl)lbl.textContent=`${DV_MON[month]} ${year}`;
  const startDow=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const prevDays=new Date(year,month,0).getDate();
  const todayStr=toDateStr(new Date()),selStr=toDateStr(d);
  const cells=[];
  for(let i=0;i<startDow;i++)cells.push({n:prevDays-startDow+1+i,mute:1,date:new Date(year,month-1,prevDays-startDow+1+i)});
  for(let n=1;n<=daysInMonth;n++)cells.push({n,date:new Date(year,month,n)});
  let tn=1;while(cells.length<42)cells.push({n:tn,mute:1,date:new Date(year,month+1,tn++)});
  const dows=['S','M','T','W','T','F','S'].map(x=>`<div class="dv-mini-dow">${x}</div>`).join('');
  const days=cells.map(c=>{
    const ds=toDateStr(c.date);
    const cls='dv-mini-day'+(c.mute?' mute':'')+(ds===todayStr?' today':(ds===selStr?' sel':''));
    return`<div class="${cls}" onclick="dvNav(new Date(${c.date.getFullYear()},${c.date.getMonth()},${c.date.getDate()}))">${c.n}</div>`;
  }).join('');
  box.innerHTML=dows+days;
}

// ── 主渲染 ──
function renderDayView(){
  const wrap=document.getElementById('dv-wrap');
  if(!wrap||!document.getElementById('dv-grid'))return;
  wrap.classList.toggle('dv-light',dvLight);
  const tb=document.getElementById('dv-themebtn');if(tb)tb.textContent=dvLight?'☀️':'🌙';
  const rb=document.getElementById('dv-roombtn');
  if(rb){rb.style.display=dvView==='day'?'inline-block':'none';rb.classList.toggle('on',dvRooms);}
  document.querySelectorAll('#dv-seg .dv-seg-b').forEach(b=>b.classList.toggle('on',b.dataset.v===dvView));

  const head=document.getElementById('dv-colhd');
  if(head)head.classList.remove('flush');   // 預設對齊時間軸刻度欄；月檢視自己會加回來

  renderMiniMonth();
  const {start}=dvLoadEvents();
  if(dvView==='week')_dvRenderWeek(dvEvents,start);
  else if(dvView==='month')_dvRenderMonth(dvEvents,start);
  else _dvRenderDay(dvEvents);
}
