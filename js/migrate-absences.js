// 舊行事曆請假 → 系統請假紀錄：一次性搬遷工具（2026-07-29，全頁改讀系統第 4 刀 (a)）
//
// 為什麼要搬：cutover 之後系統課表已重建，但 Google 行事曆上「還沒排補課」的舊請假／調課／曠課
// 只存在於 Calendar 標題裡。第 4 刀 (b) 要拔掉整層讀 Calendar 的程式，不先搬就會整批消失
// （欠家長的課堂憑空不見）。
//
// 為什麼是「快照式」：這些舊課在 cutover 時已被清掉，系統裡沒有對應的 course，
// 一般系統請假紀錄靠 courseId 反查課程重建課堂，這裡查不到就會被丟掉。
// 所以搬遷紀錄自帶 snapshot（課名／時段／教室／老師／名單），由 _snapshotOccurrence 直接長出課堂物件。
//
// ⚠️ 一次性：搬完＋第 4 刀 (b) 完成後，這整個檔案與 HTML 的卡片/modal 可整包刪除（批 1 清理）。

// ── 純函式：解析後的行事曆課堂 → 待寫入的系統請假紀錄 ──
// calEvents：parseEv 後的課堂物件（只該傳 MAKEUP_CALS 掃到的，補課行事曆本身不算請假來源）
// existing：driveData.absences（用 occId 去重 → 重跑不會產生重複）
// scheduled：driveData.makeupScheduled（只用來分類狀態，供預覽顯示，不影響是否搬）
// 回傳 {records, stats}；records 直接 concat 進 driveData.absences 即可
function buildAbsenceMigration(calEvents, studentList, existing, scheduled, now){
  const nowD=now||new Date();
  // 同名學生無法判斷是誰 → studentId 留 null（名字仍存，顯示與統計照舊）
  const byName=new Map();
  (studentList||[]).forEach(s=>{
    if(!s||!s.name)return;
    if(!byName.has(s.name))byName.set(s.name,[]);
    byName.get(s.name).push(s.id);
  });
  const idFor=n=>{const hit=byName.get(n);return hit&&hit.length===1?hit[0]:null;};

  const done=new Set((existing||[]).map(a=>a.occId));
  const schedMap=new Map((scheduled||[]).map(s=>[s.originalId,s]));

  const records=[],rows=[];
  const stats={scanned:0,already:0,migrate:0,
    byType:{'學生請假':0,'調課':0,'老師請假':0,'曠課':0},
    byStatus:{pending:0,scheduled:0,completed:0,skipped:0,noshow:0},
    matched:0,unmatched:[]};

  (calEvents||[]).forEach((e,i)=>{
    const isAbsenceLike=!!e.absType||e.isNoShow;
    if(!isAbsenceLike)return;              // 不是請假/調課/曠課 → 不是這次要搬的東西
    stats.scanned++;
    if(done.has(e.id)){stats.already++;return;}   // 已搬過（重跑安全）

    const teacherAbs=e.absType==='老師請假';
    const resched=!!e.isRescheduled;
    // 調課＝整堂移走，沒有「哪幾位請假」；absentStudents 在 parseEv 裡是全名冊，不該寫進 leave
    const leaveNames=(resched||teacherAbs)?[]:(e.absentStudents||[]);
    const noShowNames=e.noShowStudents||[];
    const timing=e.absenceTiming||{};

    [...leaveNames,...noShowNames].forEach(n=>{
      if(idFor(n)!=null)stats.matched++;
      else if(!stats.unmatched.includes(n))stats.unmatched.push(n);
    });

    records.push({
      id:Date.now()+i,
      occId:e.id,                          // ＝原 Calendar 事件 id：已排的補課靠 originalId 對回，不能換
      courseId:null,                       // 這門課已不在系統裡 → 靠 snapshot 顯示
      date:e.startDt.toISOString(),
      teacherAbsent:teacherAbs,
      leave:leaveNames.map(n=>({studentId:idFor(n),name:n,timing:timing[n]||'B'})),
      noShow:noShowNames.map(n=>({studentId:idFor(n),name:n})),
      makeupSkip:(e.makeupSkip||[]).slice(),
      resched,
      reschedReason:e.rescheduleReason||'',
      snapshot:{
        title:e.origTitle||'',
        teacher:e.teacher||'',
        classroom:e.classroom||'',
        notes:e.notes||'',
        type:e.type||'group',
        calName:e.calName||'一般課程',
        students:(e.students||[]).slice(),
        studentGroups:(e.studentGroups||[]).slice(),
        start:e.startDt.toISOString(),
        end:e.endDt.toISOString(),
      },
      migratedFrom:'calendar',
      createdAt:nowD.toISOString(),
    });

    stats.migrate++;
    const typeKey=resched?'調課':(teacherAbs?'老師請假':(leaveNames.length?'學生請假':'曠課'));
    stats.byType[typeKey]=(stats.byType[typeKey]||0)+1;

    // 狀態分類（僅供預覽讓老闆看得懂搬的是什麼，與是否搬無關）
    const skipped=leaveNames.length>0&&leaveNames.every(n=>(e.makeupSkip||[]).includes(n));
    const m=schedMap.get(e.id);
    const status=(e.isNoShow&&!e.isAbsent&&!resched)?'noshow'
      :skipped?'skipped'
      :m?(new Date(m.scheduledEnd)<nowD?'completed':'scheduled')
      :'pending';
    stats.byStatus[status]++;
    rows.push({date:e.startDt,title:e.origTitle||'',type:typeKey,status,
      who:(teacherAbs?'老師':[...leaveNames,...noShowNames].join('、'))||'—'});
  });

  rows.sort((a,b)=>a.date-b.date);
  return{records,stats,rows};
}

