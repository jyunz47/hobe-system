// 補課可以換老師（2026-08-11 老闆要求，預設原班老師）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 最在意的四條：
//  ① 沒換人＝紀錄裡不留老師欄位（跟著母課程走：課程之後換老師，補課也跟著換）
//  ② 換了人＝存 id + 名字快照，課表展開時要顯示新老師
//  ③ 只改時間（桌面日曆拖曳，不傳老師參數）不可以把換好的老師洗掉
//  ④ 撞課檢查認得這個欄位（換成張老師，就要看張老師那時段有沒有課）

// 週二 19:00 國二數學班（小明、小華，李老師）8/11 兩人請假 → 8/13（週四）排補課。
// 週四 20:00–21:30 國二數學C班是張老師的課（用來測「換成張老師就會撞」）
function resetMkT() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' }],
    enrollments: [
      { studentId: 1, courseId: 7, periodId: yearPeriodId('summer') },
      { studentId: 2, courseId: 7, periodId: yearPeriodId('summer') },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }, { id: 2, name: '張老師' }],
    courses: [
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 11, name: '國二數學C班', type: '團班', room: '309', status: '開課中', teacherIds: [2],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '20:00', end: '21:30' }], phases: [] } },
    ],
    absences: [{
      id: 1, occId: 'sys:7:2026-08-11:0', courseId: 7, date: new Date(2026, 7, 11, 19, 0).toISOString(),
      teacherAbsent: false, noShow: [], makeupSkip: [],
      leave: [{ studentId: 1, name: '小明', timing: 'A' }, { studentId: 2, name: '小華', timing: 'A' }],
    }],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';
  makeupList = sysAbsenceEvents();
}

function mktEv() { return makeupList.find(e => e.id === 'sys:7:2026-08-11:0'); }
function mktRec() { return getMakeupsFor('sys:7:2026-08-11:0')[0]; }
// 15:00–16:00 排一場（teacher 省略＝沿用原本存的，傳 null＝原班老師）
function mktSave(teacher, recId, h) {
  const hh = h == null ? 15 : h;
  return saveMakeupScheduled(mktEv(), new Date(2026, 7, 13, hh, 0), new Date(2026, 7, 13, hh + 1, 0),
    '108', null, '補課', ['小明'], recId || null, teacher);
}
function mktOcc() {
  return expandMakeupForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59))[0];
}

// ────────────────────────────────────────────────────────
suite('補課換老師：存進去的形狀', () => {

  test('沒換人 → 不留老師欄位（跟著母課程走）', () => {
    resetMkT();
    mktSave(null);
    assertEq(mktRec().teacherIds, undefined);
    assertEq(mktRec().teacherNames, undefined);
  });

  test('換人 → 存 id 與名字快照', () => {
    resetMkT();
    mktSave({ ids: [2], names: '張老師' });
    assertEqDeep(mktRec().teacherIds, [2]);
    assertEq(mktRec().teacherNames, '張老師');
  });

  test('沒換人時課表顯示母課程的老師；母課程換老師，補課跟著換', () => {
    resetMkT();
    mktSave(null);
    assertEq(mktOcc().teacher, '李老師');
    driveData.courses[0].teacherIds = [2];
    assertEq(mktOcc().teacher, '張老師');
  });

  test('換過人時課表顯示的是那位（母課程換老師也不動）', () => {
    resetMkT();
    mktSave({ ids: [2], names: '張老師' });
    assertEq(mktOcc().teacher, '張老師');
    driveData.courses[0].teacherIds = [1];
    assertEq(mktOcc().teacher, '張老師');
  });
});

// ────────────────────────────────────────────────────────
suite('補課換老師：不可以被別的動作洗掉', () => {

  test('只改時間（桌面日曆拖曳、不傳老師）→ 老師留著', () => {
    resetMkT();
    mktSave({ ids: [2], names: '張老師' });
    const id = mktRec().id;
    // 拖曳改期走的路徑：省略最後那個參數
    saveMakeupScheduled(mktEv(), new Date(2026, 7, 13, 17, 0), new Date(2026, 7, 13, 18, 0),
      '108', null, '補課', ['小明'], id);
    assertEqDeep(mktRec().teacherIds, [2]);
    assertEq(new Date(mktRec().scheduledDate).getHours(), 17);
  });

  test('明講改回原班老師（傳 null）→ 欄位清掉', () => {
    resetMkT();
    mktSave({ ids: [2], names: '張老師' });
    mktSave(null, mktRec().id);
    assertEq(mktRec().teacherIds, undefined);
  });
});

// ────────────────────────────────────────────────────────
suite('補課換老師：撞課檢查跟著換', () => {

  test('換成張老師 → 張老師那時段的課算撞', () => {
    resetMkT();
    const avail = expandCoursesForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59));
    const asZhang = { ...mktEv(), teacherIds: [2], teacher: '張老師' };
    const busy = mkTeacherBusyAt(asZhang, avail, new Date(2026, 7, 13, 20, 0), new Date(2026, 7, 13, 21, 0));
    assertEqDeep(busy.map(o => o.origTitle), ['國二數學C班']);
    // 原班老師（李老師）那時段是空的
    assertEq(mkTeacherBusyAt(mktEv(), avail, new Date(2026, 7, 13, 20, 0), new Date(2026, 7, 13, 21, 0)).length, 0);
  });

  test('已排好的補課場次自己也擋得住（換老師後的那場算他的課）', () => {
    resetMkT();
    mktSave({ ids: [2], names: '張老師' }, null, 15);   // 張老師 15:00–16:00 補課
    const avail = expandCoursesForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59))
      .concat(expandMakeupForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59)));
    const asZhang = { ...mktEv(), teacherIds: [2], teacher: '張老師' };
    const busy = mkTeacherBusyAt(asZhang, avail, new Date(2026, 7, 13, 15, 30), new Date(2026, 7, 13, 16, 30));
    assertEq(busy.length, 1);
  });
});
