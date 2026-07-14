// 系統自有課表（開發路線 ① 第 1 步，schema 2026-07-04 拍板，見 mds/資料結構.md「系統自有課表」）
// courses / teachers 存取 + 新增課程表單 + 系統課程詳情 modal。
// 全部只寫 driveData（Firestore），不寫回 Google Calendar——系統自己是唯一真相。
// 設計原則「旋鈕不是箱子」：不先選類別，填自由欄位（學生/科目/老師/排法），
// 系統自動判型、自動命名；課名可手改，類型 chips 點選可鎖定覆蓋。

// ── 存取 helpers ──
function getCourses(){return driveData.courses||[];}
function saveCourses(list){driveData.courses=list;scheduleDriveSave();}
function getTeachers(){return driveData.teachers||[];}
function saveTeachers(list){driveData.teachers=list;scheduleDriveSave();}
function teacherNameById(id){const t=getTeachers().find(t=>t.id===id);return t?t.name:'';}
function findCourseById(id){return getCourses().find(c=>c.id===id);}

// 週選項自帶一份，不在載入期依賴 settings.js 的 WEEK_ORDER/WEEK_LABEL（script 載入順序防呆）
var CF_WEEKDAYS=[[1,'週一'],[2,'週二'],[3,'週三'],[4,'週四'],[5,'週五'],[6,'週六'],[0,'週日']];
var CF_WD_LABEL={1:'週一',2:'週二',3:'週三',4:'週四',5:'週五',6:'週六',0:'週日'};
var CF_TYPES=['一對一','一對二','團班','練習課','試聽'];
// 練習課常用科目（點選式多選，另可加自訂）
var CF_PRAC_SUBJECTS=['數學','理化','物理','化學','生物','英文','國文'];

// ── 新增課程表單狀態 ──
var cfState=null;

function cfBlank(){
  return{
    target:'modal',         // 'page'＝新增頁（送出後清空連續輸入）；'modal'＝課程總覽的編輯視窗
    editId:null,            // null＝建立；有值＝編輯既有課程
    students:[],            // 初始名單（studentId 陣列）；編輯模式不在表單動名單
    practiceSubjects:{},    // studentId → 練習科目字串（多科用「、」分隔，判型為練習課時）
    stuInput:'',            // 學生輸入框當前文字（打字自動完成）
    stuMatches:null,        // 同名多筆時待選的 studentId 陣列；null＝無歧義
    pendingStu:null,        // 打的名字不在系統 → 現場建檔的暫存 {name,gradeSeg,grade,school,parentPhone}
    subject:'',
    pinnedType:null,        // null＝自動判型；點類型 chip 鎖定覆蓋
    name:'',nameTouched:false,
    teacherName:'',         // 老師以姓名輸入（自動完成）；存檔時對既有老師、對不到就建檔
    teacherRate:'',
    mode:'weekly',
    slots:[{weekday:1,start:'',end:'',date:''}], // 兩種 mode 共用欄位，存檔時只取需要的
    room:'',
    defaultPrice:'',
    needsGrade:false,needsGradeTouched:false,
    sourceChannel:'',
  };
}

function openCourseForm(courseId){
  if(courseId!=null){
    const co=findCourseById(courseId);
    if(!co)return;
    cfState={...cfBlank(),editId:co.id,subject:co.subject||'',
      pinnedType:co.type||null,name:co.name,nameTouched:true,
      teacherName:teacherNameById(co.teacherId)||'',teacherRate:co.teacherRate??'',
      mode:co.schedule?.mode||'weekly',
      slots:(co.schedule?.slots||[]).map(s=>({weekday:s.weekday??1,start:s.start||'',end:s.end||'',date:s.date||''})),
      room:co.room||'',defaultPrice:co.defaultPrice??'',
      needsGrade:!!co.needsGrade,needsGradeTouched:true,
      sourceChannel:co.sourceChannel||''};
    if(!cfState.slots.length)cfState.slots=[{weekday:1,start:'',end:'',date:''}];
  }else cfState=cfBlank();
  renderCourseForm();
  document.getElementById('cf-modal-wrap').classList.add('open');
}
function closeCourseForm(){document.getElementById('cf-modal-wrap').classList.remove('open');cfState=null;}

// ── 自動判型 ──
// 規則：鎖定優先 → 科目「練習」＝練習課 → 指定日期＋1 人＝試聽 → 1 人一對一、2 人一對二、其餘團班
function cfType(){
  const st=cfState;
  if(st.pinnedType)return st.pinnedType;
  if(st.subject.trim()==='練習')return'練習課';
  if(st.mode==='dates'&&st.students.length===1)return'試聽';
  if(st.students.length===1)return'一對一';
  if(st.students.length===2)return'一對二';
  return'團班';
}

// 把一個學生的練習科目字串（可能「數學、理化」）拆成陣列
function cfSubjList(sid){return (cfState.practiceSubjects[sid]||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean);}