// ── 唯讀盤點：掃 Google 行事曆、算出「會搬哪幾筆」，不寫入任何東西 ──
var _migAbs=null;

async function openMigrateAbsModal(){
  if(!window.gapi||!gapi.client.getToken())return toast('請先登入 Google 帳號（盤點需要讀行事曆）','err');
  showL('掃描 Google 行事曆…');
  try{
    await fetchCalIds();
    const y=getSchoolYear(),past=new Date(y,8,1),future=new Date(y+1,7,31,23,59,59);
    const entries=Object.entries(calendarIds).filter(([n])=>MAKEUP_CALS.includes(n));
    const all=await Promise.all(entries.map(async([name,id])=>{
      try{
        const r=await cachedEventList({calendarId:id,timeMin:past.toISOString(),timeMax:future.toISOString(),
          singleEvents:true,orderBy:'startTime',maxResults:2500});
        return(r.result.items||[]).map(e=>({...e,_calId:id,_calName:name}));
      }catch(err){console.warn(`${name}行事曆掃描失敗`,err);return[];}
    }));
    // 與 loadMakeup 同一組篩選條件：標題帶【…請假】【調課】【…曠課】的才是請假事件
    const evs=all.flat()
      .filter(e=>/^【.+?請假】/.test(e.summary||'')||/^【調課(?:[：:].*?)?】/.test(e.summary||'')||/^【[^】]*曠課】/.test(e.summary||''))
      .map(parseEv);
    // 已排補課的來源兩份都吃：雲端紀錄（一定有）＋ 本次掃描的比對結果（較新，後者覆蓋前者）
    const scheduled=[...getMakeupScheduledLS(),...getMakeupScheduled()];
    _migAbs=buildAbsenceMigration(evs,getStudentList(),getAbsences(),scheduled,new Date());
    renderMigrateAbsPreview();
    document.getElementById('migabs-modal-wrap').classList.add('open');
  }catch(e){toast('掃描失敗：'+(e?.message||e),'err');}
  finally{hideL();}
}
function closeMigrateAbsModal(){document.getElementById('migabs-modal-wrap').classList.remove('open');}

