// 修課登記簿（enrollments）+ 課程價目表（coursePrices）
// enrollment = 一筆「誰、修什麼課、哪個期別、什麼價」的紀錄，
// 是「學生 × 課程」歸屬的事實來源（Calendar 備註降為參考資訊）。
// schema 詳見 mds/資料結構.md

// ── 期別 id（帶學年）──
// state.js 的 periodId（sem1/winter/sem2/summer）只在單一學年內有意義；
// enrollment 要跨學年保存，期別存成 '2025-sem2' 格式（學年-期別）
function yearPeriodId(pid){return getSchoolYear()+'-'+(pid||currentPeriodId);}
function yearPeriodLabel(ypid){
  const m=String(ypid||'').match(/^(\d{4})-(\w+)$/);
  if(!m)return ypid||'';
  const labels={sem1:'上學期',winter:'寒假',sem2:'下學期',summer:'暑假'};
  return`${m[1]} ${labels[m[2]]||m[2]}`;
}

// ── enrollment 取得 / 建立 / 儲存 ──
function getEnrollments(filter){
  const all=driveData.enrollments||[];
  if(!filter)return all;
  return all.filter(en=>
    (filter.studentId==null||en.studentId===filter.studentId)&&
    (filter.periodId==null||en.periodId===filter.periodId)&&
    (filter.courseTitle==null||en.courseTitle===filter.courseTitle));
}
function saveEnrollments(list){driveData.enrollments=list;scheduleDriveSave();refreshCourseCards();}

// ── 修課起訖（2026-07-27 起真正生效）──
// startDate＝第一堂、endDate＝最後一堂，**皆含當日**；null＝沒有那一端的邊界。
// 期中人數變動（插班／中途退出）用這組欄位表達，不是把 enrollment 刪掉——
// 刪掉會連過去的堂數與自訂單價一起消失，回頭看舊課堂名冊也會少人。
// UI 一律用「從 X 起加入／從 X 起不上」講（見 courses.js sysDate*），
// 「起不上」存的是前一天（endDate 含當日），轉換在 UI 層做完，資料層只認含當日語意。
function enrollmentActiveOn(en,day){
  if(!en)return false;
  if(!day)return true;   // 沒有課堂日期可判（例：學生視窗的修課清單）→ 一律視為在籍
  const d=typeof day==='string'?day:toDateStr(day);
  if(en.startDate&&d<en.startDate)return false;
  if(en.endDate&&d>en.endDate)return false;
  return true;
}
// 課堂物件 → 該堂日期字串（給上面兩個 filter 用）
function eventDayStr(e){return e&&e.startDt?toDateStr(new Date(e.startDt)):null;}

// ── 課程卡名冊：以登記簿為事實來源，查無登記時 fallback 回備註解析 ──
// 卡片顯示「誰修這門課」改讀本期 enrollments（依課名＋本期反查 studentId → 姓名），
// 不再只看 Calendar 備註。過渡期：尚未對帳的課登記簿是空的，回 e.students（備註解析）
// 避免顯示空名單。名冊依「該堂日期」裁切（enrollmentActiveOn）：
// 起訖判斷放在 fallback 判定之後，才不會因為「當天沒人」誤退回備註名單。
// 併班補課（2026-08-06 第 2 刀）：這堂課今天多了幾個「來補課的人」→ 疊在名冊最後。
// 疊在 eventRoster / eventRosterWithId 這一層而不是展開器，是因為系統課的名冊本來就
// 從登記簿重算、不看課堂物件的 students；疊在這裡才會一路長到點名、成績、日曆側欄。
// ⚠ 請假面板的學生 chips 走的是 e.students（展開器的在籍名冊），刻意不含補課生——
//   他們要是在這堂被標請假，會變成「主課的請假紀錄」而長出一筆不存在的欠課。
function _joinRows(e){
  return (e&&e.courseId!=null&&typeof joinRosterOn==='function')?joinRosterOn(e.id):[];
}