// 練習課命名（#7 規則）：
//   1 人 → 「(名)(科目)練習課」
//   ≥2 人且全班同一科 → 「(名)(名)…(科目)練習課」（≤2 列名，3+ 用最多人年級）
//   ≥2 人但科目不同 → 「(名)(名)練習課」（≤2 列名，3+ 用最多人年級或週別）
function cfPracticeName(){
  const st=cfState;
  const ids=st.students;
  if(!ids.length){const wd=st.mode==='weekly'&&st.slots.length?(CF_WD_LABEL[st.slots[0].weekday]||''):'';return wd+'練習課';}
  const names=ids.map(id=>studentName(id));
  const subjSet=new Set();ids.forEach(id=>cfSubjList(id).forEach(s=>subjSet.add(s)));
  const subjStr=[...subjSet].join('、');
  if(ids.length===1)return names[0]+subjStr+'練習課';
  const head=ids.length<=2?names.join(''):cfTopGrade();
  if(subjSet.size===1)return head+subjStr+'練習課';   // 全班同一科
  return head+'練習課';                                  // 科目不同，不掛科目
}
// 名單裡最多人的年級
function cfTopGrade(){
  const cnt={};
  cfState.students.forEach(id=>{const s=getStudentList().find(s=>s.id===id);if(s&&s.grade)cnt[s.grade]=(cnt[s.grade]||0)+1;});
  return Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
}

// ── 自動命名（規則見資料結構.md courses.name）──
// 資料還不夠命名時回空字串，不要生出「班」「家教」這種殘字掛在課名欄
function cfAutoName(){
  const t=cfType();
  const subj=cfState.subject.trim()==='練習'?'':cfState.subject.trim();
  const names=cfState.students.map(id=>studentName(id));
  if(t==='練習課')return cfPracticeName();
  if(t==='試聽'){const s=(names[0]||'')+subj;return s?s+'試聽':'';}
  if(t==='一對一'){const s=(names[0]||'')+subj;return s?s+'家教':'';}
  if(t==='一對二'){const s=names.slice(0,2).join('')+subj;return s?s+'班':'';}
  const s=cfTopGrade()+subj;
  return s?s+'班':'';
}

// 費率單位隨型：家教按時數、團班按人頭、試聽（與補課）固定一筆
function cfRateUnit(t){return t==='一對一'||t==='一對二'?'元／小時':t==='團班'?'元／人／堂':'元／堂';}

