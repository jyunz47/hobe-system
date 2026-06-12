// 學生管理 + 從行事曆掃描學生 + 新增課程表單 + 學生編輯

var GRADES=['國小','國一','國二','國三','高一','高二','高三','大學'];

// 學生 schema（2026-05-29 起）：
//   {id, name, grade, createdAt, courses?,
//    school, birthYear, parentPhone,
//    status, statusChangedAt, statusNote}
// status 列舉：在學 / 暫停 / 離開 / 畢業
// 既有資料若無新欄位，讀取時用 fallback：s.status||'在學'、s.school||''、s.parentPhone||''、s.birthYear??null、s.statusNote||''
// 切換「待補資料」chip 可見性（CSS 用 body class 控制）
function toggleTodoChipVisibility(){
  const hidden=document.body.classList.toggle('hide-todo-chip');
  localStorage.setItem('hideTodoChip',hidden?'1':'0');
  const btn=document.getElementById('btn-toggle-todo-chip');
  if(btn)btn.textContent=hidden?'🔔 待補提示':'🔕 待補提示';
}
// 啟動時還原狀態
(function restoreTodoChipVisibility(){
  if(localStorage.getItem('hideTodoChip')==='1'){
    document.body.classList.add('hide-todo-chip');
    document.addEventListener('DOMContentLoaded',()=>{
      const btn=document.getElementById('btn-toggle-todo-chip');
      if(btn)btn.textContent='🔔 待補提示';
    });
  }
})();

function getStudentList(opts){
  const list=driveData.studentList||[];
  if(!opts)return list;
  if(opts.activeOnly)return list.filter(s=>(s.status||'在學')==='在學');
  if(opts.alumniOnly)return list.filter(s=>(s.status||'在學')!=='在學');
  return list;
}
function saveStudentList(list){driveData.studentList=list;scheduleDriveSave();}

// 建立新學生物件（含完整新欄位）
// id 用單調遞增計數器：max(上次 id + 1, Date.now()*1000)
// 同一毫秒內連續建立保證遞增、跨 session 也單調（時間始終往前）
var _lastStudentId=0;
function makeNewStudent({name,grade,courses}){
  const now=new Date().toISOString();
  _lastStudentId=Math.max(_lastStudentId+1,Date.now()*1000);
  const s={
    id:_lastStudentId,
    name,grade,
    createdAt:now,
    school:'',
    birthYear:null,
    parentPhone:'',
    status:'在學',
    statusChangedAt:now,
    statusNote:''
  };
  if(courses)s.courses=courses;
  return s;
}

// 掃描狀態
var scanData=null,_scanUnreg=[],_scanReg=[];
// 學生管理頁分頁（在學 / 歷屆）
var stuTabMode='active';
// 狀態變更 modal context
var statusModalCtx={studentId:null,selectedStatus:null};

async function scanStudentsFromCalendar(){
  if(!Object.keys(calendarIds).length)return toast('請先登入 Google 帳號','err');
  showL('掃描學生中...');
  try{
    const period=getCurrentPeriod();
    const now=period.start;
    const end=period.end;
    const SCAN_CALS=['一般課程','練習課','加課'];
    const all=await Promise.all(
      Object.entries(calendarIds).filter(([n])=>SCAN_CALS.includes(n))
        .map(async([name,id])=>{
          try{
            const r=await cachedEventList({
              calendarId:id,timeMin:now.toISOString(),timeMax:end.toISOString(),
              singleEvents:true,orderBy:'startTime',maxResults:500
            });
            return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));
          }catch{return[];}
        })
    );
    const events=all.flat().map(e=>parseEv(e)).filter(e=>!e.isRescheduled);
    const map=new Map();
    events.forEach(ev=>{
      (ev.students||[]).forEach(name=>{
        if(!map.has(name))map.set(name,new Set());
        map.get(name).add(ev.origTitle);
      });
    });
    scanData=map;
    hideL();
    renderScanSection();
  }catch(e){hideL();toast('掃描失敗：'+e.message,'err');}
}

function parseScanName(raw){
  const mBefore=raw.match(/^[（(]([^）)]+)[）)]\s*(.+)$/);
  if(mBefore)return{name:mBefore[2].trim(),gradeHint:mBefore[1].trim()};
  const mAfter=raw.match(/^(.+?)\s*[（(]([^）)]+)[）)]$/);
  if(mAfter)return{name:mAfter[1].trim(),gradeHint:mAfter[2].trim()};
  return{name:raw,gradeHint:null};
}

function courseDiffHtml(oldArr,newArr){
  const oldSet=new Set(oldArr),newSet=new Set(newArr);
  const added=newArr.filter(c=>!oldSet.has(c));
  const removed=oldArr.filter(c=>!newSet.has(c));
  if(!added.length&&!removed.length)return'';
  const parts=[];
  if(added.length)parts.push(`<span style="color:#2d9b6a">＋${added.map(esc).join('、')}</span>`);
  if(removed.length)parts.push(`<span style="color:#c0392b">－${removed.map(esc).join('、')}</span>`);
  return`<div style="font-size:11px;margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">${parts.join('')}</div>`;
}

