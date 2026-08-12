// 常數與全域狀態
// 用 var 而非 let/const，因為跨多個 <script> 時 let/const 是 script-local，
// 不會掛到 window；var 才能被其他檔案的程式碼讀到。

// ── 設定常數 ──
var TL_ROOMS=['大教室','小教室','108','208','309']; // 北投教學教室（主頁時間軸一列一間）
var COURSE_ROOMS=[...TL_ROOMS,'石牌分校']; // 課程可指定的教室：北投 5 間 + 石牌分校（石牌單一桶、不進北投時間軸）

// ── 全域狀態 ──
var authReady=false;    // Firebase Auth 已回報過一次狀態（onAuthStateChanged 首次觸發）
var currentPanel='login';
var currentDate=new Date();
var dayEvents=[];
var weekEvents=[];
var dvEvents=[];   // 桌面日曆當前檢視（日/週/月）展開出來的課堂；範圍跟 dayEvents/weekEvents 不同，要獨立一份
var absState={};
var makeupList=[];
var driveData={studentList:[],makeupScheduled:[],enrollments:[],coursePrices:[],courseSettings:[],courses:[],teachers:[],absences:[]};
var driveSaveTimer=null;
var drivePendingSave=false; // 本機是否有尚未寫入 Firestore 的改動（refreshCurrent 重讀前用來決定要不要先 flush）
// 請假課堂 occId → 這堂的補課場次**陣列**（2026-08-05 從單筆改多筆：
// 三人同一堂請假可以各排各的時段，每場自己一筆、自己一份名單）。
// 每筆 {id,originalId,scheduledDate,scheduledEnd,room,origTitle,absentStudents,calName,calEventId}
var makeupMatchMap=new Map();
var selectedWeekEvent=null;
var weekOffset=0; // 0=this week, -1=last week, +1=next week
var selectedWeekDayIdx=null; // 0=Mon..6=Sun, null = default to today

// ── 學期 helpers ──
function getSchoolYear(){const now=new Date();return now.getMonth()>=8?now.getFullYear():now.getFullYear()-1;}
function getPeriods(){
  const y=getSchoolYear();
  return[
    {id:'sem1',label:'上學期',start:new Date(y,8,1),end:new Date(y+1,0,31,23,59,59)},
    {id:'winter',label:'寒假',start:new Date(y+1,1,1),end:new Date(y+1,1,28,23,59,59)},
    {id:'sem2',label:'下學期',start:new Date(y+1,2,1),end:new Date(y+1,5,30,23,59,59)},
    {id:'summer',label:'暑假',start:new Date(y+1,6,1),end:new Date(y+1,7,31,23,59,59)},
  ];
}
// 某個日期落在哪一期別。給「這堂課屬於哪一期」用（別拿學生頁上面選的分頁當答案）
function periodOfDate(d){return getPeriods().find(p=>d>=p.start&&d<=p.end)||null;}
// 多收費門檻：同一門課請假幾次要警示。寒暑假只有 1~2 個月，門檻比學期低一次
// （學生卡片的「⚠ 多收費」標籤與請假面板的次數提醒共用這一個數字）
function getThreshold(pid){return(pid==='sem1'||pid==='sem2')?3:2;}
function detectPeriodId(){return(periodOfDate(new Date())||getPeriods()[0]).id;}
var currentPeriodId=detectPeriodId();
function switchPeriod(id){currentPeriodId=id;renderMakeup();renderStudents();}
function periodTabsHtml(){return`<div class="period-tabs">${getPeriods().map(p=>`<button class="period-tab${p.id===currentPeriodId?' active':''}" onclick="switchPeriod('${p.id}')">${p.label}</button>`).join('')}</div>`;}
function getCurrentPeriod(){return getPeriods().find(p=>p.id===currentPeriodId)||getPeriods()[0];}

// ── 事件查找 helpers ──
// 過去散在 7 處：[...dayEvents,...weekEvents].find(e=>e.id===id)
// 整合成單一函式，且短路一找到就返回（不再每次 spread 建臨時陣列）
function findEventById(id){
  return dayEvents.find(e=>e.id===id)||weekEvents.find(e=>e.id===id)
    ||dvEvents.find(e=>e.id===id)||makeupList.find(e=>e.id===id);
}
// 這堂請假排了哪幾場補課（依上課時間排序）。一堂可以有多場（每場補不同的人）。
// ⚠ 舊版的 findMakeupScheduledById 回傳單筆，已刪除——留著會讓呼叫端安靜地只看到第一場。
function getMakeupsFor(occId){
  const list=makeupMatchMap.get(occId);
  return list?list.slice().sort((a,b)=>new Date(a.scheduledDate)-new Date(b.scheduledDate)):[];
}
// 依補課場次自己的 id 找那一筆（拖曳改時段、取消單場用）
function findMakeupRec(recId){
  for(const list of makeupMatchMap.values()){
    const hit=list.find(r=>r.id===recId);
    if(hit)return hit;
  }
  return undefined;
}

