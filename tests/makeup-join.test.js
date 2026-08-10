// 「併班補課」的資料層測試（2026-08-06，補課三刀第 2 刀）
// 載入順序：stubs（index.html 內）→ utils → enrollment → schedule → dayview → courses
//           → absence → makeup → students → test-runner → 本檔
//
// 最在意的四條：
//  ① 併班的場次**不可以**在課表上另長一堂（那堂課本來就存在，長出來就變兩堂）
//  ② 那幾個人要疊進主課的名冊（點名／成績／日曆看得到），且標得出來是補課生
//  ③ 疊進去的人不可以被算成主課的在籍生（請假 chips、登記簿都不能被污染）
//  ④ 待補課清單那邊的帳要跟一般補課一樣會結：pending 減少、欠課會消

// 週二 19:00 國二數學班（小明/小華/小美，李老師）8/11 三人請假；
// 週四有四堂可當主課：國二數學B班（19:00・李老師）、國二數學C班（20:00・張老師）、
//                     國二英文班（17:00・李老師）、練習課（15:00）
// 全部人都是國二，另有高二的小虎（用來測年級）。2026-08-11＝週二，2026-08-13＝週四
function resetJoin() {
  driveData = {
    studentList: [{ id: 1, name: '小明', grade: '國二' }, { id: 2, name: '小華', grade: '國二' },
                  { id: 3, name: '小美', grade: '國二' }, { id: 4, name: '小龍', grade: '國二' },
                  { id: 5, name: '小虎', grade: '國二' }],
    enrollments: [
      ...[1, 2, 3].map(sid => ({ studentId: sid, courseId: 7, periodId: yearPeriodId('summer') })),
      ...[4, 5].map(sid => ({ studentId: sid, courseId: 8, periodId: yearPeriodId('summer') })),
      { studentId: 4, courseId: 9, periodId: yearPeriodId('summer') },
      { studentId: 5, courseId: 10, periodId: yearPeriodId('summer') },
      { studentId: 4, courseId: 11, periodId: yearPeriodId('summer') },
    ],
    makeupScheduled: [], coursePrices: [], courseSettings: [],
    teachers: [{ id: 1, name: '李老師' }, { id: 2, name: '張老師' }],
    courses: [
      { id: 7, name: '國二數學班', type: '團班', room: '小教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 2, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 8, name: '國二數學B班', type: '團班', room: '108', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '19:00', end: '20:30' }], phases: [] } },
      { id: 9, name: '國二英文班', type: '團班', room: '208', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '17:00', end: '18:30' }], phases: [] } },
      { id: 10, name: '週四練習課', type: '練習課', room: '大教室', status: '開課中', teacherIds: [1],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '15:00', end: '17:00' }], phases: [] } },
      { id: 11, name: '國二數學C班', type: '團班', room: '309', status: '開課中', teacherIds: [2],
        schedule: { mode: 'weekly', slots: [{ weekday: 4, start: '20:00', end: '21:30' }], phases: [] } },
    ],
    absences: [{
      id: 1, occId: 'sys:7:2026-08-11:0', courseId: 7, date: new Date(2026, 7, 11, 19, 0).toISOString(),
      teacherAbsent: false, noShow: [], makeupSkip: [],
      leave: [{ studentId: 1, name: '小明', timing: 'A' },
              { studentId: 2, name: '小華', timing: 'A' },
              { studentId: 3, name: '小美', timing: 'A' }],
    }],
  };
  makeupMatchMap = new Map();
  _saveCount = 0; _mkCalls = []; _actCalls = [];
  currentPeriodId = 'summer';
  makeupList = sysAbsenceEvents();
}

function jAbsEv() { return makeupList.find(e => e.id === 'sys:7:2026-08-11:0'); }
// 週四那天的所有課堂（＝slot picker 的 avail）
function thuOccs() {
  return expandCoursesForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59));
}
function occOf(courseId) { return thuOccs().find(o => o.courseId === courseId); }
// 把某幾個人併進某一堂
function joinInto(courseId, students) {
  saveMakeupJoin(jAbsEv(), occOf(courseId), students);
}

