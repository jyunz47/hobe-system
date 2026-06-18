// 設定頁：課程總覽（後台）
// 把系統認得的每一門課攤開：類型、老師、單價、需登記成績；展開看登記名單／練習課每堂名單+科目。
// 資料來源三路聯集：已載入課表（一般課程/練習課/加課三本）∪ 本期登記簿 ∪ 價目表。
// 「需登記成績」開關存進 driveData.courseSettings（見 enrollment.js）。

// 會算學費/成績的三本行事曆（同 students.js SCAN_CALS）；試聽/補課/調課不在內
var SETTINGS_GRADE_CALS=['一般課程','練習課','加課'];

// 課名正規化：去前後空白，避免同一門課因尾端空白被當兩門（parse.js origTitle 無標記時不 trim）
function normTitle(t){return (t||'').trim();}

// 展開中的課名（總覽列的展開狀態）
var _coExpanded=new Set();

function studentName(id){
  const s=(driveData.studentList||[]).find(s=>s.id===id);
  return s?s.name:'(已刪除)';
}

var TYPE_LABEL={one:'一對一家教',pair:'一對二家教',group:'團班',practice:'練習課'};
// 分區顯示順序；null = 本週沒排課、判斷不出類型
var TYPE_ORDER=['one','pair','group','practice',null];

// 整理出每門課一筆 {title,type,teachers,sessions,enrolled}
function buildCourseOverview(){
  const pid=yearPeriodId();
  const map=new Map();
  const get=t=>{const k=normTitle(t);if(!map.has(k))map.set(k,{title:k,type:null,teachers:new Set(),sessions:[],enrolled:[]});return map.get(k);};

  // 已載入課表：本日 + 本週，去重（同一堂可能同時在兩個陣列），只取三本
  const seen=new Set();
  [...(typeof weekEvents!=='undefined'?weekEvents:[]),...(typeof dayEvents!=='undefined'?dayEvents:[])]
    .forEach(e=>{
      if(!e.origTitle||!SETTINGS_GRADE_CALS.includes(e.calName)||seen.has(e.id))return;
      seen.add(e.id);
      const c=get(e.origTitle);
      if(e.type==='practice'||e.calName==='練習課')c.type='practice';
      else if(!c.type)c.type=e.type;
      if(e.teacher)c.teachers.add(e.teacher);
      c.sessions.push({date:e.startDt,students:e.students||[],groups:e.studentGroups||[],classroom:e.classroom,teacher:e.teacher});
    });

  // 本期登記簿（一般課程的固定名單）
  getEnrollments({periodId:pid}).forEach(en=>get(en.courseTitle).enrolled.push(en));
  // 價目表課名也要在（可能整週沒排、也沒登記）
  getCoursePrices().forEach(p=>{if(normTitle(p.title))get(p.title);});

  return [...map.values()].sort((a,b)=>a.title.localeCompare(b.title,'zh-Hant'));
}

// 週一起算的星期排序與標籤
var WEEK_ORDER=[1,2,3,4,5,6,0];
var WEEK_LABEL={1:'週一',2:'週二',3:'週三',4:'週四',5:'週五',6:'週六',0:'週日'};
function hhmm(d){return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;}