// ── 顏色與教室常數 ──
var COLORS={one:'#4A7C8C',pair:'#7C5A8C',group:'#2D5A3D',practice:'#8C6A2D'};
// 課堂類別（calName：一般課程／調課／補課／加課／試聽／練習課）配色，從 tokens.css 讀
//（唯一真相來源）；讀不到時用 fallback 暖化色。名稱沿用舊行事曆分類，現在純粹是類別標籤。
function readCalColors(){
  const cs=getComputedStyle(document.documentElement);
  const g=(n,f)=>cs.getPropertyValue(n).trim()||f;
  return{
    '一般課程':g('--cal-general','#007AFF'),
    '調課':g('--cal-resched','#FF3B30'),
    '補課':g('--cal-makeup','#FF9500'),
    '加課':g('--cal-extra','#FFCC00'),
    '試聽':g('--cal-trial','#34C759'),
    '練習課':g('--cal-practice','#AF52DE'),
  };
}
// 同六色的文字版：亮色系（黃、橘、綠）直接當文字在白底上看不清，
// 文字一律走這組壓深過的 ink（tokens.css --cal-*-ink），色塊才用 CAL_COLORS。
function readCalInk(){
  const cs=getComputedStyle(document.documentElement);
  const g=(n,f)=>cs.getPropertyValue(n).trim()||f;
  return{
    '一般課程':g('--cal-general-ink','#0071ED'),
    '調課':g('--cal-resched-ink','#DE332A'),
    '補課':g('--cal-makeup-ink','#AD6500'),
    '加課':g('--cal-extra-ink','#8F7200'),
    '試聽':g('--cal-trial-ink','#23873D'),
    '練習課':g('--cal-practice-ink','#A64ED3'),
  };
}
var CAL_COLORS=readCalColors();
var CAL_INK=readCalInk();
function calColor(calName){return CAL_COLORS[calName]||'#8A8276';}
function calInk(calName){return CAL_INK[calName]||CAL_COLORS[calName]||'#6E675C';}
// 類別色的淡底版（頭像方塊、標籤底）：直接壓在白底上，a 是不透明度。
function calTint(calName,a){
  const h=calColor(calName).replace('#','');
  if(h.length<6)return'transparent';
  return`rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${a})`;
}
// 「一般課程」是最大宗，上色會整頁都同一個顏色＝等於沒上色，所以維持中性米色，
// 只有補課／調課／試聽／練習課／加課帶色 —— 要一眼看出來的本來就是這些例外。
function calIsAccent(calName){return!!calName&&calName!=='一般課程';}
// 實心色塊上的字要黑要白：亮色（黃、綠）配白字看不到，改配深字。
function calOn(calName){
  const h=calColor(calName).replace('#','');
  if(h.length<6)return'#fff';
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return(r*.299+g*.587+b*.114)>168?'#2A2410':'#fff';
}
var WD=['日','一','二','三','四','五','六'];
// 教室可坐人數（2026-08-10 老闆更新：108/208/309 從 6 人改 8 人）
var ROOM_CAP={'小教室':5,'108':8,'208':8,'309':8};
var ROOMS_SMALL=['小教室','108','208','309'];

// ── 營業時間（補課/調課「選時段」可挑的範圍）──
// 平日開門分兩季：暑假（7/1–8/31）12:30 就開，學期中／寒假 16:00 才開；週末固定 9:00。
// 收班一律 21:30。要調整就改這裡（例：寒假也想提早 → weekdayOpen 那行加寒假判斷）。
var BIZ_HOURS={weekdayOpen:'16:00',weekdaySummerOpen:'12:30',weekendOpen:'09:00',close:'21:30'};
function hhmmToMin(s){const[h,m]=String(s||'').split(':').map(Number);return(h||0)*60+(m||0);}
// 某一天的營業時段（回傳當日分鐘數 {start,end}）；依「那一天」判季節，不是依今天
function bizHoursOn(date){
  const mo=date.getMonth()+1,dow=date.getDay();
  const isWeekday=dow>=1&&dow<=5;
  const isSummer=mo===7||mo===8;
  const open=!isWeekday?BIZ_HOURS.weekendOpen:(isSummer?BIZ_HOURS.weekdaySummerOpen:BIZ_HOURS.weekdayOpen);
  return{start:hhmmToMin(open),end:hhmmToMin(BIZ_HOURS.close)};
}

// slot picker 與 timeline 狀態
// students＝這次要幫誰排（請假名單的子集，2026-08-05 起可只排一部分人）；
// recId＝改期時沿用的那筆補課 id，null＝新排一場；
// join＝併班補課選中的主課 occId（2026-08-06 第 2 刀），有值時時段/教室都跟著那堂走、不用再選
var slotPicker={ev:null,mode:null,date:null,time:null,room:null,avail:null,students:null,recId:null,join:null,custom:null};
var heroProgressTimer=null;
var tlAxisStart=0,tlTotalMins=0,tlNowTimer=null;
