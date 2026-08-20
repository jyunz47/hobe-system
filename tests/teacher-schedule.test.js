// 老師個人課表 ＋ 可排時段條件 ＋ 推薦時段（2026-08-19 老闆要求）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 最在意的四條：
//  ① 課表只列「這位老師」的課——同名不同人靠 teacherIds 分開，別人的課不能混進來
//  ② 補課／調課場次也要算進課表（那場換過老師就照場次上的老師走）
//  ③ 推薦時段＝可排 ∩ 營業時間 －「不能排」－ 他自己已經有的課（三種扣減都要真的扣到）
//  ④ 一條條件都沒設 → 不推薦、也不亂猜（回空陣列）

// 週二 19:00–20:30 國二數學班（李老師，小教室，小明＋小華）
// 週四 17:00–18:00 高一數學（張老師）——同一天，用來確認不會混進李老師的課表
function resetTsch(){
  driveData={
    studentList:[{id:1,name:'小明',grade:'國二'},{id:2,name:'小華',grade:'國二'},{id:3,name:'阿哲',grade:'高一'}],
    enrollments:[
      {studentId:1,courseId:7,periodId:yearPeriodId('summer')},
      {studentId:2,courseId:7,periodId:yearPeriodId('summer')},
      {studentId:3,courseId:8,periodId:yearPeriodId('summer')},
    ],
    makeupScheduled:[],coursePrices:[],courseSettings:[],absences:[],
    teachers:[{id:1,name:'李老師',status:'在職'},{id:2,name:'張老師',status:'在職'}],
    courses:[
      {id:7,name:'國二數學班',type:'團班',room:'小教室',status:'開課中',teacherIds:[1],
        schedule:{mode:'weekly',slots:[{weekday:2,start:'19:00',end:'20:30'}],phases:[]}},
      {id:8,name:'高一數學',type:'一對一',room:'108',status:'開課中',teacherIds:[2],
        schedule:{mode:'weekly',slots:[{weekday:4,start:'17:00',end:'18:00'}],phases:[]}},
    ],
  };
  currentPeriodId='summer';
  tschState=null;
}

// 2026-08-17（一）那一週：週二＝8/18、週四＝8/20
const TS_MON=new Date(2026,7,17);
const TS_SUN=new Date(2026,7,23,23,59,59,999);
const T_LEE=()=>getTeachers().find(t=>t.id===1);
const T_CHANG=()=>getTeachers().find(t=>t.id===2);

suite('老師個人課表：只列這位老師的課', ()=>{
  resetTsch();
  const lee=teacherOccurrences(T_LEE(),TS_MON,TS_SUN);
  const chang=teacherOccurrences(T_CHANG(),TS_MON,TS_SUN);

  test('李老師這週只有自己那一堂', ()=>{
    assertEq(lee.length,1);
    assertEq(lee[0].origTitle,'國二數學班');
    assertEq(lee[0].startDt.getDay(),2);
  });

  test('張老師的課不會混進李老師的課表', ()=>{
    assertEq(chang.length,1);
    assertEq(chang[0].origTitle,'高一數學');
  });

  test('同名老師靠 teacherIds 分開（名字一樣、id 不同）', ()=>{
    resetTsch();
    const all=getTeachers().slice();
    all[1].name='李老師';                    // 兩位都叫李老師
    saveTeachers(all);
    const a=teacherOccurrences(getTeachers()[0],TS_MON,TS_SUN);
    const b=teacherOccurrences(getTeachers()[1],TS_MON,TS_SUN);
    assertEq(a.length,1);assertEq(a[0].origTitle,'國二數學班');
    assertEq(b.length,1);assertEq(b[0].origTitle,'高一數學');
    resetTsch();
  });

  test('補課場次也算進課表（週三 14:00 幫小明補一場）', ()=>{
    resetTsch();
    driveData.makeupScheduled=[{
      id:'mk1',originalId:'sys:7:2026-08-11:0',origTitle:'國二數學班',
      scheduledDate:new Date(2026,7,19,14,0).toISOString(),
      scheduledEnd:new Date(2026,7,19,14,45).toISOString(),
      room:'小教室',calName:'補課',absentStudents:['小明'],originalDate:new Date(2026,7,11,19,0).toISOString(),
    }];
    const evs=teacherOccurrences(T_LEE(),TS_MON,TS_SUN);
    assertEq(evs.length,2,'原本那堂（週二）＋補課那場（週三），照時間排');
    assertEq(evs[1].calName,'補課');
    assertEq(evs[1].startDt.getDay(),3);
    resetTsch();
  });
});

