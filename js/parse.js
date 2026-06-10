// 事件解析：Google Calendar event → 內部 event 物件
// 整個系統的核心解析大腦，純函式（無副作用、無 DOM 依賴）

function cleanDesc(raw){
  if(!raw)return'';
  // Google Calendar web editor can store HTML; normalize to plain text
  return raw
    .replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<\/div>/gi,'\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(c))
    .replace(/\r\n/g,'\n').replace(/\r/g,'\n')
    .trim();
}

function parseEv(e){
  const title=e.summary||'';
  const desc=cleanDesc(e.description);
  const descFirstLine=(desc.split('\n')[0]||'');
  const classroomMatch=descFirstLine.match(/(小教室|大教室|108|208|309|石牌分校)/);
  const classroom=classroomMatch?classroomMatch[1]:'';
  const firstLine=descFirstLine.replace(/^\d+\s+/,'').replace(/(小教室|大教室|108|208|309|石牌分校)\s*/g,'').trim();
  const teacher=firstLine;

  // Distinguish student name lines from note lines
  // stripNote: remove parenthetical annotations like (國一) or （國二） before checking
  const stripNote=s=>s.trim().replace(/\([^)]*\)/g,'').replace(/（[^）]*）/g,'').trim();
  // 排除以指令動詞開頭的假名字（請帶筆、需考卷、別遲到、勿..、麻煩..、記得..、務必..）
  // 這些不會是真實學生名，但長度與字元都會通過原本的規則
  const NOTE_PREFIX=/^(請|需|別|勿|麻煩|記得|務必|注意)/;
  const isNameLike=p=>p.length<=8&&/^[一-鿿A-Za-z]+$/.test(p)&&!NOTE_PREFIX.test(p);
  const isNameLine=l=>l.split(/[、,，]/).map(stripNote).filter(Boolean).every(isNameLike);
  const isSubjectLine=l=>{
    if(!l.includes('：'))return false;
    const rest=l.slice(l.indexOf('：')+1);
    return rest.split(/[、,，]/).map(stripNote).filter(Boolean).every(isNameLike);
  };
  const isStudentLine=l=>isNameLine(l)||isSubjectLine(l);
  const allDescLines=desc.split('\n').slice(1).filter(Boolean);
  const stuLines=allDescLines.filter(isStudentLine);
  const noteLines=allDescLines.filter(l=>!isStudentLine(l));
  const notes=noteLines.join('　').trim();

  // Student groups (for practice courses with 科目：學生 format)
  const studentGroups=stuLines.filter(isSubjectLine).map(l=>{
    const idx=l.indexOf('：');
    return{subject:l.slice(0,idx).trim(),students:l.slice(idx+1).split(/[、,，]/).map(s=>s.trim()).filter(Boolean)};
  });

  // Flat student list
  const stuRaw=stuLines.map(l=>isSubjectLine(l)?l.slice(l.indexOf('：')+1):l).join('、');
  const descStudents=stuRaw?stuRaw.split(/[、,，]/).map(s=>s.trim()).filter(Boolean):[];

  // Course type detection
  const nameOnly=title.replace(/【[^】]*】/g,'').trim();
  let type='group';
  if(/練習課?/.test(title)||e._calName==='練習課'){type='practice';}
  else if(/家教/.test(title)){
    const sp=nameOnly.replace(/家教.*/,'').trim().split(/[\s、]+/).filter(Boolean);
    type=sp.length>=2?'pair':'one';
  }else if(/、/.test(nameOnly)&&/班/.test(nameOnly)){type='pair';}

  // Students: always from description (line 2+)
  const students=descStudents;

  const startDt=new Date(e.start.dateTime||e.start.date);
  const endDt=new Date(e.end.dateTime||e.end.date);

  // 取出標題開頭連續的【...】標記，只吃得懂的（請假/曠課/調課），其餘視為課名一部分。
  // 支援請假與曠課並存，例如：【小明請假】【小華曠課】國二數學
  let _rest=title,_tags=[],_m;
  while((_m=_rest.match(/^【([^】]*)】/))){
    const c=_m[1];
    if(!/(請假|曠課)$/.test(c)&&!/^調課(?:[：:]|$)/.test(c))break;
    _tags.push(c);_rest=_rest.slice(_m[0].length);
  }
  const origTitle=_tags.length?_rest.trim():title;

  // Reschedule：【調課】或【調課：原因】
  const reschedTag=_tags.find(t=>/^調課(?:[：:]|$)/.test(t));
  const isRescheduled=!!reschedTag;
  const rescheduleReason=reschedTag?(reschedTag.match(/^調課[：:](.+)$/)?.[1]?.trim()||''):'';

  // 請假（學生或老師）：標記以「請假」結尾
  const absTag=_tags.find(t=>/請假$/.test(t));
  const isAbsent=!!absTag;
  const absentWho=absTag?absTag.replace(/請假$/,''):'';
  const isTeacherAbsent=absentWho==='老師';

  // 曠課：標記以「曠課」結尾。曠課＝課程已開始才請假，不補課、不計欠課，與請假分開統計
  const noShowTag=_tags.find(t=>/曠課$/.test(t));
  const isNoShow=!!noShowTag;
  const noShowStudents=noShowTag?noShowTag.replace(/曠課$/,'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean):[];

  // Absent students list (from 請假 tag)
  const absentStudents=isRescheduled?[...students]:
    (!isAbsent||isTeacherAbsent)?[]:absentWho.split(/[、,，]/).map(s=>s.trim()).filter(Boolean);

  // 每位學生的請假時機 map（{name:'A'|'B'|'C'}），存事件隱藏欄位，供學費系統用
  let absenceTiming={};
  try{const _raw=e.extendedProperties?.private?.absenceTiming;if(_raw)absenceTiming=JSON.parse(_raw);}catch{}
  const absType=isRescheduled?'調課':(isTeacherAbsent?'老師請假':(isAbsent?'學生請假':''));
  const totalStudents=students.length;
  const isPartialAbsent=isAbsent&&!isTeacherAbsent&&totalStudents>0&&absentStudents.length<totalStudents;
  // isFullAbsent: rescheduled, teacher absent, or all students absent
  const isFullAbsent=isRescheduled||(isAbsent&&(isTeacherAbsent||totalStudents===0||absentStudents.length>=totalStudents));

  return{
    id:e.id,title,desc,notes,teacher,classroom,students,studentGroups,type,startDt,endDt,
    durMins:Math.round((endDt-startDt)/60000),
    calId:e._calId,calName:e._calName,
    isAbsent,isPartialAbsent,isFullAbsent,isRescheduled,rescheduleReason,absentWho,absType,absentStudents,
    isNoShow,noShowStudents,absenceTiming,
    origTitle,
  };
}

function buildTitle(origTitle, type, students){
  if(type==='teacher') return `【老師請假】${origTitle}`;
  if(!students||students.length===0) return null;
  return `【${students.join('、')}請假】${origTitle}`;
}