// ────────────────────────────────────────────────────────
suite('併班補課：課表不可以多長一堂', () => {

  test('存出來的是 kind=join，時間/教室照抄主課', () => {
    resetJoin();
    joinInto(8, ['小明']);
    const rec = getMakeupsFor('sys:7:2026-08-11:0')[0];
    assertEq(rec.kind, 'join');
    assertEq(rec.hostOccId, 'sys:8:2026-08-13:0');
    assertEq(rec.hostTitle, '國二數學B班');
    assertEq(rec.room, '108');
    assertEq(new Date(rec.scheduledDate).getHours(), 19);
    assertEq(new Date(rec.scheduledEnd).getHours(), 20);
  });

  test('展開器不為併班場次長課堂（長了就會跟主課重複）', () => {
    resetJoin();
    joinInto(8, ['小明']);
    const occ = expandMakeupForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59));
    assertEq(occ.length, 0);
  });

  test('另開一場的補課照舊會長出課堂（沒被這一刀波及）', () => {
    resetJoin();
    saveMakeupScheduled(jAbsEv(), new Date(2026, 7, 13, 14, 0), new Date(2026, 7, 13, 14, 45),
      '309', null, '補課', ['小華']);
    const occ = expandMakeupForRange(new Date(2026, 7, 13, 0, 0), new Date(2026, 7, 13, 23, 59));
    assertEq(occ.length, 1);
    assertEq(occ[0].classroom, '309');
  });
});

// ────────────────────────────────────────────────────────
suite('併班補課：那幾個人疊進主課名冊', () => {

  test('主課名冊多出補課生（本班兩人 → 三人）', () => {
    resetJoin();
    assertEqDeep(eventRoster(occOf(8)), ['小龍', '小虎']);
    joinInto(8, ['小明']);
    assertEqDeep(eventRoster(occOf(8)), ['小龍', '小虎', '小明']);
  });

  test('點名用名冊帶 join 標記與來源課名，studentId 從請假紀錄的雙存取（同名不會點錯人）', () => {
    resetJoin();
    joinInto(8, ['小明', '小華']);
    const rows = eventRosterWithId(occOf(8));
    assertEq(rows.length, 4);
    const mk = rows.filter(r => r.join);
    assertEqDeep(mk.map(r => r.name), ['小明', '小華']);
    assertEqDeep(mk.map(r => r.studentId), [1, 2]);
    assertEq(mk[0].fromTitle, '國二數學班');
    assertEq(rows[0].join, undefined);   // 本班生不該被標成補課生
  });

  test('只影響被併的那一堂，同一天別堂課的名冊不動', () => {
    resetJoin();
    joinInto(8, ['小明']);
    assertEqDeep(eventRoster(occOf(9)), ['小龍']);
    assertEq(joinCountOn('sys:8:2026-08-13:0'), 1);
    assertEq(joinCountOn('sys:9:2026-08-13:0'), 0);
  });

  test('補課生不進登記簿、也不進展開器的在籍名冊（請假 chips 靠的是那一份）', () => {
    resetJoin();
    joinInto(8, ['小明']);
    assertEq(driveData.enrollments.filter(en => en.courseId === 8).length, 2);
    assertEqDeep(occOf(8).students, ['小龍', '小虎']);
  });

  test('同一人既在籍又被併進來 → 名冊不重複列', () => {
    resetJoin();
    // 小龍本來就在國二數學B班，硬塞一筆進去（資料髒掉時的防呆）
    saveMakeupJoin(jAbsEv(), occOf(8), ['小龍', '小明']);
    assertEqDeep(eventRoster(occOf(8)), ['小龍', '小虎', '小明']);
    assertEq(eventRosterWithId(occOf(8)).filter(r => r.name === '小龍').length, 1);
  });

  test('取消那場併班 → 主課名冊縮回原樣', () => {
    resetJoin();
    joinInto(8, ['小明']);
    deleteMakeupScheduled(getMakeupsFor('sys:7:2026-08-11:0')[0].id);
    assertEqDeep(eventRoster(occOf(8)), ['小龍', '小虎']);
  });
});

