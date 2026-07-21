// 學生管理 + 課表對帳（行事曆 vs 修課登記簿）+ 新增課程表單 + 學生編輯

// 年級：國小分一~六年、國中/高中沿用舊值（國一…高三），末尾保留裸「國小」「大學」給舊資料
// 顯示/分組順序＝這個陣列的順序
var GRADES=['國小一','國小二','國小三','國小四','國小五','國小六','國一','國二','國三','高一','高二','高三','大學','國小'];

// ── 兩層年級選擇器（先選階段國小/國中/高中，再選年）──
var GRADE_SEG_YEARS={'國小':['一','二','三','四','五','六'],'國中':['一','二','三'],'高中':['一','二','三']};
// 階段＋年 → 儲存字串（國中/高中維持舊格式「國一」「高二」，國小＝「國小三」）
function gradeCompose(seg,yr){if(!seg||!yr)return'';if(seg==='國中')return'國'+yr;if(seg==='高中')return'高'+yr;return'國小'+yr;}
// 儲存字串 → {seg,yr}；裸「國小」「大學」或空值拆不出（回空，走 legacy 顯示）
function gradeDecompose(g){
  if(/^國小[一二三四五六]$/.test(g))return{seg:'國小',yr:g.slice(2)};
  if(/^國[一二三]$/.test(g))return{seg:'國中',yr:g.slice(1)};
  if(/^高[一二三]$/.test(g))return{seg:'高中',yr:g.slice(1)};
  return{seg:'',yr:''};
}
// 產生「階段 select ＋ 年 select」HTML；onSeg/onYr 是各自 onchange 的 JS 字串
function gradePickerHtml(seg,yr,onSeg,onYr){
  const years=GRADE_SEG_YEARS[seg]||[];
  return `<div class="cf-grade-pick">
    <select class="cm-input" onchange="${onSeg}">
      <option value="" ${!seg?'selected':''} disabled>階段…</option>
      ${['國小','國中','高中'].map(s=>`<option ${seg===s?'selected':''}>${s}</option>`).join('')}
    </select>
    <select class="cm-input" onchange="${onYr}" ${seg?'':'disabled'}>
      <option value="" ${!yr?'selected':''} disabled>年級…</option>
      ${years.map(y=>`<option ${yr===y?'selected':''}>${y}</option>`).join('')}
    </select>
  </div>`;
}

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
function makeNewStudent({name,grade,courses,school='',parentPhone='',sourceChannel='',note=''}){
  const now=new Date().toISOString();
  _lastStudentId=Math.max(_lastStudentId+1,Date.now()*1000);
  const s={
    id:_lastStudentId,
    name,grade,
    createdAt:now,
    school,
    birthYear:null,
    parentPhone,
    sourceChannel,   // 來源管道（2026-07-04 拍板增欄；試聽轉正式報名時自動帶）
    note,            // 備註欄（2026-07-04 拍板增欄）
    status:'在學',
    statusChangedAt:now,
    statusNote:''
  };
  if(courses)s.courses=courses;
  return s;
}

// 課表對帳狀態：scanData＝行事曆掃描結果（rawName → Set(課名)），_recon＝最近一次比對分桶
var scanData=null,_recon=null;
// 學生管理頁分頁（在學 / 歷屆）
var stuTabMode='active';
// 狀態變更 modal context
var statusModalCtx={studentId:null,selectedStatus:null};

