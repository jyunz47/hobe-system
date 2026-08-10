// 全站搜尋（頂欄）：打字即找，點一下或 Enter 直接跳到那筆的視窗。
// 索引全部現算——資料都在 driveData（幾百筆等級），維護快取的成本大於重算。
// 比對與排序是純函式（gsTokens / gsHitAll / gsScore / gsBuild / gsCourseOccs），
// tests/search.test.js 直接測，不碰 DOM。
//
// 四種結果 × 四個去處（目的地都已經存在，這裡只是把人送過去）：
//   課程主頁（occ）  一堂課 → 把主頁日期切到那天、開課堂視窗（點名／成績／請假調課都在裡面）
//                    ⚠ 未來日期也找得到：不是只看已載入的今日/本週，是現場展開未來 GS_OCC_DAYS 天
//   課程管理（course）課程本體 → 切課程管理、開課程視窗（名單／單價／✎ 編輯課程）
//   老師（teacher）   → 切老師管理、捲到那一列並閃一下（.ta-row[data-tid]）
//   學生（student）   → 直接開學生視窗（不換頁）

var GS_MAX=5;            // 每組最多顯示幾筆，其餘收成「還有 N 筆」
var GS_OCC_DAYS=45;      // 「課程主頁」往後找幾天的課堂
var GS_OCC_PER_COURSE=3; // 同一門課最多列幾堂（列太多會把別門課擠掉）
var GS_OCC_COURSES=6;    // 最多幫幾門課展開課堂（展開要逐日掃，門數要有上限）
var GS_WD=['週日','週一','週二','週三','週四','週五','週六'];
var GS_LABEL={occ:'課程主頁',course:'課程管理',teacher:'老師',student:'學生'};
var GS_ICON={occ:'堂',course:'課','course-legacy':'課',teacher:'師',student:'生'};

var gsState={q:'',groups:[],flat:[],idx:-1,open:false};

// ── 比對核心（純函式）──
function gsNorm(s){return String(s==null?'':s).trim().toLowerCase();}
function gsTokens(q){return gsNorm(q).split(/\s+/).filter(Boolean);}
// 多關鍵字＝AND：每個字都要在某個欄位裡出現（例：「王 數學」＝王老師的數學課）
function gsHitAll(fields,toks){
  const hays=fields.map(gsNorm).filter(Boolean);
  return toks.length>0&&toks.every(t=>hays.some(h=>h.includes(t)));
}
// 排序分數（越小越前）：完全相同 0、開頭 1、包含 2、名字沒中（靠關聯欄位找到的）3
function gsScore(name,toks){
  const n=gsNorm(name);
  if(!n)return 3;
  let best=3;
  toks.forEach(t=>{
    const s=n===t?0:n.startsWith(t)?1:n.includes(t)?2:3;
    if(s<best)best=s;
  });
  return best;
}
// 名字沒中的時候，說一句是靠哪個欄位找到的（「老師：王小明」）
function gsWhy(toks,pairs){
  for(const[val,lbl]of pairs){
    if(!lbl||!val)continue;
    const v=gsNorm(val);
    if(toks.some(t=>v.includes(t)))return lbl+'：'+val;
  }
  return '';
}

// 這門課接下來的幾堂（含未來日期）。從今天 00:00 起算——今天稍早上完的那堂還要進得去
// （補登點名／成績），往後掃 GS_OCC_DAYS 天。已結束／沒排程的課自然回空陣列。
function gsCourseOccs(co,perCourse){
  if(typeof courseOccurrencesInRange!=='function')return[];
  const from=new Date();from.setHours(0,0,0,0);
  const to=new Date(from);to.setDate(to.getDate()+GS_OCC_DAYS);
  let occs=[];
  try{occs=courseOccurrencesInRange(co,from,to)||[];}catch(_){return[];}
  return occs.sort((a,b)=>a.startDt-b.startDt).slice(0,perCourse||GS_OCC_PER_COURSE);
}