function renderSettings(){
  const list=buildCourseOverview();
  const body=document.getElementById('co-list');
  if(!list.length){
    body.innerHTML='<div class="empty">還沒有任何課程。先到「學生管理 → 價目表」新增課名，或登記學生修課，課名就會出現在這裡。</div>';
    return;
  }
  // 有排課（有 session、判斷得出類型）→ 進週課表矩陣；其餘 → 底部「未分類」
  const typed=list.filter(c=>c.type!==null&&c.sessions.length);
  const untyped=list.filter(c=>!(c.type!==null&&c.sessions.length));
  let html='';

  ['one','pair','group','practice'].forEach(type=>{
    const courses=typed.filter(c=>c.type===type);
    if(!courses.length)return;
    html+=`<div class="co-type-sec">
      <div class="co-sec-hd">${TYPE_LABEL[type]}<span class="co-group-n">${courses.length}</span></div>
      <div class="co-week-grid">${WEEK_ORDER.map(wd=>{
        const dayCards=courses.map(c=>{
          const daySess=c.sessions.filter(s=>s.date.getDay()===wd);
          if(!daySess.length)return '';
          // 同課同日可能有多位老師（平行分班，如三堂國二數學班）→ 依老師各自一張卡
          const byTeacher=new Map();
          daySess.forEach(s=>{const t=s.teacher||'(未填老師)';if(!byTeacher.has(t))byTeacher.set(t,[]);byTeacher.get(t).push(s);});
          return [...byTeacher.entries()]
            .map(([teacher,sess])=>renderCoCard(c,sess.sort((a,b)=>a.date-b.date),wd,teacher))
            .join('');
        }).join('');
        return `<div class="co-day-col">
          <div class="co-day-hd">${WEEK_LABEL[wd]}</div>
          ${dayCards||'<div class="co-day-empty">—</div>'}
        </div>`;
      }).join('')}</div>
    </div>`;
  });

  if(untyped.length){
    html+=`<div class="co-type-sec">
      <div class="co-sec-hd">未分類 / 本週未排<span class="co-group-n">${untyped.length}</span><span class="co-group-hint">無法判斷類型或本週沒排課</span></div>
      <div class="co-flat">${untyped.map(c=>renderCoCard(c,null,null)).join('')}</div>
    </div>`;
  }
  body.innerHTML=html;
}

