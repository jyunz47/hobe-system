// 學生管理 + 從行事曆掃描學生 + 新增課程表單 + 學生編輯

var GRADES=['國小','國一','國二','國三','高一','高二','高三','大學'];
function getStudentList(){return driveData.studentList||[];}
function saveStudentList(list){driveData.studentList=list;scheduleDriveSave();}

// 掃描狀態
var scanData=null,_scanUnreg=[],_scanReg=[];

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
            const r=await gapi.client.calendar.events.list({
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
        const changed=(stu.courses||[]).slice().sort().join(',')!==courses.slice().sort().join(',');
        const diff=changed?courseDiffHtml(stu.courses||[],courses):'';
        html+=`<div class="stu-scan-exist-row">
          <div class="stu-scan-exist-name">${esc(displayName)}</div>
          <div class="stu-scan-exist-grade">${esc(stu.grade)}</div>
          <div class="stu-scan-exist-courses">${courses.map(esc).join('、')}${diff}</div>
          ${changed?`<button class="stu-scan-upd" onclick="updateStudentCoursesFromScan(${ri})">更新課程</button>`:'<span style="font-size:11px;color:var(--tx3)">✓ 最新</span>'}
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
  list.push({id:Date.now(),name:item.name,grade,courses:item.courses,createdAt:new Date().toISOString()});
  saveStudentList(list);
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
  renderScanSection();renderStudents();
  toast(`已更新 ${s.name} 的課程`,'ok');
}

function updateStudentCoursesByStuId(stuId,ri){
  const item=_scanReg[ri];if(!item)return;
  const list=getStudentList();
  const s=list.find(x=>x.id===stuId);if(!s)return;
  s.courses=item.courses;
  saveStudentList(list);
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
  if(list.some(s=>s.name===name&&s.grade===grade))return toast('已有同名同年級的學生','inf');
  list.push({id:Date.now(),name,grade,createdAt:new Date().toISOString()});
  saveStudentList(list);
  document.getElementById('stu-name-input').value='';
  toggleAddStudentForm();
  renderStudents();
  toast(`已新增 ${name}（${grade}）`,'ok');
}

function deleteStudent(id){
  if(!confirm('確定刪除這位學生的紀錄？'))return;
  saveStudentList(getStudentList().filter(s=>s.id!==id));
  renderStudents();
}

// ── 統計與警示 ──
function getThreshold(pid){return(pid==='sem1'||pid==='sem2')?3:2;}

function getStudentStats(name,periodId){
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
    if(!m||new Date(m.scheduledEnd)>=now)byCourse[c].owed++;
    if(a.absType==='學生請假')byCourse[c].studentAbs++;
    else if(a.absType==='調課')byCourse[c].reschedules++;
    else if(a.absType==='老師請假')byCourse[c].teacherAbs++;
    byCourse[c].pairs.push({absence:a,makeup:m});
  });
  const owed=pairs.filter(p=>!p.makeup||new Date(p.makeup.scheduledEnd)>=now).length;
  return{total:pairs.length,made:pairs.filter(p=>p.makeup&&new Date(p.makeup.scheduledEnd)<now).length,owed,pairs,byCourse};
}

function hasThresholdWarning(stats,pid){
  const t=getThreshold(pid||currentPeriodId);
  return Object.values(stats.byCourse).some(c=>c.type==='group'&&c.studentAbs>=t);
}

// ── 學生編輯 + modal 狀態 ──
var stuEditId=null,_editCourses=[];
var mkOpenId=null;

function toggleStudentDetail(id){openStudentModal(id);}

function openStudentModal(id){
  const list=getStudentList();
  const s=list.find(x=>x.id===id);
  if(!s)return;
  const stats=getStudentStats(s.name);
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
      body+=`<tr${courseWarn?' class="warn-row"':''}><td>${esc(course)}</td>${hasReschedules?`<td>${c.reschedules||0}</td>`:''}<td>${c.studentAbs}</td><td>${c.owed}</td><td>${courseWarn?`<span class="warn-badge">⚠ 多收費</span>`:''}</td></tr>`;
    });
    body+=`</tbody></table>`;
    if(stats.owed>0)body+=`<div class="stu-modal-total">欠課合計：${stats.owed} 堂</div>`;
  }else{
    body+=`<div style="font-size:12px;color:var(--tx3)">${period.label}無請假紀錄</div>`;
  }
  body+=`</div>`;
  // Enrolled courses
  const displayCourses=(s.courses||[]).filter(c=>!/^【調課】/.test(c));
  if(displayCourses.length){
    body+=`<div><div class="stu-modal-sec-lbl">課程</div>
      <div class="stu-courses">${displayCourses.map(c=>`<span class="stu-course-tag">${esc(c)}</span>`).join('')}</div></div>`;
  }
  // Individual absence records
  if(stats.pairs.length){
    body+=`<div><div class="stu-modal-sec-lbl">請假紀錄</div>`;
    const _now=new Date();
    body+=stats.pairs.map(({absence:a,makeup:m})=>{
      const absDate=`${a.startDt.getMonth()+1}/${a.startDt.getDate()}（${WD[a.startDt.getDay()]}）`;
      const absTypeLabel=a.absType==='老師請假'?'老師請假':a.absType==='調課'?'調課':'學生請假';
      const isDone=m&&new Date(m.scheduledEnd)<_now;
      const makeupStr=isDone
        ?`<div class="stu-pair-makeup done">✓ 已補課：${new Date(m.scheduledDate).getMonth()+1}/${new Date(m.scheduledDate).getDate()}（${WD[new Date(m.scheduledDate).getDay()]}）</div>`
        :m
        ?`<div class="stu-pair-makeup pending">○ 待上補課：${new Date(m.scheduledDate).getMonth()+1}/${new Date(m.scheduledDate).getDate()}（${WD[new Date(m.scheduledDate).getDay()]}）${fmtT(new Date(m.scheduledDate))}</div>`
        :`<div class="stu-pair-makeup owed link" onclick="jumpToMakeup('${esc(a.id)}')">○ 尚未安排補課</div>`;
      return`<div class="stu-pair"><div class="stu-pair-icon">${isDone?'✓':'○'}</div><div class="stu-pair-body"><div class="stu-pair-course">${esc(a.origTitle)}</div><div class="stu-pair-abs">${absTypeLabel}：${absDate}</div>${makeupStr}</div></div>`;
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
  const s=getStudentList().find(x=>x.id===id);
  _editCourses=s?(s.courses||[]).filter(c=>!/^【調課】/.test(c)):[];
  renderStudents();
  requestAnimationFrame(()=>document.getElementById(`edit-name-${id}`)?.focus());
}

function cancelStudentEdit(){
  stuEditId=null;_editCourses=[];
  renderStudents();
}

function saveStudentEdit(id){
  const name=document.getElementById(`edit-name-${id}`)?.value.trim();
  const grade=document.getElementById(`edit-grade-${id}`)?.value;
  if(!name)return toast('姓名不能空白','err');
  const list=getStudentList();
  if(list.some(x=>x.id!==id&&x.name===name))return toast('已有同名學生','err');
  const s=list.find(x=>x.id===id);
  if(!s)return;
  s.name=name;s.grade=grade;s.courses=[..._editCourses];
  saveStudentList(list);
  stuEditId=null;_editCourses=[];
  renderStudents();
  toast(`已更新 ${name} 的資料`,'ok');
}

function buildEditCoursesHtml(id){
  return _editCourses.map((c,i)=>
    `<span class="stu-edit-course-tag">${esc(c)}<button class="rm-course-btn" onclick="removeEditCourse(${i},${id})">✕</button></span>`
  ).join('')+
  `<div class="stu-edit-add-wrap">
    <input id="edit-new-course-${id}" class="stu-edit-new-course" placeholder="新增課程…" onkeydown="if(event.key==='Enter'){event.preventDefault();addEditCourse(${id})}">
    <button class="stu-edit-add-btn" onclick="addEditCourse(${id})">＋</button>
  </div>`;
}

function renderEditCourses(id){
  const el=document.getElementById(`edit-courses-${id}`);
  if(el)el.innerHTML=buildEditCoursesHtml(id);
}

function removeEditCourse(idx,id){
  _editCourses.splice(idx,1);
  renderEditCourses(id);
}

function addEditCourse(id){
  const input=document.getElementById(`edit-new-course-${id}`);
  const val=input?.value.trim();
  if(!val)return;
  if(!_editCourses.includes(val))_editCourses.push(val);
  input.value='';
  renderEditCourses(id);
  input.focus();
}

// ── 學生卡片清單 ──
function renderStudents(){
  const container=document.getElementById('stu-list');
  if(!container)return;
  const list=getStudentList();
  if(!list.length){container.innerHTML=periodTabsHtml()+'<div class="empty">尚未新增學生，點右上角「新增學生」開始</div>';return;}
  const byGrade={};
  GRADES.forEach(g=>{byGrade[g]=[];});
  list.forEach(s=>{if(!byGrade[s.grade])byGrade[s.grade]=[];byGrade[s.grade].push(s);});
  let html=periodTabsHtml();
  GRADES.forEach(grade=>{
    const studs=byGrade[grade]||[];
    if(!studs.length)return;
    html+=`<div class="stu-grade-sec"><div class="stu-grade-lbl">${grade}　${studs.length} 人</div><div class="stu-grid">`;
    studs.forEach(s=>{
      const stats=getStudentStats(s.name);
      const warn=hasThresholdWarning(stats);
      html+=`<div class="stu-card" onclick="toggleStudentDetail(${s.id})">
        <div class="stu-card-actions">
          <button class="stu-card-act-btn" onclick="event.stopPropagation();toggleStudentEdit(${s.id})" title="編輯">✎</button>
          <button class="stu-card-act-btn del" onclick="event.stopPropagation();deleteStudent(${s.id})" title="刪除">✕</button>
        </div>
        <div class="stu-card-name">${esc(s.name)}</div>
        <div class="stu-owed">
          <span class="stu-owed-n${stats.owed>0?' gt0':''}">${stats.owed}</span>
          <span class="stu-owed-l">欠課</span>
          ${warn?'<span class="stu-warn-chip">⚠ 多收費</span>':''}
        </div>
      </div>`;
    });
    html+=`</div>`; // close grid

    // Edit panel
    if(stuEditId!==null&&studs.some(x=>x.id===stuEditId)){
      const s=studs.find(x=>x.id===stuEditId);
      const gradeOpts=GRADES.map(g=>`<option value="${g}"${g===s.grade?' selected':''}>${g}</option>`).join('');
      html+=`<div class="stu-edit-panel"><div class="stu-edit-form">
        <div class="stu-edit-top">
          <input id="edit-name-${s.id}" class="stu-edit-input" value="${esc(s.name)}" placeholder="姓名" maxlength="20">
          <select id="edit-grade-${s.id}" class="stu-edit-select">${gradeOpts}</select>
          <button class="stu-edit-save" onclick="saveStudentEdit(${s.id})">儲存</button>
          <button class="stu-edit-cancel" onclick="cancelStudentEdit()">取消</button>
        </div>
        <div class="stu-edit-courses-row">
          <span class="stu-edit-courses-lbl">課程</span>
          <div id="edit-courses-${s.id}" class="stu-edit-courses-body">${buildEditCoursesHtml(s.id)}</div>
        </div>
      </div></div>`;
    }

    html+=`</div>`; // close grade section
  });
  container.innerHTML=html;
}
