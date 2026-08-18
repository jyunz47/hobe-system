// 桌面日曆（Apple 風行事曆）：Day／Week／Month 三種檢視、垂直時間軸＋彩色課程塊、
// 重疊的課等寬並排不互相蓋住（可按 ⊞ 攤成橫列）、日檢視可「依教室分欄」、空白處點兩下新增課程、亮／深色切換。
//
// 資料一律現算：由 schedule.js 的展開器（系統課表＋補課場次）依當前檢視的日期範圍展開，
// 不依賴 today.js 的 dayEvents，所以週／月檢視翻到任何一週都拿得到課。
// 點課塊＝selectWeekEvent 開既有詳情視窗（靠 state.js 的 findEventById 找得到 dvEvents）。

var DV_HOUR_H=62; // 每小時像素高
var DV_MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DV_WDE=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
var DV_WDS=['SUN','MON','TUE','WED','THU','FRI','SAT'];
var DV_ADD_MINS=90;      // 空白處新增課程時預設的課堂長度
var DV_SNAP=15;          // 新增／拖曳時把時間吸附到 15 分鐘
var DV_MONTH_CHIPS=3;    // 月檢視每格最多列幾筆，其餘收成「還有 N 堂」
var DV_AXIS_PAD=90;      // 時間軸前後各留幾分鐘空白（也是拖曳一次能移動的上限）

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

// ── 空白處點兩下新增課程 ──
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

// ── 重疊的課：等寬並排、互不重疊（Google 行事曆的做法）──
// 1. 分群：時間上連在一起的課歸成一群（transitive overlap）
// 2. 群內貪婪配「欄」：每堂放進第一個放得下的欄 → 欄數 n＝這一群同時段最多幾堂
// 3. 每堂寬度＝欄寬（100/n），左邊位置＝欄序 × 欄寬 → 誰都不會被蓋住
// 4. 再「往右擴張」：右邊那幾欄在這堂的時間內沒人佔，就把寬度吃過去。少了這步，一群裡只要
//    有一個時段特別擠，整群（含前後只有一兩堂的時段）都會被切成一樣細的長條
//
// 沿革（2026-08-03 同一天內試過三種，老闆最後選這個）：原本是 Apple cascade 疊法（往右縮排、
// 後者疊在前者上，被蓋住的看不到課名）→ 往下錯開＋滿欄寬（課塊左右佔滿，視覺太滿）→ 等寬並排。
function _dvLayout(items,axisStart){
  items.sort((a,b)=>a.s-b.s||b.en-a.en);
  const clusters=[];let cur=[],curEnd=-1;
  for(const it of items){if(cur.length&&it.s>=curEnd){clusters.push(cur);cur=[];curEnd=-1;}cur.push(it);curEnd=Math.max(curEnd,it.en);}
  if(cur.length)clusters.push(cur);
  for(const cl of clusters){
    const colEnd=[];
    for(const it of cl){
      let placed=false;
      for(let i=0;i<colEnd.length;i++){if(it.s>=colEnd[i]){it.lv=i;colEnd[i]=it.en;placed=true;break;}}
      if(!placed){it.lv=colEnd.length;colEnd.push(it.en);}
    }
    const n=colEnd.length,colW=100/n;
    cl.forEach(it=>{
      let span=1;                            // 往右能多吃幾欄（碰到有人佔就停）
      for(let j=it.lv+1;j<n;j++){
        if(cl.some(o=>o.lv===j&&o.s<it.en&&o.en>it.s))break;
        span++;
      }
      it.top=(it.s-axisStart)/60*DV_HOUR_H;
      it.hgt=Math.max((it.en-it.s)/60*DV_HOUR_H,22);
      it.left=it.lv*colW;it.width=span*colW;
      it.ck=cl[0].e.id;                      // 群組代號（見 _dvStacks）
    });
  }
  return items;
}

// ── 重疊群組的 ⊞ 展開／⊟ 收合 ──
// 等寬並排下誰都不會被蓋住，但同時段一多每堂就被切得很細，課名只剩前兩個字。所以**每個重疊
// 群組**（≥2 堂）右上角都給一顆 `⊞ N`：按下去整組改成橫列，完整課名＋開始時間一次看完；
// 再按一次（`⊟`）排回去。（滑鼠移過去也會把那一堂浮到最上層。）
//
// 排法＝**一個開始時間一列**，同一時間開始的課平分那一列的寬度。16 堂只有 7 個不同的開始
// 時間，就只排 7 列——比一堂一列省下一半以上的高度，整組通常塞得回原本的時間範圍裡。
//
// 展開只是「看」的模式——橫列的垂直位置是把群組時間範圍均分出來的，不代表真實時間，
// 所以展開中的那幾堂不給拖曳（拖了會以為在改時間，其實起點就對不上）。
var DV_STACK_ROW=22;          // 展開後每列的最小高度（太多堂時整組會往下長一點）
var dvStackOpen=new Set();    // 展開中的群組（key＝群組最早那堂的 id；翻頁後 id 換掉自然失效）
var dvStackRows=new Set();    // 目前被畫成橫列的課堂 id（拖曳擋在這裡）

function dvToggleStack(key){
  if(dvStackOpen.has(key))dvStackOpen.delete(key);else dvStackOpen.add(key);
  renderDayView();
}
// 掃出每個重疊群組；展開中的直接改寫該群組課塊的幾何（it.px），回傳要畫的 ⊞ 鈕
function _dvStacks(items,axisStart){
  const by=new Map();
  items.forEach(it=>{if(!by.has(it.ck))by.set(it.ck,[]);by.get(it.ck).push(it);});
  const out=[];
  by.forEach((list,key)=>{
    if(list.length<2)return;                                    // 沒疊到就不用鈕
    const open=dvStackOpen.has(key);
    const s0=Math.min(...list.map(x=>x.s)),e0=Math.max(...list.map(x=>x.en));
    const top=(s0-axisStart)/60*DV_HOUR_H;
    list.forEach(it=>{it.badged=true;});                        // ↻ 標記讓位給群組右上角的 ⊞ 鈕
    if(open){
      // 依開始時間分列（list 已依開始時間排好），同一列的課平分寬度
      const rows=[];
      list.forEach(it=>{
        const r=rows[rows.length-1];
        if(r&&r[0].s===it.s)r.push(it);else rows.push([it]);
      });
      const h=Math.max((e0-s0)/60*DV_HOUR_H/rows.length,DV_STACK_ROW);
      rows.forEach((row,i)=>{
        const w=100/row.length;
        row.forEach((it,k)=>{it.px={top:top+i*h,hgt:h,left:k*w,width:w};dvStackRows.add(it.e.id);});
      });
    }
    out.push({key,n:list.length,top:Math.max(0,top),open});
  });
  return out;
}

