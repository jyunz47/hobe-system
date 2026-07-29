// migrate-absences.js 測試：舊行事曆請假 → 系統請假紀錄（全頁改讀系統第 4 刀 (a)）
// 載入順序：stubs（index.html 內）→ parse.js / schedule.js / migrate-absences.js → test-runner.js → 本檔
//
// 核心保證：搬遷後由 _snapshotOccurrence 長出的課堂物件，
// 在待補課清單看得到的欄位上要與原本 parseEv 的結果一致（＝畫面不變）。

// 造一個 Google Calendar 事件（再交給 parseEv 解析，避免自己手編內部欄位）
function mkCalEv(over) {
  return Object.assign({
    id: 'gcal-evt-1',
    summary: '國二數學班',
    description: '小教室 陳老師\n小明、小華、小美',
    start: { dateTime: '2026-06-10T19:00:00+08:00' },
    end:   { dateTime: '2026-06-10T21:00:00+08:00' },
    _calId: 'cal-general',
    _calName: '一般課程',
  }, over || {});
}
function parsedEv(over) { return parseEv(mkCalEv(over)); }

const MIG_STUDENTS = [
  { id: 101, name: '小明' },
  { id: 102, name: '小華' },
  { id: 103, name: '小美' },
  { id: 104, name: '菜市仔名' },
  { id: 105, name: '菜市仔名' },   // 同名兩位 → 無法判斷是誰
];

function build(evs, over) {
  const o = over || {};
  return buildAbsenceMigration(
    evs,
    o.students || MIG_STUDENTS,
    o.existing || [],
    o.scheduled || [],
    o.now || new Date('2026-07-29T12:00:00+08:00')
  );
}

// ────────────────────────────────────────────────────────
suite('buildAbsenceMigration：哪些要搬、搬成什麼', () => {

  test('學生請假 → leave 一筆，studentId 對回學生檔', () => {
    const { records, stats } = build([parsedEv({ summary: '【小明請假】國二數學班' })]);
    assertEq(records.length, 1);
    assertEq(stats.migrate, 1);
    assertEqDeep(records[0].leave, [{ studentId: 101, name: '小明', timing: 'B' }]);
    assertEqDeep(records[0].noShow, []);
    assertFalse(records[0].teacherAbsent);
    assertFalse(records[0].resched);
  });

  test('多人請假 → 每人一筆 leave', () => {
    const { records } = build([parsedEv({ summary: '【小明、小華請假】國二數學班' })]);
    assertEqDeep(records[0].leave.map(x => x.name), ['小明', '小華']);
    assertEqDeep(records[0].leave.map(x => x.studentId), [101, 102]);
  });

  test('同名學生 → studentId 給 null，名字照樣保留', () => {
    const { records, stats } = build([parsedEv({
      summary: '【菜市仔名請假】國二數學班',
      description: '小教室 陳老師\n菜市仔名、小明',
    })]);
    assertEqDeep(records[0].leave, [{ studentId: null, name: '菜市仔名', timing: 'B' }]);
    assertEqDeep(stats.unmatched, ['菜市仔名']);
  });

  test('查無此人（學生已刪檔）→ studentId null 並列進 unmatched', () => {
    const { stats } = build([parsedEv({
      summary: '【路人甲請假】國二數學班',
      description: '小教室 陳老師\n路人甲',
    })]);
    assertEqDeep(stats.unmatched, ['路人甲']);
    assertEq(stats.matched, 0);
  });

  test('調課 → resched 旗標，leave 留空（不是某幾位請假）', () => {
    const { records } = build([parsedEv({ summary: '【調課：老師出國】國二數學班' })]);
    assertTrue(records[0].resched);
    assertEq(records[0].reschedReason, '老師出國');
    assertEqDeep(records[0].leave, []);
    // 全名冊仍存在 snapshot 裡，展開時才變成 absentStudents
    assertEqDeep(records[0].snapshot.students, ['小明', '小華', '小美']);
  });

  test('老師請假 → teacherAbsent，leave 留空', () => {
    const { records } = build([parsedEv({ summary: '【老師請假】國二數學班' })]);
    assertTrue(records[0].teacherAbsent);
    assertEqDeep(records[0].leave, []);
  });

  test('曠課 → 進 noShow，不進 leave', () => {
    const { records } = build([parsedEv({ summary: '【小華曠課】國二數學班' })]);
    assertEqDeep(records[0].noShow, [{ studentId: 102, name: '小華' }]);
    assertEqDeep(records[0].leave, []);
  });

  test('請假＋曠課並存 → 兩邊各自進 leave / noShow', () => {
    const { records } = build([parsedEv({ summary: '【小明請假】【小華曠課】國二數學班' })]);
    assertEqDeep(records[0].leave.map(x => x.name), ['小明']);
    assertEqDeep(records[0].noShow.map(x => x.name), ['小華']);
  });

  test('沒有請假標記的一般課 → 不搬', () => {
    const { records, stats } = build([parsedEv({})]);
    assertEq(records.length, 0);
    assertEq(stats.scanned, 0);
  });

  test('occId ＝ 原 Calendar 事件 id（已排的補課靠它對回，不能換）', () => {
    const { records } = build([parsedEv({ id: 'abc123', summary: '【小明請假】國二數學班' })]);
    assertEq(records[0].occId, 'abc123');
    assertEq(records[0].courseId, null);
  });

  test('snapshot 帶齊顯示所需：課名、老師、教室、時段、名單', () => {
    const { records } = build([parsedEv({ summary: '【小明請假】國二數學班' })]);
    const sn = records[0].snapshot;
    assertEq(sn.title, '國二數學班');
    assertEq(sn.teacher, '陳老師');
    assertEq(sn.classroom, '小教室');
    assertEq(sn.calName, '一般課程');
    assertEqDeep(sn.students, ['小明', '小華', '小美']);
    assertEq(new Date(sn.start).getHours(), 19);
    assertEq(new Date(sn.end).getHours(), 21);
  });

  test('請假時機（absenceTiming）與不補課（makeupSkip）一起搬過來', () => {
    const ev = parsedEv({
      summary: '【小明請假】國二數學班',
      extendedProperties: { private: {
        absenceTiming: JSON.stringify({ 小明: 'A' }),
        makeupSkip: JSON.stringify(['小明']),
      } },
    });
    const { records } = build([ev]);
    assertEq(records[0].leave[0].timing, 'A');
    assertEqDeep(records[0].makeupSkip, ['小明']);
  });

});