function renderScanSection(){
  const sec=document.getElementById('stu-scan-sec');
  if(!scanData||!scanData.size){sec.style.display='none';return;}
  const list=getStudentList();
  _scanUnreg=[];_scanReg=[];
  [...scanData.entries()].forEach(([rawName,courseSet])=>{
    const{name,gradeHint}=parseScanName(rawName);
    const courses=[...courseSet];
    const matches=gradeHint
      ?list.filter(s=>s.name===name&&s.grade===gradeHint)
      :list.filter(s=>s.name===name);
    if(matches.length)_scanReg.push({rawName,name,gradeHint,courses,matches});
    else _scanUnreg.push({rawName,name,gradeHint,courses});
  });
  const periodLabel=getCurrentPeriod().label;
  let html=`<div class="stu-scan-sec"><div class="stu-scan-hd"><span>🔍 掃描結果（${periodLabel}）</span><button onclick="closeScanSection()">✕</button></div><div class="stu-scan-body">`;
  if(_scanUnreg.length){
    html+=`<div><div class="stu-scan-grp-lbl">尚未建檔（${_scanUnreg.length} 人）</div>`;
    _scanUnreg.forEach(({name,gradeHint,courses},i)=>{
      const opts=GRADES.map(g=>`<option value="${g}"${g===(gradeHint||'國二')?' selected':''}>${g}</option>`).join('');
      const displayName=gradeHint?`${name}（${gradeHint}）`:name;
      html+=`<div class="stu-scan-row">
        <div class="stu-scan-name">${esc(displayName)}</div>
        <div class="stu-scan-courses">${courses.map(esc).join('、')}</div>
        <select class="stu-scan-grade" id="scan-g-${i}">${opts}</select>
        <button class="stu-scan-add" id="scan-a-${i}" onclick="addStudentFromScan(${i})">加入</button>
      </div>`;
    });
    html+=`</div>`;
  }
  if(_scanReg.length){
    html+=`<div><div class="stu-scan-grp-lbl">已在名單（${_scanReg.length} 人）</div>`;
    _scanReg.forEach(({name,gradeHint,courses,matches},ri)=>{
      const displayName=gradeHint?`${name}（${gradeHint}）`:name;
      if(matches.length>1){
        html+=`<div class="stu-scan-exist-row">
          <div class="stu-scan-exist-name">${esc(displayName)} <span class="stu-warn-chip" style="font-size:10px">⚠ 同名</span></div>
          <div class="stu-scan-exist-courses">${courses.map(esc).join('、')}</div>
          <div style="font-size:11px;color:var(--tx3);margin-top:4px">名單中有 ${matches.length} 位同名學生，無法自動區分。請在行事曆備注加上年級，例如「（${esc(matches[0].grade)}）${esc(name)}」。</div>
        </div>`;
      }else{
        const stu=matches[0];
        const stuStatus=stu.status||'在學';
        const isAlumni=stuStatus!=='在學';
        const changed=(stu.courses||[]).slice().sort().join(',')!==courses.slice().sort().join(',');
        const diff=changed&&!isAlumni?courseDiffHtml(stu.courses||[],courses):'';
        const alumniChip=isAlumni?`<span class="stu-warn-chip" style="font-size:10px;background:#FEE2E2;color:#991B1B">⚠ 已${stuStatus}</span>`:'';
        const action=isAlumni
          ?'<span style="font-size:11px;color:#991B1B">歷屆學生，課程不更新</span>'
          :(changed?`<button class="stu-scan-upd" onclick="updateStudentCoursesFromScan(${ri})">更新課程</button>`:'<span style="font-size:11px;color:var(--tx3)">✓ 最新</span>');
        html+=`<div class="stu-scan-exist-row">
          <div class="stu-scan-exist-name">${esc(displayName)} ${alumniChip}</div>
          <div class="stu-scan-exist-grade">${esc(stu.grade)}</div>
          <div class="stu-scan-exist-courses">${courses.map(esc).join('、')}${diff}</div>
          ${action}
        </div>`;
      }
    });
    html+=`</div>`;
  }
  if(!_scanUnreg.length&&!_scanReg.length){
    html+=`<div style="font-size:13px;color:var(--tx3);padding:4px 0">${periodLabel}沒有找到學生資料，請確認行事曆備注有填寫學生姓名</div>`;
  }
  html+=`</div></div>`;
  sec.innerHTML=html;
  sec.style.display='block';
  sec.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function addStudentFromScan(i){
  const item=_scanUnreg[i];if(!item)return;
  const grade=document.getElementById(`scan-g-${i}`)?.value||'國二';
  const list=getStudentList();
  if(list.some(s=>s.name===item.name&&s.grade===grade)){renderScanSection();return toast(`${item.name}（${grade}）已在名單中`,'inf');}
  const stu=makeNewStudent({name:item.name,grade,courses:item.courses});
  list.push(stu);
  saveStudentList(list);
  ensureEnrollments(stu.id,item.courses);
  const btn=document.getElementById(`scan-a-${i}`);
  if(btn){btn.textContent='✓ 已加入';btn.disabled=true;}
  renderStudents();
  toast(`已新增 ${item.name}（${grade}）`,'ok');
}

function updateStudentCoursesFromScan(ri){
  const item=_scanReg[ri];if(!item)return;
  const list=getStudentList();
  const s=list.find(x=>x.id===item.matches[0].id);if(!s)return;
  s.courses=item.courses;
  saveStudentList(list);
  ensureEnrollments(s.id,item.courses); // 登記簿只補不刪，刪除走編輯面板或之後的對帳工具
  renderScanSection();renderStudents();
  toast(`已更新 ${s.name} 的課程`,'ok');
}

function updateStudentCoursesByStuId(stuId,ri){
  const item=_scanReg[ri];if(!item)return;
  const list=getStudentList();
  const s=list.find(x=>x.id===stuId);if(!s)return;
  s.courses=item.courses;
  saveStudentList(list);
  ensureEnrollments(s.id,item.courses);
  renderScanSection();renderStudents();
  toast(`已更新 ${s.name}（${s.grade}）的課程`,'ok');
}

function closeScanSection(){
  scanData=null;_scanUnreg=[];_scanReg=[];
  document.getElementById('stu-scan-sec').style.display='none';
}

// ── 學生 CRUD ──
function toggleAddStudentForm(){
  const f=document.getElementById('stu-add-form');
  const show=f.style.display==='none';
  f.style.display=show?'flex':'none';
  if(show)document.getElementById('stu-name-input').focus();
}

function addStudent(){
  const name=document.getElementById('stu-name-input').value.trim();
  const grade=document.getElementById('stu-grade-input').value;
  if(!name)return toast('請輸入學生姓名','inf');
  const list=getStudentList();
  const dups=list.filter(s=>s.name===name&&s.grade===grade);
  if(dups.length){
    const dupsHaveId=dups.every(s=>s.school||s.parentPhone);
    if(!dupsHaveId){
      const need=dups.filter(s=>!s.school&&!s.parentPhone).length;
      return toast(`已有 ${dups.length} 位同名同年級且其中 ${need} 位尚未補學校或家長電話。請先去那位的編輯區補上辨識資料才能再新增。`,'err');
    }
    if(!confirm(`已有 ${dups.length} 位同名同年級。確定再新增「${name}（${grade}）」？\n\n建檔後請在編輯區補上學校或家長電話以區分。`))return;
  }
  list.push(makeNewStudent({name,grade}));
  saveStudentList(list);
  document.getElementById('stu-name-input').value='';
  toggleAddStudentForm();
  renderStudents();
  toast(`已新增 ${name}（${grade}）`,'ok');
}

// ── 統計與警示 ──
function getThreshold(pid){return(pid==='sem1'||pid==='sem2')?3:2;}

function getStudentStats(studentId,periodId){
  // 2026-06-01 改 by id：先用 id 找到學生，內部仍用 name 比對 Calendar 備註
  // （Calendar 備註只有名字字串，沒有 id，要等階段 3 enrollment 才能徹底 id 化）
  const stu=getStudentList().find(x=>x.id===studentId);
  if(!stu)return{total:0,made:0,owed:0,pairs:[],byCourse:{},noShow:0,halfAdd:0,halfDeduct:0,pendingDecision:0};
  const name=stu.name;
  const pid=periodId||currentPeriodId;
  const period=getPeriods().find(p=>p.id===pid)||getPeriods()[0];
  const scheduled=getMakeupScheduled();
  const scheduledMap=new Map(scheduled.map(s=>[s.originalId,s]));
  const absences=makeupList.filter(e=>{
    if(!e.startDt||e.startDt<period.start||e.startDt>period.end)return false;
    if(e.absType==='學生請假'||e.absType==='調課')return e.absentStudents?.includes(name);
    if(e.absType==='老師請假')return e.students?.includes(name);
    return false;
  });
  const now=new Date();
  const pairs=absences.map(e=>({absence:e,makeup:scheduledMap.get(e.id)||null}));
  const byCourse={};
  pairs.forEach(({absence:a,makeup:m})=>{
    const c=a.origTitle;
    if(!byCourse[c])byCourse[c]={total:0,owed:0,studentAbs:0,reschedules:0,teacherAbs:0,pairs:[],type:a.type};
    byCourse[c].total++;
    // 「不補課」（家教課前1hr內請假、確認不補）不算欠課
    if(!isMakeupSkipped(a)&&(!m||new Date(m.scheduledEnd)>=now))byCourse[c].owed++;
    if(a.absType==='學生請假')byCourse[c].studentAbs++;
    else if(a.absType==='調課')byCourse[c].reschedules++;
    else if(a.absType==='老師請假')byCourse[c].teacherAbs++;
    byCourse[c].pairs.push({absence:a,makeup:m});
  });
  const owed=pairs.filter(p=>!isMakeupSkipped(p.absence)&&(!p.makeup||new Date(p.makeup.scheduledEnd)>=now)).length;
  // 曠課次數（含純曠課事件與請假/曠課並存事件中該生被標曠課的）
  const noShow=makeupList.filter(e=>e.startDt>=period.start&&e.startDt<=period.end&&(e.noShowStudents||[]).includes(name)).length;
  // 加退費（半堂）：家教/一對二課前1hr內請假 → 補(已排)+半堂、不補−半堂、未決待確認
  let halfAdd=0,halfDeduct=0,pendingDecision=0;
  pairs.forEach(({absence:a,makeup:m})=>{
    const small=a.type==='one'||(a.type==='pair'&&(a.students?.length||0)===2);
    if(a.absType==='學生請假'&&small&&(a.absenceTiming||{})[name]==='B'){
      if((a.makeupSkip||[]).includes(name))halfDeduct+=0.5;
      else if(m)halfAdd+=0.5;      // 已排補課＝補
      else pendingDecision++;       // 還沒決定補/不補
    }
  });
  return{total:pairs.length,made:pairs.filter(p=>p.makeup&&new Date(p.makeup.scheduledEnd)<now).length,owed,pairs,byCourse,noShow,halfAdd,halfDeduct,pendingDecision};
}

function hasThresholdWarning(stats,pid){
  const t=getThreshold(pid||currentPeriodId);
  return Object.values(stats.byCourse).some(c=>c.type==='group'&&c.studentAbs>=t);
}

// ── 學生編輯 + modal 狀態 ──
// _editEnrollments：編輯面板的修課暫存（按儲存才寫回，取消即丟棄）
// 每列 {id, courseTitle, price}；id=null 代表本次新加、尚未寫入登記簿
var stuEditId=null,_editEnrollments=[];
var mkOpenId=null;

function toggleStudentDetail(id){openStudentModal(id);}

function openStudentModal(id){
  const list=getStudentList();
  const s=list.find(x=>x.id===id);
  if(!s)return;
  const stats=getStudentStats(s.id);
  document.getElementById('stu-modal-name').textContent=s.name;
  document.getElementById('stu-modal-grade').textContent=s.grade;
  const period=getCurrentPeriod();
  const threshold=getThreshold(currentPeriodId);
  const warnCourses=Object.entries(stats.byCourse).filter(([,c])=>c.type==='group'&&c.studentAbs>=threshold);
  const hasReschedules=Object.values(stats.byCourse).some(c=>c.reschedules>0);
  let body='';
  // Per-course absence section
  body+=`<div><div class="stu-modal-sec-lbl">出缺勤（${period.label}）</div>`;
  if(warnCourses.length){
    body+=`<div class="stu-modal-warn">⚠ ${warnCourses.map(([c])=>esc(c)).join('、')} 已達額外收費標準</div>`;
  }
  if(Object.keys(stats.byCourse).length){
    body+=`<table class="stu-course-tbl"><thead><tr><th>課程</th>${hasReschedules?'<th>調課</th>':''}<th>請假</th><th>欠課</th><th></th></tr></thead><tbody>`;
    Object.entries(stats.byCourse).forEach(([course,c])=>{
      const courseWarn=c.type==='group'&&c.studentAbs>=threshold;
      // 該課的學生請假日期，接在課名後（資料來自實際 Calendar 請假，名字一定相符）
      const absDates=c.pairs.filter(p=>p.absence.absType==='學生請假').map(p=>`${p.absence.startDt.getMonth()+1}/${p.absence.startDt.getDate()}`);
      const dateStr=absDates.length?` <span style="color:var(--tx3);font-weight:400;font-size:11px">${absDates.join('、')}</span>`:'';
      body+=`<tr${courseWarn?' class="warn-row"':''}><td>${esc(course)}${dateStr}</td>${hasReschedules?`<td>${c.reschedules||0}</td>`:''}<td>${c.studentAbs}</td><td>${c.owed}</td><td>${courseWarn?`<span class="warn-badge">⚠ 多收費</span>`:''}</td></tr>`;
    });
    body+=`</tbody></table>`;
    if(stats.owed>0)body+=`<div class="stu-modal-total">欠課合計：${stats.owed} 堂</div>`;
  }else{
    body+=`<div style="font-size:12px;color:var(--tx3)">${period.label}無請假紀錄</div>`;
  }
  // 曠課 + 加退費（半堂）摘要
  const extraBits=[];
  if(stats.noShow>0)extraBits.push(`<span style="color:#991b1b">曠課 ${stats.noShow} 次</span>`);
  if(stats.halfAdd>0)extraBits.push(`<span style="color:#92400E">加收 +${stats.halfAdd} 堂</span>`);
  if(stats.halfDeduct>0)extraBits.push(`<span style="color:#166534">退費 −${stats.halfDeduct} 堂</span>`);
  if(stats.pendingDecision>0)extraBits.push(`<span style="color:var(--tx3)">待確認補課 ${stats.pendingDecision} 筆</span>`);
  if(extraBits.length)body+=`<div style="margin-top:8px;font-size:13px;display:flex;gap:12px;flex-wrap:wrap">${extraBits.join('')}</div>`;
  body+=`</div>`;
  // 修課（登記簿，含單價）；沒有本期登記時退回舊 s.courses 顯示（歷屆生）
  const ens=getEnrollments({studentId:s.id,periodId:yearPeriodId()});
  if(ens.length){
    body+=`<div><div class="stu-modal-sec-lbl">修課（${period.label}）</div>
      <div class="stu-courses">${ens.map(en=>{
        const p=effectivePrice(en);
        const priceStr=p!=null?`${p} 元/堂${en.price!=null?'・自訂':''}`:'未定價';
        return`<span class="stu-course-tag">${esc(en.courseTitle)}<span class="stu-course-price${p==null?' undef':''}">${priceStr}</span></span>`;
      }).join('')}</div></div>`;
  }else{
    const displayCourses=(s.courses||[]).filter(c=>!/^【調課】/.test(c));
    if(displayCourses.length){
      body+=`<div><div class="stu-modal-sec-lbl">課程（舊紀錄）</div>
        <div class="stu-courses">${displayCourses.map(c=>`<span class="stu-course-tag">${esc(c)}</span>`).join('')}</div></div>`;
    }
  }
  // Individual absence records
  if(stats.pairs.length){
    body+=`<div><div class="stu-modal-sec-lbl">請假紀錄</div>`;
    const _now=new Date();
    body+=stats.pairs.map(({absence:a,makeup:m})=>{
      const absDate=`${a.startDt.getMonth()+1}/${a.startDt.getDate()}（${WD[a.startDt.getDay()]}）`;
      const absTypeLabel=a.absType==='老師請假'?'老師請假':a.absType==='調課'?'調課':'學生請假';
      const isDone=m&&new Date(m.scheduledEnd)<_now;
      const isSkipped=(a.makeupSkip||[]).includes(s.name); // 已決定不補課（退半堂）
      const makeupStr=isSkipped
        ?`<div class="stu-pair-makeup" style="color:var(--tx3)">— 不補課（退半堂）</div>`
        :isDone
        ?`<div class="stu-pair-makeup done">✓ 已補課：${new Date(m.scheduledDate).getMonth()+1}/${new Date(m.scheduledDate).getDate()}（${WD[new Date(m.scheduledDate).getDay()]}）</div>`
        :m
        ?`<div class="stu-pair-makeup pending">○ 待上補課：${new Date(m.scheduledDate).getMonth()+1}/${new Date(m.scheduledDate).getDate()}（${WD[new Date(m.scheduledDate).getDay()]}）${fmtT(new Date(m.scheduledDate))}</div>`
        :`<div class="stu-pair-makeup owed link" onclick="jumpToMakeup('${esc(a.id)}')">○ 尚未安排補課</div>`;
      return`<div class="stu-pair"><div class="stu-pair-icon">${isDone?'✓':isSkipped?'—':'○'}</div><div class="stu-pair-body"><div class="stu-pair-course">${esc(a.origTitle)}</div><div class="stu-pair-abs">${absTypeLabel}：${absDate}</div>${makeupStr}</div></div>`;
    }).join('');
    body+=`</div>`;
  }
  document.getElementById('stu-modal-body').innerHTML=body;
  document.getElementById('stu-modal-wrap').classList.add('open');
}

function closeStudentModal(){
  document.getElementById('stu-modal-wrap').classList.remove('open');
}

async function jumpToMakeup(eventId){
  closeStudentModal();
  mkOpenId=eventId;
  showPanel('makeup');
  await loadMakeup();
  setTimeout(()=>{
    const card=document.querySelector('.mk-card-mini.open');
    if(card){card.scrollIntoView({behavior:'smooth',block:'center'});trigHL(card);}
  },50);
}

function toggleMkCard(id){
  mkOpenId=mkOpenId===id?null:id;
  renderMakeup();
}

// ── 新增課程表單 ──
var acStudents=[];
var acPendingName=null;

function openAddCourse(){
  acStudents=[];acPendingName=null;
  document.getElementById('ac-name').value='';
  document.getElementById('ac-cal').value='一般課程';
  document.getElementById('ac-date').value=toDateStr(currentDate);
  document.getElementById('ac-start').value='';
  document.getElementById('ac-end').value='';
  document.getElementById('ac-room').value='';
  document.getElementById('ac-teacher').value='';
  document.getElementById('ac-disambig').style.display='none';
  document.querySelector('[name="ac-repeat"][value="once"]').checked=true;
  renderAcChips();
}

function closeAddCourse(){
  openAddCourse();
}

function acStuKeydown(e){
  if(e.key==='Enter'||e.key===','||e.key==='，'){
    e.preventDefault();
    const name=e.target.value.trim().replace(/[,，]/g,'');
    if(!name)return;
    e.target.value='';
    acTryAddChip(name);
  }
}

function acTryAddChip(name){
  if(acStudents.some(s=>s.name===name))return toast('已加入同名學生','inf');
  const matches=getStudentList().filter(s=>s.name===name);
  if(!matches.length){
    acAddChip(name,true,null);
  }else{
    acPendingName=name;
    document.getElementById('ac-disambig-title').textContent=`找到同名學生「${name}」，請選擇：`;
    document.getElementById('ac-disambig-opts').innerHTML=
      matches.map(s=>`<button class="btn btns" onclick="acDisambig(${s.id})">${esc(s.name)}${s.grade?`（${s.grade}）`:''} — 舊生</button>`).join('')+
      `<button class="btn btns" onclick="acDisambig(null)">建立新生</button>`;
    document.getElementById('ac-disambig').style.display='block';
  }
}

function acDisambig(existingId){
  if(!acPendingName)return;
  acAddChip(acPendingName,existingId===null,existingId);
  acPendingName=null;
  document.getElementById('ac-disambig').style.display='none';
}

function acAddChip(name,isNew,existingId){
  acStudents.push({name,isNew,existingId});
  renderAcChips();
}

function acRemoveChip(name){
  acStudents=acStudents.filter(s=>s.name!==name);
  renderAcChips();
}

function renderAcChips(){
  const wrap=document.getElementById('ac-chips');
  wrap.innerHTML=acStudents.map(s=>
    `<span class="ac-chip ${s.isNew?'ac-chip-new':'ac-chip-old'}" title="${s.isNew?'新生':'舊生'}">
      ${esc(s.name)}<button class="ac-chip-x" onclick="acRemoveChip('${esc(s.name)}')">✕</button>
    </span>`
  ).join('')+`<input id="ac-stu-input" class="ac-stu-input" placeholder="${acStudents.length?'':'輸入姓名按 Enter 新增'}" onkeydown="acStuKeydown(event)">`;
}

async function submitAddCourse(){
  const name=document.getElementById('ac-name').value.trim();
  const cal=document.getElementById('ac-cal').value;
  const date=document.getElementById('ac-date').value;
  const start=document.getElementById('ac-start').value;
  const end=document.getElementById('ac-end').value;
  const room=document.getElementById('ac-room').value;
  const teacher=document.getElementById('ac-teacher').value.trim();
  const repeat=document.querySelector('[name="ac-repeat"]:checked').value;

  if(!name)return toast('請輸入課程名稱','inf');
  if(!date)return toast('請選擇日期','inf');
  if(!start||!end)return toast('請填入開始與結束時間','inf');
  if(start>=end)return toast('結束時間需晚於開始時間','inf');

  const calId=calendarIds[cal];
  if(!calId)return toast(`找不到「${cal}」行事曆，請先確認行事曆已建立`,'err');

  const sS=new Date(`${date}T${start}`);
  const sE=new Date(`${date}T${end}`);
  const line1=[room,teacher].filter(Boolean).join(' ');
  const stuLine=acStudents.map(s=>s.name).join('、');
  const desc=[line1,stuLine].filter(Boolean).join('\n');

  const resource={summary:name,description:desc,start:{dateTime:sS.toISOString()},end:{dateTime:sE.toISOString()}};
  if(repeat==='weekly')resource.recurrence=['RRULE:FREQ=WEEKLY'];

  try{
    showL('新增課程中...');
    await gapi.client.calendar.events.insert({calendarId:calId,resource});
    invalidateEventCache();

    // 建立新生學生檔案
    const list=getStudentList();
    let added=0;
    acStudents.filter(s=>s.isNew).forEach(s=>{
      if(!list.some(x=>x.name===s.name)){
        list.push({id:Date.now()+added++,name:s.name,grade:'',createdAt:new Date().toISOString()});
      }
    });
    if(added)saveStudentList(list);

    closeAddCourse();
    hideL();
    toast(`已新增「${name}」${repeat==='weekly'?'（每週重複）':''}，${acStudents.filter(s=>s.isNew).length?`${acStudents.filter(s=>s.isNew).length} 位新生已建立檔案`:''}`.trimEnd().replace(/，$/,''),'ok');
    await refreshCurrent();
  }catch(err){
    hideL();
    toast('新增失敗：'+(err.result?.error?.message||err.message),'err');
  }
}

// ── 學生編輯流程 ──
function toggleStudentEdit(id){
  if(stuEditId===id){cancelStudentEdit();return;}
  stuEditId=id;
  _editEnrollments=getEnrollments({studentId:id,periodId:yearPeriodId()})
    .map(en=>({id:en.id,courseTitle:en.courseTitle,price:en.price}));
  renderStudents();
  requestAnimationFrame(()=>document.getElementById(`edit-name-${id}`)?.focus());
}

function cancelStudentEdit(){
  stuEditId=null;_editEnrollments=[];
  renderStudents();
}

function saveStudentEdit(id){
  const name=document.getElementById(`edit-name-${id}`)?.value.trim();
  const grade=document.getElementById(`edit-grade-${id}`)?.value;
  if(!name)return toast('姓名不能空白','err');
  const list=getStudentList();
  const cur=list.find(x=>x.id===id);
  if(!cur)return;
  const newSchool=document.getElementById(`edit-school-${id}`)?.value.trim()||'';
  const newPhone=document.getElementById(`edit-parentPhone-${id}`)?.value.trim()||'';
  // 同名同年級規則：本人必須至少填學校或家長電話（既有同名者由他們自己編輯時補）
  const dups=list.filter(s=>s.id!==id&&s.name===name&&s.grade===grade);
  if(dups.length&&!(newSchool||newPhone)){
    return toast(`改成「${name}（${grade}）」會與既有 ${dups.length} 位同名同年級學生衝突。請至少填本人的「學校」或「家長電話」其中一項以區分。`,'err');
  }
  cur.name=name;cur.grade=grade;
  cur.school=newSchool;
  const byVal=document.getElementById(`edit-birthYear-${id}`)?.value.trim();
  cur.birthYear=byVal?parseInt(byVal,10):null;
  cur.parentPhone=newPhone;
  // 修課異動寫回登記簿（本期）：暫存沒有的刪、有 id 的更新價格、id=null 的新建
  // 註：s.courses 不再寫入，留作舊資料（rollback 與歷屆顯示用）
  syncEditPrices(id);
  const pid=yearPeriodId();
  const keepIds=new Set(_editEnrollments.filter(r=>r.id).map(r=>r.id));
  const ens=getEnrollments().filter(en=>en.studentId!==id||en.periodId!==pid||keepIds.has(en.id));
  _editEnrollments.forEach(r=>{
    if(r.id){const en=ens.find(x=>x.id===r.id);if(en)en.price=r.price;}
    else ens.push(makeEnrollment({studentId:id,courseTitle:r.courseTitle,periodId:pid,price:r.price}));
  });
  driveData.enrollments=ens;
  saveStudentList(list);
  stuEditId=null;_editEnrollments=[];
  renderStudents();
  toast(`已更新 ${name} 的資料`,'ok');
}

function buildEditCoursesHtml(id){
  return _editEnrollments.map((r,i)=>{
    const def=getCourseDefaultPrice(r.courseTitle);
    const ph=def!=null?`預設 ${def}`:'未定價';
    return`<div class="stu-edit-enroll-row">
      <span class="stu-edit-course-tag">${esc(r.courseTitle)}<button class="rm-course-btn" onclick="removeEditCourse(${i},${id})">✕</button></span>
      <input type="number" class="stu-edit-price-input" id="edit-price-${id}-${i}" value="${r.price??''}" placeholder="${ph}" min="0" inputmode="numeric">
      <span class="stu-edit-price-unit">元/堂</span>
    </div>`;
  }).join('')+
  `<div class="stu-edit-add-wrap">
    <input id="edit-new-course-${id}" class="stu-edit-new-course" placeholder="新增修課…" onkeydown="if(event.key==='Enter'){event.preventDefault();addEditCourse(${id})}">
    <button class="stu-edit-add-btn" onclick="addEditCourse(${id})">＋</button>
  </div>`;
}

function renderEditCourses(id){
  const el=document.getElementById(`edit-courses-${id}`);
  if(el)el.innerHTML=buildEditCoursesHtml(id);
}

// 把畫面上的單價輸入抄回暫存（重繪或儲存前都要先呼叫，否則輸入會被吃掉）
function syncEditPrices(id){
  _editEnrollments.forEach((r,i)=>{
    const v=document.getElementById(`edit-price-${id}-${i}`)?.value.trim();
    r.price=v?Math.max(0,parseInt(v,10)||0):null;
  });
}

function removeEditCourse(idx,id){
  syncEditPrices(id);
  _editEnrollments.splice(idx,1);
  renderEditCourses(id);
}

function addEditCourse(id){
  const input=document.getElementById(`edit-new-course-${id}`);
  const val=input?.value.trim();
  if(!val)return;
  syncEditPrices(id);
  if(!_editEnrollments.some(r=>r.courseTitle===val))_editEnrollments.push({id:null,courseTitle:val,price:null});
  input.value='';
  renderEditCourses(id);
  input.focus();
}

// ── 學生卡片清單（分頁式：在學 / 歷屆） ──
function renderStudents(){
  const container=document.getElementById('stu-list');
  if(!container)return;
  const list=getStudentList();
  // 「同名同年級且視覺上無法分辨」的 key 集合（顯示 ⚠ 同名 chip 用）
  // 規則：該組必須「全部都填了學校」且「彼此學校都不重複」才算已消歧
  // - 有任一位學校空白 → 顯示 chip（該位無法被指認）
  // - 有兩位學校相同 → 顯示 chip（卡片視覺上看不出差異）
  // 家長電話不參與判斷（卡片不顯示，純資料層保留）
  const dupNeedingFix=new Set();
  const _schoolsByKey=new Map();
  list.forEach(s=>{
    const k=s.name+'|'+s.grade;
    if(!_schoolsByKey.has(k))_schoolsByKey.set(k,[]);
    _schoolsByKey.get(k).push(s.school||'');
  });
  _schoolsByKey.forEach((schools,k)=>{
    if(schools.length<=1)return;
    const allFilled=schools.every(sc=>sc.length>0);
    const allUnique=new Set(schools).size===schools.length;
    if(!allFilled||!allUnique)dupNeedingFix.add(k);
  });
  const activeList=list.filter(s=>(s.status||'在學')==='在學');
  const alumniList=list.filter(s=>(s.status||'在學')!=='在學');
  let html=`<div class="stu-tab-bar">
    <button class="stu-tab-btn${stuTabMode==='active'?' active':''}" onclick="switchStuTab('active')">在學（${activeList.length}）</button>
    <button class="stu-tab-btn${stuTabMode==='alumni'?' active':''}" onclick="switchStuTab('alumni')">歷屆（${alumniList.length}）</button>
  </div>`;
  if(!list.length){
    container.innerHTML=html+periodTabsHtml()+'<div class="empty">尚未新增學生，點右上角「新增學生」開始</div>';
    return;
  }
  html+=periodTabsHtml();
  if(stuTabMode==='active'){
    html+=activeList.length?renderStudentGradeSections(activeList,dupNeedingFix,false):'<div class="empty">沒有在學學生</div>';
  }else{
    if(!alumniList.length){
      html+='<div class="empty">尚無歷屆學生</div>';
    }else{
      ['畢業','離開','暫停'].forEach(status=>{
        const arr=alumniList.filter(s=>s.status===status);
        if(!arr.length)return;
        html+=`<div class="stu-status-sec"><div class="stu-status-sec-lbl">${status}　${arr.length} 人</div>`;
        html+=renderStudentGradeSections(arr,dupNeedingFix,true);
        html+=`</div>`;
      });
    }
  }
  container.innerHTML=html;
}

function renderStudentGradeSections(studs,dupNeedingFix,isAlumni){
  const byGrade={};
  GRADES.forEach(g=>{byGrade[g]=[];});
  studs.forEach(s=>{if(!byGrade[s.grade])byGrade[s.grade]=[];byGrade[s.grade].push(s);});
  let h='';
  GRADES.forEach(grade=>{
    const gs=byGrade[grade]||[];
    if(!gs.length)return;
    h+=`<div class="stu-grade-sec"><div class="stu-grade-lbl">${grade}　${gs.length} 人</div><div class="stu-grid">`;
    gs.forEach(s=>{h+=renderStudentCard(s,dupNeedingFix,isAlumni);});
    h+=`</div>`;
    if(stuEditId!==null&&gs.some(x=>x.id===stuEditId)){
      h+=renderStudentEditPanel(gs.find(x=>x.id===stuEditId));
    }
    h+=`</div>`;
  });
  return h;
}

function renderStudentCard(s,dupNeedingFix,isAlumni){
  const stats=getStudentStats(s.id);
  const warn=hasThresholdWarning(stats);
  const isDup=dupNeedingFix.has(s.name+'|'+s.grade);
  const needsInfo=!s.school&&!s.parentPhone;
  return `<div class="stu-card${isAlumni?' alumni':''}" onclick="toggleStudentDetail(${s.id})">
    <div class="stu-card-actions">
      <button class="stu-card-act-btn" onclick="event.stopPropagation();toggleStudentEdit(${s.id})" title="編輯">✎</button>
      <button class="stu-card-act-btn del" onclick="event.stopPropagation();openStatusChangeModal(${s.id})" title="變更狀態">${isAlumni?'🔄':'✕'}</button>
    </div>
    <div class="stu-card-name-wrap">
      <div class="stu-card-name">${esc(s.name)}</div>
      ${s.school?`<div class="stu-card-school">${esc(s.school)}</div>`:''}
    </div>
    <div class="stu-owed">
      <span class="stu-owed-n${stats.owed>0?' gt0':''}">${stats.owed}</span>
      <span class="stu-owed-l">欠課</span>
      ${warn?'<span class="stu-warn-chip">⚠ 多收費</span>':''}
      ${isDup?'<span class="stu-warn-chip">⚠ 同名</span>':''}
      ${needsInfo?'<span class="stu-info-chip">📝 待補資料</span>':''}
    </div>
  </div>`;
}

function renderStudentEditPanel(s){
  const gradeOpts=GRADES.map(g=>`<option value="${g}"${g===s.grade?' selected':''}>${g}</option>`).join('');
  return `<div class="stu-edit-panel"><div class="stu-edit-form">
    <div class="stu-edit-top">
      <input id="edit-name-${s.id}" class="stu-edit-input" value="${esc(s.name)}" placeholder="姓名" maxlength="20">
      <select id="edit-grade-${s.id}" class="stu-edit-select">${gradeOpts}</select>
      <button class="stu-edit-save" onclick="saveStudentEdit(${s.id})">儲存</button>
      <button class="stu-edit-cancel" onclick="cancelStudentEdit()">取消</button>
    </div>
    <div class="stu-edit-info-row">
      <label>學校
        <input id="edit-school-${s.id}" value="${esc(s.school||'')}" placeholder="例：松山國中" maxlength="30">
      </label>
      <label>出生年（西元）
        <input type="number" id="edit-birthYear-${s.id}" value="${s.birthYear??''}" placeholder="例：2010" min="1990" max="2030">
      </label>
      <label>家長電話
        <input id="edit-parentPhone-${s.id}" value="${esc(s.parentPhone||'')}" placeholder="例：0912xxxxxx" maxlength="15">
      </label>
    </div>
    <div class="stu-edit-courses-row">
      <span class="stu-edit-courses-lbl">修課（${getCurrentPeriod().label}）</span>
      <div id="edit-courses-${s.id}" class="stu-edit-courses-body">${buildEditCoursesHtml(s.id)}</div>
    </div>
  </div></div>`;
}

function switchStuTab(mode){
  stuTabMode=mode;
  cancelStudentEdit();
  renderStudents();
}

// ── 狀態變更 modal ──
function openStatusChangeModal(studentId){
  const s=getStudentList().find(x=>x.id===studentId);
  if(!s)return;
  statusModalCtx={studentId,selectedStatus:null};
  const current=s.status||'在學';
  const all=['在學','畢業','離開','暫停'];
  const opts=all.filter(o=>o!==current);
  document.getElementById('status-modal-name').textContent=`${s.name}（${s.grade}）　目前狀態：${current}`;
  document.getElementById('status-modal-note').value='';
  document.getElementById('status-modal-opts').innerHTML=opts.map(o=>{
    const label=o==='在學'?'復學（在學）':o;
    return `<button class="status-opt-btn" data-status="${o}" onclick="selectStatusOpt('${o}')">${label}</button>`;
  }).join('');
  document.getElementById('status-modal-wrap').classList.add('open');
}
function selectStatusOpt(status){
  statusModalCtx.selectedStatus=status;
  document.querySelectorAll('.status-opt-btn').forEach(b=>{
    b.classList.toggle('selected',b.dataset.status===status);
  });
}
function closeStatusModal(){
  document.getElementById('status-modal-wrap').classList.remove('open');
  statusModalCtx={studentId:null,selectedStatus:null};
}
function confirmStatusChange(){
  if(!statusModalCtx.selectedStatus)return toast('請先選一個狀態','inf');
  const list=getStudentList();
  const s=list.find(x=>x.id===statusModalCtx.studentId);
  if(!s)return;
  s.status=statusModalCtx.selectedStatus;
  s.statusChangedAt=new Date().toISOString();
  s.statusNote=document.getElementById('status-modal-note').value.trim();
  saveStudentList(list);
  closeStatusModal();
  renderStudents();
  const labelMap={在學:'復學（在學）',畢業:'畢業',離開:'離開',暫停:'暫停'};
  toast(`已將 ${s.name} 設為${labelMap[s.status]}`,'ok');
}

// ── 升年級批次 ──
// 國一~高二自動 +1
// 國三→高一（多數會繼續補高中，例外手動改）
// 高三→畢業（設 status='畢業'，例外手動復學）
// 國小、大學跳過（國小不分年級無法判斷；大學是頂層）
function batchPromoteGrade(){
  const GRADE_NEXT={'國一':'國二','國二':'國三','國三':'高一','高一':'高二','高二':'高三'};
  const SKIP=['國小','大學'];
  const list=getStudentList();
  const active=list.filter(s=>(s.status||'在學')==='在學');
  const eligibleGrade=active.filter(s=>GRADE_NEXT[s.grade]);
  const eligibleGraduate=active.filter(s=>s.grade==='高三');
  const skipped=active.filter(s=>SKIP.includes(s.grade));
  if(!eligibleGrade.length&&!eligibleGraduate.length){
    return toast('沒有可批次升年級的在學學生','inf');
  }
  const gradeSummary=Object.entries(GRADE_NEXT).map(([from,to])=>{
    const n=eligibleGrade.filter(s=>s.grade===from).length;
    return n?`  ${from} → ${to}：${n} 位`:'';
  }).filter(Boolean).join('\n');
  const gradMsg=eligibleGraduate.length?`\n  高三 → 畢業（狀態變更）：${eligibleGraduate.length} 位`:'';
  const skipMsg=skipped.length?`\n\n${skipped.length} 位跳過（國小不分年級、大學已頂層）`:'';
  if(!confirm(`批次升年級將執行：\n${gradeSummary}${gradMsg}${skipMsg}\n\n國三→高一、高三→畢業 為自動處理。\n如有例外（國三畢業後不續、高三繼續大學），執行後個別調整即可。\n\n確定執行？`))return;
  const now=new Date().toISOString();
  eligibleGrade.forEach(s=>{s.grade=GRADE_NEXT[s.grade];});
  eligibleGraduate.forEach(s=>{
    s.status='畢業';
    s.statusChangedAt=now;
    if(!s.statusNote)s.statusNote='批次升年級時自動設為畢業';
  });
  saveStudentList(list);
  renderStudents();
  toast(`已升年級 ${eligibleGrade.length} 位、設畢業 ${eligibleGraduate.length} 位`,'ok');
}