// ── 時間軸範圍：包住所有課，前後各留 DV_AXIS_PAD 分鐘，至少 3 小時 ──
// 前後留白不只是好看：拖曳課塊只能拖在時間軸範圍內，沒留白就一分鐘也往前拖不動。
// 留 90 分鐘＝一次可以拖 ±1.5 小時；要移更遠就再拖一次（放開後時間軸會依新位置重算）。
function _dvAxis(evs){
  if(!evs.length){const h=new Date().getHours();return{h0:Math.max(0,h-1),h1:Math.min(24,Math.max(h+5,3))};}
  const mn=Math.min(...evs.map(e=>e.startDt.getHours()*60+e.startDt.getMinutes()))-DV_AXIS_PAD;
  const mx=Math.max(...evs.map(e=>e.endDt.getHours()*60+e.endDt.getMinutes()))+DV_AXIS_PAD;
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
  // 位置在 _dvLayout 就算好了（重疊時等寬並排）；it.px＝這堂正被畫成「展開的橫列」
  // ⚠️ 橫列的左右也要吃 it.px（一列裡同時段的課平分寬度），不能沿用並排版面算出來的窄寬度，
  //    不然整組會變成一串斜著往下排的小方塊（2026-08-03 踩過）
  const rowMode=!!it.px;
  const top=rowMode?it.px.top:it.top;
  const hgt=Math.max(rowMode?it.px.hgt:it.hgt,22);
  const left=rowMode?it.px.left:it.left,width=rowMode?it.px.width:it.width;
  const faded=e.isFullAbsent||e.isRescheduled;
  const {bar,txt,bg}=_dvColors(e.calName,faded);
  let stat='';if(!faded&&isToday){if(now>=e.endDt)stat='past';else if(now>=e.startDt)stat='now';}
  // 重複課（每週排程）標 ↻；補課/調課場次與指定日期單場不標
  const co=(e.courseId!=null&&typeof findCourseById==='function')?findCourseById(e.courseId):null;
  const isRepeat=!!(co&&co.schedule&&co.schedule.mode!=='dates')&&!e.isMakeupOcc;
  // 排出去的場次也要標（以前只認 calName==='補課'，調課場次整個沒標籤）
  const mkKind=typeof mkOccKind==='function'?mkOccKind(e):'';
  const badge=
    e.isRescheduled?'<span class="dv-ev-badge">調課</span>':
    mkKind?`<span class="dv-ev-badge">${mkKind}</span>`:
    e.isAbsent?'<span class="dv-ev-badge">請假</span>':
    e.isNoShow?'<span class="dv-ev-badge">曠課</span>':'';
  // 別班的人今天併進這堂補課（第 2 刀）→ 課塊上標「+N 補」，不然只有點開側欄才看得到
  const joinN=typeof joinCountOn==='function'?joinCountOn(e.id):0;
  const joinBadge=joinN?`<span class="dv-ev-badge">+${joinN} 補</span>`:'';
  const movable=!_dvDragWhyNot(e);
  const cls='dv-ev'+(faded?' dv-faded':'')+(stat==='now'?' dv-now':'')+(stat==='past'?' dv-past':'')+(hgt<40?' dv-short':'')+(movable?' dv-movable':'')+(e.id===dvSelId?' dv-sel':'')+(rowMode?' dv-row':'')+(it.badged?' dv-badged':'');
  const sub=[];
  if(!rowMode)sub.push(`${_dvAP(e.startDt)} – ${_dvAP(e.endDt)}`);      // 橫列的開始時間已經寫在課名前面了
  if(!(dvView==='day'&&dvRooms)&&e.classroom)sub.push(esc(e.classroom)); // 已依教室分欄時不重複寫教室
  if(e.teacher&&hgt>=(rowMode?36:76))sub.push(esc(e.teacher));
  const meta=(hgt>=42&&sub.length)?`<div class="dv-ev-meta">${sub.join(' · ')}</div>`:'';
  // 展開的橫列可能只有一行高，時間就併進標題（不然只剩課名，看不出誰先誰後）
  const tm=rowMode?`<span class="dv-ev-time">${_dvAP(e.startDt)}</span>`:'';
  return`<div class="${cls}" data-id="${esc(e.id)}" style="top:${top}px;height:${hgt-2}px;left:calc(${left.toFixed(2)}% + 2px);width:calc(${width.toFixed(2)}% - 4px);z-index:${rowMode?25:2+(it.lv||0)};border-left-color:${bar};background:${bg};color:${txt}" onpointerdown="dvDragStart(event,'${esc(e.id)}')" onclick="dvEvClick(event,'${esc(e.id)}')" ondblclick="dvEvDbl(event,'${esc(e.id)}')" title="${esc(e.origTitle)}${movable?'（可拖曳改時間）':''}">`
    +`${isRepeat&&!rowMode?`<span class="dv-ev-rep" style="color:${bar}">↻</span>`:''}`
    +`<div class="dv-ev-title${faded?' struck':''}">${tm}${esc(e.origTitle)}${badge}${joinBadge}</div>${meta}</div>`;
}

// ── 分欄時間軸（day 與 week 共用）──
// cols：[{date, room, evs}]；每欄各自算版面，欄背景點兩下＝在那個日期／時間／教室新增課程
function _dvRenderColumns(cols,axis){
  const grid=document.getElementById('dv-grid');
  const {h0,h1}=axis,axisStart=h0*60,totalH=(h1-h0)*DV_HOUR_H;
  const now=new Date(),today=_dvMidnight(now);
  const w=100/cols.length;
  dvStackRows.clear();   // 每次重畫重算「哪幾堂正展開成橫列」
  // 拖曳要用的欄位幾何：每欄代表哪一天／哪間教室，以及時間軸涵蓋的分鐘範圍
  dvAxisMin=axisStart;dvAxisMax=h1*60;
  dvColMeta={roomCols:dvView==='day'&&dvRooms,cols:cols.map(c=>({date:new Date(c.date),room:c.room||''}))};
  let colsHtml='';
  cols.forEach((c,i)=>{
    const isToday=_dvSameDay(c.date,today);
    const items=_dvLayout(c.evs.map(e=>({e,s:e.startDt.getHours()*60+e.startDt.getMinutes(),en:e.endDt.getHours()*60+e.endDt.getMinutes()})),axisStart);
    const stacks=_dvStacks(items,axisStart);   // 要先跑：展開中的群組會改寫課塊幾何
    const evHtml=items.map(it=>_dvEvHtml(it,axisStart,isToday,now)).join('');
    const stackHtml=stacks.map(s=>`<div class="dv-stack${s.open?' on':''}" style="top:${s.top.toFixed(1)}px" onclick="event.stopPropagation();dvToggleStack('${esc(s.key)}')" title="${s.open?'收合，疊回原本的時間位置':`這個時段有 ${s.n} 堂課疊在一起，點開看是哪幾堂`}">${s.open?'⊟':'⊞&nbsp;'+s.n}</div>`).join('');
    // 空白處：單擊＝取消選取（同 Apple 行事曆），點兩下才新增課程
    // （單擊就開表單太容易誤觸——滑過去想選別堂課、手滑一下表單就跳出來）
    // 時間用點擊位置換算成分鐘（offsetY ÷ 每小時高）
    const hit=`<div class="dv-col-hit" onclick="dvSelect(null)" ondblclick="dvAddAt(${c.date.getFullYear()},${c.date.getMonth()},${c.date.getDate()},${axisStart}+event.offsetY/${DV_HOUR_H}*60,'${esc(c.room||'')}')" title="點兩下新增課程"></div>`;
    let nowHtml='';
    if(isToday){
      const nm=now.getHours()*60+now.getMinutes();
      if(nm>=axisStart&&nm<=h1*60)nowHtml=`<div class="dv-now-line" style="top:${((nm-axisStart)/60*DV_HOUR_H).toFixed(1)}px"></div>`;
    }
    colsHtml+=`<div class="dv-col" data-i="${i}" style="left:${(i*w).toFixed(4)}%;width:${w.toFixed(4)}%">${hit}${evHtml}${stackHtml}${nowHtml}</div>`;
  });
  grid.style.height=totalH+'px';
  grid.innerHTML=`<div class="dv-hours">${_dvHoursHtml(h0,h1)}</div><div class="dv-events">${colsHtml}</div>`;
}

