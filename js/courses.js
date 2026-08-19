// 系統自有課表（開發路線 ① 第 1 步，schema 2026-07-04 拍板，見 mds/資料結構.md「系統自有課表」）
// courses / teachers 存取 + 新增課程表單 + 系統課程詳情 modal。
// 全部只寫 driveData（Firestore），不寫回 Google Calendar——系統自己是唯一真相。
// 設計原則「旋鈕不是箱子」：不先選類別，填自由欄位（學生/科目/老師/排法），
// 系統自動判型、自動命名；課名可手改，類型 chips 點選可鎖定覆蓋。

// ── 存取 helpers ──
function getCourses(){return driveData.courses||[];}
function saveCourses(list){driveData.courses=list;scheduleDriveSave('courses');}
function getTeachers(){return driveData.teachers||[];}
function saveTeachers(list){driveData.teachers=list;scheduleDriveSave('teachers');}
function teacherNameById(id){const t=getTeachers().find(t=>t.id===id);return t?t.name:'';}
// 課程老師（可多位）：新資料 teacherIds 陣列；舊資料單一 teacherId 自動相容
function courseTeacherIds(co){return Array.isArray(co.teacherIds)?co.teacherIds:(co.teacherId!=null?[co.teacherId]:[]);}
function courseTeacherNames(co){return courseTeacherIds(co).map(teacherNameById).filter(Boolean);}
function findCourseById(id){return getCourses().find(c=>c.id===id);}

// ── 課名分段（namePhases，2026-07-29 起）＋ 滾動命名（2026-08-03 起）──
// 名單期中變動時課名也要跟著變。兩層機制，由上往下：
//   1. 課名分段 `[{from:'YYYY-MM-DD', name}]`——手動壓過的名字，from<=該天的最後一段贏
//   2. 滾動命名——自動命名的課（courseNameIsAuto），課名逐日現算，跟課型同一套人數規則
//   3. 都沒有 → course.name（建課當下的名字，＝手取的名字不會被動到）
// 課程身分是 id 不是名字，所以改名不會對錯資料；已建立的補課/調課紀錄抄的是當下名字，仍顯示舊名。
function courseNamePhases(co){
  return (co&&Array.isArray(co.namePhases)?co.namePhases:[])
    .filter(p=>p&&p.from&&String(p.name||'').trim())
    .slice().sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);
}
function courseNameOn(co,day){
  if(!co)return'';
  const d=!day?null:(typeof day==='string'?day:toDateStr(day));
  if(!d)return co.name||'';
  // 分段最優先：手動壓過那天的名字就不再滾
  const ph=courseNamePhases(co).filter(p=>p.from<=d);
  if(ph.length)return String(ph[ph.length-1].name).trim();
  // 自動命名的課：拿那天在籍的名單現算（名單少一人，課名自己從「班」變「家教」）
  if(courseNameIsAuto(co)){
    const s=courseSuggestNameOn(co,d);
    if(s)return s;   // 算不出名字（那天沒人在籍）→ 落回建課當下的名字，不要變空白
  }
  return co.name||'';
}
// 這門課的名字能不能跟著名單滾？
// 存檔時記旗標 `nameAuto`（課名欄留空＝交給自動命名）。舊課沒這個旗標 → 回推：
// 現在的名字若等於自動命名算得出來的（全部登記或今天在籍的名單），就當它是自動的。
// 判斷刻意寬鬆——老闆選了「舊課也滾」，寧可多滾也不要一門一門重存才生效。
function courseNameIsAuto(co){
  if(!co)return false;
  if(typeof co.nameAuto==='boolean')return co.nameAuto;
  const nm=(co.name||'').trim();
  if(!nm)return true;
  return nm===courseSuggestNameOn(co,null)||nm===courseSuggestNameOn(co,toDateStr(new Date()));
}
// 滾動判型（courseTypeByCount / courseTypeOn）住在 schedule.js，跟課堂展開器同一支。

// 某天的建議課名：拿「那天在籍的名單」重跑自動命名規則（day=null＝不裁切，用全部登記）。
// 人數會影響課型（1 人家教／2 人一對二／3+ 團班），所以型也依當天人數重判——
// 跟課堂的滾動判型同一套規則，只是這裡產出的是「字」，課程本體的 type/費率仍不動。
function courseSuggestNameOn(co,day){
  if(!co)return'';
  const d=day==null?null:(typeof day==='string'?day:toDateStr(day));
  const ens=getEnrollments({periodId:yearPeriodId()})
    .filter(en=>en.courseId===co.id&&(d==null||enrollmentActiveOn(en,d)));
  const ids=ens.map(en=>en.studentId);
  if(!ids.length)return'';   // 那天沒人在籍 → 算不出名字（自動命名全靠學生名字/年級）
  const prac={};ens.forEach(en=>{prac[en.studentId]=en.practiceSubject||'';});
  const type=courseTypeByCount(co,ids.length);
  const wd=co.schedule?.mode==='weekly'&&(co.schedule.slots||[]).length
    ?(CF_WD_LABEL[co.schedule.slots[0].weekday]||''):'';
  return courseAutoNameFor({type,studentIds:ids,subject:co.subject,prac,weekdayLabel:wd});
}

// 週選項自帶一份，不在載入期依賴 settings.js 的 WEEK_ORDER/WEEK_LABEL（script 載入順序防呆）
var CF_WEEKDAYS=[[1,'週一'],[2,'週二'],[3,'週三'],[4,'週四'],[5,'週五'],[6,'週六'],[0,'週日']];
var CF_WD_LABEL={1:'週一',2:'週二',3:'週三',4:'週四',5:'週五',6:'週六',0:'週日'};
var CF_TYPES=['一對一','一對二','團班','練習課','試聽'];
// 練習課常用科目（點選式多選，另可加自訂）
var CF_PRAC_SUBJECTS=['數學','理化','物理','化學','生物','英文','國文'];
// 主科目欄自訂下拉的選項（比練習科目多「練習」＝練習課）
var CF_SUBJECTS=['數學','理化','物理','化學','生物','英文','國文','練習'];

// ── 新增課程表單狀態 ──
var cfState=null;

// 空白時段：日期預設今天（2026-08-06 老闆要求）。「指定日期」多半是排今天或這幾天的單場加課，
// 空欄位每次都要點日曆挑；每週重複用不到 date 欄，帶著也不影響（存檔時只取該 mode 需要的欄位）。
function cfBlankSlot(){return{weekday:1,start:'',end:'',date:toDateStr(new Date())};}

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
    namePhases:[],          // 課名分段：[{from:'YYYY-MM-DD', name}]，某日起改叫別的（名單期中變動時用）
    teachers:[],            // 老師（可多位）：姓名字串陣列；存檔時對既有老師、對不到就建檔
    teacherInput:'',        // 老師輸入框當前文字
    teacherRate:'',
    mode:'weekly',
    slots:[cfBlankSlot()],  // 兩種 mode 共用欄位，存檔時只取需要的
    phases:[],              // 換時段段落（每週重複才有）：[{from:'YYYY-MM-DD', slots:[{weekday,start,end}]}]，依日期自動切換上課時間
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
      // 只有真的手動鎖過的課才帶回鎖定狀態；沒鎖的課回到自動＝跟著人數滾
      pinnedType:co.typePinned?(co.type||null):null,
      // 自動命名的課：課名欄留空（placeholder 顯示自動算的名字），存檔才不會把它凍成手取的
      name:courseNameIsAuto(co)?'':(co.name||''),nameTouched:!courseNameIsAuto(co),
      namePhases:(co.namePhases||[]).map(p=>({from:p.from||'',name:p.name||''})),
      teachers:courseTeacherNames(co),teacherInput:'',teacherRate:co.teacherRate??'',
      mode:co.schedule?.mode||'weekly',
      slots:(co.schedule?.slots||[]).map(s=>({weekday:s.weekday??1,start:s.start||'',end:s.end||'',date:s.date||''})),
      phases:(co.schedule?.phases||[]).map(p=>({from:p.from||'',slots:(p.slots||[]).map(s=>({weekday:s.weekday??1,start:s.start||'',end:s.end||''}))})),
      room:co.room||'',defaultPrice:co.defaultPrice??'',
      needsGrade:!!co.needsGrade,needsGradeTouched:true,
      sourceChannel:co.sourceChannel||''};
    if(!cfState.slots.length)cfState.slots=[cfBlankSlot()];
  }else cfState=cfBlank();
  renderCourseForm();
  document.getElementById('cf-modal-wrap').classList.add('open');
}
function closeCourseForm(){
  document.getElementById('cf-modal-wrap').classList.remove('open');
  cfState=null;
  if(typeof _sysDateEdit!=='undefined')_sysDateEdit=null; // 未存的修課起訖編輯狀態一併丟棄
}
function courseFormOpen(){const w=document.getElementById('cf-modal-wrap');return !!cfState&&!!w&&w.classList.contains('open');}

// ── 表單裡的名單（2026-07-31：編輯課程也能加退學生）──
// 新增模式＝表單暫存的初始名單（送出時才寫 enrollments）；
// 編輯模式＝直接讀寫本期登記簿，跟課程視窗同一份資料、即時生效（所以不會「兩處打架」）。
function cfCourseEnrolls(){
  const id=cfState?cfState.editId:null;
  return id==null?[]:getEnrollments({periodId:yearPeriodId()}).filter(en=>en.courseId===id);
}
function cfRosterIds(){return cfState.editId!=null?cfCourseEnrolls().map(en=>en.studentId):cfState.students;}
function cfRosterPrac(){
  if(cfState.editId==null)return cfState.practiceSubjects;
  const m={};cfCourseEnrolls().forEach(en=>{m[en.studentId]=en.practiceSubject||'';});
  return m;
}
function cfTakenIds(){return new Set(cfRosterIds());}

