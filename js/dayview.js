// 日檢視（Apple 風單日時間軸・深色）：垂直時間軸＋彩色課程塊＋重疊自動分欄＋右側迷你月曆
// 讀同一份 dayEvents（today.js 的 loadToday 已展開系統課表＋補課場次），不另外拉資料。
// 日期沿用 currentDate；點課塊＝selectWeekEvent 開既有詳情視窗，跟主頁一致。

var DV_HOUR_H=62; // 每小時像素高
var DV_MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DV_WDE=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// hex → rgba（深色底疊半透明色塊）
function _dvTint(hex,a){
  const {r,g,b}=_dvRGB(hex);return`rgba(${r},${g},${b},${a})`;
}
function _dvRGB(hex){
  const h=String(hex||'').replace('#','');
  const n=h.length===3?h.split('').map(c=>c+c).join(''):h;
  return{r:parseInt(n.slice(0,2),16)||0,g:parseInt(n.slice(2,4),16)||0,b:parseInt(n.slice(4,6),16)||0};
}
// 往白色混，讓中間調在深色底上變亮（文字/邊條用）
function _dvLighten(hex,f){
  const {r,g,b}=_dvRGB(hex);
  const m=v=>Math.round(v+(255-v)*f);
  return`rgb(${m(r)},${m(g)},${m(b)})`;
}
// 12 小時制：1PM / 6:30PM
function _dvAP(d){
  let h=d.getHours();const m=d.getMinutes();const ap=h<12?'AM':'PM';h=h%12;if(h===0)h=12;
  return m?`${h}:${String(m).padStart(2,'0')}${ap}`:`${h}${ap}`;
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

// 導覽：設定日期並重載（loadToday 尾端會 renderDayView；未登入時直接重畫）
function dvNav(d){
  currentDate=d;
  if(typeof setDateDisplay==='function')setDateDisplay(currentDate);
  const dp=document.getElementById('date-picker');if(dp)dp.value=toDateStr(currentDate);
  if(window.gapi&&gapi.client.getToken())Promise.all([loadToday(),loadWeek()]);
  else renderDayView();
}
function dvShiftMonth(delta){
  const d=new Date(currentDate);d.setDate(1);d.setMonth(d.getMonth()+delta);
  const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  d.setDate(Math.min(currentDate.getDate(),last));
  dvNav(d);
}
function dvSegMsg(){if(typeof toast==='function')toast('目前提供單日檢視','inf');}

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

function renderDayView(){
  renderMiniMonth();
  const grid=document.getElementById('dv-grid');
  if(!grid)return;
  const d=currentDate;
  const md=document.getElementById('dv-h-md'),yr=document.getElementById('dv-h-yr'),wd=document.getElementById('dv-h-wd');
  if(md)md.textContent=`${DV_MON[d.getMonth()]} ${d.getDate()},`;
  if(yr)yr.textContent=d.getFullYear();
  if(wd)wd.textContent=DV_WDE[d.getDay()];

  const evs=(dayEvents||[]).slice();
  if(!evs.length){grid.style.height='';grid.innerHTML='<div class="dv-empty">這天沒有課程</div>';return;}

  const now=new Date();
  const t0=new Date();t0.setHours(0,0,0,0);
  const vd=new Date(d);vd.setHours(0,0,0,0);
  const isToday=vd.getTime()===t0.getTime();

  const items=evs.map(e=>({e,s:e.startDt.getHours()*60+e.startDt.getMinutes(),en:e.endDt.getHours()*60+e.endDt.getMinutes()}));
  const minMin=Math.min(...items.map(x=>x.s)),maxMin=Math.max(...items.map(x=>x.en));
  let axisStartH=Math.max(0,Math.floor(minMin/60)),axisEndH=Math.min(24,Math.ceil(maxMin/60));
  if(axisEndH-axisStartH<3)axisEndH=Math.min(24,axisStartH+3);
  const axisStart=axisStartH*60,totalH=(axisEndH-axisStartH)*DV_HOUR_H;

  // 重疊分欄：分群（transitive overlap）→ 群內貪婪配欄
  items.sort((a,b)=>a.s-b.s||b.en-a.en);
  const clusters=[];let cur=[],curEnd=-1;
  for(const it of items){if(cur.length&&it.s>=curEnd){clusters.push(cur);cur=[];curEnd=-1;}cur.push(it);curEnd=Math.max(curEnd,it.en);}
  if(cur.length)clusters.push(cur);
  for(const cl of clusters){
    const colEnd=[];
    for(const it of cl){let placed=false;for(let i=0;i<colEnd.length;i++){if(it.s>=colEnd[i]){it.col=i;colEnd[i]=it.en;placed=true;break;}}if(!placed){it.col=colEnd.length;colEnd.push(it.en);}}
    cl.forEach(it=>it.ncols=colEnd.length);
  }

  // 小時格線
  let hoursHtml='';
  for(let h=axisStartH;h<axisEndH;h++){
    let hh=h%12;if(hh===0)hh=12;const ap=h<12?'AM':'PM';const lab=h===12?'Noon':`${hh} ${ap}`;
    hoursHtml+=`<div class="dv-hour" style="height:${DV_HOUR_H}px"><span class="dv-hour-lbl">${lab}</span></div>`;
  }

  // 課程塊
  let evHtml='';
  for(const it of items){
    const e=it.e;
    const top=(it.s-axisStart)/60*DV_HOUR_H,hgt=Math.max((it.en-it.s)/60*DV_HOUR_H,22),w=100/it.ncols;
    const color=calColor(e.calName),bar=_dvLighten(color,.18),txt=_dvLighten(color,.55);
    const faded=e.isFullAbsent||e.isRescheduled;
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
    const sub=[];
    sub.push(`${_dvAP(e.startDt)} – ${_dvAP(e.endDt)}`);
    if(e.classroom)sub.push(esc(e.classroom));
    if(hgt>=76&&e.teacher)sub.push(esc(e.teacher));
    const meta=hgt>=42?`<div class="dv-ev-meta">${sub.join(' · ')}</div>`:'';
    evHtml+=`<div class="${cls}" style="top:${top}px;height:${hgt-2}px;left:calc(${(it.col*w).toFixed(2)}% + 2px);width:calc(${w.toFixed(2)}% - 4px);border-left-color:${bar};background:${_dvTint(color,faded?.10:.30)};color:${txt}" onclick="selectWeekEvent('${esc(e.id)}')" title="${esc(e.origTitle)}">`
      +`${isRepeat?`<span class="dv-ev-rep" style="color:${bar}">↻</span>`:''}`
      +`<div class="dv-ev-title${faded?' struck':''}">${esc(e.origTitle)}${badge}</div>${meta}</div>`;
  }

  // 現在時間紅線
  let nowHtml='';
  if(isToday){const nm=now.getHours()*60+now.getMinutes();if(nm>=axisStart&&nm<=axisEndH*60)nowHtml=`<div class="dv-now-line" style="top:${((nm-axisStart)/60*DV_HOUR_H).toFixed(1)}px"></div>`;}

  grid.style.height=totalH+'px';
  grid.innerHTML=`<div class="dv-hours">${hoursHtml}</div><div class="dv-events">${evHtml}${nowHtml}</div>`;
}