function _dvEmpty(msg){
  const g=document.getElementById('dv-grid');g.style.height='';
  g.innerHTML=`<div class="dv-empty">${msg}　·　在時間軸空白處點兩下可新增課程</div>`;
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
      return`<div class="dv-mchip${faded?' struck':''}${e.id===dvSelId?' dv-sel':''}" data-id="${esc(e.id)}" style="border-left-color:${bar};background:${bg};color:${txt}" onclick="dvEvClick(event,'${esc(e.id)}')" ondblclick="dvEvDbl(event,'${esc(e.id)}')" title="${esc(e.origTitle)}">${_dvAP(e.startDt)} ${esc(e.origTitle)}</div>`;
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

// ══════════════════════════════════════════════════════════════
// 側欄詳情面板 inspector（2026-07-31）
// ══════════════════════════════════════════════════════════════
// 點課塊 → 右側欄下半部顯示這一堂的老師／教室／名冊／請假與點名狀態（Apple 行事曆的 inspector）。
// 這裡**只負責看**：所有會寫資料的動作都是把既有的置中詳情視窗開起來（selectWeekEventAndXxx），
// 寫入路徑維持單一入口，不在側欄裡另做一套。
// 單擊＝選取、雙擊＝直接開置中視窗；側欄被藏起來時（≤820px）單擊照舊開視窗。

var dvSelId=null;   // 目前選取的課堂 id（重繪時該課塊會帶 .dv-sel）

function _dvSideVisible(){const s=document.querySelector('.dv-side');return !!s&&s.offsetParent!==null;}

function dvSelect(id){
  dvSelId=id;
  document.querySelectorAll('#dv-grid .dv-ev,#dv-grid .dv-mchip')
    .forEach(el=>el.classList.toggle('dv-sel',el.dataset.id===id));
  renderDvInspector();
}

// 狀態色：同一組色票在深色底要亮一點、亮色底要暗一點（沿用課塊那套算法）
function _dvTone(hex){return _dvShift(hex,dvLight?-.12:.38);}
// 類別 chip 專用：亮底時 -.12 壓不夠（黃/橘/綠會糊掉），直接吃 tokens 的 ink 版
function _dvCalTone(cal){return dvLight?calInk(cal):_dvShift(calColor(cal),.38);}
function _dvTag(txt,hex){return`<span class="dv-stu-tag" style="color:${_dvTone(hex)}">${txt}</span>`;}

// 名冊每個人右邊那顆標籤：曠課／請假優先，其次才看點名紀錄
function _dvStuTag(ev,r){
  // 調課＝整堂移走，absentStudents 會被塞成全名冊——別把它寫成每個人都「請假」
  if(ev.isRescheduled)return _dvTag('調課','#C0504A');
  if((ev.noShowStudents||[]).includes(r.name))return _dvTag('曠課','#C0504A');
  if((ev.absentStudents||[]).includes(r.name))return _dvTag('請假','#C16B36');
  if(!canAttend(ev))return'';
  if(r.studentId==null)return _dvTag('無法點名','#8A8276');
  const a=getAtt(ev.id,r.studentId);
  if(a&&a.status==='到')return a.lateMin>0?_dvTag(`遲到 ${a.lateMin} 分`,'#B98A4A'):_dvTag('到','#5C7E6A');
  return _dvTag('未點名','#8A8276');
}

// 課堂 → 系統課 id。補課／調課場次自己沒有 courseId，從 originalId（sys:<課程id>:…）反查母課程；
// 舊行事曆搬遷的快照紀錄兩邊都查不到 → null（那種課本來就不在系統裡，編不了）
function dvCourseIdOf(ev){
  if(!ev)return null;
  if(ev.courseId!=null)return ev.courseId;
  const m=String(ev.makeupOriginalId||'').match(/^sys:(\d+):/);
  return m?Number(m[1]):null;
}

// 側欄「✎ 編輯課程」：開的就是課程管理那扇表單（openCourseForm），存檔後會重畫日曆
function dvEditCourse(id){
  const ev=dvEvents.find(x=>x.id===id)||findEventById(id);
  const cid=dvCourseIdOf(ev);
  if(cid==null)return;
  openCourseForm(cid);
}

// 練習課名冊（2026-08-13）：側欄預設長的就是課程主頁課程卡那個樣子——
// 「年級 ｜ 科目 ｜ 名字、名字…」一行一科。逐人的點名／請假狀態退成第二層，
// 按標題右邊那顆「點名 x/y」才切過去（老闆：預設是顯示這個不是點名）。
// 分法與卡片一致（js/today.js pracRosterHtml）：一位學生練兩類科目會在兩行各出現一次。
// 回傳 null＝不是練習課 → 呼叫端維持原本那條逐人的名單。
function _dvPracGroups(ev,roster,subjOf){
  if(ev.type!=='practice'||!roster.length)return null;
  const byId=new Map(getStudentList().map(s=>[s.id,s]));
  const gradeOf=r=>{
    if(r.studentId!=null)return byId.get(r.studentId)?.grade||'';
    const m=getStudentList().filter(s=>s.name===r.name);   // 同名不只一個就認不出年級，寧可留白
    return m.length===1?(m[0].grade||''):'';
  };
  const byGrade=new Map();
  const put=(grade,subj,name)=>{
    if(!byGrade.has(grade))byGrade.set(grade,new Map());
    const lines=byGrade.get(grade);
    if(!lines.has(subj))lines.set(subj,[]);
    lines.get(subj).push(name);
  };
  roster.forEach(r=>{
    // 併班補課的人在這堂沒有登記＝沒有練習科目，自成一段擺最後（列上還有「補・原課」標）
    if(r.join)return put('補課生','',r.name);
    const raw=subjOf.get(r.name)||'';
    const cats=pracSubjCats(raw==='（未填科目）'?'':raw);   // 展開器用全形括號代表沒填
    (cats.length?cats:['未填科目']).forEach(s=>put(gradeOf(r)||'未填年級',s,r.name));
  });
  const GR=typeof GRADES!=='undefined'?GRADES:[],PS=typeof CF_PRAC_SUBJECTS!=='undefined'?CF_PRAC_SUBJECTS:[];
  const gOrder=g=>{if(g==='補課生')return 9999;if(g==='未填年級')return 999;const i=GR.indexOf(g);return i<0?99:i;};
  // 數理＝數學＋理化合併類，排在數學後面（自訂科目 99、未填科目最後）
  const sOrder=s=>s==='未填科目'?999:s==='數理'?PS.indexOf('數學')+.5:(PS.indexOf(s)<0?99:PS.indexOf(s));
  return[...byGrade.entries()].sort((a,b)=>gOrder(a[0])-gOrder(b[0]))
    .map(([grade,lines])=>({grade,lines:[...lines.entries()].sort((a,b)=>sOrder(a[0])-sOrder(b[0]))
      .map(([subj,names])=>({subj,names}))}));
}

// 名冊要看哪一面：'list'＝名單（預設）、'att'＝逐人的點名／請假狀態。切過去會記著，
// 一堂堂點過去不用每堂再按一次；重新整理回預設。只有練習課有這顆切換。
var dvRosterView='list';
function dvSetRosterView(v){dvRosterView=v;renderDvInspector();}

function renderDvInspector(){
  const box=document.getElementById('dv-insp');if(!box)return;
  const ev=dvSelId?dvEvents.find(x=>x.id===dvSelId):null;
  if(!ev){   // 沒選、或選的那堂已經不在目前檢視範圍（翻頁／改期）
    dvSelId=null;
    box.innerHTML='<div class="dv-insp-none"><i>🗓</i><span>點一下課塊<br>這裡會顯示老師、教室、名冊與請假狀態<br><small>選好後可用 ↑↓←→ 換課</small></span></div>';
    return;
  }
  const faded=ev.isFullAbsent||ev.isRescheduled;
  const {bar}=_dvColors(ev.calName,false);
  const now=new Date();

  // ── 標頭的狀態 chips ──
  const chips=[`<span class="dv-chip">${typeLbl(ev.type)}</span>`];
  if(ev.calName&&ev.calName!=='一般課程')chips.push(`<span class="dv-chip" style="color:${_dvCalTone(ev.calName)}">${esc(ev.calName)}</span>`);
  if(ev.isRescheduled)chips.push(`<span class="dv-chip" style="color:${_dvCalTone('調課')}">調課</span>`);
  else if(ev.isAbsent)chips.push(`<span class="dv-chip" style="color:${_dvTone('#C16B36')}">${ev.absType==='老師請假'?'老師請假':'請假 '+ev.absentStudents.length+' 人'}</span>`);
  if(ev.isNoShow)chips.push(`<span class="dv-chip" style="color:${_dvTone('#C0504A')}">曠課 ${ev.noShowStudents.length} 人</span>`);
  if(!faded&&_dvSameDay(ev.startDt,now)){
    if(now>=ev.endDt)chips.push('<span class="dv-chip">已結束</span>');
    else if(now>=ev.startDt)chips.push(`<span class="dv-chip" style="color:${_dvTone('#5C7E6A')}">進行中</span>`);
  }

  // ── 資訊列 ──
  const row=(k,v,dim)=>`<div class="dv-insp-row"><span class="k">${k}</span><span class="v${dim?' dim':''}">${v}</span></div>`;
  const rows=[
    row('授課',ev.teacher?esc(ev.teacher):'未指定',!ev.teacher),
    row('教室',ev.classroom?esc(ev.classroom):'未指定',!ev.classroom),
  ];
  if(ev.subject)rows.push(row('科目',esc(ev.subject)));
  // 補課／調課場次：講得出替哪一堂排的（標頭 chips 已經標了類別）
  if(typeof mkOccFromWhen==='function'&&mkOccFromWhen(ev))rows.push(row('原課',esc(mkOccFromWhen(ev))));
  if(ev.isRescheduled)rows.push(row('原因',ev.rescheduleReason?esc(ev.rescheduleReason):'未輸入',!ev.rescheduleReason));
  if(ev.isAbsent&&ev.absType!=='老師請假'&&ev.absentStudents.length)rows.push(row('請假',esc(ev.absentStudents.join('、'))));
  if(ev.isNoShow)rows.push(row('曠課',esc(ev.noShowStudents.join('、'))));
  if(ev.notes)rows.push(row('備註',esc(ev.notes)));
  // 整堂沒上（請假／調課）就一定有補課或調課要排——排了沒排一眼看到
  if(faded){
    const lbl=ev.isRescheduled?'調課':'補課';
    const recs=getMakeupsFor(ev.id);   // 一堂可以排好幾場（不同人各排各的）
    recs.forEach(rec=>{
      const sd=new Date(rec.scheduledDate);
      const who=(rec.absentStudents||[]).join('、');
      const where=isJoinRec(rec)?`・👥 併入 ${esc(rec.hostTitle||'另一堂課')}`:(rec.room?'・'+esc(rec.room):'');
      rows.push(row(recs.length>1&&who?`${lbl}・${esc(who)}`:lbl,
        `${sd.getMonth()+1}/${sd.getDate()}（${WD[sd.getDay()]}）${_dvHM(sd)}${where}`));
    });
    const left=mkWaitTxt(ev);
    if(!recs.length)rows.push(row(lbl,`<span style="color:${_dvTone('#C0504A')};font-weight:600">未安排</span>`));
    else if(left.length)rows.push(row(lbl,`<span style="color:${_dvTone('#C0504A')};font-weight:600">${esc(left.join('、'))} 未排完</span>`));
  }

  // ── 處理進度（跟待補課清單同一串留言，js/makeup.js）──
  // 只有整堂沒上（請假／調課）才長出來：那才是「還要處理」的課，也才是排補課時
  // 真的會停下來看一眼的地方。照常上的課不需要有人在這裡交代什麼。
  const noteOpen=mkNoteState.openFor===ev.id&&mkNoteState.openIn==='dv';
  const noteSec=faded?`
     <div class="dv-insp-sec">
       <div class="dv-insp-sec-hd">處理進度
         <button class="dv-note-btn r" onclick="mkNoteOpen('${esc(ev.id)}','dv')">${noteOpen?'收起':'＋ 加進度'}</button>
       </div>
       ${mkNotesHtml(ev,true,'dv')||'<div class="dv-insp-row"><span class="v dim">還沒有人記進度</span></div>'}
     </div>`:'';

  // ── 名冊（練習課預設看名單，其餘課型＝逐人的請假／曠課／點名狀態）──
  const roster=eventRosterWithId(ev);
  const subjOf=new Map();   // 名字 → 練習科目（練習課用；同點名／成績面板的攤法）
  (ev.studentGroups||[]).forEach(g=>g.students.forEach(nm=>subjOf.set(nm,subjOf.has(nm)?subjOf.get(nm)+'、'+g.subject:g.subject)));
  // 點名進度文字（練習課拿它當切換鈕的字，其餘課型就是一段唯讀的字）
  let attTxt='',attDone=false;
  if(canAttend(ev)&&roster.length){
    const s=attSummary(ev);
    attDone=!!s.total&&s.here>=s.total;
    attTxt=attDone?'✓ 點名完成':`點名 ${s.here}/${s.total}`;
  }
  const stuRow=(r,withSubj)=>`<div class="dv-stu"><span class="dv-stu-nm">${esc(r.name)}</span>${
      withSubj&&subjOf.has(r.name)?`<span class="dv-stu-sub">${esc(subjOf.get(r.name))}</span>`:''
    }${r.join?_dvTag('補・'+(r.fromTitle||''),'#C16B36'):''}${_dvStuTag(ev,r)}</div>`;
  const grps=_dvPracGroups(ev,roster,subjOf);
  const flatHtml=()=>roster.map(r=>stuRow(r,true)).join('');   // 逐人狀態那面：科目跟在名字後面（側欄太窄，不再切段）
  // 練習課預設看名單（＝課程主頁課程卡的長相），要逐人狀態再按右上角切
  const listHtml=()=>`<div class="dv-prac">${grps.map(g=>
      `<div class="dv-prac-row"><span class="dv-prac-g">${esc(g.grade)}</span><div class="dv-prac-lines">${
        g.lines.map(l=>`<div class="dv-prac-line">${l.subj?`<span class="dv-prac-s">${esc(l.subj)}</span>`:''}${esc(l.names.join('、'))}</div>`).join('')
      }</div></div>`).join('')}</div>`;
  const stuHtml=!roster.length
    ?'<div class="dv-insp-row"><span class="v dim">這堂還沒有人登記</span></div>'
    :(grps&&dvRosterView==='list'?listHtml():flatHtml());
  // 標題右邊：練習課＝可按的切換（名單 ⇄ 逐人狀態）；其餘課型維持唯讀的點名進度
  const attHd=grps
    ?`<button class="dv-note-btn r"${attDone&&dvRosterView!=='list'?` style="color:${_dvTone('#5C7E6A')}"`:''} onclick="dvSetRosterView('${dvRosterView==='list'?'att':'list'}')">${
        dvRosterView==='list'?(attTxt||'逐人狀態')+' ›':'‹ 名單'}</button>`
    :(attTxt?`<span class="r"${attDone?` style="color:${_dvTone('#5C7E6A')}"`:''}>${attTxt}</span>`:'');

  // ── 動作：一律轉開既有的置中詳情視窗 ──
  const b=(fn,txt,cls)=>`<button class="dv-insp-b${cls||''}" onclick="${fn}('${esc(ev.id)}')">${txt}</button>`;
  const acts=[];
  if(canAttend(ev))acts.push(b('selectWeekEventAndAtt','✓ 點名'));
  if(canAttend(ev)&&evNeedsGrade(ev))acts.push(b('selectWeekEventAndGrade','✎ 成績'));
  if(!ev.isMakeupOcc){
    // 未調課：請假／調課併一顆，開視窗後再選；已調課：只剩補原因，直接展開調課面板
    if(!ev.isRescheduled)acts.push(b('selectWeekEvent','↔ 請假/調課'));
    else acts.push(b('selectWeekEventAndReschedule','↔ 調課原因'));
  }
  // 底下那顆：改課的時段／收費／名單走「✎ 編輯課程」（與課程管理同一扇表單）；
  // 查不到系統課的舊紀錄沒得編輯，退回「開啟完整視窗」免得那格空著
  acts.push(dvCourseIdOf(ev)!=null?b('dvEditCourse','✎ 編輯課程')
                                  :b('selectWeekEvent','開啟完整視窗',' dv-insp-open'));

  box.innerHTML=
    `<div class="dv-insp-hd">
       <div class="dv-insp-bar" style="background:${bar}"></div>
       <div style="min-width:0">
         <div class="dv-insp-title${faded?' struck':''}">${esc(ev.origTitle)}</div>
         <div class="dv-insp-when">${_dvWhen(ev.startDt)}　${_dvHM(ev.startDt)}–${_dvHM(ev.endDt)}　${fmtDur(ev.durMins)}</div>
       </div>
     </div>
     <div class="dv-insp-chips">${chips.join('')}</div>
     <div class="dv-insp-rows">${rows.join('')}</div>
     ${noteSec}
     <div class="dv-insp-sec">
       <div class="dv-insp-sec-hd">名冊 ${roster.length} 人${attHd}</div>
       <div class="dv-insp-stu">${stuHtml}</div>
     </div>
     <div class="dv-insp-acts">${acts.join('')}</div>`;
}

// ── 方向鍵切換選取的課堂（2026-08-03）──
// 選了一堂之後不用再一堂堂用滑鼠點：
//   ↑ ↓＝同一欄裡的上一／下一堂（依時間先後）
//   ← →＝左右相鄰欄裡時間最接近的那一堂（週檢視＝換天、日檢視依教室分欄＝換教室；空欄自動跳過）
// 月檢視：↑ ↓ 在同一天格內移動，到頭就跳上／下一週的同一天；← → 走前／後一個有課的日子。
// 只在「已經選了一堂」時攔截按鍵，沒選時方向鍵照舊捲頁面。
function _dvNavGroups(){
  const grid=document.getElementById('dv-grid');if(!grid)return null;
  const mon=grid.querySelector('.dv-month');
  if(mon)return{month:true,groups:[...mon.querySelectorAll('.dv-mcell')].map(c=>[...c.querySelectorAll('.dv-mchip')])};
  // 課塊在 DOM 裡是疊放順序，重疊時不等於視覺上下——依實際位置排
  return{month:false,groups:[...grid.querySelectorAll('.dv-col')].map(c=>
    [...c.querySelectorAll('.dv-ev')].sort((a,b)=>{
      const ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect();
      return ra.top-rb.top||ra.left-rb.left;
    }))};
}
// 鄰欄裡挑垂直位置最接近目前這堂的（時間最接近）
function _dvNearestY(list,ref){
  const y=ref.getBoundingClientRect().top;
  let best=list[0],bd=Infinity;
  for(const el of list){const d=Math.abs(el.getBoundingClientRect().top-y);if(d<bd){bd=d;best=el;}}
  return best;
}
function dvArrowMove(key){
  const cur=document.querySelector('#dv-grid .dv-sel');
  if(!cur||!cur.offsetParent)return false;   // 切到別的分頁時日曆被藏起來，方向鍵要還給那一頁
  const nav=_dvNavGroups();if(!nav)return false;
  const {groups,month}=nav;
  let g=-1,i=-1;
  groups.forEach((list,gi)=>{const ii=list.indexOf(cur);if(ii>=0){g=gi;i=ii;}});
  if(g<0)return false;
  let next=null;
  if(key==='ArrowUp'||key==='ArrowDown'){
    const step=key==='ArrowDown'?1:-1;
    if(groups[g][i+step])next=groups[g][i+step];
    else if(month)for(let k=g+step*7;k>=0&&k<groups.length;k+=step*7){   // 到格子頭尾 → 上／下一週同一天
      const l=groups[k];if(l.length){next=step>0?l[0]:l[l.length-1];break;}
    }
  }else{
    const step=key==='ArrowRight'?1:-1;
    for(let k=g+step;k>=0&&k<groups.length;k+=step)
      if(groups[k].length){next=_dvNearestY(groups[k],cur);break;}
  }
  if(!next||next===cur)return false;
  dvSelect(next.dataset.id);
  next.scrollIntoView({block:'nearest',inline:'nearest'});
  return true;
}

// ══════════════════════════════════════════════════════════════
// 拖曳課塊改時間／教室（2026-07-31）
// ══════════════════════════════════════════════════════════════
// 三種對象、三條寫入路徑，全部沿用系統既有的資料模型，不新增 schema：
//   ① 每週重複課 → 問「只改這一天」還是「從這天起都改」
//        · 只改這一天＝標記調課（driveData.absences 的 resched 旗標）＋ 寫一筆新時段
//          （driveData.makeupScheduled），跟手動「調課 → 排時段」寫出來的東西一模一樣，
//          所以待補課清單、學生統計、「取消調課」都自動吃得到
//        · 從這天起都改＝在 course.schedule.phases 加一段 {from, slots}，
//          **不動已經上過的課堂**（老闆定的「從 X 起分段、不回溯」原則）
//   ② 指定日期課（試聽等單場）→ 沒有「以後」可言，直接改那個 slot 的日期/時間
//   ③ 補課／調課場次（mk:）→ 直接改 makeupScheduled 那筆的時段
//      （以前要「取消安排 → 重排」才改得動期）
//
// 教室的但書：course.room 是整門課一個欄位，**沒有分段**。所以「從這天起都改」若同時換了
// 教室，過去的課堂顯示也會跟著變成新教室——小視窗會明講這件事再讓人按。
// 只想改這一天的教室不受影響（調課紀錄自己帶 room）。
//
// 觸控不啟用拖曳：iPad 上手指按住拖＝捲動頁面，搶掉會很難用。平板要改時間走編輯表單。

var dvAxisMin=0,dvAxisMax=1440;              // 目前時間軸涵蓋的分鐘範圍（拖曳夾在裡面）
var dvColMeta={roomCols:false,cols:[]};      // 每一欄代表哪一天／哪間教室
var dvDrag=null;                             // 拖曳中的狀態
var dvDragEndAt=0;                           // 上次放開拖曳的時間戳（用來吃掉緊接著的 click）
var dvPendingMove=null;                      // 等使用者在小視窗選要怎麼套用

function _dvHM(d){return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function _dvWhen(d){return`${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`;}
// occId `sys:<courseId>:<YYYY-MM-DD>:<slotIdx>` → slotIdx
function _dvSlotIdx(id){const m=String(id).match(/^sys:\d+:\d{4}-\d{2}-\d{2}:(\d+)$/);return m?Number(m[1]):-1;}

// 這一堂能不能拖？回傳 null＝可以，字串＝不行的原因（也用來決定要不要給「可拖」游標）
function _dvDragWhyNot(ev){
  if(typeof isSignedIn==='function'&&!isSignedIn())return'要先登入才能改課表';
  if(dvStackRows.has(ev.id))return'這組疊在一起的課正展開著——橫列位置不代表真實時間，先按 ⊟ 收合再拖';
  if(ev.isLegacyAbsence)return'這是舊行事曆搬進來的歷史紀錄，時間改不動';
  if(ev.isMakeupOcc)return null;                       // 補課／調課場次：可拖＝改期
  if(ev.courseId==null)return'這堂沒有對應的系統課程，時間改不動';
  if(ev.isRescheduled)return'這堂已標記調課——請改拖它的調課場次，或先取消調課';
  return null;
}

// 點課塊：剛拖曳過就不要順手把詳情面板也點開
// 單擊＝選取（右側欄 inspector 顯示細節）；雙擊＝直接開置中詳情視窗。
// 側欄被 CSS 藏起來時（視窗 ≤820px）單擊直接開視窗，否則點了會像沒反應。
function dvEvClick(e,id){
  e.stopPropagation();
  if(Date.now()-dvDragEndAt<300)return;
  if(_dvSideVisible())dvSelect(id);
  else selectWeekEvent(id);
}
function dvEvDbl(e,id){
  e.stopPropagation();
  if(Date.now()-dvDragEndAt<300)return;
  selectWeekEvent(id);
}

function dvDragStart(e,id){
  if(e.pointerType==='touch')return;         // 觸控留給捲動
  if(e.button!==0)return;
  const ev=dvEvents.find(x=>x.id===id);if(!ev)return;
  const el=e.currentTarget,col=el.closest('.dv-col');if(!col)return;
  dvDrag={ev,el,why:_dvDragWhyNot(ev),pid:e.pointerId,
    x0:e.clientX,y0:e.clientY,
    startMin:ev.startDt.getHours()*60+ev.startDt.getMinutes(),
    dur:Math.max(DV_SNAP,Math.round((ev.endDt-ev.startDt)/60000)),
    ci:Number(col.dataset.i||0),min:null,ghost:null,tip:null,moved:false};
  try{el.setPointerCapture(e.pointerId);}catch(_){}
}

function dvDragMove(e){
  if(!dvDrag)return;
  const dx=e.clientX-dvDrag.x0,dy=e.clientY-dvDrag.y0;
  if(!dvDrag.moved){
    if(Math.abs(dx)<4&&Math.abs(dy)<4)return;          // 手抖不算拖，維持「點一下＝開詳情」
    if(dvDrag.why){const w=dvDrag.why;dvDragCleanup();if(typeof toast==='function')toast(w,'inf');return;}
    dvDrag.moved=true;
    document.body.classList.add('dv-dragging');
    dvDrag.el.classList.add('dv-drag-src');
    const g=dvDrag.el.cloneNode(true);
    g.className=dvDrag.el.className.replace('dv-drag-src','')+' dv-ghost';
    g.removeAttribute('onclick');g.removeAttribute('onpointerdown');
    document.querySelector('#dv-grid .dv-events').appendChild(g);
    dvDrag.ghost=g;
    const t=document.createElement('div');t.className='dv-drag-tip';
    document.body.appendChild(t);dvDrag.tip=t;
  }
  // 時間：垂直位移換算成分鐘、吸附 15 分、夾在時間軸範圍內
  const dm=Math.round(dy/DV_HOUR_H*60/DV_SNAP)*DV_SNAP;
  dvDrag.min=Math.max(dvAxisMin,Math.min(dvAxisMax-dvDrag.dur,dvDrag.startMin+dm));
  // 欄：看游標水平位置落在哪一欄（週檢視＝換日、日檢視依教室＝換教室）
  const colEls=[...document.querySelectorAll('#dv-grid .dv-col')];
  for(let i=0;i<colEls.length;i++){
    const r=colEls[i].getBoundingClientRect();
    if(e.clientX>=r.left&&e.clientX<r.right){dvDrag.ci=i;break;}
  }
  const n=Math.max(1,dvColMeta.cols.length),w=100/n;
  const g=dvDrag.ghost;
  g.style.top=((dvDrag.min-dvAxisMin)/60*DV_HOUR_H)+'px';
  g.style.height=(dvDrag.dur/60*DV_HOUR_H-2)+'px';
  g.style.left=`calc(${(dvDrag.ci*w).toFixed(4)}% + 2px)`;
  g.style.width=`calc(${w.toFixed(4)}% - 4px)`;
  g.style.zIndex=90;
  // 跟著游標的時間提示
  const t=_dvDropTarget();
  dvDrag.tip.textContent=`${_dvWhen(t.start)} ${_dvHM(t.start)}–${_dvHM(t.end)}${t.room?'　'+t.room:''}`;
  const tw=dvDrag.tip.offsetWidth;
  dvDrag.tip.style.left=Math.max(8,Math.min(e.clientX+16,window.innerWidth-tw-8))+'px';
  dvDrag.tip.style.top=(e.clientY+18)+'px';
}

// 目前拖到哪：{start,end,room}
function _dvDropTarget(){
  const c=dvColMeta.cols[dvDrag.ci]||dvColMeta.cols[0]||{date:new Date(currentDate),room:''};
  const start=new Date(c.date);start.setHours(0,dvDrag.min,0,0);
  const end=new Date(start.getTime()+dvDrag.dur*60000);
  const room=dvColMeta.roomCols?(c.room||''):(dvDrag.ev.classroom||'');
  return{start,end,room};
}

function dvDragEnd(){
  if(!dvDrag)return;
  const d=dvDrag;
  if(!d.moved){dvDragCleanup();return;}
  const t=_dvDropTarget();
  dvDragCleanup();
  dvDragEndAt=Date.now();
  if(t.start.getTime()===d.ev.startDt.getTime()&&t.room===(d.ev.classroom||''))return; // 放回原位
  dvAskMove(d.ev,t.start,t.end,t.room);
}

function dvDragCleanup(){
  if(!dvDrag)return;
  try{dvDrag.el.releasePointerCapture(dvDrag.pid);}catch(_){}
  dvDrag.el.classList.remove('dv-drag-src');
  if(dvDrag.ghost)dvDrag.ghost.remove();
  if(dvDrag.tip)dvDrag.tip.remove();
  document.body.classList.remove('dv-dragging');
  dvDrag=null;
}
function dvDragAbort(){if(dvDrag){const m=dvDrag.moved;dvDragCleanup();if(m)dvDragEndAt=Date.now();}}

window.addEventListener('pointermove',dvDragMove);
window.addEventListener('pointerup',dvDragEnd);
window.addEventListener('pointercancel',dvDragAbort);
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(dvDrag)return dvDragAbort();
    if(dvPendingMove)return dvCloseMove();
    return;
  }
  // 方向鍵切換選取的課堂：打字中、拖曳中、任何視窗開著的時候都不搶
  if(!/^Arrow(Up|Down|Left|Right)$/.test(e.key))return;
  if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return;
  if(!dvSelId||dvDrag||dvPendingMove)return;
  const t=e.target;
  if(t&&(/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||t.isContentEditable))return;
  if(document.querySelector('.stu-modal-wrap.open'))return;
  if(dvArrowMove(e.key))e.preventDefault();
});