// ── 自動判型 ──
// 規則：鎖定優先 → 科目「練習」＝練習課 → 1 人一對一、2 人一對二、其餘團班
// 2026-07-31：拿掉「指定日期＋1 人＝試聽」——指定日期只是排課方式（單場加課、寒暑期單堂都是），
// 不代表試聽；試聽改成點類型 chip 手動鎖定。
function cfType(){
  const st=cfState;
  if(st.pinnedType)return st.pinnedType;
  if(st.subject.trim()==='練習')return'練習課';
  const n=cfRosterIds().length;   // 編輯模式＝登記簿在籍人數；新增＝表單初始名單
  if(n===1)return'一對一';
  if(n===2)return'一對二';
  return'團班';
}

// 把一個學生的練習科目字串（可能「數學、理化」）拆成陣列
function cfSubjList(sid){return (cfState.practiceSubjects[sid]||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean);}

// ── 自動命名（規則見資料結構.md courses.name）──
// 純函式版：吃「一份名單」而不是 cfState，所以新增表單與「課名分段建議」共用同一套規則。
// 資料還不夠命名時回空字串，不要生出「班」「家教」這種殘字掛在課名欄
function _anSubjList(prac,sid){return String((prac||{})[sid]||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean);}
// 名單裡最多人的年級
function _anTopGrade(ids){
  const cnt={};
  ids.forEach(id=>{const s=getStudentList().find(s=>s.id===id);if(s&&s.grade)cnt[s.grade]=(cnt[s.grade]||0)+1;});
  return Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
}
// 練習課命名（#7 規則＋2026-07-16 跨年級規則）：
//   1 人 → 「(名)(科目)練習課」
//   ≥2 人跨年級 → 「(年級)、(年級)練習課」（年級照低到高排，不掛名不掛科目）
//   ≥2 人同年級且全班同一科 → 「(名)、(名)…(科目)練習課」（≤2 列名，3+ 用最多人年級）
//   ≥2 人同年級但科目不同 → 「(名)、(名)練習課」（≤2 列名，3+ 用最多人年級或週別）
function _anPracticeName(ids,prac,weekdayLabel){
  if(!ids.length)return(weekdayLabel||'')+'練習課';
  const names=ids.map(id=>studentName(id));
  const subjSet=new Set();ids.forEach(id=>_anSubjList(prac,id).forEach(s=>subjSet.add(s)));
  const cats=pracSubjCats([...subjSet]);   // 數學＋理化＝一類「數理」
  const subjStr=cats.join('、');
  if(ids.length===1)return names[0]+subjStr+'練習課';
  // 跨年級：課名列出各年級（低→高，照 GRADES 順序）
  const gradeSet=new Set(ids.map(id=>getStudentList().find(s=>s.id===id)?.grade).filter(Boolean));
  if(gradeSet.size>=2)return [...gradeSet].sort((a,b)=>GRADES.indexOf(a)-GRADES.indexOf(b)).join('、')+'練習課';
  const head=ids.length<=2?names.join('、'):_anTopGrade(ids);
  if(cats.length===1)return head+subjStr+'練習課';    // 全班同一類（數理算一類）
  return head+'練習課';                                  // 科目不同，不掛科目
}
function courseAutoNameFor({type,studentIds,subject,prac,weekdayLabel}){
  const ids=studentIds||[];
  const subj=String(subject||'').trim()==='練習'?'':String(subject||'').trim();
  const names=ids.map(id=>studentName(id));
  if(type==='練習課')return _anPracticeName(ids,prac,weekdayLabel);
  if(type==='試聽'){const s=(names[0]||'')+subj;return s?s+'試聽':'';}
  if(type==='一對一'){const s=(names[0]||'')+subj;return s?s+'家教':'';}
  if(type==='一對二'){const s=names.slice(0,2).join('、')+subj;return s?s+'班':'';}
  const s=_anTopGrade(ids)+subj;
  return s?s+'班':'';
}
function cfAutoName(){
  const st=cfState;
  return courseAutoNameFor({
    type:cfType(),studentIds:cfRosterIds(),subject:st.subject,prac:cfRosterPrac(),
    weekdayLabel:st.mode==='weekly'&&st.slots.length?(CF_WD_LABEL[st.slots[0].weekday]||''):'',
  });
}

// 費率單位隨型：家教按時數、團班按人頭、試聽（與補課）固定一筆
function cfRateUnit(t){return t==='一對一'||t==='一對二'?'元／小時':t==='團班'?'元／人／堂':'元／堂';}