// ────────────────────────────────────────────────────────
suite('buildAbsenceMigration：重跑安全（idempotent）', () => {

  test('已搬過的（existing 有同 occId）→ 跳過、算進 already', () => {
    const ev = parsedEv({ id: 'dup-1', summary: '【小明請假】國二數學班' });
    const { stats, records } = build([ev], { existing: [{ occId: 'dup-1' }] });
    assertEq(records.length, 0);
    assertEq(stats.already, 1);
    assertEq(stats.migrate, 0);
    assertEq(stats.scanned, 1);
  });

  test('把第一次的結果當 existing 再跑一次 → 一筆都不會重複', () => {
    const evs = [
      parsedEv({ id: 'e1', summary: '【小明請假】國二數學班' }),
      parsedEv({ id: 'e2', summary: '【調課】國二數學班' }),
    ];
    const first = build(evs);
    assertEq(first.records.length, 2);
    const second = build(evs, { existing: first.records });
    assertEq(second.records.length, 0);
    assertEq(second.stats.already, 2);
  });

  test('系統自己產生的請假紀錄（sys: occId）不會被誤判成已搬', () => {
    const ev = parsedEv({ id: 'gcal-x', summary: '【小明請假】國二數學班' });
    const { records } = build([ev], { existing: [{ occId: 'sys:7:2026-06-10:0' }] });
    assertEq(records.length, 1);
  });

});

// ────────────────────────────────────────────────────────
suite('buildAbsenceMigration：預覽的狀態分類', () => {

  const NOW = new Date('2026-07-29T12:00:00+08:00');

  test('沒排補課 → 待安排', () => {
    const { stats } = build([parsedEv({ id: 'p1', summary: '【小明請假】國二數學班' })]);
    assertEq(stats.byStatus.pending, 1);
  });

  test('補課排在未來 → 已排補課', () => {
    const { stats } = build([parsedEv({ id: 'p2', summary: '【小明請假】國二數學班' })], {
      scheduled: [{ originalId: 'p2', scheduledEnd: '2026-08-10T20:00:00+08:00' }], now: NOW,
    });
    assertEq(stats.byStatus.scheduled, 1);
  });

  test('補課已經上完 → 已完成', () => {
    const { stats } = build([parsedEv({ id: 'p3', summary: '【小明請假】國二數學班' })], {
      scheduled: [{ originalId: 'p3', scheduledEnd: '2026-07-01T20:00:00+08:00' }], now: NOW,
    });
    assertEq(stats.byStatus.completed, 1);
  });

  test('請假學生全在 makeupSkip → 不補課', () => {
    const ev = parsedEv({
      id: 'p4', summary: '【小明請假】國二數學班',
      extendedProperties: { private: { makeupSkip: JSON.stringify(['小明']) } },
    });
    assertEq(build([ev]).stats.byStatus.skipped, 1);
  });

  test('純曠課 → 歸曠課類（不算待安排）', () => {
    const { stats } = build([parsedEv({ id: 'p5', summary: '【小華曠課】國二數學班' })]);
    assertEq(stats.byStatus.noshow, 1);
    assertEq(stats.byStatus.pending, 0);
  });

  test('狀態分類不影響「要不要搬」——已完成的一樣搬', () => {
    const { records } = build([parsedEv({ id: 'p6', summary: '【小明請假】國二數學班' })], {
      scheduled: [{ originalId: 'p6', scheduledEnd: '2026-07-01T20:00:00+08:00' }], now: NOW,
    });
    assertEq(records.length, 1);
  });

});