// ── 放開後的小視窗：問這一次移動要怎麼套用 ──
function dvAskMove(ev,s,en,room){
  const co=(ev.courseId!=null&&typeof findCourseById==='function')?findCourseById(ev.courseId):null;
  const weekly=!!(co&&co.schedule&&co.schedule.mode!=='dates');
  // 「從這天起」的起算日＝原本那天與新那天取早的（跨日拖曳時，同一週的新那天才吃得到）
  const from=new Date(Math.min(_dvMidnight(ev.startDt).getTime(),_dvMidnight(s).getTime()));
  dvPendingMove={ev,s,en,room,co,weekly,from};
  const roomChanged=room!==(ev.classroom||'');
  const line=(d,e2,r)=>`${_dvWhen(d)} ${_dvHM(d)}–${_dvHM(e2)}${r?'　·　'+esc(r):''}`;
  let foot,note='';
  if(ev.isMakeupOcc){
    foot=`<button class="dv-cf-b dv-cf-pri" onclick="dvMoveApply('makeup')">改期</button>`;
    note='這是補課／調課場次，改期只影響這一場。';
  }else if(!weekly){
    foot=`<button class="dv-cf-b dv-cf-pri" onclick="dvMoveApply('dates')">改這一場</button>`;
    note='這門課是「指定日期」排的，改的就是那一場本身。';
  }else{
    foot=`<button class="dv-cf-b" onclick="dvMoveApply('once')">只改這一天</button>`
      +`<button class="dv-cf-b dv-cf-pri" onclick="dvMoveApply('series')">從 ${from.getMonth()+1}/${from.getDate()} 起都改</button>`;
    note=`<b>只改這一天</b>＝登記成一筆調課（原時段會畫上刪除線，待補課清單看得到，可以取消）。<br>`
      +`<b>從 ${from.getMonth()+1}/${from.getDate()} 起都改</b>＝這門課之後每週都用新時段，${from.getMonth()+1}/${from.getDate()} 以前上過的課維持原樣。`;
    if(roomChanged)note+=`<br><span class="dv-cf-warn">⚠ 教室沒有分段功能：選「從這天起都改」的話，整門課（含以前的課堂顯示）都會變成「${esc(room||'未指定')}」。只想改這一天的教室請選左邊。</span>`;
  }
  document.getElementById('dv-cf-title').textContent=ev.origTitle||'移動課堂';
  document.getElementById('dv-cf-body').innerHTML=
    `<div class="dv-cf-row old">${line(ev.startDt,ev.endDt,ev.classroom)}</div>`
    +`<div class="dv-cf-arw">↓</div>`
    +`<div class="dv-cf-row new">${line(s,en,room)}</div>`
    +`<div class="dv-cf-note">${note}</div>`;
  document.getElementById('dv-cf-foot').innerHTML=
    `<button class="dv-cf-b dv-cf-cancel" onclick="dvCloseMove()">取消</button>${foot}`;
  document.getElementById('dv-cf').style.display='flex';
}
function dvCloseMove(){
  dvPendingMove=null;
  const w=document.getElementById('dv-cf');if(w)w.style.display='none';
}