// ────────────────────────────────────────────────────────
suite('併班補課：待補課清單的帳照結', () => {

  test('併班算已排，剩下的人還在待安排', () => {
    resetJoin();
    joinInto(8, ['小明']);
    assertEqDeep(mkPendingNames(jAbsEv()), ['小華', '小美']);
    assertEq(mkStatusOf(jAbsEv(), new Date(2026, 7, 12)), 'pending');
  });

  test('三人都併進去 → 已安排；主課上完 → 已完成', () => {
    resetJoin();
    joinInto(8, ['小明', '小華', '小美']);
    assertEqDeep(mkPendingNames(jAbsEv()), []);
    assertEq(mkStatusOf(jAbsEv(), new Date(2026, 7, 12)), 'scheduled');
    assertEq(mkStatusOf(jAbsEv(), new Date(2026, 7, 20)), 'completed');
  });

  test('併班可以跟另開場次並存（一人併班、一人自己排）', () => {
    resetJoin();
    joinInto(8, ['小明']);
    saveMakeupScheduled(jAbsEv(), new Date(2026, 7, 14, 17, 0), new Date(2026, 7, 14, 17, 45),
      '309', null, '補課', ['小華']);
    const recs = getMakeupsFor('sys:7:2026-08-11:0');
    assertEq(recs.length, 2);
    assertEqDeep(mkPendingNames(jAbsEv()), ['小美']);
  });

  test('學生統計：併班的課上完後，那位學生的欠課消掉、其他人照欠', () => {
    resetJoin();
    // 欠課要「已經上完」才消 → 併進 7/30（週四）那堂已過去的課
    saveMakeupJoin(jAbsEv(), expandCoursesForRange(new Date(2026, 6, 30, 0, 0), new Date(2026, 6, 30, 23, 59))
      .find(o => o.courseId === 8), ['小明']);
    assertEq(getStudentStats(1, 'summer').owed, 0);
    assertEq(getStudentStats(2, 'summer').owed, 1);
  });

  test('取消小明的請假 → 他那筆併班跟著撤，主課名冊也回去', () => {
    resetJoin();
    joinInto(8, ['小明']);
    driveData.absences[0].leave = driveData.absences[0].leave.filter(x => x.name !== '小明');
    syncMakeupOnLeaveCancel('sys:7:2026-08-11:0');
    assertEq(getMakeupsFor('sys:7:2026-08-11:0').length, 0);
    assertEqDeep(eventRoster(occOf(8)), ['小龍', '小虎']);
  });

  test('把小明改標成曠課 → 併班撤掉（曠課不排補課）', () => {
    resetJoin();
    joinInto(8, ['小明', '小華']);
    dropMakeupsForNoShow('sys:7:2026-08-11:0', ['小明']);
    const recs = getMakeupsFor('sys:7:2026-08-11:0');
    assertEq(recs.length, 1);
    assertEqDeep(recs[0].absentStudents, ['小華']);
    assertEqDeep(eventRoster(occOf(8)), ['小龍', '小虎', '小華']);
  });
});

