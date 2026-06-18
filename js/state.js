// 常數與全域狀態
// 用 var 而非 let/const，因為跨多個 <script> 時 let/const 是 script-local，
// 不會掛到 window；var 才能被其他檔案的程式碼讀到。

// ── 設定常數 ──
var CLIENT_ID='729031557572-tjn0hoiph1b0dbkp57lut0l6ekshm629.apps.googleusercontent.com';
var SCOPES='https://www.googleapis.com/auth/calendar';
var DISCOVERY_DOC='https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
var CAL_NAMES=['一般課程','補課','調課','試聽','練習課','加課'];
var MAKEUP_CALS=['一般課程','調課','試聽','練習課','加課']; // exclude 補課
var TL_ROOMS=['大教室','小教室','108','208','309'];

// ── 全域狀態 ──
var tokenClient=null,gapiReady=false,gisReady=false;
var tokenRefreshTimer=null;
var calendarIds={};
var currentPanel='login';
var currentDate=new Date();
var dayEvents=[];
var weekEvents=[];
var absState={};
var makeupList=[];
var driveData={studentList:[],makeupScheduled:[],enrollments:[],coursePrices:[],courseSettings:[]};
var driveSaveTimer=null;
var drivePendingSave=false; // 本機是否有尚未寫入 Firestore 的改動（refreshCurrent 重讀前用來決定要不要先 flush）
var makeupMatchMap=new Map(); // absenceEventId → {calEventId,scheduledDate,scheduledEnd,room,origTitle,absentStudents}
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
function detectPeriodId(){const now=new Date();return(getPeriods().find(p=>now>=p.start&&now<=p.end)||getPeriods()[0]).id;}
var currentPeriodId=detectPeriodId();
function switchPeriod(id){currentPeriodId=id;renderMakeup();renderStudents();}
function periodTabsHtml(){return`<div class="period-tabs">${getPeriods().map(p=>`<button class="period-tab${p.id===currentPeriodId?' active':''}" onclick="switchPeriod('${p.id}')">${p.label}</button>`).join('')}</div>`;}
function getCurrentPeriod(){return getPeriods().find(p=>p.id===currentPeriodId)||getPeriods()[0];}

// ── 事件查找 helpers ──
// 過去散在 7 處：[...dayEvents,...weekEvents].find(e=>e.id===id)
// 整合成單一函式，且短路一找到就返回（不再每次 spread 建臨時陣列）
function findEventById(id){
  return dayEvents.find(e=>e.id===id)||weekEvents.find(e=>e.id===id)||makeupList.find(e=>e.id===id);
}
// 過去散在 3 處：new Map(getMakeupScheduled().map(s=>[s.originalId,s])).get(id)
// 直接從 makeupMatchMap 取（O(1)），不用每次建臨時 Map
function findMakeupScheduledById(originalId){
  const v=makeupMatchMap.get(originalId);
  return v?{originalId,...v}:undefined;
}

// ── Calendar API 快取 ──
// 同一 timeRange 在 TTL 內重複查同一行事曆 → 直接用上次的結果，省一次網路請求
// 切換日期/週次、開 slot picker 都會大量受益
// 寫操作（patch/insert/delete）後務必呼叫 invalidateEventCache()，否則會看到過時資料
var _eventListCache=new Map();
var EVENT_CACHE_TTL_MS=30000; // 30 秒
async function cachedEventList(params){
  const key=JSON.stringify(params);
  const cached=_eventListCache.get(key);
  if(cached&&Date.now()-cached.ts<EVENT_CACHE_TTL_MS)return cached.response;
  const response=await gapi.client.calendar.events.list(params);
  _eventListCache.set(key,{ts:Date.now(),response});
  return response;
}
function invalidateEventCache(){_eventListCache.clear();}

// ── 顏色與教室常數 ──
var COLORS={one:'#4A7C8C',pair:'#7C5A8C',group:'#2D5A3D',practice:'#8C6A2D'};
// 行事曆六色從 tokens.css 讀（唯一真相來源）；讀不到時用 fallback 暖化色
function readCalColors(){
  const cs=getComputedStyle(document.documentElement);
  const g=(n,f)=>cs.getPropertyValue(n).trim()||f;
  return{
    '一般課程':g('--cal-general','#6B8F7A'),
    '調課':g('--cal-resched','#C0504A'),
    '補課':g('--cal-makeup','#C16B36'),
    '加課':g('--cal-extra','#B98A4A'),
    '試聽':g('--cal-trial','#7E8B83'),
    '練習課':g('--cal-practice','#9A8552'),
  };
}
var CAL_COLORS=readCalColors();
function calColor(calName){return CAL_COLORS[calName]||'#8A8276';}
var WD=['日','一','二','三','四','五','六'];
var ROOM_CAP={'小教室':5,'108':6,'208':6,'309':6};
var ROOMS_SMALL=['小教室','108','208','309'];

// slot picker 與 timeline 狀態
var slotPicker={ev:null,mode:null,date:null,time:null,room:null,avail:null};
var heroProgressTimer=null;
var tlAxisStart=0,tlTotalMins=0,tlNowTimer=null;