function eventRoster(e){
  const descNames=e.students||[];
  const day=eventDayStr(e);
  // 系統自有課堂：直接以 courseId 反查本期登記簿（同名不混、與展開器一致）
  if(e.courseId!=null){
    const byId=new Map(getStudentList().map(s=>[s.id,s]));
    const names=getEnrollments({periodId:yearPeriodId()})
      .filter(en=>en.courseId===e.courseId&&enrollmentActiveOn(en,day))
      .map(en=>byId.get(en.studentId)?.name).filter(Boolean);
    // 已經在名單上的補課生不重複列（同一人既在籍又來補課的邊角情況）
    const joins=_joinRows(e).map(r=>r.name).filter(n=>!names.includes(n));
    return joins.length?[...names,...joins]:names;
  }
  if(!e.origTitle)return descNames;
  // 只看行事曆課的登記（courseId==null）；系統自有課程若恰好同名，名冊各自獨立不混
  const ens=getEnrollments({courseTitle:e.origTitle,periodId:yearPeriodId()}).filter(en=>en.courseId==null);
  if(!ens.length)return descNames; // 這門課這期沒有登記紀錄（尚未對帳）→ fallback 備註
  const byId=new Map(getStudentList().map(s=>[s.id,s]));
  const names=ens.map(en=>byId.get(en.studentId)?.name).filter(Boolean);
  if(!names.length)return descNames; // 登記的學生都查不到（已刪檔）→ fallback 備註
  return ens.filter(en=>enrollmentActiveOn(en,day)).map(en=>byId.get(en.studentId)?.name).filter(Boolean);
}

// 點名用名冊：把名冊解析成 [{studentId, name}]。
// 有本期登記紀錄 → 直接用 enrollment 的 studentId（同名問題在此終結）；
// 尚未對帳（fallback 備註）時，只有「唯一同名在學生」才給得到 studentId，
// 其餘 studentId=null（無法可靠點名，UI 顯示但不可點，引導去課表對帳）。
function eventRosterWithId(e){
  const byId=new Map(getStudentList().map(s=>[s.id,s]));
  const day=eventDayStr(e);
  // 系統自有課堂：以 courseId 反查本期登記簿，studentId 直接來自登記（同名終結）
  if(e.courseId!=null){
    const rows=getEnrollments({periodId:yearPeriodId()})
      .filter(en=>en.courseId===e.courseId&&enrollmentActiveOn(en,day))
      .map(en=>({studentId:en.studentId,name:byId.get(en.studentId)?.name||'(未知)'}));
    const joins=_joinRows(e).filter(j=>!rows.some(r=>r.name===j.name));
    return joins.length?[...rows,...joins]:rows;
  }
  // 同 eventRoster：只看行事曆課的登記，系統課（courseId）不混入
  const ens=e.origTitle?getEnrollments({courseTitle:e.origTitle,periodId:yearPeriodId()}).filter(en=>en.courseId==null):[];
  if(ens.length)return ens.filter(en=>enrollmentActiveOn(en,day))
    .map(en=>({studentId:en.studentId,name:byId.get(en.studentId)?.name||'(未知)'}));
  const byName=new Map();
  getStudentList().filter(s=>(s.status||'在學')==='在學').forEach(s=>{
    if(!byName.has(s.name))byName.set(s.name,[]);
    byName.get(s.name).push(s);
  });
  return (e.students||[]).map(nm=>{
    const m=byName.get(nm)||[];
    return{studentId:m.length===1?m[0].id:null,name:nm};
  });
}

// id 用單調遞增計數器，同 makeNewStudent 的慣例
var _lastEnrollmentId=0;
function makeEnrollment({studentId,courseTitle,periodId,price=null,startDate=null,endDate=null,note='',courseId=null,practiceSubject=''}){
  _lastEnrollmentId=Math.max(_lastEnrollmentId+1,Date.now()*1000);
  return{
    id:_lastEnrollmentId,
    studentId,courseTitle,periodId,
    price,            // null = 用價目表預設；數字 = 個人覆蓋價
    startDate,        // null = 期初就上（插班才填 ISO 日期字串）
    endDate,          // null = 上到期末（中途停課才填）
    note,
    courseId,         // 連 courses.id（系統自有課程）；null = 行事曆課，靠 courseTitle 對
    practiceSubject,  // 練習課：該生的練習科目
    createdAt:new Date().toISOString(),
  };
}