// ────────────────────────────────────────────────────────
suite('併班補課：可以併進哪幾堂', () => {

  // exact＝三個條件（科目/年級/老師）全中，也就是預設會顯示的那幾堂
  function exactTitles(students) {
    return mkJoinCandidates(jAbsEv(), thuOccs(), students).filter(c => c.exact).map(c => c.occ.origTitle);
  }

  test('預設只有「同科目＋同年級＋同老師」算完全相符', () => {
    resetJoin();
    const cands = mkJoinCandidates(jAbsEv(), thuOccs(), ['小明']);
    assertEqDeep(cands.map(c => c.occ.origTitle), ['國二數學B班', '國二數學C班', '國二英文班']);
    assertEqDeep(cands.map(c => c.exact), [true, false, false]);
    assertEqDeep(exactTitles(['小明']), ['國二數學B班']);
  });

  test('同科目同年級但換老師 → 不算完全相符（只標「不同老師」，仍可攤開看到）', () => {
    resetJoin();
    const c = mkJoinCandidates(jAbsEv(), thuOccs(), ['小明']).find(x => x.occ.origTitle === '國二數學C班');
    assertEq(c.sameSubject, true);
    assertEq(c.sameGrade, true);
    assertEq(c.sameTeacher, false);
    assertEq(c.exact, false);
  });

  test('同科目同老師但換年級 → 不算完全相符', () => {
    resetJoin();
    // 國二數學B班全班改成高二 → 年級對不上
    driveData.studentList.filter(s => [4, 5].includes(s.id)).forEach(s => { s.grade = '高二'; });
    const c = mkJoinCandidates(jAbsEv(), thuOccs(), ['小明']).find(x => x.occ.origTitle === '國二數學B班');
    assertEq(c.sameGrade, false);
    assertEq(c.exact, false);
    assertEqDeep(exactTitles(['小明']), []);
  });

  test('老師改名不影響比對（比的是 teacherIds 不是名字）', () => {
    resetJoin();
    assertEqDeep(exactTitles(['小明']), ['國二數學B班']);
    driveData.courses.find(c => c.id === 8).teacherIds = [1];   // 同一位老師，換個 id 表示法也一樣
    assertEqDeep(exactTitles(['小明']), ['國二數學B班']);
  });

  test('那堂算不出年級（沒人填年級）→ 不當作「不合」，寬鬆放行', () => {
    resetJoin();
    driveData.studentList.filter(s => [4, 5].includes(s.id)).forEach(s => { delete s.grade; });
    const c = mkJoinCandidates(jAbsEv(), thuOccs(), ['小明']).find(x => x.occ.origTitle === '國二數學B班');
    assertEq(c.sameGrade, true);
    assertEq(c.exact, true);
  });

  test('標題字串講得出條件（給空狀態與區塊標題用）', () => {
    resetJoin();
    assertEq(mkJoinCriteriaTxt(jAbsEv(), ['小明']), '國二數學・李老師');
  });

  test('練習課與試聽不列（練習課本來就有自己的加入路徑）', () => {
    resetJoin();
    driveData.courses.find(c => c.id === 9).type = '試聽';
    assertEqDeep(exactTitles(['小明']), ['國二數學B班']);
    assertTrue(!mkJoinCandidates(jAbsEv(), thuOccs(), ['小明']).some(c => c.occ.origTitle === '國二英文班'),
      '試聽課不該出現在候選裡');
  });

  test('整堂請假／調課的那堂不列（沒課可以併）', () => {
    resetJoin();
    driveData.absences.push({
      id: 2, occId: 'sys:8:2026-08-13:0', courseId: 8, date: new Date(2026, 7, 13, 19, 0).toISOString(),
      teacherAbsent: true, leave: [], noShow: [], makeupSkip: [],
    });
    assertEqDeep(exactTitles(['小明']), []);
    assertTrue(!mkJoinCandidates(jAbsEv(), thuOccs(), ['小明']).some(c => c.occ.courseId === 8),
      '老師請假那堂不該出現在候選裡');
  });

  test('自己那堂不列（同一天的來源課堂）', () => {
    resetJoin();
    const tue = expandCoursesForRange(new Date(2026, 7, 11, 0, 0), new Date(2026, 7, 11, 23, 59));
    assertEqDeep(mkJoinCandidates(jAbsEv(), tue, ['小明']).map(c => c.occ.origTitle), []);
  });

  test('人已經全在名單上的那堂不列（併進去也沒意義）', () => {
    resetJoin();
    // 小虎只在國二數學B班 → 那堂濾掉
    assertTrue(!mkJoinCandidates(jAbsEv(), thuOccs(), ['小虎']).some(c => c.occ.courseId === 8),
      '小虎已在名單的那堂不該列出');
    // 小龍在 8、9、11 三堂都在 → 一堂都沒得併
    assertEqDeep(mkJoinCandidates(jAbsEv(), thuOccs(), ['小龍']).map(c => c.occ.origTitle), []);
    // 一部分人已在名單、一部分沒有 → 那堂還是要列（沒在的人補得到）
    assertEqDeep(exactTitles(['小龍', '小明']), ['國二數學B班']);
  });
});