// ── 學生輸入：打字自動完成 → 對到既有學生加入；對不到就現場建檔 ──
function cfStuInput(v){cfState.stuInput=v;}
function cfResolveStudent(){
  const st=cfState,q=(st.stuInput||'').trim();
  if(!q)return;
  const taken=cfTakenIds();
  const matches=getStudentList({activeOnly:true}).filter(s=>s.name===q&&!taken.has(s.id));
  if(matches.length===1)return cfPickStudent(matches[0].id);
  if(matches.length>1){st.stuMatches=matches.map(s=>s.id);st.pendingStu=null;return renderCourseForm();}
  // 系統查無此人 → 開現場建檔小表單（名字帶入）
  st.stuMatches=null;
  st.pendingStu={name:q,gradeSeg:'',grade:'',school:'',parentPhone:''};
  renderCourseForm();
}
function cfPickStudent(sid){
  const st=cfState;
  st.stuInput='';st.stuMatches=null;st.pendingStu=null;
  if(st.editId!=null)return cfEnrollNow(sid);   // 編輯既有課：直接寫登記簿，不等「儲存變更」
  st.students.push(sid);
  cfAfterTypeAffecting();
}
// 編輯模式加入學生＝寫一筆 enrollment（與課程視窗的 ＋加入 同一筆資料、同一套規則）
function cfEnrollNow(sid){
  const co=findCourseById(cfState.editId);
  if(!co)return;
  const title=courseNameOn(co,new Date());
  saveEnrollments([...getEnrollments(),makeEnrollment({
    studentId:sid,courseTitle:title,periodId:yearPeriodId(),courseId:co.id,
  })]);
  logAct('roster',`把 ${studentName(sid)} 加進課程`,title,'');
  toast(`已加入 ${studentName(sid)}：${title}`,'ok');
  renderSettings();
  refreshCourseModal();   // 連帶重繪本表單（見 settings.js refreshCourseModal）
}
function cfCancelStuAdd(){cfState.stuMatches=null;cfState.pendingStu=null;renderCourseForm();}
function cfPendingSet(f,v){cfState.pendingStu[f]=v;}
// 現場建檔小表單的「姓名」＝這個名字的唯一真相：改它，上面的輸入框與標題一起跟著改，
// 免得三個地方各寫各的（改了下面按上面的「＋ 加入」會拿到舊名字）。
// 直接改 DOM 不重繪——重繪會把正在打字的游標踢掉。
function cfPendingName(v){
  cfState.pendingStu.name=v;
  cfState.stuInput=v;
  const top=document.getElementById('cf-stu-input');if(top)top.value=v;
  const lbl=document.getElementById('cf-resolve-lbl');if(lbl)lbl.textContent=`「${v}」不在系統 → 現場建檔並加入`;
}
function cfPendingSeg(v){cfState.pendingStu.gradeSeg=v;if(!(GRADE_SEG_YEARS[v]||[]).length)cfState.pendingStu.grade=gradeCompose(v);else if(gradeDecompose(cfState.pendingStu.grade).seg!==v)cfState.pendingStu.grade='';renderCourseForm();}
function cfPendingYear(yr){cfState.pendingStu.grade=gradeCompose(cfState.pendingStu.gradeSeg,yr);}
// 現場建檔：走 makeNewStudent（與新增學生頁同一入口，欄位一致、資料不出入）→ 建好即加入本課
function cfCreatePendingStudent(){
  const p=cfState.pendingStu,name=(p.name||'').trim();
  if(!name)return;
  if(!p.grade)return toast('請先選年級（沒年級的學生在管理頁會看不到）','err');
  const stu=makeNewStudent({name,grade:p.grade,school:(p.school||'').trim(),parentPhone:(p.parentPhone||'').trim()});
  saveStudentList([...getStudentList(),stu]);
  logAct('student','新增學生',`${name}（${p.grade}）`,'從新增課程表單現場建檔');
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
// 科目自訂下拉（原生 datalist 無法「有值時仍列全部」，故自製）：點欄位列全部、打字才過濾、點項填入
function cfSubjOpen(){const m=document.getElementById('cf-subj-menu');if(!m)return;m.querySelectorAll('.cf-combo-opt').forEach(o=>o.hidden=false);m.hidden=false;}
function cfSubjInput(el){cfSubjectInput(el.value);const m=document.getElementById('cf-subj-menu');if(!m)return;const q=el.value.trim();m.querySelectorAll('.cf-combo-opt').forEach(o=>o.hidden=!!q&&!o.textContent.includes(q));m.hidden=false;}
function cfSubjBlur(){setTimeout(()=>{const m=document.getElementById('cf-subj-menu');if(m)m.hidden=true;},120);}
function cfSubjPick(v){cfSubjectInput(v);cfSubjectChange();}
function cfPinType(t){cfState.pinnedType=cfState.pinnedType===t?null:t;cfAfterTypeAffecting();}
function cfNameInput(v){
  if(v.trim()===''){cfState.nameTouched=false;cfState.name=cfAutoName();return;} // 清空＝回到自動命名
  cfState.name=v;cfState.nameTouched=true;
}
function cfTeacherInput(v){cfState.teacherInput=v;}
function cfAddTeacher(){const n=(cfState.teacherInput||'').trim();if(!n)return;if(!cfState.teachers.includes(n))cfState.teachers.push(n);cfState.teacherInput='';renderCourseForm();}
function cfDelTeacher(i){cfState.teachers.splice(i,1);renderCourseForm();}
function cfRateInput(v){cfState.teacherRate=v;}
function cfSetMode(m){
  if(cfState.mode===m)return;
  cfState.mode=m;
  // 切到「指定日期」時，還沒填日期的那幾列補上今天（跟新開表單同一個預設）
  if(m==='dates')cfState.slots.forEach(sl=>{if(!sl.date)sl.date=toDateStr(new Date());});
  cfAfterTypeAffecting();
}
function cfSlotSet(i,f,v){cfState.slots[i][f]=v;if(f==='weekday')cfSyncAutoName();}
function cfAddSlot(){cfState.slots.push(cfBlankSlot());renderCourseForm();}
// 換時段段落（多段上課時間）：同一門課、不同期別時間不同，依 from 日期自動切換
var CF_TERM_STARTS=[['上學期',8,1],['寒假',1,1],['下學期',2,1],['暑假',6,1]]; // [標籤, 月(0起), 日]
function cfNextTermDate(mo,dd){const now=new Date();now.setHours(0,0,0,0);let d=new Date(now.getFullYear(),mo,dd);if(d<now)d=new Date(now.getFullYear()+1,mo,dd);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
// 課名分段（namePhases）：「從某日起改叫別的」，與換時段共用日期快捷
function cfAddNamePhase(){cfState.namePhases.push({from:'',name:''});renderCourseForm();}
function cfDelNamePhase(ni){cfState.namePhases.splice(ni,1);renderCourseForm();}
function cfNamePhaseSet(ni,f,v){cfState.namePhases[ni][f]=v;renderCourseForm();}
function cfNamePhasePreset(ni,mo,dd){cfState.namePhases[ni].from=cfNextTermDate(mo,dd);renderCourseForm();}
// 該段的建議課名（也拿來當 placeholder）：編輯既有課＝依那天在籍的名單；新課還沒有登記＝用目前表單名單
function cfNamePhaseHint(ni){
  const p=cfState.namePhases[ni];
  if(!p||!p.from)return'';
  const co=cfState.editId!=null?findCourseById(cfState.editId):null;
  return co?courseSuggestNameOn(co,p.from):cfAutoName();
}
function cfNamePhaseSuggest(ni){
  const p=cfState.namePhases[ni];
  if(!p)return;
  if(!p.from)return toast('先選日期，才知道要照哪天的名單命名','inf');
  const nm=cfNamePhaseHint(ni);
  if(!nm)return toast('那天的名單湊不出課名（沒人或缺年級/科目），請直接輸入','inf');
  p.name=nm;renderCourseForm();
}
function cfAddPhase(){cfState.phases.push({from:'',slots:[{weekday:1,start:'',end:''}]});renderCourseForm();}
function cfDelPhase(pi){cfState.phases.splice(pi,1);renderCourseForm();}
function cfPhaseFromSet(pi,v){cfState.phases[pi].from=v;}
function cfPhaseFromPreset(pi,mo,dd){cfState.phases[pi].from=cfNextTermDate(mo,dd);renderCourseForm();}
function cfPhaseSlotSet(pi,si,f,v){cfState.phases[pi].slots[si][f]=v;}
function cfPhaseAddSlot(pi){cfState.phases[pi].slots.push({weekday:1,start:'',end:''});renderCourseForm();}
function cfPhaseDelSlot(pi,si){const s=cfState.phases[pi].slots;s.splice(si,1);if(!s.length)s.push({weekday:1,start:'',end:''});renderCourseForm();}
function cfDelSlot(i){
  cfState.slots.splice(i,1);
  if(!cfState.slots.length)cfState.slots.push(cfBlankSlot());
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

  // 名單：新增＝表單初始名單（送出時才寫登記簿）；編輯＝直接加退登記簿，即時生效（與課程視窗同一份）
  const taken=cfTakenIds();
  // 自動完成清單：還沒在名單上的在學學生（value＝姓名，選項文字附年級）
  const dlOpts=getStudentList({activeOnly:true})
    .filter(s=>!taken.has(s.id))
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','zh-Hant'))
    .map(s=>`<option value="${esc(s.name)}">${esc(s.name)}（${esc(s.grade||'')}）</option>`).join('');
  // 同名多筆 → 選是哪一位；查無此人 → 現場建檔（兩種模式共用）
  let extra='';
  if(st.stuMatches){
    extra=`<div class="cf-resolve"><div class="cf-resolve-lbl">系統有多位「${esc(st.stuInput)}」，是哪一位？</div>
      ${st.stuMatches.map(id=>{const s=getStudentList().find(x=>x.id===id);return`<button class="btn btns" onclick="cfPickStudent(${id})">${esc(s.name)}（${esc(s.grade||'?')}・${esc(s.school||'學校未填')}）</button>`;}).join('')}
      <button class="btn btns" onclick="cfState.pendingStu={name:cfState.stuInput,gradeSeg:'',grade:'',school:'',parentPhone:''};cfState.stuMatches=null;renderCourseForm()">都不是，建新檔</button>
      <button class="btn btns" onclick="cfCancelStuAdd()">取消</button></div>`;
  }else if(st.pendingStu){
    const p=st.pendingStu;
    extra=`<div class="cf-resolve"><div class="cf-resolve-lbl" id="cf-resolve-lbl">「${esc(p.name)}」不在系統 → 現場建檔並加入</div>
      <div class="as-grid">
        <div class="cm-sec"><div class="cm-lbl">姓名</div><input class="cm-input" name="search-newstu" autocomplete="off" value="${esc(p.name)}" oninput="cfPendingName(this.value)"></div>
        <div class="cm-sec"><div class="cm-lbl">年級（必選）</div>${gradePickerHtml(p.gradeSeg,gradeDecompose(p.grade).yr,"cfPendingSeg(this.value)","cfPendingYear(this.value)")}</div>
        <div class="cm-sec"><div class="cm-lbl">學校</div><input class="cm-input" name="search-school" autocomplete="off" value="${esc(p.school)}" oninput="cfPendingSet('school',this.value)"></div>
        <div class="cm-sec"><div class="cm-lbl">家長聯絡方式</div><input class="cm-input" name="search-contact" autocomplete="off" value="${esc(p.parentPhone)}" oninput="cfPendingSet('parentPhone',this.value)"></div>
      </div>
      <div class="cf-foot"><span style="flex:1"></span><button class="btn btns" onclick="cfCancelStuAdd()">取消</button><button class="btn btns btnp" onclick="cfCreatePendingStudent()">建檔並加入</button></div></div>`;
  }
  const addBox=`<div class="co-add">
      <input class="co-add-sel" id="cf-stu-input" name="search-student" autocomplete="off" list="cf-students-dl" placeholder="輸入學生姓名…" value="${esc(st.stuInput||'')}" oninput="cfStuInput(this.value)" onkeydown="if(enterSubmit(event)){cfResolveStudent()}">
      <datalist id="cf-students-dl">${dlOpts}</datalist>
      <button class="co-add-btn" onclick="cfResolveStudent()">＋ 加入</button>
    </div>
    ${extra}`;

  let stuSec;
  if(edit){
    // 編輯既有課：名單就是登記簿本身（chips／📅 起訖／✕ 退課與課程視窗共用同一份 HTML）
    const co=findCourseById(st.editId),ens=cfCourseEnrolls();
    stuSec=`<div class="cm-sec"><div class="cm-lbl">名單${t==='練習課'?'（可加退、改科目）':''}<span class="cm-count">${ens.length}</span></div>
      ${co?sysRosterHtml(co,ens):''}
      ${addBox}
      <div class="cm-hint">名單這裡改當下就生效，不用按「儲存變更」。📅＝修課起訖（插班／中途退出）、✕＝整筆退課。</div></div>`;
  }else{
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
          <div class="cf-subj-tags">${common}${customs}<input class="cf-subj-add" list="cf-subjects" placeholder="＋其他" onkeydown="if(enterSubmit(event)){cfAddCustomPracSubj(${sid},this.value);this.value=''}"></div>
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
    stuSec=`<div class="cm-sec"><div class="cm-lbl">學生（初始名單，之後隨時可加退）${t==='練習課'?'<span class="cm-hint" style="margin:0 0 0 6px">點科目可選多個</span>':''}<span class="cm-count">${st.students.length}</span></div>
      ${chips}
      ${addBox}</div>`;
  }

  const subjMenu=CF_SUBJECTS.map(s=>`<div class="cf-combo-opt${s===st.subject?' cur':''}" onmousedown="event.preventDefault();cfSubjPick('${s}')">${esc(s)}</div>`).join('');
  const subjSec=`<div class="cm-sec"><div class="cm-lbl">科目</div>
    <div class="cf-combo">
      <input class="cm-input" id="cf-subj-input" name="search-subject" autocomplete="off" value="${esc(st.subject)}" placeholder="例：數學（填「練習」＝練習課）" oninput="cfSubjInput(this)" onfocus="cfSubjOpen()" onclick="cfSubjOpen()" onblur="cfSubjBlur()" onchange="cfSubjectChange()">
      <div class="cf-combo-menu" id="cf-subj-menu" hidden>${subjMenu}</div>
    </div>
  </div>`;

  const wdSel=(sl,onCh)=>`<select onchange="${onCh}">${CF_WEEKDAYS.map(([v,l])=>`<option value="${v}" ${sl.weekday===v?'selected':''}>${l}</option>`).join('')}</select>`;
  // 換時段段落（僅每週重複）：各段從某日期起、依日期自動切換上課時間
  const phaseBlocks=st.mode==='weekly'?st.phases.map((ph,pi)=>`
    <div class="cf-phase">
      <div class="cf-phase-hd">
        <span class="cf-phase-lbl">從</span>
        <input type="date" class="cf-phase-date" value="${esc(ph.from)}" onchange="cfPhaseFromSet(${pi},this.value)">
        <span class="cf-phase-lbl">起改為</span>
        <span class="cf-phase-presets">${CF_TERM_STARTS.map(([lbl,mo,dd])=>`<button type="button" class="cf-term-btn" onclick="cfPhaseFromPreset(${pi},${mo},${dd})">${lbl}</button>`).join('')}</span>
        <button class="co-stu-x cf-phase-x" title="移除此段" onclick="cfDelPhase(${pi})">✕</button>
      </div>
      ${ph.slots.map((sl,si)=>`
      <div class="cf-slot">
        ${wdSel(sl,`cfPhaseSlotSet(${pi},${si},'weekday',parseInt(this.value,10))`)}
        <input type="time" value="${esc(sl.start)}" onchange="cfPhaseSlotSet(${pi},${si},'start',this.value)">
        <span class="cf-slot-dash">–</span>
        <input type="time" value="${esc(sl.end)}" onchange="cfPhaseSlotSet(${pi},${si},'end',this.value)">
        <button class="co-stu-x" title="移除時段" onclick="cfPhaseDelSlot(${pi},${si})">✕</button>
      </div>`).join('')}
      <button class="cf-add-slot" onclick="cfPhaseAddSlot(${pi})">＋ 加時段</button>
    </div>`).join(''):'';
  const modeSec=`<div class="cm-sec"><div class="cm-lbl">排課</div>
    <div class="cf-mode">
      <label><input type="radio" name="cf-mode" value="weekly" ${st.mode==='weekly'?'checked':''} onchange="cfSetMode('weekly')"> 每週重複</label>
      <label><input type="radio" name="cf-mode" value="dates" ${st.mode==='dates'?'checked':''} onchange="cfSetMode('dates')"> 指定日期</label>
    </div>
    <div class="cf-slots">${st.slots.map((sl,i)=>`
      <div class="cf-slot">
        ${st.mode==='weekly'
          ? wdSel(sl,`cfSlotSet(${i},'weekday',parseInt(this.value,10))`)
          :`<input type="date" value="${esc(sl.date)}" onchange="cfSlotSet(${i},'date',this.value)">`}
        <input type="time" value="${esc(sl.start)}" onchange="cfSlotSet(${i},'start',this.value)">
        <span class="cf-slot-dash">–</span>
        <input type="time" value="${esc(sl.end)}" onchange="cfSlotSet(${i},'end',this.value)">
        <button class="co-stu-x" title="移除時段" onclick="cfDelSlot(${i})">✕</button>
      </div>`).join('')}
      <button class="cf-add-slot" onclick="cfAddSlot()">＋ 加時段</button>
    </div>
    ${phaseBlocks}
    ${st.mode==='weekly'?`<button class="cf-add-phase" onclick="cfAddPhase()">＋ 換時段（開學／假期後改時間）</button>`:''}
    ${st.mode==='weekly'&&st.phases.length?`<div class="cm-hint" style="margin-top:6px">同一門課不同期別時間不同時用「換時段」；系統依日期自動套用當天生效的時段。</div>`:''}
  </div>`;

  // 老師（可多位）：chips 加入；查無此名 → 建立課程時一併建檔（與老師管理同一份 teachers）
  const teachers=getTeachers().filter(x=>(x.status||'在職')==='在職');
  const tDl=teachers.map(x=>`<option value="${esc(x.name)}">`).join('');
  const tChips=st.teachers.map((nm,i)=>{
    const unknown=!teachers.some(x=>x.name===nm);
    return`<span class="cf-chip">${esc(nm)}${unknown?'<span class="cf-chip-new">新</span>':''}<button class="co-stu-x" title="移除" onclick="cfDelTeacher(${i})">✕</button></span>`;
  }).join('');
  const tNewHint=st.teachers.some(nm=>!teachers.some(x=>x.name===nm))
    ?`<div class="cm-hint">標「新」的老師不在系統，建立課程時會自動建檔。</div>`:'';
  const rateSec=t==='練習課'
    ?`<div class="cm-hint">練習課輔導老師薪資走打卡制，不在系統內設費率。</div>`
    :`<div class="cm-lbl" style="margin-top:12px">老師費率（薪資表用，可先空著）</div>
      <div class="cm-price-row"><input type="number" class="cm-input cm-price" min="0" inputmode="numeric" placeholder="未定" value="${st.teacherRate===''?'':esc(String(st.teacherRate))}" oninput="cfRateInput(this.value)"><span class="cm-unit">${cfRateUnit(t)}</span></div>`;
  const teacherSec=`<div class="cm-sec"><div class="cm-lbl">老師${t==='練習課'?'（預設輔導老師，當堂可換）':''}${st.teachers.length>1?`<span class="cm-count">${st.teachers.length}</span>`:''}</div>
    ${tChips?`<div class="cf-chips">${tChips}</div>`:''}
    <div class="co-add">
      <input class="co-add-sel" name="search-teacher" autocomplete="off" list="cf-teachers-dl" placeholder="輸入老師姓名…" value="${esc(st.teacherInput)}" oninput="cfTeacherInput(this.value)" onkeydown="if(enterSubmit(event)){cfAddTeacher()}">
      <datalist id="cf-teachers-dl">${tDl}</datalist>
      <button class="co-add-btn" onclick="cfAddTeacher()">＋ 加入</button>
    </div>
    ${tNewHint}
    ${rateSec}
  </div>`;

  const roomSec=`<div class="cm-sec"><div class="cm-lbl">教室</div>
    <select class="cm-input" onchange="cfRoomChange(this.value)">
      <option value="">不指定</option>
      ${COURSE_ROOMS.map(r=>`<option ${st.room===r?'selected':''}>${r}</option>`).join('')}
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
    <input class="cm-input" name="search-channel" autocomplete="off" list="cf-channels" value="${esc(st.sourceChannel)}" placeholder="例：朋友介紹" oninput="cfChannelInput(this.value)">
    <div class="cm-hint">之後正式報名，來源管道會跟著轉進學生檔。</div>
  </div>`:'';

  const typeChips=CF_TYPES.map(x=>`<button class="cf-type-chip${x===t?' on':''}${st.pinnedType===x?' pinned':''}" onclick="cfPinType('${x}')">${x}</button>`).join('');
  // 課名分段：從某日起改叫別的（同「換時段」的長相與快捷）
  const namePhaseBlocks=st.namePhases.map((np,ni)=>`
    <div class="cf-phase">
      <div class="cf-phase-hd">
        <span class="cf-phase-lbl">從</span>
        <input type="date" class="cf-phase-date" value="${esc(np.from)}" onchange="cfNamePhaseSet(${ni},'from',this.value)">
        <span class="cf-phase-lbl">起改叫</span>
        <span class="cf-phase-presets">${CF_TERM_STARTS.map(([lbl,mo,dd])=>`<button type="button" class="cf-term-btn" onclick="cfNamePhasePreset(${ni},${mo},${dd})">${lbl}</button>`).join('')}</span>
        <button class="co-stu-x cf-phase-x" title="移除此段" onclick="cfDelNamePhase(${ni})">✕</button>
      </div>
      <div class="cf-slot">
        <input class="cm-input" name="search-phasename" autocomplete="off" value="${esc(np.name)}" placeholder="${esc(cfNamePhaseHint(ni)||'那天起的課名')}" onchange="cfNamePhaseSet(${ni},'name',this.value)">
        <button type="button" class="cf-term-btn" title="依那天在籍的名單重新命名" onclick="cfNamePhaseSuggest(${ni})">↺ 建議</button>
      </div>
    </div>`).join('');
  const nameSec=`<div class="cm-sec cf-verdict">
    <div class="cm-lbl">系統判定${st.pinnedType?'（已鎖定：不隨人數變，再點一次解除）':'（自動：每堂照那天在籍人數判，點類型可鎖死）'}</div>
    <div class="cf-type-row">${typeChips}</div>
    ${st.pinnedType?'':'<div class="cm-hint">期中有人退出／插班，課堂的課型會自己跟著變（補課時長、課前 1hr 內請假的半堂規則都照著走）。老師費率單位不跟著變，固定看這裡的型。</div>'}
    <div class="cm-lbl" style="margin-top:12px">課名（留空＝自動命名，會跟著名單變；自己打＝固定不動）</div>
    <input class="cm-input" id="cf-name" name="search-coursename" autocomplete="off" value="${esc(st.name)}" placeholder="${esc(cfAutoName()||'選學生、填科目後自動命名')}" oninput="cfNameInput(this.value)">
    <div class="cm-hint">${(st.name||'').trim()
      ?'這是手取的名字，名單怎麼變都不會動。清空就交回自動命名。'
      :'自動命名：期中有人退出／插班，課名自己跟著變（兩人的「○、○班」剩一人會變成「○家教」）。想固定就直接打上去。'}</div>
    ${namePhaseBlocks}
    <button class="cf-add-slot" onclick="cfAddNamePhase()">＋ 換課名（某日起改叫別的）</button>
    ${st.namePhases.length?'<div class="cm-hint">指定某天起的名字，蓋過自動命名：那天之前的課堂顯示舊名，之後顯示新名。</div>':''}
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
// 編輯課程 → 動態只記「真的變了的東西」。上課時間是最會影響全班的一項，所以放主句、
// 其餘（教室／老師／課名／單價）當補充；什麼都沒改就不記，避免按了儲存就洗一行版面。
function logCourseEditAct(old,rec){
  if(typeof logAct!=='function')return;
  const tn=ids=>(ids||[]).map(id=>getTeachers().find(t=>t.id===id)?.name).filter(Boolean).join('、');
  const oldSlots=sysSlotLabel(old),newSlots=sysSlotLabel(rec);
  const timeChanged=oldSlots!==newSlots;
  const others=[];
  if(old.name!==rec.name)others.push(`課名 ${old.name} → ${rec.name}`);
  if((old.room||'')!==(rec.room||''))others.push(`教室 ${old.room||'未指定'} → ${rec.room||'未指定'}`);
  if(tn(old.teacherIds)!==tn(rec.teacherIds))others.push(`老師 ${tn(old.teacherIds)||'無'} → ${tn(rec.teacherIds)||'無'}`);
  if((old.defaultPrice??null)!==(rec.defaultPrice??null))others.push(`單價 ${old.defaultPrice??'未設'} → ${rec.defaultPrice??'未設'}`);
  if((old.type||'')!==(rec.type||''))others.push(`類型 ${old.type} → ${rec.type}`);
  if(!timeChanged&&!others.length)return;
  logAct('course',timeChanged?'改了上課時間':'改了課程設定',rec.name,
    (timeChanged?`${oldSlots||'未排時段'} → ${newSlots||'未排時段'}`:'')
    +(timeChanged&&others.length?'　|　':'')+others.join('、'));
}

function cfSubmit(){
  const st=cfState,t=cfType();
  // 老師（可多位）：收 chips ＋ 尚未按加入的輸入框文字；至少一位
  const tnames=st.teachers.map(s=>s.trim()).filter(Boolean);
  const pendingT=(st.teacherInput||'').trim();
  if(pendingT&&!tnames.includes(pendingT))tnames.push(pendingT);
  if(!tnames.length)return toast('請至少加入一位老師','err');
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
  // 換時段段落（僅每週重複）：各段收完整 weekly 時段、需有 from 日期，依日期排序
  const phases=st.mode==='weekly'?st.phases
    .map(p=>({from:p.from||'',slots:p.slots
      .map(s=>({weekday:Number(s.weekday),start:s.start,end:s.end}))
      .filter(s=>s.start&&s.end&&!isNaN(s.weekday))}))
    .filter(p=>p.from&&p.slots.length)
    .sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0)
    :[];
  for(const p of phases)for(const s of p.slots)if(s.end<=s.start)return toast('換時段的結束時間要晚於開始時間','err');
  // 課名分段：只收「有日期＋有名字」的，依日期排序（沒填完的當作沒設，不擋存檔）
  const namePhases=st.namePhases
    .map(p=>({from:p.from||'',name:String(p.name||'').trim()}))
    .filter(p=>p.from&&p.name)
    .sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);

  // 逐一解析成 id；查無此名就建檔（一次可建多位，id 用 Date.now()+序避免同毫秒撞號）
  const tlist=getTeachers().slice();
  const teacherIds=[];let tCreated=false,created=0;
  tnames.forEach(nm=>{
    let tt=tlist.find(x=>x.name===nm);
    if(!tt){tt={id:Date.now()+created,name:nm,status:'在職'};tlist.push(tt);created++;tCreated=true;}
    if(!teacherIds.includes(tt.id))teacherIds.push(tt.id);
  });
  if(tCreated)saveTeachers(tlist);
  const noFee=(t==='練習課'||t==='試聽');
  const rec={
    id:st.editId??Date.now(),
    // nameAuto：課名欄留空＝交給自動命名（＝之後課名跟著名單滾）；有手打＝這個名字固定不動
    name,nameAuto:!(st.name||'').trim(),namePhases,type:t,typePinned:!!st.pinnedType,teacherIds,
    teacherRate:t==='練習課'?null:(String(st.teacherRate).trim()===''?null:Math.max(0,parseInt(st.teacherRate,10)||0)),
    schedule:{mode:st.mode,slots,phases},
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
    const old=list[i];
    rec.createdAt=old.createdAt;
    rec.status=old.status;
    // 改課名：courseId 才是 join key，courseTitle 只是顯示用 → 同步本課 enrollments 的顯示名
    if(old.name!==name)getEnrollments().forEach(en=>{if(en.courseId===rec.id)en.courseTitle=name;});
    list[i]=rec;
    saveCourses(list);
    logCourseEditAct(old,rec);
  }else{
    saveCourses([...getCourses(),rec]);
    logAct('course','建立課程',name,[sysSlotLabel(rec),rec.room,tnames.join('、')].filter(Boolean).join(' · '));
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
  // 從桌面日曆點空白建課時，人還停在日曆上——把新課現算進來，馬上看得到
  if(currentPanel==='dayview'&&typeof renderDayView==='function')renderDayView();
}

// ── 刪除課程（連同本課 enrollments；學生本人不動）──
async function deleteCourse(id){
  const co=findCourseById(id);
  if(!co)return;
  const ens=getEnrollments().filter(en=>en.courseId===id);
  const times=sysSlotLabel(co)||'（未排時段）';
  const ok=await uiConfirm({title:'刪除這門課？',ok:'刪除課程',danger:true,
    html:`<p class="ask-big">${esc(courseNameOn(co,new Date()))}</p>
      <div class="ask-list">${times.split('、').map(s=>`・${esc(s)}`).join('<br>')}</div>
      <p>會一併移除 <b>${ens.length}</b> 筆修課登記，學生本人不會被刪。</p>
      <div class="ask-note ask-warn">刪掉之後救不回來。</div>`});
  if(!ok)return;
  // 連動清掉本課的系統請假紀錄（不留孤兒；待補課清單重建時查無課程也會跳過）
  if(getAbsences().some(a=>a.courseId===id))saveAbsences(getAbsences().filter(a=>a.courseId!==id));
  saveCourses(getCourses().filter(c=>c.id!==id));
  if(ens.length)saveEnrollments(getEnrollments().filter(en=>en.courseId!==id));
  logAct('course','刪除課程',courseNameOn(co,new Date()),`${times}${ens.length?`・一併移除 ${ens.length} 筆修課登記`:''}`);
  toast(`已刪除「${courseNameOn(co,new Date())}」`,'ok');
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
// 老師檔只有 id/姓名/狀態；「教哪些課」存在課程側（courses.teacherIds，可多位），這裡反查顯示
function renderTeacherAdmin(){
  const box=document.getElementById('teacher-admin');
  if(!box)return;
  const rows=getTeachers().map(t=>{
    const used=getCourses().filter(c=>courseTeacherIds(c).includes(t.id));
    const retired=(t.status||'在職')==='離職';
    const courseList=used.length?used.map(c=>c.name).join('、'):'（尚未指派課程）';
    const schOpen=!!tschState&&tschState.tid===t.id;
    return`<div class="ta-row${retired?' ta-retired':''}" data-tid="${t.id}">
      <div class="ta-main">
        <div class="ta-line1">
          <input class="ta-name" value="${esc(t.name)}" maxlength="10" onchange="taRename(${t.id},this.value)" title="點擊直接改名">
          <button class="ta-status${retired?' off':''}" onclick="taToggleStatus(${t.id})" title="點擊切換在職/離職">${esc(t.status||'在職')}</button>
          <button class="ta-sch${schOpen?' on':''}" onclick="toggleTeacherSch(${t.id})" title="看這位老師週一到週日哪些時段有課">${schOpen?'收起課表':'課表'}</button>
          <span class="ta-courses">${esc(courseList)}</span>
          <button class="co-stu-x" title="刪除老師" onclick="taDelete(${t.id})">✕</button>
        </div>
        <div class="ta-count">${used.length} 門課</div>
      </div>
    </div>`+(schOpen?teacherSchHtml(t):'');
  }).join('');
  box.innerHTML=(rows||'<div class="co-empty">還沒有老師。在下方新增，或在新增課程表單裡順手建。</div>')+
    `<div class="co-add">
      <input class="cm-input" id="ta-new-name" placeholder="新老師姓名…" maxlength="10" onkeydown="if(enterSubmit(event)){taAdd()}">
      <button class="co-add-btn" onclick="taAdd()">＋ 新增</button>
    </div>`;
}
function taAdd(){
  const el=document.getElementById('ta-new-name');
  const name=(el&&el.value||'').trim();
  if(!name)return;
  if(getTeachers().some(t=>t.name===name))return toast('已有同名老師','inf');
  saveTeachers([...getTeachers(),{id:Date.now(),name,status:'在職'}]);
  logAct('student','新增老師',name,'');
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
  logAct('student',`老師改為${t.status}`,t.name,t.status==='離職'?'不再出現在新增課程的老師下拉':'');
  toast(`${t.name}：${t.status}${t.status==='離職'?'（不再出現在新增課程的老師下拉）':''}`,'ok');
  renderTeacherAdmin();
}
async function taDelete(id){
  const t=getTeachers().find(x=>x.id===id);
  if(!t)return;
  const used=getCourses().filter(c=>courseTeacherIds(c).includes(id));
  if(used.length)return toast(`不能刪：${t.name} 還有 ${used.length} 門課掛著（${used.map(c=>c.name).join('、')}）。先在那些課的編輯裡改指老師、或刪除課程。`,'err');
  const ok=await uiConfirm({title:'刪除這位老師？',ok:'刪除',danger:true,
    html:`<p>把 <b>${esc(t.name)}</b> 從老師名單移除。</p>
      <div class="ask-note ask-warn">刪掉之後救不回來。</div>`});
  if(!ok)return;
  saveTeachers(getTeachers().filter(x=>x.id!==id));
  logAct('student','刪除老師',t.name,'');
  toast(`已刪除老師 ${t.name}`,'ok');
  if(tschState&&tschState.tid===id)tschState=null;
  renderTeacherAdmin();
}

// ══════════════════════════════════════════════════════════════
// 老師個人課表（2026-08-19 老闆要求：「看到老師的個人課表」，放在老師管理頁）
// 老師檔上不存課表——課掛在課程本體（teacherIds），所以這裡是把那一週的系統課表
// 展開後篩出這個人的，週一到週日一天一格。補課／調課場次也算（那場換過老師就照
// 場次上的老師走）；整堂沒上的（請假／調課移走）畫成劃掉、不算時數。
// ══════════════════════════════════════════════════════════════
var tschState=null;   // {tid, offset}：展開哪位老師、看第幾週（0＝本週）

function toggleTeacherSch(id){
  tschState=(tschState&&tschState.tid===id)?null:{tid:id,offset:0};
  renderTeacherAdmin();
}
function tschWeek(delta){
  if(!tschState)return;
  tschState.offset=delta===0?0:tschState.offset+delta;
  renderTeacherAdmin();
}
// 這一堂是不是這位老師的：有 id 就只認 id（同名老師不會混），舊資料／快照才退回比名字
function occHasTeacher(e,t){
  if(!e||!t)return false;
  const ids=(typeof mkTeacherIds==='function')?mkTeacherIds(e):new Set();
  if(ids.size)return ids.has('t:'+t.id);
  return String(e.teacher||'').split('、').filter(Boolean).includes(t.name);
}
function teacherOccurrences(t,start,end){
  if(!t)return[];
  return[...expandCoursesForRange(start,end),...expandMakeupForRange(start,end)]
    .filter(e=>occHasTeacher(e,t)).sort((a,b)=>a.startDt-b.startDt);
}
// 第 offset 週的週一（0＝本週）
function tschMonday(offset){
  const d=new Date();d.setHours(0,0,0,0);
  d.setDate(d.getDate()-((d.getDay()+6)%7)+(offset||0)*7);
  return d;
}

// ── 老師的可排時段條件（2026-08-19 老闆要求：「適合安排／無法安排的時段」）──
// 存在老師檔上：avail:[{id,weekday,start,end,kind:'ok'|'no'}]。
// 語意刻意只有兩種、不做權重：'ok'＝這段可以排（推薦只從這裡面找）、'no'＝這段不能排（一律扣掉，跟 ok 重疊時 no 贏）。
// 一條都沒設＝系統不知道這位老師的作息，就不推薦、也不擋任何事（現有排課流程完全不受影響）。
var TSCH_WD=[[1,'週一'],[2,'週二'],[3,'週三'],[4,'週四'],[5,'週五'],[6,'週六'],[0,'週日']];
function teacherAvail(t){return Array.isArray(t&&t.avail)?t.avail:[];}
function taAvailSave(tid,list){
  const all=getTeachers().slice();
  const t=all.find(x=>x.id===tid);if(!t)return;
  t.avail=list;
  saveTeachers(all);
  renderTeacherAdmin();
}
function taAvailAdd(tid,kind){
  const t=getTeachers().find(x=>x.id===tid);if(!t)return;
  taAvailSave(tid,[...teacherAvail(t),{id:Date.now(),weekday:1,start:'16:00',end:'21:30',kind:kind||'ok'}]);
}
function taAvailSet(tid,rid,field,val){
  const t=getTeachers().find(x=>x.id===tid);if(!t)return;
  const list=teacherAvail(t).map(r=>r.id===rid?{...r,[field]:field==='weekday'?Number(val):val}:r);
  taAvailSave(tid,list);
}
function taAvailDel(tid,rid){
  const t=getTeachers().find(x=>x.id===tid);if(!t)return;
  taAvailSave(tid,teacherAvail(t).filter(r=>r.id!==rid));
}

// 區段相減：從 seg 裡挖掉 cut，回傳剩下的 0~2 段（分鐘制）
function _segMinus(seg,cut){
  if(cut.e<=seg.s||cut.s>=seg.e)return[seg];
  const out=[];
  if(cut.s>seg.s)out.push({s:seg.s,e:cut.s});
  if(cut.e<seg.e)out.push({s:cut.e,e:seg.e});
  return out;
}
function _minOfDay(d){return d.getHours()*60+d.getMinutes();}
function _dayAtMin(day,min){const d=new Date(day);d.setHours(0,min,0,0);return d;}

// 推薦時段＝「可排時段 ∩ 營業時間」－「不可排時段」－「這位老師那一週已經有的課」。
// 只列 30 分鐘以上的空檔（再短排不進一堂課），並附上那段的教室狀況——
// 光說老師有空沒用，沒教室一樣排不成，所以教室用的是排補課同一套 getRoomAvail。
function teacherFreeSlots(t,monday){
  const rules=teacherAvail(t);
  const oks=rules.filter(r=>r.kind!=='no'),nos=rules.filter(r=>r.kind==='no');
  if(!oks.length)return[];
  const out=[];
  for(let di=0;di<7;di++){
    const day=new Date(monday);day.setDate(monday.getDate()+di);day.setHours(0,0,0,0);
    const dayEnd=new Date(day);dayEnd.setHours(23,59,59,999);
    const wd=day.getDay();
    if(!oks.some(r=>Number(r.weekday)===wd))continue;
    const biz=bizHoursOn(day);
    const evs=[...expandCoursesForRange(day,dayEnd),...expandMakeupForRange(day,dayEnd)];
    const busy=[
      ...evs.filter(e=>occHasTeacher(e,t)&&!e.isFullAbsent&&!e.isRescheduled)
        .map(e=>({s:_minOfDay(e.startDt),e:_minOfDay(e.endDt)})),
      ...nos.filter(r=>Number(r.weekday)===wd).map(r=>({s:hhmmToMin(r.start),e:hhmmToMin(r.end)})),
    ];
    oks.filter(r=>Number(r.weekday)===wd).forEach(r=>{
      let segs=[{s:Math.max(hhmmToMin(r.start),biz.start),e:Math.min(hhmmToMin(r.end),biz.end)}].filter(x=>x.e>x.s);
      busy.forEach(b=>{segs=segs.flatMap(sg=>_segMinus(sg,b));});
      segs.filter(sg=>sg.e-sg.s>=30).forEach(sg=>out.push({day:new Date(day),di,...sg,rooms:tschRoomsFree(evs,day,sg)}));
    });
  }
  return out.sort((a,b)=>a.di-b.di||a.s-b.s);
}
// 那個空檔有哪些教室排得進去（大教室看家教桌數，小教室是一次一堂）
function tschRoomsFree(evs,day,sg){
  const s=_dayAtMin(day,sg.s),e=_dayAtMin(day,sg.e);
  const big=getRoomAvail(evs,'大教室',s,e);
  const small=ROOMS_SMALL.filter(r=>getRoomAvail(evs,r,s,e).available);
  return{bigFree:big.free,small};
}

// ── 畫面 ──
function teacherSchHtml(t){
  const mon=tschMonday(tschState.offset);
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);sun.setHours(23,59,59,999);
  const evs=teacherOccurrences(t,mon,sun);
  const live=evs.filter(e=>!e.isFullAbsent&&!e.isRescheduled);
  const mins=live.reduce((s,e)=>s+(e.durMins||0),0);
  const stu=new Set(live.flatMap(e=>e.students||[])).size;
  const off=evs.length-live.length;
  const today=new Date();today.setHours(0,0,0,0);
  const wkLbl=tschState.offset===0?'本週':tschState.offset===1?'下一週':tschState.offset===-1?'上一週'
    :(tschState.offset>0?`往後 ${tschState.offset} 週`:`往前 ${Math.abs(tschState.offset)} 週`);

  // 七格：一天一格，格內按時間排
  const days=[];
  for(let di=0;di<7;di++){
    const d=new Date(mon);d.setDate(mon.getDate()+di);d.setHours(0,0,0,0);
    const de=new Date(d);de.setHours(23,59,59,999);
    const list=evs.filter(e=>e.startDt>=d&&e.startDt<=de);
    const isToday=d.getTime()===today.getTime();
    const blocks=list.map(e=>{
      const dead=e.isFullAbsent||e.isRescheduled;
      const tag=e.isRescheduled?'調課移走':e.isFullAbsent?(e.absType||'整堂沒上'):'';
      const n=(e.students||[]).length;
      const leave=!dead&&(e.absentStudents||[]).length?`・${e.absentStudents.length} 人請假`:'';
      return`<div class="tsch-blk${dead?' tsch-dead':''}" style="border-left-color:${calColor(e.calName)}" title="${esc((e.origTitle||'')+' ／ '+(e.classroom||'未指定教室'))}">
        <span class="tsch-t">${fmtT(e.startDt)}–${fmtT(e.endDt)}</span>
        <span class="tsch-n">${esc(e.origTitle||'(未命名)')}</span>
        <span class="tsch-m">${esc(e.classroom||'未指定教室')}${n?`・${n} 人`:''}${leave}</span>
        ${tag?`<span class="tsch-tag">${esc(tag)}</span>`:''}
      </div>`;
    }).join('');
    days.push(`<div class="tsch-day${isToday?' tsch-today':''}">
      <div class="tsch-dhd"><b>${TSCH_WD[di][1]}</b><span>${d.getMonth()+1}/${d.getDate()}${isToday?'・今天':''}</span></div>
      ${blocks||'<div class="tsch-none">沒課</div>'}
    </div>`);
  }

  // 可排時段條件（沒設過就先講這塊是幹嘛的）
  const rules=teacherAvail(t);
  const ruleRows=rules.map(r=>`<div class="tsch-rule${r.kind==='no'?' no':''}">
    <select class="tsch-sel" onchange="taAvailSet(${t.id},${r.id},'weekday',this.value)">
      ${TSCH_WD.map(([v,l])=>`<option value="${v}"${Number(r.weekday)===v?' selected':''}>${l}</option>`).join('')}
    </select>
    <input class="tsch-time-in" type="time" value="${esc(r.start)}" onchange="taAvailSet(${t.id},${r.id},'start',this.value)">
    <span class="tsch-dash">–</span>
    <input class="tsch-time-in" type="time" value="${esc(r.end)}" onchange="taAvailSet(${t.id},${r.id},'end',this.value)">
    <select class="tsch-sel" onchange="taAvailSet(${t.id},${r.id},'kind',this.value)">
      <option value="ok"${r.kind!=='no'?' selected':''}>可以排</option>
      <option value="no"${r.kind==='no'?' selected':''}>不能排</option>
    </select>
    <button class="co-stu-x" title="刪掉這條" onclick="taAvailDel(${t.id},${r.id})">✕</button>
  </div>`).join('');

  // 推薦（依上面的條件算這一週）
  const free=teacherFreeSlots(t,mon);
  const recBody=!rules.some(r=>r.kind!=='no')
    ? `<div class="tsch-none">還沒設「可以排」的時段——上面加一條，這裡就會算出這一週哪幾段排得進去。</div>`
    : (!free.length
      ? `<div class="tsch-none">這一週的可排時段都被自己的課或「不能排」佔滿了（換一週看看）。</div>`
      : free.map(f=>{
          const len=f.e-f.s;
          const roomTxt=[f.rooms.bigFree>0?`大教室 ${f.rooms.bigFree} 桌`:'',f.rooms.small.length?`${f.rooms.small.join('／')} 空著`:'']
            .filter(Boolean).join('・')||'⚠ 這段沒有空教室';
          return`<div class="tsch-rec${f.rooms.bigFree<=0&&!f.rooms.small.length?' warn':''}">
            <span class="tsch-rec-d">${TSCH_WD[f.di][1]} ${f.day.getMonth()+1}/${f.day.getDate()}</span>
            <span class="tsch-rec-t">${minToHHMM(f.s)}–${minToHHMM(f.e)}</span>
            <span class="tsch-rec-len">${len>=60?`${(len/60).toFixed(len%60?1:0)} 小時`:`${len} 分`}</span>
            <span class="tsch-rec-r">${esc(roomTxt)}</span>
          </div>`;
        }).join(''));

  return`<div class="tsch">
    <div class="tsch-hd">
      <span class="tsch-title">${esc(t.name)} 的課表</span>
      <span class="tsch-range">${wkLbl}　${mon.getMonth()+1}/${mon.getDate()}（一）～${sun.getMonth()+1}/${sun.getDate()}（日）</span>
      <span class="tsch-nav">
        <button class="dbtn" onclick="tschWeek(-1)">‹ 上一週</button>
        <button class="dbtn" onclick="tschWeek(0)">本週</button>
        <button class="dbtn" onclick="tschWeek(1)">下一週 ›</button>
      </span>
    </div>
    <div class="tsch-sum">
      <span>這週 <b>${live.length}</b> 堂</span>
      <span>共 <b>${(mins/60).toFixed(mins%60?1:0)}</b> 小時</span>
      <span>教到 <b>${stu}</b> 位學生</span>
      ${off?`<span class="tsch-sum-off">${off} 堂沒上（請假／調課）</span>`:''}
    </div>
    <div class="tsch-grid">${days.join('')}</div>
    <div class="tsch-sec">
      <div class="tsch-sec-hd">可排時段條件<span class="tsch-sec-sub">「可以排」是推薦的來源，「不能排」一律扣掉。一條都沒設＝系統不猜，也不會擋任何現有排課流程。</span></div>
      ${ruleRows||'<div class="tsch-none">還沒設定。</div>'}
      <div class="tsch-rule-add">
        <button class="co-add-btn" onclick="taAvailAdd(${t.id},'ok')">＋ 可以排的時段</button>
        <button class="co-add-btn" onclick="taAvailAdd(${t.id},'no')">＋ 不能排的時段</button>
      </div>
    </div>
    <div class="tsch-sec">
      <div class="tsch-sec-hd">這一週推薦排這裡<span class="tsch-sec-sub">＝可排時段 ∩ 營業時間 －「不能排」－ 他自己已經有的課；30 分鐘以上才列，附當下的空教室（跟排補課同一套教室規則）。</span></div>
      ${recBody}
    </div>
  </div>`;
}

// ── 課程總覽整合：把系統課塞進週課表矩陣 ──
// weekly slot 合成「本週該星期」的 Date 讓矩陣排位；dates slot 用實際日期
function sysCourseSessions(co){
  const sched=co.schedule||{};
  const mon=new Date();mon.setHours(0,0,0,0);
  mon.setDate(mon.getDate()-((mon.getDay()+6)%7)); // 本週一
  // 每週重複：用「本週生效的段」的時段（多段依日期切換）；指定日期照舊
  const slots=sched.mode==='dates'?(sched.slots||[]):_activePhase(_schedulePhases(sched),mon).slots;
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
    return{date:d,students:[],groups:[],classroom:co.room,teacher:courseTeacherNames(co).join('、')};
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

// 名單加入的入口只剩 ✎ 編輯課程（cfEnrollNow）——課程視窗那顆加入框 2026-07-31 拿掉，
// 它只認得既有學生、建不了新檔，留著就是兩套規則。
function sysSetPracticeSubject(enId,val){
  const list=getEnrollments().slice();
  const en=list.find(e=>e.id===enId);
  if(!en)return;
  en.practiceSubject=val.trim();
  saveEnrollments(list);
}

// ── 修課起訖：期中人數變動（插班／中途退出）──
// 資料層 startDate/endDate 都是**含當日**（見 enrollment.js）；
// UI 一律講「從 X 起」——「從 X 起不上」存成 endDate = X 的前一天，換算只在這裡做。
// 為什麼不直接退課：退課是整筆刪除，過去的堂數與自訂單價會一起消失，
// 回頭看 7 月的課堂名冊也會變少人。設起訖則是「8 月起才少一人」。
function coDateParse(s){const[y,m,d]=String(s||'').split('-').map(Number);return(y&&m&&d)?new Date(y,m-1,d):null;}
function coDateShift(s,n){const d=coDateParse(s);if(!d)return'';d.setDate(d.getDate()+n);return toDateStr(d);}
function coDateMD(s){const d=coDateParse(s);return d?`${d.getMonth()+1}/${d.getDate()}`:'';}

// 名單 pill 上的起訖標籤；沒設起訖就不顯示
function sysWindowChip(en){
  const parts=[];
  if(en.startDate)parts.push(`${coDateMD(en.startDate)} 起加入`);
  if(en.endDate)parts.push(`${coDateMD(coDateShift(en.endDate,1))} 起退出`);
  return parts.length?`<span class="co-stu-win">${esc(parts.join('・'))}</span>`:'';
}

var _sysDateEdit=null; // {enId, joinFrom, leaveFrom}——leaveFrom 是「起不上」那天（＝endDate+1）

function sysDateEditOpen(enId){
  const en=getEnrollments().find(e=>e.id===enId);
  if(!en)return;
  _sysDateEdit=_sysDateEdit&&_sysDateEdit.enId===enId
    ?null // 再點一次 📅 收合
    :{enId,joinFrom:en.startDate||'',leaveFrom:en.endDate?coDateShift(en.endDate,1):''};
  refreshCourseModal();
}
function sysDateEditCancel(){_sysDateEdit=null;refreshCourseModal();}
function sysDateSet(f,v){if(_sysDateEdit)_sysDateEdit[f]=v;refreshCourseModal();}
function sysDatePreset(f,mo,dd){if(_sysDateEdit)_sysDateEdit[f]=cfNextTermDate(mo,dd);refreshCourseModal();}

function sysDateEditorHtml(ens){
  const st=_sysDateEdit;
  if(!st)return'';
  const en=ens.find(e=>e.id===st.enId);
  if(!en)return''; // 編輯中的那筆不屬於這門課（換課程視窗）→ 不顯示
  const presets=f=>CF_TERM_STARTS.map(([lbl,mo,dd])=>`<button type="button" class="cf-term-btn" onclick="sysDatePreset('${f}',${mo},${dd})">${lbl}</button>`).join('');
  // 把換算結果講白，避免「含當天不含當天」猜來猜去
  let sum='';
  if(st.leaveFrom)sum=`最後一堂是 ${coDateMD(coDateShift(st.leaveFrom,-1))}（含當天），${coDateMD(st.leaveFrom)} 起的課堂名單就沒有他`;
  else if(st.joinFrom)sum=`${coDateMD(st.joinFrom)} 起的課堂名單才有他，之前的堂不算`;
  else sum='目前沒有設起訖＝整個期別都上';
  return`<div class="co-dates">
    <div class="co-dates-hd">${esc(studentName(en.studentId))} 的修課起訖</div>
    <div class="co-dates-row">
      <span class="cf-phase-lbl">從</span>
      <input type="date" class="cf-phase-date" value="${esc(st.joinFrom)}" onchange="sysDateSet('joinFrom',this.value)">
      <span class="cf-phase-lbl">起加入</span>
      <span class="cf-phase-presets">${presets('joinFrom')}</span>
    </div>
    <div class="co-dates-row">
      <span class="cf-phase-lbl">從</span>
      <input type="date" class="cf-phase-date" value="${esc(st.leaveFrom)}" onchange="sysDateSet('leaveFrom',this.value)">
      <span class="cf-phase-lbl">起不上</span>
      <span class="cf-phase-presets">${presets('leaveFrom')}</span>
    </div>
    <div class="co-dates-sum">→ ${esc(sum)}</div>
    <div class="co-dates-foot">
      <button class="btn btns" onclick="sysDateClear()">清除起訖</button>
      <span style="flex:1"></span>
      <button class="btn btns" onclick="sysDateEditCancel()">取消</button>
      <button class="btn btns btnp" onclick="sysDateSave()">儲存</button>
    </div>
  </div>`;
}

function sysDateClear(){if(_sysDateEdit){_sysDateEdit.joinFrom='';_sysDateEdit.leaveFrom='';}refreshCourseModal();}

async function sysDateSave(){
  const st=_sysDateEdit;
  if(!st)return;
  const list=getEnrollments().slice();
  const en=list.find(e=>e.id===st.enId);
  if(!en)return;
  const startDate=st.joinFrom||null;
  const endDate=st.leaveFrom?coDateShift(st.leaveFrom,-1):null;
  if(startDate&&endDate&&startDate>endDate)return toast('「起加入」比「起不上」晚，日期反了','err');
  en.startDate=startDate;en.endDate=endDate;
  saveEnrollments(list);
  logAct('roster',
    startDate||endDate?`調整 ${studentName(en.studentId)} 的修課起訖`:`清除 ${studentName(en.studentId)} 的修課起訖`,
    en.courseTitle||'',
    [startDate?`${coDateMD(startDate)} 起加入`:'',endDate?`${coDateMD(coDateShift(endDate,1))} 起不上`:'']
      .filter(Boolean).join('、')||'整期都上');
  _sysDateEdit=null;
  toast(startDate||endDate
    ?`已設定 ${studentName(en.studentId)} 的修課起訖`
    :`已清除 ${studentName(en.studentId)} 的修課起訖（整期都上）`,'ok');
  // 人數變了 → 順手問課名要不要一起改（起訖與課名分段是同一件事的兩半）
  const changeDay=st.leaveFrom||st.joinFrom;
  if(changeDay&&en.courseId!=null)await sysOfferNamePhase(en.courseId,changeDay);
  renderSettings();
  refreshCourseModal();
  refreshStudentModal();
}

// 設完修課起訖後：那天起名單變了，課名通常也該變。算出建議名字問一次，按確定就寫課名分段。
// 只在「建議名字 ≠ 那天原本的課名」且該日期還沒有分段時問，不重複騷擾。
// 2026-08-03：自動命名的課已經自己會滾（courseNameOn），不用問也不該問——
// 問了反而是把會動的名字釘死成一段。只剩「手取名字」的課才需要這一問。
async function sysOfferNamePhase(courseId,day){
  const co=findCourseById(courseId);
  if(!co)return;
  if(courseNameIsAuto(co))return;                       // 自動命名＝課名自己會跟著滾
  if(courseNamePhases(co).some(p=>p.from===day))return; // 那天已經有分段了
  const suggest=courseSuggestNameOn(co,day);
  const curName=courseNameOn(co,day);
  if(!suggest||suggest===curName)return;
  const ok=await uiConfirm({title:'課名要一起改嗎？',ok:'改課名',cancel:'先不改',
    html:`<p><b>${esc(coDateMD(day))}</b> 起這門課的名單變了，課名建議同步改成：</p>
      <p class="ask-big">${esc(suggest)}</p>
      <div class="ask-note">${esc(coDateMD(day))} 之前的課堂仍顯示「${esc(curName)}」。不改也可以，之後在 ✎ 編輯課程的「＋ 換課名」隨時能設。</div>`});
  if(!ok)return;
  const list=getCourses().slice();
  const c=list.find(x=>x.id===courseId);
  if(!c)return;
  c.namePhases=[...courseNamePhases(c),{from:day,name:suggest}]
    .sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);
  saveCourses(list);
  toast(`${coDateMD(day)} 起改叫「${suggest}」`,'ok');
}

// 時段標籤（modal meta 用）；多段時附各段「起始日→時段」
function sysSlotLabel(co){
  const sched=co.schedule||{};
  const slots=sched.slots||[];
  if(sched.mode==='dates')
    return slots.map(s=>{
      if(!s.date)return'';
      const[y,m,d]=s.date.split('-').map(Number);
      return`${m}/${d} ${s.start}–${s.end}`;
    }).filter(Boolean).join('、');
  const wk=ss=>ss.map(s=>`${CF_WD_LABEL[s.weekday]||''} ${s.start}–${s.end}`).join('、');
  let out=wk(slots);
  (sched.phases||[]).filter(p=>p&&p.from&&p.slots&&p.slots.length).forEach(p=>{
    const[,m,d]=String(p.from).split('-').map(Number);
    out+=`　→ ${m}/${d}起 ${wk(p.slots)}`;
  });
  return out;
}

// ── 名單 chips（課程視窗與 ✎ 編輯課程共用同一份）──
// 每個 pill＝一筆 enrollment：練習課帶科目、其餘顯示單價，設過起訖的淡色並標「X/X 起退出」。
// ro=true（課程視窗）＝純看，不給按鈕；ro=false（編輯課程）＝可改科目、📅 設起訖、✕ 整筆退課。
// 兩處共用是刻意的：名單只有登記簿一個真相，長相一致才不會以為是兩份資料。
function sysRosterHtml(co,ens,ro){
  if(!ens.length)return`<div class="co-empty">還沒有學生。</div>`;
  const isPractice=co.type==='練習課',noFee=(co.type==='練習課'||co.type==='試聽');
  const today=toDateStr(new Date());
  const anyWindow=ens.some(en=>en.startDate||en.endDate);
  return`<div class="co-roster${ro?' co-roster-ro':''}">`+ens.map(en=>{
      const p=en.price??co.defaultPrice; // 系統課預設價在課程本體，不查價目表
      const extra=isPractice
        ?(ro
          ?(en.practiceSubject?`<span class="co-stu-subj">${esc(pracSubjLabel(en.practiceSubject))}</span>`:'<span class="co-undef">未填科目</span>')
          :`<input class="cf-chip-subj" list="cf-subjects" value="${esc(en.practiceSubject||'')}" placeholder="科目（多科用、分隔）" onchange="sysSetPracticeSubject(${en.id},this.value)">`)
        :(noFee?'':`<span class="co-stu-price">${p==null?'<span class="co-undef">未定價</span>':p}</span>`);
      const win=sysWindowChip(en);
      const off=!enrollmentActiveOn(en,today); // 今天不在區間內＝淡色（已退出／還沒開始）
      const btns=ro?''
        :`<button class="co-stu-cal" title="設定修課起訖（插班／中途退出）" onclick="sysDateEditOpen(${en.id})">📅</button>`+
         `<button class="co-stu-x" title="退課（整筆刪除）" onclick="coRemoveEnroll(${en.id})">✕</button>`;
      return`<span class="co-stu${off?' co-stu-off':''}">${esc(studentName(en.studentId))}${extra}${win}${btns}</span>`;
    }).join('')+`</div>`+(ro?'':sysDateEditorHtml(ens))+
    (anyWindow?`<div class="cm-hint">淡色＝今天不在他的修課區間內；名單人數會依課堂日期自動變（過去的堂數不受影響）。</div>`:'');
}

// ── 系統課程詳情 modal（settings.js renderCourseModal 分流過來）──
// 2026-07-31 起這扇視窗**只給看**：一張對齊的事實表＋名單，所有更動走 ✎ 編輯課程。
// 為什麼：同一件事有兩個入口，就會有兩套規則慢慢走鐘（加入框在這裡建不了新學生就是一例）。
function renderSysCourseModal(ctx){
  const co=ctx.c.sys;
  // 標題＝今天生效的課名；課名分段（namePhases）時把之後要改的名字列進事實表
  document.getElementById('course-modal-title').textContent=courseNameOn(co,new Date());
  const noFee=(co.type==='練習課'||co.type==='試聽');
  const isPractice=co.type==='練習課';
  const ens=getEnrollments({periodId:yearPeriodId()}).filter(en=>en.courseId===co.id);
  const today=toDateStr(new Date());
  const activeN=ens.filter(en=>enrollmentActiveOn(en,today)).length;

  // 類型＝今天生效的型（滾動判型：看今天在籍幾個人）；跟課程本體的型不一樣時講一句為什麼
  const typeNow=courseTypeOn(co,today);
  const typeSub=co.typePinned?'<span class="cm-fact-sub">已鎖定，不隨人數變</span>'
    :(typeNow!==co.type?`<span class="cm-fact-sub">今天 ${activeN} 人・課型隨在籍人數變（開課時為${esc(co.type||'未分類')}）</span>`:'');

  // 事實表：一行一件事、標籤對齊，掃一眼就看完（沒填的整行不出現）
  const fact=(k,v)=>v?`<div class="cm-fact"><span class="cm-fact-k">${k}</span><span class="cm-fact-v">${v}</span></div>`:'';
  const nameSched=courseNamePhases(co).map(p=>`${esc(coDateMD(p.from))} 起改叫「${esc(p.name)}」`).join('<br>');
  const facts=`<div class="cm-facts">
    ${fact('類型',`<span class="cm-tag">${esc(typeNow||'未分類')}</span>${co.needsGrade?'<span class="cm-tag">需登記成績</span>':'<span class="cm-tag cm-tag-off">只點名</span>'}${typeSub}`)}
    ${fact('時段',esc(sysSlotLabel(co))||'<span class="co-undef">未排時段</span>')}
    ${fact('老師',esc(courseTeacherNames(co).join('、'))||'<span class="co-undef">未指定</span>')}
    ${fact('教室',esc(co.room)||'不指定')}
    ${fact('科目',esc(co.subject))}
    ${fact('每堂收費',noFee
      ?`不收費<span class="cm-fact-sub">${esc(co.type)}不進學費結算</span>`
      :(co.defaultPrice!=null?`${co.defaultPrice} 元/堂<span class="cm-fact-sub">課程預設價，個別優惠看名單上的數字</span>`:'<span class="co-undef">未定價</span>'))}
    ${fact('老師費率',isPractice?'打卡制<span class="cm-fact-sub">不在系統內設費率</span>'
      :(co.teacherRate!=null?`${co.teacherRate} ${esc(cfRateUnit(co.type))}${typeNow!==co.type?`<span class="cm-fact-sub">單位固定跟開課時的${esc(co.type)}走，不隨人數變</span>`:''}`:'<span class="co-undef">未定</span>'))}
    ${fact('來源管道',co.type==='試聽'?esc(co.sourceChannel):'')}
    ${fact('課名變更',nameSched)}
  </div>`;

  // 練習課：先按年級、再按科目分組的唯讀總覽（#7）
  let groupView='';
  if(isPractice&&ens.length){
    const byGrade={};
    ens.forEach(en=>{const g=(getStudentList().find(s=>s.id===en.studentId)||{}).grade||'未分年級';(byGrade[g]=byGrade[g]||[]).push(en);});
    const gradeOrder=(typeof GRADES!=='undefined'?GRADES:[]);
    const gkeys=Object.keys(byGrade).sort((a,b)=>{const ia=gradeOrder.indexOf(a),ib=gradeOrder.indexOf(b);return(ia<0?99:ia)-(ib<0?99:ib);});
    groupView=`<div class="cm-sec"><div class="cm-lbl">名單總覽（年級 → 科目）</div>`+gkeys.map(g=>{
      const bySubj={};
      byGrade[g].forEach(en=>{const subs=pracSubjCats(en.practiceSubject);(subs.length?subs:['（未填科目）']).forEach(s=>{(bySubj[s]=bySubj[s]||[]).push(studentName(en.studentId));});});
      return`<div class="pv-grade"><div class="pv-grade-hd">${esc(g)}</div>`+Object.entries(bySubj).map(([s,ns])=>`<div class="pv-subj"><span class="pv-subj-n">${esc(s)}</span>${esc(ns.join('、'))}</div>`).join('')+`</div>`;
    }).join('')+`</div>`;
  }

  // 名單只顯示不編輯；今天在籍人數與登記人數不同時（有人已退出／還沒開始）把兩個數字都講出來
  const rosterSec=`<div class="cm-sec"><div class="cm-lbl">名單<span class="cm-count">${ens.length}</span>${
      ens.length&&activeN!==ens.length?`<span class="cm-lbl-sub">今天在籍 ${activeN} 人</span>`:''
    }</div>${sysRosterHtml(co,ens,true)}</div>`;

  const btns=`<div class="cf-foot">
    <button class="btn btns btnp" onclick="closeCourseModal();openCourseForm(${co.id})">✎ 編輯課程</button>
    <button class="btn btns cf-danger" onclick="deleteCourse(${co.id})">🗑 刪除課程</button>
  </div>`;

  document.getElementById('course-modal-body').innerHTML=
    facts+groupView+rosterSec+
    `<div class="cm-hint">這扇視窗只顯示現況。加退學生、設修課起訖、改時段／收費／課名 → 按 ✎ 編輯課程。</div>`+btns;
}