suite('可排時段條件 → 推薦時段', ()=>{
  test('一條都沒設＝不推薦（系統不猜）', ()=>{
    resetTsch();
    assertEq(teacherFreeSlots(T_LEE(),TS_MON).length,0);
  });

  test('設一條「週二 16:00–21:00 可以排」→ 扣掉自己 19:00–20:30 那堂，剩兩段', ()=>{
    resetTsch();
    taAvailSave(1,[{id:11,weekday:2,start:'16:00',end:'21:00',kind:'ok'}]);
    const free=teacherFreeSlots(T_LEE(),TS_MON);
    assertEq(free.length,2);
    assertEq(minToHHMM(free[0].s)+'–'+minToHHMM(free[0].e),'16:00–19:00');
    assertEq(minToHHMM(free[1].s)+'–'+minToHHMM(free[1].e),'20:30–21:00');
  });

  test('「不能排」會再扣一刀（週二 16:00–17:30 不能排）', ()=>{
    resetTsch();
    taAvailSave(1,[
      {id:11,weekday:2,start:'16:00',end:'21:00',kind:'ok'},
      {id:12,weekday:2,start:'16:00',end:'17:30',kind:'no'},
    ]);
    const free=teacherFreeSlots(T_LEE(),TS_MON);
    assertEq(free.length,2);
    assertEq(minToHHMM(free[0].s)+'–'+minToHHMM(free[0].e),'17:30–19:00');
  });

  test('可排時段被營業時間夾住（週二寫到 23:00，只算到 21:30 關門）', ()=>{
    resetTsch();
    taAvailSave(1,[{id:11,weekday:2,start:'20:00',end:'23:00',kind:'ok'}]);
    const free=teacherFreeSlots(T_LEE(),TS_MON);
    assertEq(free.length,1);
    assertEq(minToHHMM(free[0].s)+'–'+minToHHMM(free[0].e),'20:30–21:30');
  });

  test('不到 30 分鐘的碎片不列（排不進一堂課）', ()=>{
    resetTsch();
    taAvailSave(1,[{id:11,weekday:2,start:'18:45',end:'19:00',kind:'ok'}]);
    assertEq(teacherFreeSlots(T_LEE(),TS_MON).length,0);
  });

  test('整段都被自己的課蓋住 → 那天沒有推薦', ()=>{
    resetTsch();
    taAvailSave(1,[{id:11,weekday:2,start:'19:00',end:'20:30',kind:'ok'}]);
    assertEq(teacherFreeSlots(T_LEE(),TS_MON).length,0);
  });

  test('推薦帶教室狀況：小教室被自己那堂佔走的那段不會說它空著', ()=>{
    resetTsch();
    taAvailSave(1,[{id:11,weekday:2,start:'16:00',end:'21:00',kind:'ok'}]);
    const free=teacherFreeSlots(T_LEE(),TS_MON);
    assertTrue(free[0].rooms.small.includes('小教室'),'16:00–19:00 小教室是空的');
    assertEq(free[0].rooms.bigFree,6,'沒有練習課 → 大教室 6 桌');
  });

  test('補課場次也會擋掉推薦（週二 17:00–18:00 排了一場補課）', ()=>{
    resetTsch();
    taAvailSave(1,[{id:11,weekday:2,start:'16:00',end:'19:00',kind:'ok'}]);
    driveData.makeupScheduled=[{
      id:'mk2',originalId:'sys:7:2026-08-11:0',origTitle:'國二數學班',
      scheduledDate:new Date(2026,7,18,17,0).toISOString(),
      scheduledEnd:new Date(2026,7,18,18,0).toISOString(),
      room:'小教室',calName:'補課',absentStudents:['小明'],
    }];
    const free=teacherFreeSlots(T_LEE(),TS_MON);
    assertEq(free.length,2);
    assertEq(minToHHMM(free[0].e),'17:00');
    assertEq(minToHHMM(free[1].s),'18:00');
    resetTsch();
  });
});