async function dvMoveApply(how){
  const p=dvPendingMove;if(!p)return;
  dvCloseMove();
  let msg='';
  try{
    if(how==='makeup')msg=_dvMoveMakeup(p);
    else if(how==='dates')msg=_dvMoveDates(p);
    else if(how==='once')msg=_dvMoveOnce(p);
    else if(how==='series')msg=_dvMoveSeries(p);
  }catch(err){
    if(typeof toast==='function')toast('改時間失敗：'+(err.message||err),'err');
    return;
  }
  if(!msg)return;
  if(typeof toast==='function')toast(msg,'ok');
  await Promise.all([loadToday(),loadWeek(),loadMakeup(true)]);
  renderDayView();
}

// ① 只改這一天：標記調課 ＋ 寫新時段（＝手動「調課 → 排時段」的結果）
function _dvMoveOnce(p){
  const ev=p.ev;
  const list=getAbsences().slice();
  let rec=list.find(a=>a.occId===ev.id);
  if(!rec){
    rec={id:Date.now(),occId:ev.id,courseId:ev.courseId,date:ev.startDt.toISOString(),
      teacherAbsent:false,leave:[],noShow:[],makeupSkip:[],createdAt:new Date().toISOString()};
    list.push(rec);
  }
  rec.resched=true;
  if(!rec.reschedReason)rec.reschedReason='';
  rec.updatedAt=new Date().toISOString();
  saveAbsences(list);
  // 調課場次的名單＝這堂的名冊（saveMakeupScheduled 讀 absentStudents）
  saveMakeupScheduled({...ev,absentStudents:(ev.students||[]).slice()},p.s,p.en,p.room,null,'調課');
  return`已登記調課：${_dvWhen(p.s)} ${_dvHM(p.s)}–${_dvHM(p.en)}${p.room?'・'+p.room:''}`;
}