// daySess：該星期某老師的堂次；null = 未分類區。wd：星期。teacher：這張卡的老師（平行分班用，展開 key 也含它）
function renderCoCard(c,daySess,wd,teacher){
  const on=courseNeedsGrade(c.title);
  const isPractice=c.type==='practice';
  const teacherLabel=teacher!=null?teacher:([...c.teachers].join('、'));
  const key=c.title+'@'+(wd==null?'x':wd)+'#'+(teacher!=null?teacher:'');
  const expanded=_coExpanded.has(key);
  const tEsc=JSON.stringify(c.title).replace(/"/g,'&quot;');
  const kEsc=JSON.stringify(key).replace(/"/g,'&quot;');
  const times=[...new Set((daySess||[]).map(s=>hhmm(s.date)))];
  return `<div class="co-card${expanded?' open':''}">
    <div class="co-card-hd" onclick="toggleCoExpand(${kEsc})">
      <span class="co-card-title">${esc(c.title)}</span>
      ${teacherLabel?`<span class="co-card-teacher">👤 ${esc(teacherLabel)}</span>`:''}
      ${times.length?`<span class="co-card-time">${times.join(' / ')}</span>`:''}
    </div>
    <label class="switch switch-sm" onclick="event.stopPropagation()">
      <input type="checkbox" ${on?'checked':''} onchange="toggleNeedsGrade(${tEsc},this.checked)">
      <span class="switch-track"><span class="switch-thumb"></span></span>
      <span class="switch-label">${on?'登記成績':'只點名'}</span>
    </label>
    ${expanded?`<div class="co-detail">${renderCoDetail(c,isPractice,daySess)}</div>`:''}
  </div>`;
}

function renderCoDetail(c,isPractice,daySess){
  if(isPractice){
    const sess=(daySess&&daySess.length?daySess:c.sessions).slice().sort((a,b)=>a.date-b.date);
    if(!sess.length)return '<div class="co-empty">本週尚未載入這門練習課的堂次。</div>';
    return `<div class="co-note">練習課名單來自行事曆備註，每堂不同，此處唯讀。</div>`+sess.map(s=>{
      const d=`${s.date.getMonth()+1}/${s.date.getDate()}`;
      let roster;
      if(s.groups.length)roster=s.groups.map(g=>`<span class="co-grp"><b>${esc(g.subject)}</b>：${esc(g.students.join('、'))}</span>`).join('');
      else roster=s.students.length?esc(s.students.join('、')):'<span class="co-empty">無名單</span>';
      return `<div class="co-sess"><span class="co-sess-d">${d}</span><span class="co-sess-r">${roster}</span></div>`;
    }).join('');
  }
  // 一般課程：本期登記簿名單，可直接加退
  const tEsc=JSON.stringify(c.title).replace(/"/g,'&quot;');
  const enrolledIds=new Set(c.enrolled.map(en=>en.studentId));
  const opts=getStudentList({activeOnly:true})
    .filter(s=>!enrolledIds.has(s.id))
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh-Hant'))
    .map(s=>`<option value="${s.id}">${esc(s.name)}（${esc(s.grade||'')}）</option>`).join('');
  const roster=c.enrolled.length
    ? `<div class="co-roster">`+c.enrolled.map(en=>{
        const p=effectivePrice(en);
        const pStr=p==null?'<span class="co-undef">未定價</span>':`${p}`;
        return `<span class="co-stu">${esc(studentName(en.studentId))}<span class="co-stu-price">${pStr}</span><button class="co-stu-x" title="退課" onclick="coRemoveEnroll(${en.id})">✕</button></span>`;
      }).join('')+`</div>`
    : `<div class="co-empty">本期登記簿沒有學生。</div>`;
  const adder=`<div class="co-add">
    <select class="co-add-sel">${opts||''}<option value="" disabled ${opts?'':'selected'}>（無可加學生）</option></select>
    <button class="co-add-btn" onclick="coAddEnroll(this,${tEsc})">＋ 加入</button>
  </div>`;
  // 清掉整門課的殘留登記（改名後孤兒課用）
  const clear=c.enrolled.length?`<button class="co-clear-btn" onclick="coClearCourse(${tEsc})">🗑 整門課從登記簿移除（清改名殘留）</button>`:'';
  return roster+adder+clear;
}

// 一鍵移除某課名本期的全部登記（清掉改名後殘留的舊課；不碰其他期別、不碰行事曆、學生本人不刪）
function coClearCourse(title){
  const t=normTitle(title);
  const pid=yearPeriodId();
  const victims=getEnrollments({periodId:pid}).filter(e=>normTitle(e.courseTitle)===t);
  if(!victims.length)return;
  const names=victims.map(e=>studentName(e.studentId)).join('、');
  if(!confirm(`把「${t}」本期的全部 ${victims.length} 筆登記從登記簿移除？\n\n（${names}）\n\n用於清掉改名後殘留的舊課。不影響 Google 行事曆，學生本人不會被刪，之後可再加回。`))return;
  saveEnrollments(getEnrollments().filter(e=>!(normTitle(e.courseTitle)===t&&e.periodId===pid)));
  toast(`已移除「${t}」的 ${victims.length} 筆登記`,'ok');
  renderSettings();
}

// 加學生進這門課（本期登記簿），單價留空＝用價目表預設
function coAddEnroll(btn,title){
  const sel=btn.parentElement.querySelector('.co-add-sel');
  const sid=parseInt(sel&&sel.value,10);
  if(!sid)return;
  const list=getEnrollments().slice();
  list.push(makeEnrollment({studentId:sid,courseTitle:normTitle(title),periodId:yearPeriodId()}));
  saveEnrollments(list);
  toast(`已加入 ${studentName(sid)}：${normTitle(title)}`,'ok');
  renderSettings();
}

// 退課：從登記簿移除這筆（可在學生編輯或這裡再加回）
function coRemoveEnroll(enId){
  const en=getEnrollments().find(e=>e.id===enId);
  if(!en)return;
  if(!confirm(`把「${studentName(en.studentId)}」從「${en.courseTitle}」退掉？\n\n會移除這筆登記（含自訂單價），之後可再加回。不影響 Google 行事曆。`))return;
  saveEnrollments(getEnrollments().filter(e=>e.id!==enId));
  toast(`已退課：${studentName(en.studentId)} — ${en.courseTitle}`,'ok');
  renderSettings();
}

function toggleCoExpand(key){
  if(_coExpanded.has(key))_coExpanded.delete(key);else _coExpanded.add(key);
  renderSettings();
}

function toggleNeedsGrade(title,on){
  const t=normTitle(title);
  const list=getCourseSettings().slice();
  const row=list.find(c=>normTitle(c.title)===t);
  if(row)row.needsGrade=on;
  else list.push({title:t,needsGrade:on});
  saveCourseSettings(list);
  renderSettings();  // 重繪以更新「需登記成績／只點名」標籤
}