// 這塊是「畫面不能整個炸掉」的防線：七格 grid、兩個區塊的文案都要在。
// 用相對於「今天」的那一週（課是每週重複的，所以哪一週跑都有課），不釘死日期。
suite('老師課表畫面：七天 × 時間軸，不丟例外', ()=>{
  test('週一～週日七欄＋課塊＋沒課的那幾天', ()=>{
    resetTsch();
    tschState={tid:1,offset:0};
    const html=teacherSchHtml(T_LEE());
    TSCH_WD.forEach(([,lbl])=>assertTrue(html.includes(lbl),'要有 '+lbl+' 那欄'));
    assertTrue(html.includes('國二數學班'),'課塊要有課名');
    assertTrue(html.includes('小教室'),'課塊要有教室');
    assertTrue(html.includes('沒課'),'空的那幾天要寫沒課');
    tschState=null;
  });

  test('時間軸預設 15:00–21:30（老闆指定），刻度都畫出來', ()=>{
    resetTsch();
    tschState={tid:1,offset:0};
    const html=teacherSchHtml(T_LEE());
    ['15:00','16:00','17:00','18:00','19:00','20:00','21:00','21:30']
      .forEach(t=>assertTrue(html.includes('>'+t+'<'),'刻度要有 '+t));
    assertFalse(html.includes('>14:00<'),'預設不畫 15:00 以前');
    assertFalse(html.includes('已延伸成'),'沒有課超出範圍時不該出現延伸說明');
    tschState=null;
  });

  test('課塊照時間定位：19:00–20:30 在 15:00–21:30 軸上的位置與高度', ()=>{
    resetTsch();
    tschState={tid:1,offset:0};
    const html=teacherSchHtml(T_LEE());
    // 軸 390 分鐘；19:00 距軸首 240 分 → 61.54%，90 分 → 23.08%
    assertTrue(html.includes('top:61.54%'),'19:00 要落在 61.54%');
    assertTrue(html.includes('height:23.08%'),'90 分鐘要占 23.08%');
    tschState=null;
  });

  test('有課落在 15:00 前 → 軸自動延伸，而且講明延伸過（課不能消失）', ()=>{
    resetTsch();
    const cs=getCourses().slice();
    cs.push({id:9,name:'週六早上加強',type:'一對一',room:'108',status:'開課中',teacherIds:[1],
      schedule:{mode:'weekly',slots:[{weekday:6,start:'09:00',end:'10:30'}],phases:[]}});
    driveData.courses=cs;
    driveData.enrollments=[...driveData.enrollments,{studentId:3,courseId:9,periodId:yearPeriodId('summer')}];
    tschState={tid:1,offset:0};
    const html=teacherSchHtml(T_LEE());
    assertTrue(html.includes('週六早上加強'),'超出預設範圍的課要看得到');
    assertTrue(html.includes('>09:00<'),'軸要長到 09:00');
    assertTrue(html.includes('已延伸成 09:00–21:30'),'要講明軸被延伸了');
    tschState=null;
    resetTsch();
  });

  test('沒設條件時推薦區給的是指路、不是空白', ()=>{
    resetTsch();
    tschState={tid:1,offset:0};
    const html=teacherSchHtml(T_LEE());
    assertTrue(html.includes('還沒設「可以排」的時段'),'要指路怎麼開始');
    tschState=null;
  });

  test('設了條件就列出推薦（含教室狀況）', ()=>{
    resetTsch();
    taAvailSave(1,[{id:11,weekday:2,start:'16:00',end:'21:00',kind:'ok'}]);
    tschState={tid:1,offset:0};
    const html=teacherSchHtml(T_LEE());
    assertTrue(html.includes('16:00–19:00'),'要列出扣掉自己的課之後的空檔');
    assertTrue(html.includes('大教室'),'要附教室狀況');
    tschState=null;
    resetTsch();
  });
});

suite('大教室家教尖峰（今日摘要那一行）', ()=>{
  const D=(h,m)=>new Date(2026,7,18,h,m);
  const one=(s,e,title)=>({classroom:'大教室',type:'one',startDt:s,endDt:e,origTitle:title||'家教',students:['甲']});

  test('沒有家教 → peak 0', ()=>{
    assertEq(bigRoomTutorPeak([]).peak,0);
    assertEq(bigRoomTutorPeak([one(D(17,0),D(18,0))&&{classroom:'小教室',type:'one',startDt:D(17,0),endDt:D(18,0)}]).peak,0);
  });

  test('三堂重疊 → 尖峰 3，時段講的是真的三堂都在的那一段', ()=>{
    const r=bigRoomTutorPeak([one(D(17,0),D(19,0),'A'),one(D(17,30),D(19,0),'B'),one(D(18,0),D(19,0),'C')]);
    assertEq(r.peak,3);
    assertEq(r.total,3);
    assertEq(fmtT(r.windows[0].start)+'–'+fmtT(r.windows[0].end),'18:00–19:00');
  });

  test('整堂請假／調課移走的不佔桌', ()=>{
    const evs=[one(D(17,0),D(19,0),'A'),{...one(D(17,0),D(19,0),'B'),isFullAbsent:true},
      {...one(D(17,0),D(19,0),'C'),isRescheduled:true}];
    assertEq(bigRoomTutorPeak(evs).peak,1);
  });

  test('練習課人多 → 桌數上限跟著降（15 人 → 4 桌）', ()=>{
    const prac={classroom:'大教室',type:'practice',startDt:D(17,0),endDt:D(19,0),
      students:Array.from({length:15},(_,i)=>'學'+i),origTitle:'練習課'};
    const r=bigRoomTutorPeak([prac,one(D(17,0),D(19,0),'A'),one(D(17,0),D(19,0),'B')]);
    assertEq(r.peak,2);
    assertEq(r.windows[0].max,4,'15 人以上只剩 4 桌');
  });

  test('相鄰又同組數的段會併成一段（17:00–18:00 與 18:00–19:00 都是 2 組）', ()=>{
    const r=bigRoomTutorPeak([one(D(17,0),D(19,0),'A'),one(D(17,0),D(18,0),'B'),one(D(18,0),D(19,0),'C')]);
    assertEq(r.peak,2);
    assertEq(r.windows.length,1);
    assertEq(fmtT(r.windows[0].start)+'–'+fmtT(r.windows[0].end),'17:00–19:00');
  });
});