async function scanStudentsFromCalendar(){
  if(!Object.keys(calendarIds).length)return toast('請先登入 Google 帳號','err');
  showL('對帳中...');
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

// 對帳面板：只報告差異，每一條都等使用者按了才動資料
// 注意：對帳不再寫 student.courses（舊欄位凍結），所有修課異動都進登記簿
function renderScanSection(){
  const sec=document.getElementById('stu-scan-sec');
  if(!scanData){sec.style.display='none';return;}
  const periodLabel=getCurrentPeriod().label;
  let html=`<div class="stu-scan-sec"><div class="stu-scan-hd"><span>🧾 課表對帳（${periodLabel}）</span><button onclick="closeScanSection()">✕</button></div><div class="stu-scan-body">`;
  if(!scanData.size){
    html+=`<div style="font-size:13px;color:var(--tx3);padding:4px 0">${periodLabel}沒有掃到任何學生，請確認行事曆備注有填寫學生姓名</div></div></div>`;
    sec.innerHTML=html;sec.style.display='block';
    return;
  }
  const entries=[...scanData.entries()].map(([rawName,courseSet])=>{
    const{name,gradeHint}=parseScanName(rawName);
    return{name,gradeHint,courses:[...courseSet]};
  });
  _recon=computeReconciliation(entries,getStudentList(),getEnrollments(),yearPeriodId());
  const{unknown,ambiguous,alumni,diffs,okCount}=_recon;
  if(unknown.length){
    html+=`<div><div class="stu-scan-grp-lbl">查無此人——行事曆有、尚未建檔（${unknown.length} 人）</div>`;
    unknown.forEach(({name,gradeHint,courses},i)=>{
      const opts=GRADES.map(g=>`<option value="${g}"${g===(gradeHint||'國二')?' selected':''}>${g}</option>`).join('');
      const displayName=gradeHint?`${name}（${gradeHint}）`:name;
      html+=`<div class="stu-scan-row">
        <div class="stu-scan-name">${esc(displayName)}</div>
        <div class="stu-scan-courses">${courses.map(esc).join('、')}</div>
        <select class="stu-scan-grade" id="recon-g-${i}">${opts}</select>
        <button class="stu-scan-add" onclick="reconCreateStudent(${i})">建檔並登記</button>
      </div>`;
    });
    html+=`<div class="recon-hint">名字打錯的話不用建檔，直接去行事曆備注改字，再對帳一次。</div></div>`;
  }
  if(diffs.length){
    html+=`<div><div class="stu-scan-grp-lbl">修課差異（${diffs.length} 人）</div>`;
    diffs.forEach((d,di)=>{
      const chips=[
        ...d.missing.map((title,mi)=>`<button class="recon-chip add" title="行事曆有上、登記簿沒登記，點此補登" onclick="reconEnroll(${di},${mi})">＋ ${esc(title)}</button>`),
        ...d.extra.map((en,xi)=>`<button class="recon-chip rm" title="登記簿有、這期行事曆沒出現過他，點此退課" onclick="reconUnenroll(${di},${xi})">－ ${esc(en.courseTitle)}</button>`),
      ].join('');
      const allBtn=d.missing.length>=2?`<button class="stu-scan-upd" onclick="reconEnrollAll(${di})">全部補登</button>`:'';
      html+=`<div class="stu-scan-exist-row">
        <div class="stu-scan-exist-name">${esc(d.stu.name)}</div>
        <div class="stu-scan-exist-grade">${esc(d.stu.grade)}</div>
        <div class="stu-scan-exist-courses recon-chips">${chips}</div>
        ${allBtn}
      </div>`;
    });
    html+=`<div class="recon-hint">＋綠色＝行事曆有上但沒登記（點了補登）；－紅色＝登記了但這期行事曆沒出現（點了退課）。不確定的先放著沒關係。</div></div>`;
  }
  if(alumni.length){
    html+=`<div><div class="stu-scan-grp-lbl">歷屆生出現在課表（${alumni.length} 人）</div>`;
    alumni.forEach(({stu,courses})=>{
      html+=`<div class="stu-scan-exist-row">
        <div class="stu-scan-exist-name">${esc(stu.name)} <span class="stu-warn-chip" style="font-size:10px;background:#F8EDEA;color:#C0504A">⚠ 已${esc(stu.status||'')}</span></div>
        <div class="stu-scan-exist-grade">${esc(stu.grade)}</div>
        <div class="stu-scan-exist-courses">${courses.map(esc).join('、')}</div>
        <span style="font-size:11px;color:#C0504A">確定回來上課的話，先到歷屆分頁幫他復學，再對帳一次</span>
      </div>`;
    });
    html+=`</div>`;
  }
  if(ambiguous.length){
    html+=`<div><div class="stu-scan-grp-lbl">同名無法區分（${ambiguous.length} 筆）</div>`;
    ambiguous.forEach(({name,gradeHint,courses,matches})=>{
      const displayName=gradeHint?`${name}（${gradeHint}）`:name;
      html+=`<div class="stu-scan-exist-row">
        <div class="stu-scan-exist-name">${esc(displayName)} <span class="stu-warn-chip" style="font-size:10px">⚠ 同名</span></div>
        <div class="stu-scan-exist-courses">${courses.map(esc).join('、')}</div>
        <div style="font-size:11px;color:var(--tx3);margin-top:4px">名單中有 ${matches.length} 位同名學生，無法自動區分。請在行事曆備注加上年級，例如「（${esc(matches[0].grade)}）${esc(name)}」。</div>
      </div>`;
    });
    html+=`</div>`;
  }
  if(!unknown.length&&!ambiguous.length&&!alumni.length&&!diffs.length){
    html+=`<div class="recon-allclear">✓ 行事曆與登記簿完全一致（${okCount} 位在學生）</div>`;
  }else if(okCount>0){
    html+=`<div class="recon-ok-line">✓ 另有 ${okCount} 位在學生與登記簿一致</div>`;
  }
  html+=`</div></div>`;
  sec.innerHTML=html;
  sec.style.display='block';
  sec.scrollIntoView({behavior:'smooth',block:'nearest'});
}

// ── 對帳動作：每一條都是使用者點了才執行 ──
function reconCreateStudent(i){
  const item=_recon?.unknown[i];if(!item)return;
  const grade=document.getElementById(`recon-g-${i}`)?.value||item.gradeHint||'國二';
  const list=getStudentList();
  if(list.some(s=>s.name===item.name&&s.grade===grade)){
    return toast(`已有同名同年級「${item.name}（${grade}）」。若是不同人，請在行事曆備注加年級標注區分；若年級選錯，改選正確年級再建檔。`,'err');
  }
  const stu=makeNewStudent({name:item.name,grade});
  list.push(stu);
  saveStudentList(list);
  ensureEnrollments(stu.id,item.courses);
  renderScanSection();renderStudents();
  toast(`已建檔 ${item.name}（${grade}）並登記 ${item.courses.length} 門課`,'ok');
}

function reconEnroll(di,mi){
  const d=_recon?.diffs[di];if(!d)return;
  const title=d.missing[mi];if(title==null)return;
  ensureEnrollments(d.stu.id,[title]);
  renderScanSection();
  toast(`已補登記 ${d.stu.name}：${title}`,'ok');
}

function reconEnrollAll(di){
  const d=_recon?.diffs[di];if(!d)return;
  const n=ensureEnrollments(d.stu.id,d.missing);
  renderScanSection();
  toast(`已補登記 ${d.stu.name} 的 ${n} 門課`,'ok');
}

function reconUnenroll(di,xi){
  const d=_recon?.diffs[di];if(!d)return;
  const en=d.extra[xi];if(!en)return;
  if(!confirm(`確定退課？\n\n${d.stu.name} — ${en.courseTitle}\n\n這門課整個${getCurrentPeriod().label}的行事曆都沒出現他的名字。退課會移除這筆登記（含自訂單價）；之後可在學生編輯加回。`))return;
  saveEnrollments(getEnrollments().filter(x=>x.id!==en.id));
  renderScanSection();
  toast(`已退課：${d.stu.name} — ${en.courseTitle}`,'ok');
}

function closeScanSection(){
  scanData=null;_recon=null;
  document.getElementById('stu-scan-sec').style.display='none';
}

// ── 學生 CRUD：新增學生表單（「新增課程/學生」頁的學生分頁，欄位 2026-07-04 拍板）──
// 舊的學生管理行內快速表單（toggleAddStudentForm/addStudent）已由本表單取代（2026-07-04）
var asState=null;
function asBlank(){return{name:'',gradeSeg:'',grade:'',school:'',parentPhone:'',sourceChannel:'',note:'',dupAck:false};}
function asSetSeg(v){asState.gradeSeg=v;if(gradeDecompose(asState.grade).seg!==v)asState.grade='';renderAddStudentForm();}
function asSetYear(yr){asState.grade=gradeCompose(asState.gradeSeg,yr);}
function initAddStudentPage(){asState=asBlank();renderAddStudentForm();}

function asSet(f,v){asState[f]=v;if(f==='name')asState.dupAck=false;}
function asNameChange(){renderAddStudentForm();}  // blur 時重繪，讓同名警示浮出

function renderAddStudentForm(){
  const st=asState;
  const name=st.name.trim();
  // 同名判斷（拍板）：對到既有學生（不分年級/狀態）先亮警示，勾「確認是另一位」才放行
  const dups=name?getStudentList().filter(s=>s.name===name):[];
  const warn=dups.length?`<div class="stu-modal-warn">⚠ 已有 ${dups.length} 位同名學生：${dups.map(s=>`${esc(s.name)}（${esc(s.grade||'?')}・${esc(s.school||'學校未填')}・${esc(s.status||'在學')}）`).join('、')}。若是同一人請不要重複建檔（修課請從課程那邊加）。<label class="as-dup-ack"><input type="checkbox" ${st.dupAck?'checked':''} onchange="asState.dupAck=this.checked"> 我確認過了，要新增的是另一位新學生</label></div>`:'';
  document.getElementById('add-student-body').innerHTML=`
    ${warn}
    <div class="as-grid">
      <div class="cm-sec"><div class="cm-lbl">姓名（必填）</div><input class="cm-input" id="as-name" name="search-newstu" autocomplete="off" value="${esc(st.name)}" maxlength="20" oninput="asSet('name',this.value)" onchange="asNameChange()"></div>
      <div class="cm-sec"><div class="cm-lbl">年級（必選）</div>
        ${gradePickerHtml(st.gradeSeg,gradeDecompose(st.grade).yr,"asSetSeg(this.value)","asSetYear(this.value)")}
      </div>
      <div class="cm-sec"><div class="cm-lbl">學校</div><input class="cm-input" name="search-school" autocomplete="off" value="${esc(st.school)}" maxlength="20" oninput="asSet('school',this.value)"></div>
      <div class="cm-sec"><div class="cm-lbl">家長聯絡方式</div><input class="cm-input" name="search-contact" autocomplete="off" value="${esc(st.parentPhone)}" maxlength="30" oninput="asSet('parentPhone',this.value)"></div>
      <div class="cm-sec"><div class="cm-lbl">來源管道（怎麼知道補習班的）</div><input class="cm-input" name="search-channel" autocomplete="off" list="cf-channels" value="${esc(st.sourceChannel)}" placeholder="例：朋友介紹" oninput="asSet('sourceChannel',this.value)"></div>
    </div>
    <div class="cm-sec"><div class="cm-lbl">備註</div><textarea class="cm-input as-note" rows="2" oninput="asSet('note',this.value)">${esc(st.note)}</textarea></div>
    <div class="cf-foot"><span style="flex:1"></span><button class="btn btns btnp" onclick="asSubmit()">＋ 新增學生</button></div>`;
}

function asSubmit(){
  const st=asState;
  const name=st.name.trim();
  if(!name)return toast('請輸入學生姓名','err');
  if(!st.grade)return toast('請選擇年級——沒選年級的學生在學生管理頁會看不到','err');
  const list=getStudentList();
  const sameName=list.filter(s=>s.name===name);
  // 同名同年級且舊檔缺辨識資料 → 先補舊檔（沿用原本保護，避免之後分不清誰是誰）
  const sameGrade=sameName.filter(s=>s.grade===st.grade);
  if(sameGrade.length){
    const need=sameGrade.filter(s=>!s.school&&!s.parentPhone).length;
    if(need)return toast(`已有 ${sameGrade.length} 位同名同年級、其中 ${need} 位還沒補學校或家長電話。請先到學生管理幫舊檔補辨識資料再新增。`,'err');
  }
  if(sameName.length&&!st.dupAck){renderAddStudentForm();return toast('有同名學生，請先勾「確認是另一位新學生」','inf');}
  const stu=makeNewStudent({name,grade:st.grade,school:st.school.trim(),parentPhone:st.parentPhone.trim(),sourceChannel:st.sourceChannel.trim(),note:st.note.trim()});
  saveStudentList([...list,stu]);
  toast(`已新增 ${name}（${st.grade}）`,'ok');
  asState=asBlank();
  renderAddStudentForm();  // 清空重填，連續輸入下一筆
  document.getElementById('as-name')?.focus();
  renderStudents();
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

// 學生視窗「加入課程」狀態（雙向連結的學生側入口，與課程視窗「加入學生」寫同一筆 enrollment）
var _stuModalId=null;
var _stuAC=null;
function refreshStudentModal(){
  if(_stuModalId!=null&&document.getElementById('stu-modal-wrap').classList.contains('open'))openStudentModal(_stuModalId);
}

function openStudentModal(id){
  const list=getStudentList();
  const s=list.find(x=>x.id===id);
  if(!s)return;
  _stuModalId=id;
  _stuAC={courseId:null,price:'',subjects:[]};
  const stats=getStudentStats(s.id);
  document.getElementById('stu-modal-name').textContent=s.name;
  document.getElementById('stu-modal-grade').textContent=s.grade;
  const period=getCurrentPeriod();
  const threshold=getThreshold(currentPeriodId);
  const warnCourses=Object.entries(stats.byCourse).filter(([,c])=>c.type==='group'&&c.studentAbs>=threshold);
  const hasReschedules=Object.values(stats.byCourse).some(c=>c.reschedules>0);
  const leaveCnt=stats.pairs.filter(p=>p.absence.absType==='學生請假').length;
  const reschedCnt=stats.pairs.filter(p=>p.absence.absType==='調課').length;
  let body='';
  // B3 四格統計（請假／調課／欠課／加收半堂）
  body+=`<div class="stu-modal-grid">
    <div class="smg"><div class="smg-n">${leaveCnt}</div><div class="smg-l">請假</div></div>
    <div class="smg"><div class="smg-n">${reschedCnt}</div><div class="smg-l">調課</div></div>
    <div class="smg${stats.owed>0?' smg-owed':''}"><div class="smg-n">${stats.owed}</div><div class="smg-l">欠課</div></div>
    <div class="smg"><div class="smg-n">${stats.halfAdd}</div><div class="smg-l">加收半堂</div></div>
  </div>`;
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
  if(stats.noShow>0)extraBits.push(`<span style="color:#C0504A">曠課 ${stats.noShow} 次</span>`);
  if(stats.halfAdd>0)extraBits.push(`<span style="color:#C16B36">加收 +${stats.halfAdd} 堂</span>`);
  if(stats.halfDeduct>0)extraBits.push(`<span style="color:#5C7E6A">退費 −${stats.halfDeduct} 堂</span>`);
  if(stats.pendingDecision>0)extraBits.push(`<span style="color:var(--tx3)">待確認補課 ${stats.pendingDecision} 筆</span>`);
  if(extraBits.length)body+=`<div style="margin-top:8px;font-size:13px;display:flex;gap:12px;flex-wrap:wrap">${extraBits.join('')}</div>`;
  body+=`</div>`;
  // 修課（登記簿，含單價）；在學生多「加入課程」入口；沒有本期登記時退回舊 s.courses 顯示（歷屆生）
  const ens=getEnrollments({studentId:s.id,periodId:yearPeriodId()});
  const isActive=(s.status||'在學')==='在學';
  if(ens.length||isActive){
    const tags=ens.map(en=>stuCourseTagHtml(en)).join('')
      ||`<span style="font-size:12px;color:var(--tx3)">本期還沒有修課登記</span>`;
    body+=`<div><div class="stu-modal-sec-lbl">修課（${period.label}）</div>
      <div class="stu-courses">${tags}</div>
      ${isActive?'<div id="stu-ac-box"></div>':''}</div>`;
  }
  if(!ens.length){
    const displayCourses=(s.courses||[]).filter(c=>!/^【調課】/.test(c));
    if(displayCourses.length){
      body+=`<div><div class="stu-modal-sec-lbl">課程（舊紀錄）</div>
        <div class="stu-courses">${displayCourses.map(c=>`<span class="stu-course-tag">${esc(c)}</span>`).join('')}</div></div>`;
    }
  }
  // 成績（課堂成績歷史＋段考登記）——資料按期別 lazy 載入，先佔位、載完填入
  body+=`<div><div class="stu-modal-sec-lbl">成績（${period.label}）</div>
    <div id="stu-grades-sec"><div style="font-size:12px;color:var(--tx3)">載入中…</div></div></div>`;
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
  if(isActive)renderStuAddCourse(s.id);
  document.getElementById('stu-modal-wrap').classList.add('open');
  // 成績區：等 grades/exams 文件載完再填（已快取則立即）；載回時視窗可能已換人，比對 _stuModalId
  Promise.all([loadGrades(),loadExams()]).then(()=>{
    const el=document.getElementById('stu-grades-sec');
    if(el&&_stuModalId===id)el.innerHTML=buildStuGradesSec(s);
  });
}

function closeStudentModal(){
  document.getElementById('stu-modal-wrap').classList.remove('open');
  _stuModalId=null;_stuAC=null;
}

// ── 學生視窗成績區：課堂成績歷史（唯讀彙整）＋段考成績（手動登記）──
var STU_EXAM_NAMES=['一段','二段','三段'];
var _stuExamPick='一段'; // 段考次別選擇（跨重繪記住，連續登同一段考的多科不用重選）
function buildStuGradesSec(s){
  // 課堂成績：本期 grades 依 studentId 彙整，新的在上；課名從課堂合成 id 反查
  const courseName=r=>{
    const m=String(r.eventId).match(/^sys:(\d+):/);
    const co=m?findCourseById(Number(m[1])):null;
    return co?co.name:'課堂';
  };
  const recs=gradesBucket().records.filter(r=>r.studentId===s.id)
    .sort((a,b)=>new Date(b.date)-new Date(a.date));
  const classRows=recs.map(r=>{
    const d=new Date(r.date);
    return`<div class="stu-gr-row"><span class="stu-gr-date">${d.getMonth()+1}/${d.getDate()}</span><span class="stu-gr-course">${esc(courseName(r))}</span><span class="gr-chip">${esc(r.label||'成績')}${r.score!=null?` <b>${r.score}</b>`:''}</span></div>`;
  }).join('')||`<div style="font-size:12px;color:var(--tx3)">本期還沒有課堂成績（在課程頁的課卡「✎ 成績」登記）</div>`;
  // 段考：次別點選（一段/二段/三段），顯示按段考分組（一段一列）
  const byExam=new Map();
  getExams(s.id).forEach(x=>{
    const n=x.examName||'未填';
    if(!byExam.has(n))byExam.set(n,[]);
    byExam.get(n).push(x);
  });
  const exOrder=n=>{const i=STU_EXAM_NAMES.indexOf(n);return i<0?99:i;};
  const examRows=[...byExam.entries()].sort((a,b)=>exOrder(a[0])-exOrder(b[0])).map(([name,list])=>
    `<div class="prac-grade-row"><span class="prac-grade">${esc(name)}</span><span style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${
      list.map(x=>`<span class="gr-chip">${esc(x.subject||'成績')}${x.score!=null?` <b>${x.score}</b>`:''}<button class="gr-x" title="刪除" onclick="stuExamRemove(${x.id})">✕</button></span>`).join('')
    }</span></div>`).join('');
  const addRow=`<span class="gr-add" style="margin-left:0">
    <select id="stu-exam-name" onchange="_stuExamPick=this.value">${STU_EXAM_NAMES.map(n=>`<option${n===_stuExamPick?' selected':''}>${n}</option>`).join('')}</select>
    <input class="gr-lab" id="stu-exam-subj" style="width:72px" placeholder="科目" maxlength="8" autocomplete="off" name="search-examsubj">
    <input class="gr-sc" id="stu-exam-score" type="number" inputmode="numeric" placeholder="分數" onkeydown="if(event.key==='Enter'){event.preventDefault();stuExamAdd(${s.id})}">
    <button class="att-min ok" title="登記" onclick="stuExamAdd(${s.id})">✓</button></span>`;
  return`<div class="stu-gr-lbl">課堂成績</div><div class="stu-gr-list">${classRows}</div>
    <div class="stu-gr-lbl" style="margin-top:10px">段考成績</div>
    ${examRows}<div style="margin-top:6px">${addRow}</div>`;
}
function _refreshStuGradesSec(){
  const s=getStudentList().find(x=>x.id===_stuModalId);
  const el=document.getElementById('stu-grades-sec');
  if(el&&s)el.innerHTML=buildStuGradesSec(s);
}
function stuExamAdd(sid){
  const name=(document.getElementById('stu-exam-name')?.value||'').trim()||_stuExamPick;
  const subj=(document.getElementById('stu-exam-subj')?.value||'').trim();
  const sc=(document.getElementById('stu-exam-score')?.value||'').trim();
  if(!subj&&sc==='')return toast('至少填科目或分數','inf');
  if(sc!==''&&isNaN(Number(sc)))return toast('分數要是數字','inf');
  addExam(sid,name,subj,sc===''?null:Number(sc));
  _refreshStuGradesSec();
  document.getElementById('stu-exam-subj')?.focus(); // 同一次段考連續登下一科
}
function stuExamRemove(examId){
  const rec=examsBucket().records.find(r=>r.id===examId);
  if(!rec)return;
  const label=`${rec.examName}${rec.subject?'・'+rec.subject:''}${rec.score!=null?' '+rec.score+' 分':''}`;
  if(!confirm(`刪除段考成績「${label}」？`))return;
  removeExam(examId);
  _refreshStuGradesSec();
}

// ── 學生視窗：修課 tag 一顆 ──
// 系統課（courseId）：預設價在課程本體、不查價目表；練習課顯示科目、試聽標示不收費；可直接退課（✕）
// 行事曆課（courseId=null）：維持原樣（價目表＋個人覆蓋），加退走學生編輯面板
function stuCourseTagHtml(en){
  const co=en.courseId!=null?findCourseById(en.courseId):null;
  let priceStr;
  if(co&&co.type==='試聽')priceStr='試聽・不收費';
  else if(co&&co.type==='練習課')priceStr=en.practiceSubject?esc(en.practiceSubject):'練習課';
  else{
    const p=co?(en.price??co.defaultPrice):effectivePrice(en);
    priceStr=p!=null?`${p} 元/堂${en.price!=null?'・自訂':''}`:'未定價';
  }
  const undef=priceStr==='未定價';
  const x=co?`<button class="co-stu-x" title="退課" onclick="coRemoveEnroll(${en.id})">✕</button>`:'';
  return`<span class="stu-course-tag">${esc(en.courseTitle)}<span class="stu-course-price${undef?' undef':''}">${priceStr}</span>${x}</span>`;
}

// ── 學生視窗：「加入課程」盒（選系統課 → 依課型補欄 → 寫入 enrollment）──
function renderStuAddCourse(sid){
  const box=document.getElementById('stu-ac-box');
  if(!box)return;
  const pid=yearPeriodId();
  const enrolledCids=new Set(getEnrollments({studentId:sid,periodId:pid}).filter(en=>en.courseId!=null).map(en=>en.courseId));
  const avail=getCourses().filter(co=>!enrolledCids.has(co.id))
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh-Hant'));
  if(!avail.length){
    box.innerHTML=getCourses().length
      ?`<div class="cm-hint">系統課程都已加入。</div>`
      :`<div class="cm-hint">還沒有系統課程可加入（到「新增課程/學生」頁建立）。</div>`;
    return;
  }
  const st=_stuAC;
  const co=st.courseId!=null?findCourseById(st.courseId):null;
  // 選項附類型／老師／時段：平行分班課名可能相同（三班都叫國二數學班），靠這行分辨
  const opts=avail.map(c=>{
    const slot=sysSlotLabel(c);
    return`<option value="${c.id}" ${st.courseId===c.id?'selected':''}>${esc(c.name)}（${c.type}・${esc(teacherNameById(c.teacherId)||'未指定')}${slot?'・'+esc(slot):''}）</option>`;
  }).join('');
  let extra='';
  if(co){
    if(co.type==='練習課'){
      const common=CF_PRAC_SUBJECTS.map(x=>stuAcSubjBtn(x,st.subjects.includes(x))).join('');
      const customs=st.subjects.filter(x=>!CF_PRAC_SUBJECTS.includes(x)).map(x=>stuAcSubjBtn(x,true)).join('');
      extra=`<div class="cm-lbl" style="margin-top:8px">練習科目（點選，可多個）</div>
        <div class="cf-subj-tags">${common}${customs}<input class="cf-subj-add" list="cf-subjects" placeholder="＋其他" onkeydown="if(event.key==='Enter'){event.preventDefault();stuAcAddSubj(this)}"></div>`;
    }else if(co.type==='試聽'){
      extra=`<div class="cm-hint">試聽不收費、不進學費結算。</div>`;
    }else{
      const ph=co.defaultPrice!=null?`預設 ${co.defaultPrice}`:'未定價';
      extra=`<div class="cm-price-row" style="margin-top:8px">
        <input type="number" class="cm-input cm-price" min="0" inputmode="numeric" placeholder="${ph}" value="${esc(String(st.price))}" oninput="_stuAC.price=this.value">
        <span class="cm-unit">元 / 堂（留空＝用課程預設價）</span></div>`;
    }
  }
  box.innerHTML=`<div class="co-add">
    <select class="co-add-sel" onchange="stuAcPick(this.value)">
      <option value="" ${st.courseId==null?'selected':''}>＋ 加入課程…</option>${opts}
    </select>
    ${co?`<button class="co-add-btn" onclick="stuAcSubmit(${sid})">＋ 加入</button>`:''}
  </div>${extra}`;
}
function stuAcPick(v){
  _stuAC.courseId=v?parseInt(v,10):null;
  _stuAC.price='';_stuAC.subjects=[];
  renderStuAddCourse(_stuModalId);
}
function stuAcSubjBtn(subj,on){
  const a=JSON.stringify(String(subj)).replace(/"/g,'&quot;');
  return`<button type="button" class="cf-subj-tog${on?' on':''}" onclick="stuAcToggleSubj(${a})">${esc(subj)}</button>`;
}
function stuAcToggleSubj(subj){
  const i=_stuAC.subjects.indexOf(subj);
  if(i>=0)_stuAC.subjects.splice(i,1);else _stuAC.subjects.push(subj);
  renderStuAddCourse(_stuModalId);
}
function stuAcAddSubj(inp){
  const s=(inp.value||'').trim();
  if(!s)return;
  if(!_stuAC.subjects.includes(s))_stuAC.subjects.push(s);
  inp.value='';
  renderStuAddCourse(_stuModalId);
}
function stuAcSubmit(sid){
  const co=_stuAC&&_stuAC.courseId!=null?findCourseById(_stuAC.courseId):null;
  if(!co)return;
  const pid=yearPeriodId();
  if(getEnrollments({studentId:sid,periodId:pid}).some(en=>en.courseId===co.id))return toast('已在這門課的名單裡','inf');
  const noFee=(co.type==='練習課'||co.type==='試聽');
  const v=String(_stuAC.price??'').trim();
  const price=noFee||v===''?null:Math.max(0,parseInt(v,10)||0);
  const list=getEnrollments().slice();
  list.push(makeEnrollment({
    studentId:sid,courseTitle:co.name,periodId:pid,courseId:co.id,
    price,practiceSubject:co.type==='練習課'?_stuAC.subjects.join('、'):'',
  }));
  saveEnrollments(list);
  toast(`已加入 ${studentName(sid)}：${co.name}`,'ok');
  renderSettings();        // 課程總覽人數／名單跟著更新
  refreshCourseModal();
  openStudentModal(sid);   // 重繪學生視窗（新課即時出現，選擇器歸零）
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
  saveEnrollments(ens);   // 寫回登記簿 + 即時重繪課程卡（不必手動按更新）
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
    <div class="stu-edit-danger">
      <button class="stu-edit-del-btn" onclick="openDeleteModal(${s.id})">🗑️ 徹底刪除此學生</button>
      <span class="stu-edit-danger-hint">永久移除（含所有學期的修課登記），不可復原。給清測試帳號／重複資料用。</span>
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

// ── 徹底刪除學生（硬刪除，不可復原）──
// 與「變更狀態」的軟刪除不同：軟刪除只改 status 搬到歷屆、資料還在；
// 這裡把學生本人 + 其所有學期的修課登記從 Firestore 永久移除，給清測試帳號／重複資料用。
// 注意：makeupScheduled 以名字字串記缺席者、無 id 連結，不在此清理（屬 Calendar 衍生的歷史，另循對帳/北極星處理）。
var deleteModalCtx={studentId:null};
function openDeleteModal(studentId){
  const s=getStudentList().find(x=>x.id===studentId);
  if(!s)return;
  deleteModalCtx={studentId};
  const enrollCount=getEnrollments().filter(e=>e.studentId===studentId).length;
  document.getElementById('delete-modal-info').innerHTML=
    `即將永久刪除 <b>${esc(s.name)}（${esc(s.grade)}）</b>，連同其 <b>${enrollCount}</b> 筆修課登記（所有學期）。<br>此動作<b>不可復原</b>，也不會進歷屆。`;
  document.getElementById('delete-modal-confirm').value='';
  document.getElementById('delete-modal-wrap').classList.add('open');
  requestAnimationFrame(()=>document.getElementById('delete-modal-confirm')?.focus());
}
function closeDeleteModal(){
  document.getElementById('delete-modal-wrap').classList.remove('open');
  deleteModalCtx={studentId:null};
}
function confirmDeleteStudent(){
  const s=getStudentList().find(x=>x.id===deleteModalCtx.studentId);
  if(!s)return;
  const typed=document.getElementById('delete-modal-confirm').value.trim();
  if(typed!==s.name)return toast(`請輸入「${s.name}」以確認刪除`,'err');
  saveStudentList(getStudentList().filter(x=>x.id!==s.id));
  saveEnrollments(getEnrollments().filter(e=>e.studentId!==s.id));
  closeDeleteModal();
  stuEditId=null;_editEnrollments=[];
  renderStudents();
  toast(`已徹底刪除 ${s.name}（${s.grade}）`,'ok');
}

// ── 升年級批次 ──
// 國一~高二自動 +1
// 國三→高一（多數會繼續補高中，例外手動改）
// 高三→畢業（設 status='畢業'，例外手動復學）
// 國小、大學跳過（國小不分年級無法判斷；大學是頂層）
function batchPromoteGrade(){
  const GRADE_NEXT={'國小一':'國小二','國小二':'國小三','國小三':'國小四','國小四':'國小五','國小五':'國小六','國小六':'國一','國一':'國二','國二':'國三','國三':'高一','高一':'高二','高二':'高三'};
  const SKIP=['大學','國小'];  // 大學已頂層；裸「國小」＝舊資料未分年、無法自動升
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
  const skipMsg=skipped.length?`\n\n${skipped.length} 位跳過（大學已頂層、或舊資料未分年級的「國小」）`:'';
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