// ────────────────────────────────────────────────────────
// 真正的驗收點：搬完之後長出來的課堂物件，要跟原本 parseEv 的一樣
suite('_snapshotOccurrence：搬遷後畫面欄位與原本一致', () => {

  function roundTrip(over) {
    const ev = parsedEv(over);
    const { records } = build([ev]);
    return { before: ev, after: _snapshotOccurrence(records[0]) };
  }

  test('學生請假：請假名單、部分請假旗標、標題都一致', () => {
    const { before, after } = roundTrip({ summary: '【小明請假】國二數學班' });
    assertEq(after.origTitle, before.origTitle);
    assertEq(after.absType, before.absType);
    assertEqDeep(after.absentStudents, before.absentStudents);
    assertEq(after.isAbsent, before.isAbsent);
    assertEq(after.isPartialAbsent, before.isPartialAbsent);
    assertEq(after.isFullAbsent, before.isFullAbsent);
    assertEq(after.absentWho, before.absentWho);
  });

  test('調課：整堂移走的語意一致（absentStudents ＝ 全名冊）', () => {
    const { before, after } = roundTrip({ summary: '【調課：老師出國】國二數學班' });
    assertEq(after.absType, '調課');
    assertEq(after.isRescheduled, true);
    assertEq(after.rescheduleReason, before.rescheduleReason);
    assertEqDeep(after.absentStudents, before.absentStudents);
    assertEq(after.isFullAbsent, before.isFullAbsent);
  });

  test('老師請假：整堂請假、學生名單不算請假', () => {
    const { before, after } = roundTrip({ summary: '【老師請假】國二數學班' });
    assertEq(after.absType, '老師請假');
    assertEq(after.absentWho, '老師');
    assertEqDeep(after.absentStudents, before.absentStudents);
    assertEq(after.isFullAbsent, true);
  });

  test('一人請假一人曠課：兩邊旗標都對', () => {
    const { before, after } = roundTrip({ summary: '【小明請假】【小華曠課】國二數學班' });
    assertEqDeep(after.absentStudents, before.absentStudents);
    assertEqDeep(after.noShowStudents, before.noShowStudents);
    assertEq(after.isNoShow, true);
    assertEqDeep(after.absenceTiming, { 小明: 'B', 小華: 'C' });
  });

  test('時段、教室、老師、名單、課型都照抄', () => {
    const { before, after } = roundTrip({ summary: '【小明請假】國二數學班' });
    assertEq(after.startDt.getTime(), before.startDt.getTime());
    assertEq(after.endDt.getTime(), before.endDt.getTime());
    assertEq(after.durMins, before.durMins);
    assertEq(after.classroom, before.classroom);
    assertEq(after.teacher, before.teacher);
    assertEq(after.type, before.type);
    assertEqDeep(after.students, before.students);
  });

  test('id 不變 → 已排的補課仍對得回這筆請假', () => {
    const { before, after } = roundTrip({ id: 'keep-me', summary: '【小明請假】國二數學班' });
    assertEq(after.id, before.id);
    assertEq(after.id, 'keep-me');
  });

  test('搬過來的紀錄標記成系統事件（不會再去戳 Google Calendar）', () => {
    const { after } = roundTrip({ summary: '【小明請假】國二數學班' });
    assertEq(after.calId, null);
    assertEq(after.courseId, null);
    assertTrue(after.isLegacyAbsence);
    assertTrue(isSysEvent(after));
  });

  test('不補課名單（退半堂）跟著過來', () => {
    const { after } = roundTrip({
      summary: '【小明請假】國二數學班',
      extendedProperties: { private: { makeupSkip: JSON.stringify(['小明']) } },
    });
    assertEqDeep(after.makeupSkip, ['小明']);
  });

});

// ────────────────────────────────────────────────────────
suite('sysAbsenceEvents：系統課紀錄與搬遷紀錄並存', () => {

  test('有 snapshot 的走快照、沒有的照舊查系統課（查無就跳過）', () => {
    const saved = driveData;
    driveData = Object.assign({}, saved, {
      absences: [
        { occId: 'sys:999:2026-06-10:0', courseId: 999, date: '2026-06-10T19:00:00+08:00', leave: [] },
        { occId: 'gcal-1', courseId: null, date: '2026-06-11T19:00:00+08:00',
          leave: [{ studentId: 101, name: '小明', timing: 'B' }], noShow: [],
          snapshot: { title: '國二數學班', teacher: '陳老師', classroom: '小教室',
            type: 'group', calName: '一般課程', students: ['小明', '小華'],
            start: '2026-06-11T19:00:00+08:00', end: '2026-06-11T21:00:00+08:00' } },
      ],
      courses: [],   // 課程已被 cutover 清掉 → 上面那筆系統紀錄查無課程
    });
    const out = sysAbsenceEvents();
    driveData = saved;
    assertEq(out.length, 1);            // 查無課程的被跳過，快照的長出來
    assertEq(out[0].id, 'gcal-1');
    assertEq(out[0].origTitle, '國二數學班');
    assertEqDeep(out[0].absentStudents, ['小明']);
  });

});