// ② 從這天起都改：course.schedule.phases 加／改一段，不動更早的課堂
function _dvMoveSeries(p){
  const co=p.co;if(!co||!co.schedule)throw new Error('找不到這堂課的系統課程');
  const si=_dvSlotIdx(p.ev.id);if(si<0)throw new Error('認不出這是課程的第幾個時段');
  const act=_activePhase(_schedulePhases(co.schedule),p.ev.startDt);
  const slots=(act.slots||[]).map(s=>({weekday:Number(s.weekday),start:s.start,end:s.end}));
  if(!slots[si])throw new Error('認不出這是課程的第幾個時段');
  const was=`${WD[slots[si].weekday]} ${slots[si].start}–${slots[si].end}`;   // 動態要講「從什麼改成什麼」
  slots[si]={weekday:p.s.getDay(),start:_dvHM(p.s),end:_dvHM(p.en)};
  const fromStr=toDateStr(p.from);
  co.schedule.phases=co.schedule.phases||[];
  const same=co.schedule.phases.find(x=>x.from===fromStr);
  if(same)same.slots=slots;else co.schedule.phases.push({from:fromStr,slots});
  co.schedule.phases.sort((a,b)=>String(a.from).localeCompare(String(b.from)));
  if(p.room!==(co.room||''))co.room=p.room;
  co.updatedAt=new Date().toISOString();
  saveCourses(getCourses());
  logAct('course','改了上課時間（從某天起都改）',courseNameOn(co,p.from),
    `${was} → ${WD[p.s.getDay()]} ${_dvHM(p.s)}–${_dvHM(p.en)}${p.room?'・'+p.room:''}，${p.from.getMonth()+1}/${p.from.getDate()} 起生效`);
  return`${p.from.getMonth()+1}/${p.from.getDate()} 起改成 ${WD[p.s.getDay()]} ${_dvHM(p.s)}–${_dvHM(p.en)}${p.room?'・'+p.room:''}`;
}