// ── 學生輸入：打字自動完成 → 對到既有學生加入；對不到就現場建檔 ──
function cfStuInput(v){cfState.stuInput=v;}
function cfResolveStudent(){
  const st=cfState,q=(st.stuInput||'').trim();
  if(!q)return;
  const matches=getStudentList({activeOnly:true}).filter(s=>s.name===q&&!st.students.includes(s.id));
  if(matches.length===1)return cfPickStudent(matches[0].id);
  if(matches.length>1){st.stuMatches=matches.map(s=>s.id);st.pendingStu=null;return renderCourseForm();}
  // 系統查無此人 → 開現場建檔小表單（名字帶入）
  st.stuMatches=null;
  st.pendingStu={name:q,gradeSeg:'',grade:'',school:'',parentPhone:''};
  renderCourseForm();
}
function cfPickStudent(sid){
  cfState.students.push(sid);
  cfState.stuInput='';cfState.stuMatches=null;cfState.pendingStu=null;
  cfAfterTypeAffecting();
}
function cfCancelStuAdd(){cfState.stuMatches=null;cfState.pendingStu=null;renderCourseForm();}
function cfPendingSet(f,v){cfState.pendingStu[f]=v;}
function cfPendingSeg(v){cfState.pendingStu.gradeSeg=v;if(gradeDecompose(cfState.pendingStu.grade).seg!==v)cfState.pendingStu.grade='';renderCourseForm();}
function cfPendingYear(yr){cfState.pendingStu.grade=gradeCompose(cfState.pendingStu.gradeSeg,yr);}
// 現場建檔：走 makeNewStudent（與新增學生頁同一入口，欄位一致、資料不出入）→ 建好即加入本課
function cfCreatePendingStudent(){
  const p=cfState.pendingStu,name=(p.name||'').trim();
  if(!name)return;
  if(!p.grade)return toast('請先選年級（沒年級的學生在管理頁會看不到）','err');
  const stu=makeNewStudent({name,grade:p.grade,school:(p.school||'').trim(),parentPhone:(p.parentPhone||'').trim()});
  saveStudentList([...getStudentList(),stu]);
  toast(`已建檔並加入 ${name}（${p.grade}）`,'ok');
  cfPickStudent(stu.id);
}
function cfRemoveStudent(sid){
  cfState.students=cfState.students.filter(id=>id!==sid);
  delete cfState.practiceSubjects[sid];
  cfAfterTypeAffecting();
}
function cfSetPracSubj(sid,v){cfState.practiceSubjects[sid]=v.trim();cfSyncAutoName();}
// 練習科目多選：點常用科目 toggle 加/減，或加自訂科目（都存回「、」分隔字串）
function cfTogglePracSubj(sid,subj){
  const list=cfSubjList(sid);
  const i=list.indexOf(subj);
  if(i>=0)list.splice(i,1);else list.push(subj);
  cfState.practiceSubjects[sid]=list.join('、');
  cfSyncAutoName();renderCourseForm();
}
function cfAddCustomPracSubj(sid,v){
  const s=(v||'').trim();if(!s)return;
  const list=cfSubjList(sid);
  if(!list.includes(s))list.push(s);
  cfState.practiceSubjects[sid]=list.join('、');
  cfSyncAutoName();renderCourseForm();
}
// 一顆科目 toggle 鈕（subj 可能是使用者自訂字串，做 JSON escape 防引號炸掉 onclick）
function cfSubjTogBtn(sid,subj,on){
  const a=JSON.stringify(String(subj)).replace(/"/g,'&quot;');
  return`<button type="button" class="cf-subj-tog${on?' on':''}" onclick="cfTogglePracSubj(${sid},${a})">${esc(subj)}</button>`;
}
function cfSubjectInput(v){cfState.subject=v;cfSyncAutoName();}
function cfSubjectChange(){cfAfterTypeAffecting();}
function cfPinType(t){cfState.pinnedType=cfState.pinnedType===t?null:t;cfAfterTypeAffecting();}
function cfNameInput(v){
  if(v.trim()===''){cfState.nameTouched=false;cfState.name=cfAutoName();return;} // 清空＝回到自動命名
  cfState.name=v;cfState.nameTouched=true;
}
function cfTeacherInput(v){cfState.teacherName=v;}
function cfRateInput(v){cfState.teacherRate=v;}
function cfSetMode(m){if(cfState.mode!==m){cfState.mode=m;cfAfterTypeAffecting();}}
function cfSlotSet(i,f,v){cfState.slots[i][f]=v;if(f==='weekday')cfSyncAutoName();}
function cfAddSlot(){cfState.slots.push({weekday:1,start:'',end:'',date:''});renderCourseForm();}
function cfDelSlot(i){
  cfState.slots.splice(i,1);
  if(!cfState.slots.length)cfState.slots.push({weekday:1,start:'',end:'',date:''});
  renderCourseForm();
}
function cfRoomChange(v){cfState.room=v;}
function cfPriceInput(v){cfState.defaultPrice=v;}
function cfGradeToggle(on){cfState.needsGrade=on;cfState.needsGradeTouched=true;renderCourseForm();}
function cfChannelInput(v){cfState.sourceChannel=v;}

// 判型可能變了：練習課自動打開「需登記成績」（手動動過就不搶），然後重繪
function cfAfterTypeAffecting(){
  if(!cfState.needsGradeTouched)cfState.needsGrade=(cfType()==='練習課');
  renderCourseForm();
}
// 沒手改過課名時，讓課名跟著欄位長
function cfSyncAutoName(){
  if(cfState.nameTouched)return;
  cfState.name=cfAutoName();
  const el=document.getElementById('cf-name');
  if(el)el.value=cfState.name;
}

// ── 表單渲染（載點二選一：新增頁 add-course-body / 編輯 modal cf-modal-body）──
function renderCourseForm(){
  const st=cfState,t=cfType(),edit=st.editId!=null,onPage=st.target==='page';
  if(!st.nameTouched)st.name=cfAutoName();
  if(!onPage)document.getElementById('cf-modal-title').textContent=edit?'✎ 編輯課程':'＋ 新增課程';
  const noFee=(t==='練習課'||t==='試聽');

  // 學生：建立時＝初始名單；編輯模式名單改在課程視窗加退（同一筆 enrollment，避免兩處打架）
  let stuSec;
  if(edit){
    stuSec=`<div class="cm-sec"><div class="cm-lbl">名單</div><div class="cm-hint">名單加退在課程總覽點這門課的視窗裡操作，這裡只改課程本身。</div></div>`;
  }else{
    const chosen=new Set(st.students);
    // 自動完成清單：未選的在學學生（value＝姓名，選項文字附年級）
    const dlOpts=getStudentList({activeOnly:true})
      .filter(s=>!chosen.has(s.id))
      .sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh-Hant'))
      .map(s=>`<option value="${esc(s.name)}">${esc(s.name)}（${esc(s.grade||'')}）</option>`).join('');
    let chips;
    if(t==='練習課'){
      // 練習課：每位學生一列，科目用可點選標籤（多選）＋自訂
      const rows=st.students.map(sid=>{
        const s=getStudentList().find(x=>x.id===sid);
        const cur=cfSubjList(sid);
        const common=CF_PRAC_SUBJECTS.map(subj=>cfSubjTogBtn(sid,subj,cur.includes(subj))).join('');
        const customs=cur.filter(x=>!CF_PRAC_SUBJECTS.includes(x)).map(x=>cfSubjTogBtn(sid,x,true)).join('');
        return`<div class="cf-prac-row">
          <div class="cf-prac-hd"><b>${esc(s?s.name:'（已刪除）')}</b><span class="cf-chip-g">${esc(s?.grade||'')}</span><button class="co-stu-x" title="移除學生" onclick="cfRemoveStudent(${sid})">✕</button></div>
          <div class="cf-subj-tags">${common}${customs}<input class="cf-subj-add" list="cf-subjects" placeholder="＋其他" onkeydown="if(event.key==='Enter'){event.preventDefault();cfAddCustomPracSubj(${sid},this.value);this.value=''}"></div>
        </div>`;
      }).join('');
      chips=rows?`<div class="cf-prac-list">${rows}</div>`:'';
    }else{
      const inline=st.students.map(sid=>{
        const s=getStudentList().find(x=>x.id===sid);
        return`<span class="cf-chip">${esc(s?s.name:'（已刪除）')}<span class="cf-chip-g">${esc(s?.grade||'')}</span><button class="co-stu-x" title="移除" onclick="cfRemoveStudent(${sid})">✕</button></span>`;
      }).join('');
      chips=inline?`<div class="cf-chips">${inline}</div>`:'';
    }
    // 同名多筆 → 選是哪一位；或都不是就建新檔
    let extra='';
    if(st.stuMatches){
      extra=`<div class="cf-resolve"><div class="cf-resolve-lbl">系統有多位「${esc(st.stuInput)}」，是哪一位？</div>
        ${st.stuMatches.map(id=>{const s=getStudentList().find(x=>x.id===id);return`<button class="btn btns" onclick="cfPickStudent(${id})">${esc(s.name)}（${esc(s.grade||'?')}・${esc(s.school||'學校未填')}）</button>`;}).join('')}
        <button class="btn btns" onclick="cfState.pendingStu={name:cfState.stuInput,gradeSeg:'',grade:'',school:'',parentPhone:''};cfState.stuMatches=null;renderCourseForm()">都不是，建新檔</button>
        <button class="btn btns" onclick="cfCancelStuAdd()">取消</button></div>`;
    }else if(st.pendingStu){
      const p=st.pendingStu;
      extra=`<div class="cf-resolve"><div class="cf-resolve-lbl">「${esc(p.name)}」不在系統 → 現場建檔並加入</div>
        <div class="as-grid">
          <div class="cm-sec"><div class="cm-lbl">姓名</div><input class="cm-input" value="${esc(p.name)}" oninput="cfPendingSet('name',this.value)"></div>
          <div class="cm-sec"><div class="cm-lbl">年級（必選）</div>${gradePickerHtml(p.gradeSeg,gradeDecompose(p.grade).yr,"cfPendingSeg(this.value)","cfPendingYear(this.value)")}</div>
          <div class="cm-sec"><div class="cm-lbl">學校</div><input class="cm-input" value="${esc(p.school)}" oninput="cfPendingSet('school',this.value)"></div>
          <div class="cm-sec"><div class="cm-lbl">家長聯絡方式</div><input class="cm-input" value="${esc(p.parentPhone)}" oninput="cfPendingSet('parentPhone',this.value)"></div>
        </div>
        <div class="cf-foot"><span style="flex:1"></span><button class="btn btns" onclick="cfCancelStuAdd()">取消</button><button class="btn btns btnp" onclick="cfCreatePendingStudent()">建檔並加入</button></div></div>`;
    }
    stuSec=`<div class="cm-sec"><div class="cm-lbl">學生（初始名單，之後隨時可加退）${t==='練習課'?'<span class="cm-hint" style="margin:0 0 0 6px">點科目可選多個</span>':''}<span class="cm-count">${st.students.length}</span></div>
      ${chips}
      <div class="co-add">
        <input class="co-add-sel" id="cf-stu-input" list="cf-students-dl" placeholder="輸入學生姓名…" value="${esc(st.stuInput||'')}" oninput="cfStuInput(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();cfResolveStudent()}">
        <datalist id="cf-students-dl">${dlOpts}</datalist>
        <button class="co-add-btn" onclick="cfResolveStudent()">＋ 加入</button>
      </div>
      ${extra}</div>`;
  }

  const subjSec=`<div class="cm-sec"><div class="cm-lbl">科目</div>
    <input class="cm-input" list="cf-subjects" value="${esc(st.subject)}" placeholder="例：數學（填「練習」＝練習課）" oninput="cfSubjectInput(this.value)" onchange="cfSubjectChange()">
  </div>`;

  const modeSec=`<div class="cm-sec"><div class="cm-lbl">排課</div>
    <div class="cf-mode">
      <label><input type="radio" name="cf-mode" value="weekly" ${st.mode==='weekly'?'checked':''} onchange="cfSetMode('weekly')"> 每週重複</label>
      <label><input type="radio" name="cf-mode" value="dates" ${st.mode==='dates'?'checked':''} onchange="cfSetMode('dates')"> 指定日期</label>
    </div>
    <div class="cf-slots">${st.slots.map((sl,i)=>`
      <div class="cf-slot">
        ${st.mode==='weekly'
          ?`<select onchange="cfSlotSet(${i},'weekday',parseInt(this.value,10))">${CF_WEEKDAYS.map(([v,l])=>`<option value="${v}" ${sl.weekday===v?'selected':''}>${l}</option>`).join('')}</select>`
          :`<input type="date" value="${esc(sl.date)}" onchange="cfSlotSet(${i},'date',this.value)">`}
        <input type="time" value="${esc(sl.start)}" onchange="cfSlotSet(${i},'start',this.value)">
        <span class="cf-slot-dash">–</span>
        <input type="time" value="${esc(sl.end)}" onchange="cfSlotSet(${i},'end',this.value)">
        <button class="co-stu-x" title="移除時段" onclick="cfDelSlot(${i})">✕</button>
      </div>`).join('')}
      <button class="cf-add-slot" onclick="cfAddSlot()">＋ 加時段</button>
    </div></div>`;

  // 老師：打字自動完成；查無此名 → 建立課程時一併建檔（與老師管理同一份 teachers）
  const teachers=getTeachers().filter(x=>(x.status||'在職')==='在職');
  const tDl=teachers.map(x=>`<option value="${esc(x.name)}">`).join('');
  const tKnown=st.teacherName.trim()&&teachers.some(x=>x.name===st.teacherName.trim());
  const tNewHint=st.teacherName.trim()&&!tKnown?`<div class="cm-hint">「${esc(st.teacherName.trim())}」不在系統，建立課程時會自動建檔為新老師。</div>`:'';
  const rateSec=t==='練習課'
    ?`<div class="cm-hint">練習課輔導老師薪資走打卡制，不在系統內設費率。</div>`
    :`<div class="cm-lbl" style="margin-top:12px">老師費率（薪資表用，可先空著）</div>
      <div class="cm-price-row"><input type="number" class="cm-input cm-price" min="0" inputmode="numeric" placeholder="未定" value="${st.teacherRate===''?'':esc(String(st.teacherRate))}" oninput="cfRateInput(this.value)"><span class="cm-unit">${cfRateUnit(t)}</span></div>`;
  const teacherSec=`<div class="cm-sec"><div class="cm-lbl">老師${t==='練習課'?'（預設輔導老師，當堂可換）':''}</div>
    <input class="cm-input" list="cf-teachers-dl" placeholder="輸入老師姓名…" value="${esc(st.teacherName)}" oninput="cfTeacherInput(this.value)" onchange="renderCourseForm()">
    <datalist id="cf-teachers-dl">${tDl}</datalist>
    ${tNewHint}
    ${rateSec}
  </div>`;

  const roomSec=`<div class="cm-sec"><div class="cm-lbl">教室</div>
    <select class="cm-input" onchange="cfRoomChange(this.value)">
      <option value="">不指定</option>
      ${TL_ROOMS.map(r=>`<option ${st.room===r?'selected':''}>${r}</option>`).join('')}
    </select></div>`;

  const priceSec=noFee
    ?`<div class="cm-sec"><div class="cm-lbl">每堂收費</div><div class="cm-hint">${t}不收費、不進學費結算。</div></div>`
    :`<div class="cm-sec"><div class="cm-lbl">每堂收費（課程預設價）</div>
      <div class="cm-price-row"><input type="number" class="cm-input cm-price" min="0" inputmode="numeric" placeholder="未定價" value="${st.defaultPrice===''?'':esc(String(st.defaultPrice))}" oninput="cfPriceInput(this.value)"><span class="cm-unit">元 / 堂</span></div>
      <div class="cm-hint">全班預設價，個別學生優惠之後在課程視窗覆蓋。</div></div>`;

  const gradeSec=`<div class="cm-sec"><label class="switch">
    <input type="checkbox" ${st.needsGrade?'checked':''} onchange="cfGradeToggle(this.checked)">
    <span class="switch-track"><span class="switch-thumb"></span></span>
    <span class="switch-label">${st.needsGrade?'需登記成績':'只點名'}</span>
  </label>${t==='練習課'?'<div class="cm-hint">練習課預設要登記成績（每堂考卷分數）。</div>':''}</div>`;

  const channelSec=t==='試聽'?`<div class="cm-sec"><div class="cm-lbl">來源管道（怎麼知道補習班的）</div>
    <input class="cm-input" list="cf-channels" value="${esc(st.sourceChannel)}" placeholder="例：朋友介紹" oninput="cfChannelInput(this.value)">
    <div class="cm-hint">之後正式報名，來源管道會跟著轉進學生檔。</div>
  </div>`:'';

  const typeChips=CF_TYPES.map(x=>`<button class="cf-type-chip${x===t?' on':''}${st.pinnedType===x?' pinned':''}" onclick="cfPinType('${x}')">${x}</button>`).join('');
  const nameSec=`<div class="cm-sec cf-verdict">
    <div class="cm-lbl">系統判定${st.pinnedType?'（已手動鎖定，再點一次解除）':'（自動，點類型可改）'}</div>
    <div class="cf-type-row">${typeChips}</div>
    <div class="cm-lbl" style="margin-top:12px">課名（自動命名，可直接改；清空＝回到自動）</div>
    <input class="cm-input" id="cf-name" value="${esc(st.name)}" placeholder="${esc(cfAutoName()||'選學生、填科目後自動命名')}" oninput="cfNameInput(this.value)">
  </div>`;

  const foot=onPage
    ?`<div class="cf-foot">
      <span style="flex:1"></span>
      <button class="btn btns" onclick="initAddCoursePage()">清空重填</button>
      <button class="btn btns btnp" onclick="cfSubmit()">＋ 建立課程</button>
    </div>`
    :`<div class="cf-foot">
      ${edit?`<button class="btn btns cf-danger" onclick="deleteCourse(${st.editId})">🗑 刪除</button>`:''}
      <span style="flex:1"></span>
      <button class="btn btns" onclick="closeCourseForm()">取消</button>
      <button class="btn btns btnp" onclick="cfSubmit()">${edit?'儲存變更':'建立課程'}</button>
    </div>`;

  document.getElementById(onPage?'add-course-body':'cf-modal-body').innerHTML=
    stuSec+subjSec+modeSec+teacherSec+roomSec+priceSec+gradeSec+channelSec+nameSec+foot;
}

// ── 存檔 ──
function cfSubmit(){
  const st=cfState,t=cfType();
  // 老師：以姓名對既有；查無此名 → 稍後建檔
  const tname=(st.teacherName||'').trim();
  if(!tname)return toast('請輸入老師','err');
  const name=(st.name||'').trim()||cfAutoName().trim();
  if(!name)return toast('課名不能是空的（選學生或填科目讓系統命名，或直接輸入）','err');
  // 時段：只收完整的
  const slots=st.slots
    .map(s=>st.mode==='weekly'
      ?{weekday:Number(s.weekday),start:s.start,end:s.end}
      :{date:s.date,start:s.start,end:s.end})
    .filter(s=>s.start&&s.end&&(st.mode==='weekly'?!isNaN(s.weekday):!!s.date));
  if(!slots.length)return toast(`至少要一個完整時段（${st.mode==='weekly'?'星期':'日期'}＋開始＋結束）`,'err');
  for(const s of slots)if(s.end<=s.start)return toast('結束時間要晚於開始時間','err');

  let teacher=getTeachers().find(x=>x.name===tname);
  let teacherId=teacher?teacher.id:null;
  if(!teacher){
    const nt={id:Date.now(),name:tname,status:'在職'};
    saveTeachers([...getTeachers(),nt]);
    teacherId=nt.id;
  }
  const noFee=(t==='練習課'||t==='試聽');
  const rec={
    id:st.editId??Date.now(),
    name,type:t,teacherId,
    teacherRate:t==='練習課'?null:(String(st.teacherRate).trim()===''?null:Math.max(0,parseInt(st.teacherRate,10)||0)),
    schedule:{mode:st.mode,slots},
    room:st.room||'',
    defaultPrice:noFee?null:(String(st.defaultPrice).trim()===''?null:Math.max(0,parseInt(st.defaultPrice,10)||0)),
    needsGrade:!!st.needsGrade,
    subject:st.subject.trim(),
    sourceChannel:t==='試聽'?st.sourceChannel.trim():'',
    status:'開課中',
    createdAt:new Date().toISOString(),
  };

  if(st.editId!=null){
    const list=getCourses().slice();
    const i=list.findIndex(c=>c.id===st.editId);
    if(i<0)return;
    rec.createdAt=list[i].createdAt;
    rec.status=list[i].status;
    // 改課名：courseId 才是 join key，courseTitle 只是顯示用 → 同步本課 enrollments 的顯示名
    if(list[i].name!==name)getEnrollments().forEach(en=>{if(en.courseId===rec.id)en.courseTitle=name;});
    list[i]=rec;
    saveCourses(list);
  }else{
    saveCourses([...getCourses(),rec]);
    // 初始名單 → enrollments（與課程視窗「加入學生」同一筆資料，雙向連結）
    if(st.students.length){
      const ens=getEnrollments().slice();
      st.students.forEach(sid=>ens.push(makeEnrollment({
        studentId:sid,courseTitle:name,periodId:yearPeriodId(),courseId:rec.id,
        practiceSubject:t==='練習課'?(st.practiceSubjects[sid]||''):'',
      })));
      saveEnrollments(ens);
    }
  }
  toast(st.editId!=null?`已更新「${name}」`:`已建立課程「${name}」`,'ok');
  if(st.target==='page'){initAddCoursePage();}  // 新增頁：清空重填，連續輸入下一筆
  else closeCourseForm();
  renderSettings();
  refreshCourseModal();
}

// ── 刪除課程（連同本課 enrollments；學生本人不動）──
function deleteCourse(id){
  const co=findCourseById(id);
  if(!co)return;
  const ens=getEnrollments().filter(en=>en.courseId===id);
  const times=sysSlotLabel(co)||'（未排時段）';
  if(!confirm(`刪除課程「${co.name}」？\n\n上課時間：\n${times.split('、').map(s=>'  ・'+s).join('\n')}\n\n會一併移除 ${ens.length} 筆修課登記。學生本人不會被刪。此操作無法復原。`))return;
  saveCourses(getCourses().filter(c=>c.id!==id));
  if(ens.length)saveEnrollments(getEnrollments().filter(en=>en.courseId!==id));
  toast(`已刪除「${co.name}」`,'ok');
  closeCourseForm();
  closeCourseModal();
  renderSettings();
}

// ── 新增頁（左側「新增課程/學生」獨立頁，進頁直接填、不開 modal）──
var addTabMode='course';
function initAddPage(){
  // 半途離開再回來：保留未送出的內容，只在狀態不存在（或被 modal 佔走）時重開空白表單
  if(!cfState||cfState.target!=='page')initAddCoursePage();else renderCourseForm();
  if(typeof asState==='undefined'||!asState)initAddStudentPage();else renderAddStudentForm();
  switchAddTab(addTabMode);
}
function initAddCoursePage(){cfState=cfBlank();cfState.target='page';renderCourseForm();}
function switchAddTab(mode){
  addTabMode=mode;
  document.getElementById('add-course-card').style.display=mode==='course'?'block':'none';
  document.getElementById('add-student-card').style.display=mode==='student'?'block':'none';
  document.getElementById('add-tab-course').classList.toggle('active',mode==='course');
  document.getElementById('add-tab-student').classList.toggle('active',mode==='student');
}
function goAddCourse(){switchPanel('add');switchAddTab('course');}
function goAddStudent(){switchPanel('add');switchAddTab('student');}

// ── 老師管理（設定頁）──
// 老師檔只有 id/姓名/狀態；「教哪些課」存在課程側（courses.teacherId），這裡反查顯示
function renderTeacherAdmin(){
  const box=document.getElementById('teacher-admin');
  if(!box)return;
  const rows=getTeachers().map(t=>{
    const used=getCourses().filter(c=>c.teacherId===t.id);
    const retired=(t.status||'在職')==='離職';
    const courseList=used.length?used.map(c=>c.name).join('、'):'（尚未指派課程）';
    return`<div class="ta-row${retired?' ta-retired':''}">
      <div class="ta-main">
        <div class="ta-line1">
          <input class="ta-name" value="${esc(t.name)}" maxlength="10" onchange="taRename(${t.id},this.value)" title="點擊直接改名">
          <button class="ta-status${retired?' off':''}" onclick="taToggleStatus(${t.id})" title="點擊切換在職/離職">${esc(t.status||'在職')}</button>
          <span class="ta-count">${used.length} 門課</span>
          <button class="co-stu-x" title="刪除老師" onclick="taDelete(${t.id})">✕</button>
        </div>
        <div class="ta-courses">${esc(courseList)}</div>
      </div>
    </div>`;
  }).join('');
  box.innerHTML=(rows||'<div class="co-empty">還沒有老師。在下方新增，或在新增課程表單裡順手建。</div>')+
    `<div class="co-add">
      <input class="cm-input" id="ta-new-name" placeholder="新老師姓名…" maxlength="10" onkeydown="if(event.key==='Enter'){event.preventDefault();taAdd()}">
      <button class="co-add-btn" onclick="taAdd()">＋ 新增</button>
    </div>`;
}
function taAdd(){
  const el=document.getElementById('ta-new-name');
  const name=(el&&el.value||'').trim();
  if(!name)return;
  if(getTeachers().some(t=>t.name===name))return toast('已有同名老師','inf');
  saveTeachers([...getTeachers(),{id:Date.now(),name,status:'在職'}]);
  toast(`已新增老師 ${name}`,'ok');
  renderTeacherAdmin();
}
function taRename(id,val){
  const name=(val||'').trim();
  const list=getTeachers().slice();
  const t=list.find(x=>x.id===id);
  if(!t)return;
  if(!name){renderTeacherAdmin();return toast('姓名不能是空的','err');}
  t.name=name;
  saveTeachers(list);
  toast(`已改名為 ${name}`,'ok');
  renderSettings();      // 課卡顯示的老師名跟著換（課程只存 id）
  renderTeacherAdmin();
}
function taToggleStatus(id){
  const list=getTeachers().slice();
  const t=list.find(x=>x.id===id);
  if(!t)return;
  t.status=(t.status||'在職')==='在職'?'離職':'在職';
  saveTeachers(list);
  toast(`${t.name}：${t.status}${t.status==='離職'?'（不再出現在新增課程的老師下拉）':''}`,'ok');
  renderTeacherAdmin();
}
function taDelete(id){
  const t=getTeachers().find(x=>x.id===id);
  if(!t)return;
  const used=getCourses().filter(c=>c.teacherId===id);
  if(used.length)return toast(`不能刪：${t.name} 還有 ${used.length} 門課掛著（${used.map(c=>c.name).join('、')}）。先在那些課的編輯裡改指老師、或刪除課程。`,'err');
  if(!confirm(`刪除老師「${t.name}」？此操作無法復原。`))return;
  saveTeachers(getTeachers().filter(x=>x.id!==id));
  toast(`已刪除老師 ${t.name}`,'ok');
  renderTeacherAdmin();
}

// ── 課程總覽整合：把系統課塞進週課表矩陣 ──
// weekly slot 合成「本週該星期」的 Date 讓矩陣排位；dates slot 用實際日期
function sysCourseSessions(co){
  const slots=co.schedule?.slots||[];
  const mon=new Date();mon.setHours(0,0,0,0);
  mon.setDate(mon.getDate()-((mon.getDay()+6)%7)); // 本週一
  return slots.map(sl=>{
    let d;
    if(co.schedule?.mode==='dates'&&sl.date){
      const[y,m,dd]=sl.date.split('-').map(Number);
      d=new Date(y,m-1,dd);
    }else{
      d=new Date(mon);
      d.setDate(mon.getDate()+((sl.weekday??1)+6)%7);
    }
    const[h,mi]=(sl.start||'0:0').split(':').map(Number);
    d.setHours(h||0,mi||0,0,0);
    return{date:d,students:[],groups:[],classroom:co.room,teacher:teacherNameById(co.teacherId)};
  });
}

// 卡片開關（系統課的 needsGrade 存課程本體，不走 courseSettings）
function toggleSysNeedsGrade(id,on){
  const list=getCourses().slice();
  const co=list.find(c=>c.id===id);
  if(!co)return;
  co.needsGrade=on;
  saveCourses(list);
  renderSettings();
}

// 系統課的名單加入（打字姓名 → 對既有學生；與表單初始名單、學生卡「加入課程」寫同一筆 enrollment）
function sysAddEnroll(btn,courseId){
  const inp=btn.parentElement.querySelector('.co-add-sel');
  const q=(inp&&inp.value||'').trim();
  if(!q)return;
  const co=findCourseById(courseId);
  if(!co)return;
  const enrolled=new Set(getEnrollments({periodId:yearPeriodId()}).filter(en=>en.courseId===courseId).map(en=>en.studentId));
  const matches=getStudentList({activeOnly:true}).filter(s=>s.name===q&&!enrolled.has(s.id));
  if(!matches.length)return toast(`系統查無在學學生「${q}」（要新學生請到「新增課程/學生」頁建檔）`,'err');
  if(matches.length>1)return toast(`有多位「${q}」，請到課程編輯或用完整辨識再加`,'inf');
  const sid=matches[0].id;
  const list=getEnrollments().slice();
  list.push(makeEnrollment({studentId:sid,courseTitle:co.name,periodId:yearPeriodId(),courseId}));
  saveEnrollments(list);
  toast(`已加入 ${studentName(sid)}：${co.name}`,'ok');
  renderSettings();
  refreshCourseModal();
}
function sysSetPracticeSubject(enId,val){
  const list=getEnrollments().slice();
  const en=list.find(e=>e.id===enId);
  if(!en)return;
  en.practiceSubject=val.trim();
  saveEnrollments(list);
}

// 時段標籤（modal meta 用）
function sysSlotLabel(co){
  const slots=co.schedule?.slots||[];
  if(co.schedule?.mode==='dates')
    return slots.map(s=>{
      if(!s.date)return'';
      const[y,m,d]=s.date.split('-').map(Number);
      return`${m}/${d} ${s.start}–${s.end}`;
    }).filter(Boolean).join('、');
  return slots.map(s=>`${CF_WD_LABEL[s.weekday]||''} ${s.start}–${s.end}`).join('、');
}

// ── 系統課程詳情 modal（settings.js renderCourseModal 分流過來）──
function renderSysCourseModal(ctx){
  const co=ctx.c.sys;
  document.getElementById('course-modal-title').textContent=co.name;
  const noFee=(co.type==='練習課'||co.type==='試聽');
  const isPractice=co.type==='練習課';
  const meta=[co.type,'👤 '+(teacherNameById(co.teacherId)||'未指定'),sysSlotLabel(co),co.room||''].filter(Boolean).join('　·　');

  const info=`<div class="cm-sec"><div class="cm-lbl">費用與薪資</div>
    <div class="cf-info-row">每堂收費：${noFee?'不收費（不進學費結算）':(co.defaultPrice!=null?co.defaultPrice+' 元/堂':'未定價')}</div>
    <div class="cf-info-row">老師費率：${isPractice?'打卡制（不在系統）':(co.teacherRate!=null?co.teacherRate+' '+cfRateUnit(co.type):'未定')}</div>
    ${co.type==='試聽'&&co.sourceChannel?`<div class="cf-info-row">來源管道：${esc(co.sourceChannel)}</div>`:''}
  </div>`;

  const ens=getEnrollments({periodId:yearPeriodId()}).filter(en=>en.courseId===co.id);
  const enrolledIds=new Set(ens.map(en=>en.studentId));
  const dlOpts=getStudentList({activeOnly:true})
    .filter(s=>!enrolledIds.has(s.id))
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh-Hant'))
    .map(s=>`<option value="${esc(s.name)}">${esc(s.name)}（${esc(s.grade||'')}）</option>`).join('');

  // 練習課：先按年級、再按科目分組的唯讀總覽（#7）
  let groupView='';
  if(isPractice&&ens.length){
    const byGrade={};
    ens.forEach(en=>{const g=(getStudentList().find(s=>s.id===en.studentId)||{}).grade||'未分年級';(byGrade[g]=byGrade[g]||[]).push(en);});
    const gradeOrder=(typeof GRADES!=='undefined'?GRADES:[]);
    const gkeys=Object.keys(byGrade).sort((a,b)=>{const ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return(ia<0?99:ia)-(ib<0?99:ib);});
    groupView=`<div class="cm-sec"><div class="cm-lbl">名單總覽（年級 → 科目）</div>`+gkeys.map(g=>{
      const bySubj={};
      byGrade[g].forEach(en=>{const subs=(en.practiceSubject||'').split(/[、,，]/).map(x=>x.trim()).filter(Boolean);(subs.length?subs:['（未填科目）']).forEach(s=>{(bySubj[s]=bySubj[s]||[]).push(studentName(en.studentId));});});
      return`<div class="pv-grade"><div class="pv-grade-hd">${esc(g)}</div>`+Object.entries(bySubj).map(([s,ns])=>`<div class="pv-subj"><span class="pv-subj-n">${esc(s)}</span>${esc(ns.join('、'))}</div>`).join('')+`</div>`;
    }).join('')+`</div>`;
  }

  const roster=ens.length
    ?`<div class="co-roster">`+ens.map(en=>{
        const p=en.price??co.defaultPrice; // 系統課預設價在課程本體，不查價目表
        const extra=isPractice
          ?`<input class="cf-chip-subj" list="cf-subjects" value="${esc(en.practiceSubject||'')}" placeholder="科目（多科用、分隔）" onchange="sysSetPracticeSubject(${en.id},this.value)">`
          :(noFee?'':`<span class="co-stu-price">${p==null?'<span class="co-undef">未定價</span>':p}</span>`);
        return`<span class="co-stu">${esc(studentName(en.studentId))}${extra}<button class="co-stu-x" title="退課" onclick="coRemoveEnroll(${en.id})">✕</button></span>`;
      }).join('')+`</div>`
    :`<div class="co-empty">還沒有學生。</div>`;
  const adder=`<div class="co-add">
    <input class="co-add-sel" id="sys-add-stu-${co.id}" list="sys-add-dl-${co.id}" placeholder="輸入學生姓名…">
    <datalist id="sys-add-dl-${co.id}">${dlOpts}</datalist>
    <button class="co-add-btn" onclick="sysAddEnroll(this,${co.id})">＋ 加入</button>
  </div>`;

  const btns=`<div class="cf-foot">
    <button class="btn btns" onclick="closeCourseModal();openCourseForm(${co.id})">✎ 編輯課程</button>
    <button class="btn btns cf-danger" onclick="deleteCourse(${co.id})">🗑 刪除課程</button>
  </div>`;

  document.getElementById('course-modal-body').innerHTML=
    `<div class="cm-meta">${esc(meta)}</div>`+info+groupView+
    `<div class="cm-sec"><div class="cm-lbl">名單${isPractice?'（可加退、改科目）':''}<span class="cm-count">${ens.length}</span></div>${roster}${adder}</div>`+btns;
}