// 課堂日期：今天／明天講白話，其餘寫 8/13（四）
function gsOccWhen(d){
  const t=new Date();t.setHours(0,0,0,0);
  const day=new Date(d);day.setHours(0,0,0,0);
  const diff=Math.round((day-t)/864e5);
  if(diff===0)return'今天';
  if(diff===1)return'明天';
  return`${d.getMonth()+1}/${d.getDate()}（${GS_WD[d.getDay()].slice(1)}）`;
}

// 課程的上課時間摘要（本週生效的時段，最多列兩筆）
function gsCourseWhen(co){
  if(typeof sysCourseSessions!=='function')return '';
  let sess=[];
  try{sess=sysCourseSessions(co)||[];}catch(_){return '';}
  const seen=new Set();
  const bits=[];
  sess.forEach(s=>{
    const d=s.date;
    if(!(d instanceof Date)||isNaN(d))return;
    const txt=`${GS_WD[d.getDay()]} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    if(seen.has(txt))return;
    seen.add(txt);bits.push(txt);
  });
  return bits.slice(0,2).join(' / ')+(bits.length>2?' …':'');
}

// ── 命中的課程（課程管理那組、課程主頁那組、桌面日曆搜尋，三邊吃同一份）──
// 回傳 [{co,score,why,name,meta}]，已依分數排好
function gsCourseHits(toks){
  if(!toks.length)return[];
  const today=new Date(),todayStr=toDateStr(today);
  const stuName=new Map(getStudentList().map(s=>[s.id,s.name]));
  const byCourse=new Map();
  getEnrollments({periodId:yearPeriodId()}).forEach(en=>{
    if(en.courseId==null)return;
    if(!byCourse.has(en.courseId))byCourse.set(en.courseId,[]);
    byCourse.get(en.courseId).push(en);
  });
  const hits=[];
  getCourses().forEach(co=>{
    const name=courseNameOn(co,today);
    const tNames=courseTeacherNames(co);
    const roster=byCourse.get(co.id)||[];
    const sNames=roster.map(en=>stuName.get(en.studentId)).filter(Boolean);
    if(!gsHitAll([name,co.subject,co.room,...tNames,...sNames],toks))return;
    let score=gsScore(name,toks);
    if(score===3&&tNames.some(n=>gsScore(n,toks)<3))score=2.4;   // 用老師名找到的，排在課名命中之後
    const why=score<3?'':gsWhy(toks,[[co.subject,'科目'],[co.room,'教室'],
      ...tNames.map(n=>[n,'老師']),...sNames.map(n=>[n,'學生'])]);
    const meta=[courseTypeOn(co,todayStr),gsCourseWhen(co),
      tNames.length?'👤 '+tNames.join('、'):'',co.room?'🏫 '+co.room:'',roster.length+' 人']
      .filter(Boolean).join('　·　');
    hits.push({co,score,why,name,meta});
  });
  return hits.sort((a,b)=>a.score-b.score);
}

// 命中的課程 → 一堂一堂的課（含未來日期）。
// 只幫命中最好的幾門課展開，一門最多列幾堂——展開要逐日掃，沒有上限的話打一個「數」字就掃穿全部課程。
function gsOccRows(hits,perCourse){
  const rows=[];
  hits.slice(0,GS_OCC_COURSES).forEach(({co,score,why})=>{
    gsCourseOccs(co,perCourse).forEach(occ=>{
      rows.push({kind:'occ',id:occ.id,courseId:co.id,occTs:occ.startDt.getTime(),
        name:occ.origTitle||courseNameOn(co,occ.startDt),
        // 分數沿用課程本體的（哪門課比較符合）；同分的一律按日期排——
        // 「接下來這幾堂」照時間走才讀得下去，混著課名排會變成 8/11、8/12、8/14、8/19、8/18
        score,why,meta:gsOccMeta(occ)});
    });
  });
  return rows;
}

// 已排的補課／調課場次也是行事曆上的一堂課，一樣要搜得到（它們不屬於任何課程本體，自己一條路）
function gsMakeupOccs(toks){
  if(!toks.length||typeof expandMakeupForRange!=='function')return[];
  const from=new Date();from.setHours(0,0,0,0);
  const to=new Date(from);to.setDate(to.getDate()+GS_OCC_DAYS);
  let list=[];
  try{list=expandMakeupForRange(from,to)||[];}catch(_){return[];}
  return list
    .filter(e=>gsHitAll([e.origTitle,e.teacher,e.classroom,e.calName,...(e.students||[])],toks))
    .map(e=>({kind:'occ',id:e.id,courseId:null,occTs:e.startDt.getTime(),name:e.origTitle,
      score:gsScore(e.origTitle,toks),why:'',meta:gsOccMeta(e,e.calName)}));
}

function gsOccMeta(occ,tag){
  return[tag||'',gsOccWhen(occ.startDt),`${fmtT(occ.startDt)}–${fmtT(occ.endDt)}`,
    occ.teacher?'👤 '+occ.teacher:'',occ.classroom?'🏫 '+occ.classroom:'',
    (typeof eventRoster==='function'?eventRoster(occ):(occ.students||[])).length+' 人']
    .filter(Boolean).join('　·　');
}

// ── 建結果（頂欄搜尋的四組）──
// 回傳 [{kind,id,name,meta,why,score}]；kind='occ'|'course'|'course-legacy'|'teacher'|'student'
function gsBuild(q){
  const toks=gsTokens(q);
  if(!toks.length)return[];
  const today=new Date();
  const students=getStudentList();
  const ens=getEnrollments({periodId:yearPeriodId()});
  const byCourse=new Map(),byStudent=new Map();
  ens.forEach(en=>{
    const ck=en.courseId!=null?('sys'+en.courseId):('t:'+(en.courseTitle||''));
    if(!byCourse.has(ck))byCourse.set(ck,[]);
    byCourse.get(ck).push(en);
    if(!byStudent.has(en.studentId))byStudent.set(en.studentId,[]);
    byStudent.get(en.studentId).push(en);
  });
  const courses=getCourses();
  const courseName=id=>{const co=courses.find(c=>c.id===id);return co?courseNameOn(co,today):'';};
  const out=[];

  // ── 課程管理：課程本體 ／ 課程主頁：一堂一堂的課 ──
  const hits=gsCourseHits(toks);
  hits.forEach(h=>out.push({kind:'course',id:h.co.id,name:h.name,meta:h.meta,score:h.score,why:h.why}));
  gsOccRows(hits).forEach(r=>out.push(r));
  gsMakeupOccs(toks).forEach(r=>out.push(r));

  // ── 舊行事曆時代留下的課（只有課名，cutover 後通常沒有；有就別讓它搜不到）──
  const legacy=new Set();
  ens.forEach(en=>{if(en.courseId==null&&(en.courseTitle||'').trim())legacy.add(en.courseTitle.trim());});
  (typeof getCoursePrices==='function'?getCoursePrices():[]).forEach(p=>{
    if((p.title||'').trim())legacy.add(p.title.trim());
  });
  legacy.forEach(title=>{
    if(!gsHitAll([title],toks))return;
    const roster=byCourse.get('t:'+title)||[];
    out.push({kind:'course-legacy',id:title,name:title,score:gsScore(title,toks),why:'',
      meta:['舊課（無課程檔）',roster.length+' 人'].join('　·　')});
  });

  // ── 老師 ──
  getTeachers().forEach(t=>{
    const mine=courses.filter(c=>courseTeacherIds(c).includes(t.id));
    const coNames=mine.map(c=>courseNameOn(c,today)).filter(Boolean);
    if(!gsHitAll([t.name,...coNames],toks))return;
    const score=gsScore(t.name,toks);
    const retired=(t.status||'在職')==='離職';
    out.push({kind:'teacher',id:t.id,name:t.name,score:score+(retired?0.5:0),
      meta:[retired?'離職':'在職',mine.length+' 門課',coNames.slice(0,3).join('、')].filter(Boolean).join('　·　'),
      why:score<3?'':gsWhy(toks,coNames.map(n=>[n,'教']))});
  });

  // ── 學生 ──
  students.forEach(s=>{
    const mine=byStudent.get(s.id)||[];
    const coNames=mine.map(en=>en.courseId!=null?courseName(en.courseId):(en.courseTitle||'')).filter(Boolean);
    if(!gsHitAll([s.name,s.school,s.grade,...coNames],toks))return;
    const score=gsScore(s.name,toks);
    const alumni=(s.status||'在學')!=='在學';
    out.push({kind:'student',id:s.id,name:s.name,score:score+(alumni?0.5:0),
      meta:[s.grade,s.school,mine.length+' 門課',alumni?s.status:''].filter(Boolean).join('　·　'),
      why:score<3?'':gsWhy(toks,[[s.school,'學校'],...coNames.map(n=>[n,'修課'])])});
  });

  return out.sort((a,b)=>a.score-b.score
    ||((a.occTs&&b.occTs)?a.occTs-b.occTs:0)
    ||String(a.name).localeCompare(String(b.name),'zh-Hant'));
}

// 分組（課程主頁／課程管理／老師／學生），組內最強的那筆決定組的先後
// ——打學生名字時「學生」組就會排最前面
function gsGroups(res){
  const kindOf=r=>r.kind==='course-legacy'?'course':r.kind;
  return ['occ','course','teacher','student'].map(k=>{
    const all=res.filter(r=>kindOf(r)===k);
    return{kind:k,label:GS_LABEL[k],total:all.length,items:all.slice(0,GS_MAX),
      more:Math.max(0,all.length-GS_MAX),best:all.length?all[0].score:99};
  }).filter(g=>g.total).sort((a,b)=>a.best-b.best);
}

// ── UI ──
function gsInput(v){gsState.q=v;gsRun();}
function gsRun(){
  const res=gsBuild(gsState.q);
  gsState.groups=gsGroups(res);
  gsState.flat=gsState.groups.reduce((a,g)=>a.concat(g.items),[]);
  gsState.idx=gsState.flat.length?0:-1;
  gsState.open=!!gsState.q.trim();
  gsRender();
}
function gsFocus(){if(gsState.q.trim())gsRun();}
function gsClose(){gsState.open=false;gsRender();}
function gsClear(){
  const inp=document.getElementById('gs-inp');
  if(inp)inp.value='';
  gsState.q='';gsClose();
}
function gsHover(i){if(gsState.idx===i)return;gsState.idx=i;gsRender();}
function gsMove(d){
  if(!gsState.flat.length)return;
  gsState.idx=(gsState.idx+d+gsState.flat.length)%gsState.flat.length;
  gsRender();
  const row=document.querySelector('.gs-row.sel');
  if(row&&row.scrollIntoView)row.scrollIntoView({block:'nearest'});
}
function gsKey(e){
  if(e.key==='ArrowDown'){e.preventDefault();gsMove(1);}
  else if(e.key==='ArrowUp'){e.preventDefault();gsMove(-1);}
  else if(e.key==='Escape'){e.preventDefault();gsClear();}
  else if(typeof isEnterKey==='function'&&isEnterKey(e)){e.preventDefault();gsPick(gsState.idx);}
}

// 命中字反白：先在原字串塞哨兵、escape 完再換成 <mark>，這樣不會標到 HTML 實體裡去
var GS_M1=String.fromCharCode(1),GS_M2=String.fromCharCode(2);  // 哨兵：不可能出現在人名／課名裡
function gsHl(s){
  let raw=String(s==null?'':s);
  gsTokens(gsState.q).forEach(t=>{
    const re=new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
    raw=raw.replace(re,m=>GS_M1+m+GS_M2);
  });
  return esc(raw).split(GS_M1).join('<mark>').split(GS_M2).join('</mark>');
}

function gsRender(){
  const drop=document.getElementById('gs-drop');
  if(!drop)return;
  if(!gsState.open){drop.classList.remove('open');drop.innerHTML='';return;}
  let html='';
  if(!gsState.flat.length){
    html=`<div class="gs-empty">找不到「${esc(gsState.q.trim())}」<span>可以打課程名稱、科目、老師或學生姓名</span></div>`;
  }else{
    let i=0;
    gsState.groups.forEach(g=>{
      html+=`<div class="gs-grp">${g.label}<span class="gs-grp-n">${g.total}</span></div>`;
      g.items.forEach(r=>{
        const k=i++;
        html+=`<div class="gs-row${k===gsState.idx?' sel':''}" onmousedown="event.preventDefault()" onclick="gsPick(${k})" onmouseenter="gsHover(${k})">
          <span class="gs-ico k-${r.kind==='course-legacy'?'course':r.kind}">${GS_ICON[r.kind]}</span>
          <span class="gs-txt"><span class="gs-nm">${gsHl(r.name)}</span><span class="gs-meta">${esc(r.meta)}</span></span>
          ${r.why?`<span class="gs-why">${esc(r.why)}</span>`:''}
        </div>`;
      });
      if(g.more)html+=`<div class="gs-more">還有 ${g.more} 筆…（再多打幾個字縮小範圍）</div>`;
    });
    html+=`<div class="gs-hint"><span>↑↓ 選擇</span><span>Enter 開啟</span><span>Esc 清空</span></div>`;
  }
  drop.innerHTML=html;
  drop.classList.add('open');
}

function gsPick(i){
  const r=gsState.flat[i];
  if(!r)return;
  gsClose();
  const inp=document.getElementById('gs-inp');
  if(inp)inp.blur();
  if(r.kind==='student')return openStudentModal(r.id);
  if(r.kind==='teacher')return gsGoTeacher(r.id);
  if(r.kind==='occ')return gsGoOcc(r);
  return gsGoCourseAdmin(r);
}

// ── 課程主頁：把主頁切到那一天，開那堂課的課堂視窗 ──
// 課堂視窗靠 findEventById 找課堂，而它只看已載入的今日／本週——所以未來日期要先把
// currentDate／weekOffset 搬過去、重載一次，那一堂才在 dayEvents 裡。
// 課堂 id 是穩定合成的（sys:課程:日期:第幾段），重載後不會變，所以搜出來的 id 等一下還找得到。
async function gsGoOcc(r){
  const d=new Date(r.occTs);d.setHours(0,0,0,0);
  currentDate=d;
  setDateDisplay(currentDate);
  const dp=document.getElementById('date-picker');if(dp)dp.value=toDateStr(d);
  weekOffset=gsWeekOffsetOf(d);
  selectedWeekDayIdx=null;
  showPanel('courses');
  if(typeof updateWeekTitle==='function')updateWeekTitle();
  await Promise.all([loadToday(),loadWeek()]);
  selectWeekEvent(r.id);
}

// 那一天在「這一週」的前後幾週（本週＝0，下週＝1）
function gsWeekOffsetOf(d){
  const mondayOf=x=>{const m=new Date(x);m.setHours(0,0,0,0);m.setDate(m.getDate()-((m.getDay()+6)%7));return m;};
  return Math.round((mondayOf(d)-mondayOf(new Date()))/(7*864e5));
}

// ── 課程管理：切過去、開那門課的課程視窗（名單／單價／✎ 編輯課程）──
// openCourseModal 要 _coCardCtx，所以先 switchPanel 讓該頁重繪把上下文建起來。
// 一門課在週課表可能有好幾張卡（每星期／每老師一張），開第一張就好——視窗內容是同一門課。
function gsGoCourseAdmin(r){
  switchPanel('settings');
  const want=r.kind==='course-legacy'?null:('sys'+r.id+'@');
  const keys=[];
  _coCardCtx.forEach((ctx,k)=>{
    if(want){if(k.indexOf(want)===0)keys.push(k);}
    else if(ctx.c&&!ctx.c.sys&&ctx.c.title===r.id)keys.push(k);
  });
  if(!keys.length)return toast('這門課在課程管理沒有課卡','inf');
  openCourseModal(keys[0]);
  // 視窗關掉之後看得到自己在哪：底下那幾張卡一起閃（同一門課排好幾天就好幾張）
  const cards=[...document.querySelectorAll('.co-card')].filter(el=>keys.indexOf(el.dataset.cokey||'')>=0);
  if(cards.length)gsFlash(cards);
}

// 捲到第一個並讓整組閃一下（課卡可能有好幾張、老師只有一列）
function gsFlash(els){
  if(els[0]&&els[0].scrollIntoView)els[0].scrollIntoView({block:'center',inline:'center',behavior:'smooth'});
  els.forEach(el=>{
    el.classList.remove('gs-flash');
    void el.offsetWidth;             // 重新觸發動畫（連按同一筆也要閃）
    el.classList.add('gs-flash');
    setTimeout(()=>el.classList.remove('gs-flash'),1700);
  });
}

function gsGoTeacher(id){
  switchPanel('teachers');
  const row=document.querySelector('.ta-row[data-tid="'+id+'"]');
  if(row)gsFlash([row]);
}

// ═══ 桌面日曆的搜尋（🔍 鈕／⌘K）═══
// 那個視窗沒有側欄也沒有頂欄——切分頁就回不來了（2026-07-30 老闆踩過），所以這裡**只找課堂**：
// 找到就把日曆翻到那天、選起那一塊。要改名單／單價那種事回主系統視窗做。
// 課堂來源＝課程展開的課堂 ∪ 已排的補課／調課場次，比對欄位跟頂欄搜尋同一套。
var GS_DV_MAX=8;
var gsDv={q:'',rows:[],idx:-1};

function gsDvResults(q){
  const toks=gsTokens(q);
  if(!toks.length)return[];
  const hits=gsCourseHits(toks);
  // 只命中一門課時多列幾堂——在日曆裡搜一門課，通常就是想挑它的某一天
  const rows=[...gsOccRows(hits,hits.length===1?GS_DV_MAX:GS_OCC_PER_COURSE),...gsMakeupOccs(toks)];
  return rows.sort((a,b)=>a.score-b.score||a.occTs-b.occTs).slice(0,GS_DV_MAX);
}

function gsDvOpen(){
  const w=document.getElementById('dv-gs');
  if(!w)return;
  gsDv={q:'',rows:[],idx:-1};
  w.classList.add('open');
  gsDvRender();
  const inp=document.getElementById('dv-gs-inp');
  if(inp){inp.value='';setTimeout(()=>inp.focus(),0);}
}
function gsDvClose(){
  const w=document.getElementById('dv-gs');
  if(w)w.classList.remove('open');
  gsDv={q:'',rows:[],idx:-1};
}
function gsDvOpened(){const w=document.getElementById('dv-gs');return !!w&&w.classList.contains('open');}
function gsDvInput(v){
  gsDv.q=v;
  gsDv.rows=gsDvResults(v);
  gsDv.idx=gsDv.rows.length?0:-1;
  gsDvRender();
}
function gsDvHover(i){if(gsDv.idx===i)return;gsDv.idx=i;gsDvRender();}
function gsDvKey(e){
  if(e.key==='ArrowDown'){e.preventDefault();gsDvMove(1);}
  else if(e.key==='ArrowUp'){e.preventDefault();gsDvMove(-1);}
  else if(e.key==='Escape'){e.preventDefault();gsDvClose();}
  else if(typeof isEnterKey==='function'&&isEnterKey(e)){e.preventDefault();gsDvPick(gsDv.idx);}
}
function gsDvMove(d){
  if(!gsDv.rows.length)return;
  gsDv.idx=(gsDv.idx+d+gsDv.rows.length)%gsDv.rows.length;
  gsDvRender();
  const el=document.querySelector('.dv-gs-row.sel');
  if(el&&el.scrollIntoView)el.scrollIntoView({block:'nearest'});
}

function gsDvRender(){
  const box=document.getElementById('dv-gs-list');
  if(!box)return;
  if(!gsDv.q.trim()){
    box.innerHTML='<div class="dv-gs-empty">打課名、老師、學生、教室都可以<span>找到就把日曆翻到那一天</span></div>';
    return;
  }
  if(!gsDv.rows.length){
    box.innerHTML=`<div class="dv-gs-empty">接下來 ${GS_OCC_DAYS} 天裡找不到「${esc(gsDv.q.trim())}」的課<span>改設定請回主系統視窗</span></div>`;
    return;
  }
  const savedQ=gsState.q;gsState.q=gsDv.q;   // gsHl 讀 gsState.q 反白命中字，借用完馬上還回去
  box.innerHTML=gsDv.rows.map((r,i)=>`<div class="dv-gs-row${i===gsDv.idx?' sel':''}"
      onmousedown="event.preventDefault()" onclick="gsDvPick(${i})" onmouseenter="gsDvHover(${i})">
    <span class="dv-gs-txt"><span class="dv-gs-nm">${gsHl(r.name)}</span><span class="dv-gs-meta">${esc(r.meta)}</span></span>
  </div>`).join('');
  gsState.q=savedQ;
}

// 翻到那一天、選起那一塊。日／週／月檢視都留在原本那個（使用者自己挑的視角不要被搶走）
async function gsDvPick(i){
  const r=gsDv.rows[i];
  if(!r)return;
  gsDvClose();
  const d=new Date(r.occTs);
  currentDate=d;
  if(typeof setDateDisplay==='function')setDateDisplay(currentDate);
  const dp=document.getElementById('date-picker');if(dp)dp.value=toDateStr(d);
  weekOffset=gsWeekOffsetOf(d);
  if(typeof isSignedIn==='function'&&isSignedIn())await Promise.all([loadToday(),loadWeek()]);
  if(typeof renderDayView==='function')renderDayView();
  if(typeof dvSelect==='function')dvSelect(r.id);
  const el=document.querySelector('#dv-grid [data-id="'+r.id+'"]');
  if(el&&el.scrollIntoView)el.scrollIntoView({block:'center',behavior:'smooth'});
  // 側欄詳情被藏起來時（視窗太窄）改開課堂視窗，不然選了等於沒反應
  if(typeof _dvSideVisible==='function'&&!_dvSideVisible()&&typeof selectWeekEvent==='function')selectWeekEvent(r.id);
}

// ⌘K / Ctrl+K：在桌面日曆開課堂搜尋，其餘畫面跳到頂欄搜尋框
window.addEventListener('keydown',e=>{
  if(!(e.metaKey||e.ctrlKey)||e.altKey)return;
  if(e.key!=='k'&&e.key!=='K')return;
  const dvBox=document.getElementById('dv-gs');
  if(dvBox&&currentPanel==='dayview'){e.preventDefault();return gsDvOpened()?gsDvClose():gsDvOpen();}
  const inp=document.getElementById('gs-inp');
  if(!inp||!inp.offsetParent)return;
  e.preventDefault();inp.focus();inp.select();
});
// 點外面收起來（點結果列本身走 onmousedown preventDefault，不會先失焦）
document.addEventListener('click',e=>{
  const box=document.getElementById('gs-box');
  if(box&&!box.contains(e.target)&&gsState.open)gsClose();
});
