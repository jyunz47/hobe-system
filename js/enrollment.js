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
function saveEnrollments(list){driveData.enrollments=list;scheduleDriveSave();}

// id 用單調遞增計數器，同 makeNewStudent 的慣例
var _lastEnrollmentId=0;
function makeEnrollment({studentId,courseTitle,periodId,price=null,startDate=null,endDate=null,note=''}){
  _lastEnrollmentId=Math.max(_lastEnrollmentId+1,Date.now()*1000);
  return{
    id:_lastEnrollmentId,
    studentId,courseTitle,periodId,
    price,            // null = 用價目表預設；數字 = 個人覆蓋價
    startDate,        // null = 期初就上（插班才填 ISO 日期字串）
    endDate,          // null = 上到期末（中途停課才填）
    note,
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

// ── 一次性轉換：student.courses → 本期 enrollments ──
// 安全閥：已轉換過（有 marker）不重跑；學生清單是空的（可能雲端讀取失敗）也不跑，
// 避免在沒讀到資料的狀態下寫入 marker 導致永遠不轉換
function migrateCoursesToEnrollments(){
  if(driveData.enrollmentsMigratedAt)return;
  const students=getStudentList();
  if(!students.length)return;
  const pid=yearPeriodId(detectPeriodId());
  const ens=driveData.enrollments||[];
  let added=0;
  students.filter(s=>(s.status||'在學')==='在學').forEach(s=>{
    (s.courses||[]).filter(c=>!/^【調課】/.test(c)).forEach(title=>{
      if(ens.some(en=>en.studentId===s.id&&en.courseTitle===title&&en.periodId===pid))return;
      ens.push(makeEnrollment({studentId:s.id,courseTitle:title,periodId:pid}));
      added++;
    });
  });
  driveData.enrollments=ens;
  driveData.enrollmentsMigratedAt=new Date().toISOString();
  scheduleDriveSave();
  console.log(`[enrollment] 一次性轉換完成：${added} 筆 student.courses → 修課登記簿（${pid}）`);
}

// ── 掃描帶入：只補不刪 ──
// 掃描更新 student.courses 時順手補登記簿缺的課；刪除交給之後的對帳工具
// （自動刪會弄丟個人覆蓋價，且掃描結果不一定比登記簿正確）
function ensureEnrollments(studentId,courseTitles){
  const pid=yearPeriodId();
  const ens=driveData.enrollments||[];
  let added=0;
  (courseTitles||[]).filter(t=>!/^【調課】/.test(t)).forEach(title=>{
    if(ens.some(en=>en.studentId===studentId&&en.courseTitle===title&&en.periodId===pid))return;
    ens.push(makeEnrollment({studentId,courseTitle:title,periodId:pid}));
    added++;
  });
  if(added){driveData.enrollments=ens;scheduleDriveSave();}
  return added;
}

// ── 價目表編輯 modal ──
// 列出「價目表已有的 + 本期登記簿出現過的」所有課名；空白價格 = 未定價
var _priceRows=[];
function openPriceModal(){
  const titles=new Set(getCoursePrices().map(c=>c.title));
  getEnrollments({periodId:yearPeriodId()}).forEach(en=>titles.add(en.courseTitle));
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
      <input id="price-new-title" placeholder="新增課程名稱…" maxlength="30" onkeydown="if(event.key==='Enter'){event.preventDefault();addPriceRow()}">
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