function renderMigrateAbsPreview(){
  const {stats,rows}=_migAbs;
  const STATUS_LBL={pending:'待安排',scheduled:'已排補課',completed:'已完成',skipped:'不補課',noshow:'曠課'};
  const box=document.getElementById('migabs-modal-info');
  if(!stats.migrate){
    box.innerHTML=`掃到 <b>${stats.scanned}</b> 筆行事曆請假紀錄，其中 <b>${stats.already}</b> 筆先前已搬過。<br><br>
      <b>沒有需要搬的東西</b>——可以直接進行下一步（拔掉讀行事曆的程式）。`;
    document.getElementById('migabs-go').style.display='none';
    return;
  }
  document.getElementById('migabs-go').style.display='';
  const typeLine=Object.entries(stats.byType).filter(([,n])=>n).map(([k,n])=>`${k} <b>${n}</b>`).join('、');
  const statusLine=Object.entries(stats.byStatus).filter(([,n])=>n).map(([k,n])=>`${STATUS_LBL[k]} <b>${n}</b>`).join('、');
  const unmatchedLine=stats.unmatched.length
    ? `<div style="margin-top:8px;color:var(--in)">⚠️ 對不到系統學生的名字 <b>${stats.unmatched.length}</b> 個：${esc(stats.unmatched.join('、'))}
       <div style="font-size:12px;color:var(--tx3);margin-top:2px">（名字照樣保留、清單看得到，只是沒連到學生檔；重建學生時名字打一樣就能事後對回）</div></div>`
    : `<div style="margin-top:8px;color:var(--ac)">✓ 所有請假學生都對回系統學生檔了</div>`;
  box.innerHTML=`
    掃到 <b>${stats.scanned}</b> 筆行事曆請假紀錄${stats.already?`，其中 <b>${stats.already}</b> 筆先前已搬過（會跳過）`:''}。<br>
    這次要搬 <b style="font-size:15px">${stats.migrate}</b> 筆：<br>
    <div style="margin-top:6px">・類型：${typeLine}</div>
    <div>・狀態：${statusLine}</div>
    ${unmatchedLine}
    <div style="margin-top:12px;font-size:12px;color:var(--tx3)">
      搬遷只<b>新增</b>系統紀錄，不修改也不刪除任何 Google 行事曆事件。重複按不會產生重複（同一筆只搬一次）。
    </div>
    <div style="margin-top:10px;max-height:260px;overflow:auto;border:1px solid var(--br);border-radius:6px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--sf2);position:sticky;top:0">
          <th style="text-align:left;padding:5px 8px">日期</th>
          <th style="text-align:left;padding:5px 8px">課程</th>
          <th style="text-align:left;padding:5px 8px">對象</th>
          <th style="text-align:left;padding:5px 8px">類型</th>
          <th style="text-align:left;padding:5px 8px">狀態</th>
        </tr></thead>
        <tbody>${rows.map(r=>`<tr style="border-top:1px solid var(--br)">
          <td style="padding:4px 8px;white-space:nowrap">${r.date.getMonth()+1}/${r.date.getDate()}</td>
          <td style="padding:4px 8px">${esc(r.title)}</td>
          <td style="padding:4px 8px">${esc(r.who)}</td>
          <td style="padding:4px 8px">${r.type}</td>
          <td style="padding:4px 8px;color:var(--tx3)">${STATUS_LBL[r.status]}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

// ── 寫入：先寫雲端成功才動本機（寫失敗＝資料完全沒動）──
async function confirmMigrateAbs(){
  if(!_migAbs||!_migAbs.records.length)return closeMigrateAbsModal();
  const newList=[...getAbsences(),..._migAbs.records];
  showL('搬遷中…');
  try{
    await SHARED_DOC.set({absences:newList},{merge:true});
  }catch(e){
    hideL();
    return toast('搬遷失敗（雲端寫入錯誤），資料未動：'+(e?.message||e),'err');
  }
  driveData.absences=newList;
  const n=_migAbs.records.length;
  _migAbs=null;
  hideL();
  closeMigrateAbsModal();
  await loadMakeup(true);
  renderMakeup();
  toast(`已搬遷 ${n} 筆請假紀錄進系統。到「待補課/調課清單」確認內容沒變。`,'ok');
}