// ── 價目表 ──
function getCoursePrices(){return driveData.coursePrices||[];}
function saveCoursePrices(list){driveData.coursePrices=list;scheduleDriveSave();}
function getCourseDefaultPrice(title){
  const row=getCoursePrices().find(c=>c.title===title);
  return row&&typeof row.price==='number'?row.price:null;
}
// 實際單價：個人覆蓋優先，否則用價目表預設；都沒有回 null（未定價）
function effectivePrice(en){return en.price??getCourseDefaultPrice(en.courseTitle);}

// ── 課程設定（courseSettings，2026-06-19 起）──
// 每門課一筆 {title, needsGrade}；未設定的課一律 fallback 成「只點名」(needsGrade=false)
// 欄位刻意留可擴充（之後加 isMath 給高中數學作業清單，不必改結構）
function getCourseSettings(){return driveData.courseSettings||[];}
function saveCourseSettings(list){driveData.courseSettings=list;scheduleDriveSave();}
// 這門課要不要登記成績；查無設定 = 只點名
// 比對前去前後空白：舊資料的 origTitle 可能帶尾端空白，不清會對不上
function courseNeedsGrade(title){
  const t=(title||'').trim();
  const row=getCourseSettings().find(c=>(c.title||'').trim()===t);
  return !!(row&&row.needsGrade);
}

// 註：一次性轉換 migrateCoursesToEnrollments（student.courses → enrollments）於 2026-07-30
// cutover 重建完成後移除——重建後的學生全由「新增課程/學生」頁正向建立，沒有 s.courses 舊欄位可轉。
// 註：課表對帳（computeReconciliation / ensureEnrollments）於 2026-07-29 第 4 刀移除——
// 它的唯一輸入是 Google 行事曆備註的名字，系統改自有課表後名冊由登記簿正向建立，無可對之帳。

// ── 價目表編輯 modal ──
// 列出「價目表已有的 + 本期登記簿出現過的」所有課名；空白價格 = 未定價
var _priceRows=[];
function openPriceModal(){
  const titles=new Set(getCoursePrices().map(c=>c.title));
  // 系統課（courseId）不進價目表：它的預設價存在課程本體（courses.defaultPrice）
  getEnrollments({periodId:yearPeriodId()}).forEach(en=>{if(en.courseId==null)titles.add(en.courseTitle);});
  _priceRows=[...titles].sort((a,b)=>a.localeCompare(b,'zh-Hant')).map(t=>({title:t,price:getCourseDefaultPrice(t)}));
  renderPriceModal();
  document.getElementById('price-modal-wrap').classList.add('open');
}
function renderPriceModal(){
  const rows=_priceRows.map((r,i)=>`
    <div class="price-row">
      <span class="price-row-title">${esc(r.title)}</span>
      <input type="number" id="price-in-${i}" class="price-row-input" value="${r.price??''}" placeholder="未定價" min="0" inputmode="numeric">
      <span class="price-row-unit">元/堂</span>
    </div>`).join('');
  document.getElementById('price-modal-body').innerHTML=
    (rows||'<div style="font-size:13px;color:var(--tx3)">還沒有任何課程，先在下方新增課名</div>')+
    `<div class="price-add-wrap">
      <input id="price-new-title" placeholder="新增課程名稱…" maxlength="30" onkeydown="if(enterSubmit(event)){addPriceRow()}">
      <button class="btn btns" onclick="addPriceRow()">＋</button>
    </div>`;
}
function syncPriceInputs(){
  _priceRows.forEach((r,i)=>{
    const v=document.getElementById(`price-in-${i}`)?.value.trim();
    r.price=v?Math.max(0,parseInt(v,10)||0):null;
  });
}
function addPriceRow(){
  const input=document.getElementById('price-new-title');
  const t=input?.value.trim();
  if(!t)return;
  if(_priceRows.some(r=>r.title===t))return toast('價目表已有這門課','inf');
  syncPriceInputs();
  _priceRows.push({title:t,price:null});
  renderPriceModal();
  document.getElementById('price-new-title')?.focus();
}
function savePriceModal(){
  syncPriceInputs();
  // 未定價的列也保留（使用者剛加課名、價格之後補）
  saveCoursePrices(_priceRows.map(r=>({title:r.title,price:r.price})));
  closePriceModal();
  renderStudents();
  toast('價目表已更新','ok');
}
function closePriceModal(){
  document.getElementById('price-modal-wrap').classList.remove('open');
  _priceRows=[];
}