// ③ 指定日期課：直接改那個時段本身
function _dvMoveDates(p){
  const co=p.co;if(!co||!co.schedule)throw new Error('找不到這堂課的系統課程');
  const si=_dvSlotIdx(p.ev.id),slot=(co.schedule.slots||[])[si];
  if(!slot)throw new Error('認不出這是課程的第幾個時段');
  const was=`${slot.date||''} ${slot.start}–${slot.end}`.trim();
  slot.date=toDateStr(p.s);slot.start=_dvHM(p.s);slot.end=_dvHM(p.en);
  if(p.room!==(co.room||''))co.room=p.room;
  co.updatedAt=new Date().toISOString();
  saveCourses(getCourses());
  logAct('course','改了上課時間',courseNameOn(co,p.s),
    `${was} → ${toDateStr(p.s)} ${_dvHM(p.s)}–${_dvHM(p.en)}${p.room?'・'+p.room:''}`);
  return`已改成 ${_dvWhen(p.s)} ${_dvHM(p.s)}–${_dvHM(p.en)}${p.room?'・'+p.room:''}`;
}

// ④ 補課／調課場次：改 makeupScheduled 那筆的時段
function _dvMoveMakeup(p){
  // 認那一場自己的 id（一堂請假可能排了好幾場，用來源 occId 會抓錯場）
  const rid=p.ev.makeupRecId;
  const list=getMakeupScheduledLS().map(normalizeMakeupRec);
  const rec=list.find(x=>x.id===rid);
  if(!rec)throw new Error('找不到這筆補課安排');
  const wasS=new Date(rec.scheduledDate),wasRoom=rec.room||'';
  rec.scheduledDate=p.s.toISOString();rec.scheduledEnd=p.en.toISOString();rec.room=p.room;
  driveData.makeupScheduled=list;
  rebuildMakeupMatchMap();
  scheduleDriveSave();
  logAct('makeup',`改了${(rec.absentStudents||[]).length?` ${rec.absentStudents.join('、')} 的`:''}${rec.calName||'補課'}時段`,
    `${fmtD(p.s)} ${_dvHM(p.s)}–${_dvHM(p.en)} ${p.room||''} ${rec.origTitle||''}`.trim(),
    `原本排在 ${fmtD(wasS)} ${fmtT(wasS)} ${wasRoom}`.trim());
  return`已改期：${_dvWhen(p.s)} ${_dvHM(p.s)}–${_dvHM(p.en)}${p.room?'・'+p.room:''}`;
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
  renderDvInspector();   // 選取的那堂可能已改期／翻頁不見了，重繪後一併對齊
}

// 開場先把側欄的「還沒選課塊」提示畫上：renderDayView 要登入＋切到日曆分頁才會跑，
// 在那之前側欄下半部會是一塊空白框。
renderDvInspector();
