// 多裝置同步 第三刀：本機待送佇列（js/sync.js）
//
// 這一刀要證明的事：**頁面在「使用者做完」與「雲端確認」之間消失，那筆改動不會不見**。
// 第二刀把寫入從 set() 換成 runTransaction，換來逐筆合併的正確性，但賠掉了 set() 免費附贈的
// 離線耐受——交易需要一個來回，頁面一消失就是直接沒了（2026-08-24 老闆因此丟了一筆調課）。
//
// 每組「本體」測試盡量配一個「對照組」，直接跑第二刀的做法（沒有佇列）證明它真的會弄丟東西。

// 假 Firestore：跟 sync-merge.test.js 同一套語意，另外多一個 failNext 插針
// （讓「交易發出去但沒回來」變成可以重現的情境）。
function makeQueueCloud(initial) {
  const cloud = {
    data: initial ? JSON.parse(JSON.stringify(initial)) : null,
    writes: 0,
    failNext: 0,          // >0 時接下來這幾發交易直接拋錯
  };
  cloud.ref = {
    set(d, opts) {
      if (cloud.failNext > 0) { cloud.failNext--; return Promise.reject(new Error('boom')); }
      cloud.writes++;
      const copy = JSON.parse(JSON.stringify(d));
      cloud.data = (opts && opts.merge) ? Object.assign({}, cloud.data || {}, copy) : copy;
      return Promise.resolve();
    },
  };
  cloud.runTx = async function (fn) {
    if (cloud.failNext > 0) { cloud.failNext--; throw new Error('boom'); }
    let staged = null;
    const tx = {
      get() {
        return Promise.resolve({
          exists: cloud.data != null,
          data: () => JSON.parse(JSON.stringify(cloud.data || {})),
        });
      },
      set(ref, d, opts) { staged = { d: JSON.parse(JSON.stringify(d)), merge: !!(opts && opts.merge) }; },
    };
    const out = await fn(tx);
    cloud.writes++;
    cloud.data = staged.merge ? Object.assign({}, cloud.data || {}, staged.d) : staged.d;
    return out;
  };
  return cloud;
}

// 佇列的隔離：測試跟正式站同一個 origin，共用 localStorage。
// 不換 key 的話，測試留下的假批次會在老闆下次開系統時被當成真的補送出去。
const _REAL_QUEUE_KEY = SYNC_QUEUE_LS;
const TEST_QUEUE_KEY = 'hobe_pendingOps_TEST';
function queueReset() {
  SYNC_QUEUE_LS = TEST_QUEUE_KEY;
  try { localStorage.removeItem(TEST_QUEUE_KEY); } catch (_) {}
}
function queueCleanup() {
  try { localStorage.removeItem(TEST_QUEUE_KEY); } catch (_) {}
  SYNC_QUEUE_LS = _REAL_QUEUE_KEY;
}

const attRec = (e, s, status) => ({ eventId: e, studentId: s, status });
const attOf = a => (a || []).map(r => r.eventId + ':' + r.studentId + '=' + r.status);

suite('多裝置同步 第三刀 — 佇列本身（push / drop / settle）', () => {

  test('排進去看得到、清掉就不見', () => {
    queueReset();
    assertEq(syncQueueCount(), 0, '一開始是空的');
    syncQueuePush({ id: 'a', uid: 'u1', kind: 'main', ops: {} });
    syncQueuePush({ id: 'b', uid: 'u1', kind: 'main', ops: {} });
    assertEq(syncQueueCount('u1'), 2);
    syncQueueDrop('a');
    assertEqDeep(syncQueueFor('u1').map(b => b.id), ['b']);
    queueCleanup();
  });

  test('別的帳號的批次撈不出來（換人登入不會替對方送）', () => {
    queueReset();
    syncQueuePush({ id: 'mine', uid: 'u1', kind: 'main', ops: {} });
    syncQueuePush({ id: 'theirs', uid: 'u2', kind: 'main', ops: {} });
    assertEq(syncQueueCount('u1'), 1);
    assertEqDeep(syncQueueFor('u1').map(b => b.id), ['mine']);
    queueCleanup();
  });

  test('🔴 settle：同一份文件的舊批會被新批蓋掉（不然舊值會自己回來）', () => {
    queueReset();
    syncQueuePush({ id: 'old', uid: 'u1', kind: 'records', docId: 'attendance_2025_sem2', ops: {} });
    syncQueuePush({ id: 'new', uid: 'u1', kind: 'records', docId: 'attendance_2025_sem2', ops: {} });
    syncQueueSettle('new', 'records', 'attendance_2025_sem2');
    assertEq(syncQueueCount('u1'), 0, '自己與更早的同文件批次一起清掉');
    queueCleanup();
  });

  test('settle 不碰別份文件的批次', () => {
    queueReset();
    syncQueuePush({ id: 'grades', uid: 'u1', kind: 'records', docId: 'grades_2025_sem2', ops: {} });
    syncQueuePush({ id: 'att', uid: 'u1', kind: 'records', docId: 'attendance_2025_sem2', ops: {} });
    syncQueueSettle('att', 'records', 'attendance_2025_sem2');
    assertEqDeep(syncQueueFor('u1').map(b => b.id), ['grades'], '成績那批還沒送成，要留著');
    queueCleanup();
  });

  test('settle 對 main 只清同一欄，別欄留著', () => {
    queueReset();
    syncQueuePush({
      id: 'b1', uid: 'u1', kind: 'main',
      ops: { absences: { upserts: [], deletes: [] }, courses: { upserts: [], deletes: [] } },
    });
    syncQueuePush({ id: 'b2', uid: 'u1', kind: 'main', ops: { courses: { upserts: [], deletes: [] } } });
    syncQueueSettle('b2', 'main', null, ['courses']);
    const left = syncQueueFor('u1');
    assertEq(left.length, 1);
    assertEqDeep(Object.keys(left[0].ops), ['absences'], '請假那欄還沒送成，不能跟著被清掉');
    queueCleanup();
  });

  test('settle 不動比自己晚排進來的批次', () => {
    queueReset();
    syncQueuePush({ id: 'first', uid: 'u1', kind: 'records', docId: 'd', ops: {} });
    syncQueuePush({ id: 'second', uid: 'u1', kind: 'records', docId: 'd', ops: {} });
    syncQueueSettle('first', 'records', 'd');
    assertEqDeep(syncQueueFor('u1').map(b => b.id), ['second'], '晚排的是這一發之後才做的事，還沒落地');
    queueCleanup();
  });

});

suite('多裝置同步 第三刀 — 存檔會先上保險（syncSaveRecords）', () => {

  atest('寫成功 → 佇列清空（保險用不到就收起來）', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    const cur = [attRec('e1', 's1', '到')];
    await syncSaveRecords(cloud.ref, cloud.runTx, [], cur, attKeyOf,
      { docId: 'attendance_x', keyKind: 'att', uid: 'u1' });
    assertEqDeep(attOf(cloud.data.records), ['e1:s1=到']);
    assertEq(syncQueueCount('u1'), 0, '落地了就不留保險');
    queueCleanup();
  });

  atest('🩸 本體：交易失敗 → 那批還留在佇列裡（頁面現在死掉也救得回來）', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    cloud.failNext = 1;
    const cur = [attRec('e1', 's1', '到')];
    let threw = false;
    try {
      await syncSaveRecords(cloud.ref, cloud.runTx, [], cur, attKeyOf,
        { docId: 'attendance_x', keyKind: 'att', uid: 'u1' });
    } catch (_) { threw = true; }
    assertTrue(threw, '失敗要往上拋，呼叫端才會重試');
    assertEq(syncQueueCount('u1'), 1, '保險留著');
    assertEqDeep(attOf(cloud.data.records), [], '雲端確實還沒有那筆');
    queueCleanup();
  });

  atest('對照組：不給佇列資訊（＝第二刀的做法）→ 失敗後什麼都沒留下，那筆就這樣沒了', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    cloud.failNext = 1;
    try {
      await syncSaveRecords(cloud.ref, cloud.runTx, [], [attRec('e1', 's1', '到')], attKeyOf);
    } catch (_) {}
    assertEq(syncQueueCount('u1'), 0, '沒有保險');
    assertEqDeep(attOf(cloud.data.records), [], '雲端也沒有 → 改動人間蒸發');
    queueCleanup();
  });

  atest('沒動到任何一筆 → 不排進佇列（別把佇列灌滿空批次）', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [attRec('e1', 's1', '到')] });
    const same = [attRec('e1', 's1', '到')];
    const out = await syncSaveRecords(cloud.ref, cloud.runTx, same, JSON.parse(JSON.stringify(same)),
      attKeyOf, { docId: 'attendance_x', keyKind: 'att', uid: 'u1' });
    assertEq(out, null);
    assertEq(syncQueueCount('u1'), 0);
    queueCleanup();
  });

  atest('認不出筆別 → 佇列記的是「整份取代」，補送時照樣整份取代', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    cloud.failNext = 1;
    const cur = [{ id: 'g1', v: 1 }, { id: 'g1', v: 2 }];   // 同一把鑰匙出現兩次
    try {
      await syncSaveRecords(cloud.ref, cloud.runTx, [], cur, recIdKeyOf,
        { docId: 'grades_x', keyKind: 'rec', uid: 'u1' });
    } catch (_) {}
    const [b] = syncQueueFor('u1');
    assertTrue(!!(b && b.ops && b.ops.replace), '記成整份取代');
    await syncReplayBatch(b, () => cloud.ref, cloud.runTx);
    assertEq(cloud.data.records.length, 2);
    queueCleanup();
  });

});

suite('多裝置同步 第三刀 — 頁面死掉再開（syncReplayBatch）', () => {

  atest('🩸 本體：交易失敗後關掉分頁，下次開頁補送 → 那筆回來了', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    cloud.failNext = 1;
    try {
      await syncSaveRecords(cloud.ref, cloud.runTx, [], [attRec('e1', 's1', '到')], attKeyOf,
        { docId: 'attendance_x', keyKind: 'att', uid: 'u1' });
    } catch (_) {}
    // ── 這裡等於「分頁被關掉、本機記憶體全沒了」，只剩 localStorage 裡那批 ──
    const pending = syncQueueFor('u1');
    assertEq(pending.length, 1);
    for (const b of pending) { await syncReplayBatch(b, () => cloud.ref, cloud.runTx); syncQueueDrop(b.id); }
    assertEqDeep(attOf(cloud.data.records), ['e1:s1=到'], '補回來了');
    assertEq(syncQueueCount('u1'), 0);
    queueCleanup();
  });

  atest('補送是冪等的：同一批送兩次，結果跟送一次一樣', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    cloud.failNext = 1;
    try {
      await syncSaveRecords(cloud.ref, cloud.runTx, [], [attRec('e1', 's1', '到')], attKeyOf,
        { docId: 'attendance_x', keyKind: 'att', uid: 'u1' });
    } catch (_) {}
    const [b] = syncQueueFor('u1');
    await syncReplayBatch(b, () => cloud.ref, cloud.runTx);
    await syncReplayBatch(b, () => cloud.ref, cloud.runTx);
    assertEqDeep(attOf(cloud.data.records), ['e1:s1=到'], '不會變成兩筆');
    queueCleanup();
  });

  atest('補送疊在別台這段時間寫的東西上面，不會把對方蓋掉', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    cloud.failNext = 1;
    try {
      await syncSaveRecords(cloud.ref, cloud.runTx, [], [attRec('e1', 's1', '到')], attKeyOf,
        { docId: 'attendance_x', keyKind: 'att', uid: 'u1' });
    } catch (_) {}
    // 我這台掛掉的期間，櫃台點了別堂課的名
    cloud.data = { records: [attRec('e9', 's9', '到')] };
    const [b] = syncQueueFor('u1');
    await syncReplayBatch(b, () => cloud.ref, cloud.runTx);
    assertEqDeep(attOf(cloud.data.records).sort(), ['e1:s1=到', 'e9:s9=到'], '兩邊都在');
    queueCleanup();
  });

  atest('🔴 回歸：先失敗再改再成功 → 舊批不會把舊值蓋回來', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    // 第一發：標「到」，交易失敗（基準不動，所以下一發是從同一個基準重算）
    cloud.failNext = 1;
    try {
      await syncSaveRecords(cloud.ref, cloud.runTx, [], [attRec('e1', 's1', '到')], attKeyOf,
        { docId: 'attendance_x', keyKind: 'att', uid: 'u1' });
    } catch (_) {}
    assertEq(syncQueueCount('u1'), 1);
    // 第二發：改成「遲到」，這次成功 → settle 應該把第一發那批一起清掉
    await syncSaveRecords(cloud.ref, cloud.runTx, [], [attRec('e1', 's1', '遲到')], attKeyOf,
      { docId: 'attendance_x', keyKind: 'att', uid: 'u1' });
    assertEqDeep(attOf(cloud.data.records), ['e1:s1=遲到']);
    assertEq(syncQueueCount('u1'), 0, '舊批已被新批蓋過，不能留');
    // 下次開頁補送（佇列是空的）→ 還是「遲到」
    for (const b of syncQueueFor('u1')) await syncReplayBatch(b, () => cloud.ref, cloud.runTx);
    assertEqDeep(attOf(cloud.data.records), ['e1:s1=遲到'], '不會變回「到」');
    queueCleanup();
  });

  atest('對照組：舊批沒被清掉的話，補送真的會把舊值蓋回去（證明 settle 有用）', async () => {
    queueReset();
    const cloud = makeQueueCloud({ records: [] });
    const stale = { id: 'stale', uid: 'u1', kind: 'records', docId: 'attendance_x', keyKind: 'att',
      ops: diffRecords([], [attRec('e1', 's1', '到')], attKeyOf) };
    cloud.data = { records: [attRec('e1', 's1', '遲到')] };
    await syncReplayBatch(stale, () => cloud.ref, cloud.runTx);
    assertEqDeep(attOf(cloud.data.records), ['e1:s1=到'], '舊值真的回來了 → 所以 settle 非做不可');
    queueCleanup();
  });

  atest('課表那包（main）也補得回來：請假那欄補送後兩台的紀錄都在', async () => {
    queueReset();
    const cloud = makeQueueCloud({ absences: [] });
    const ops = syncMainOps(['absences'], { absences: [{ occId: 'sys:1:2026-08-24:0', resched: true }] },
      { absences: [] });
    const batch = syncQueuePush({ id: 'm1', uid: 'u1', kind: 'main', ops });
    // 我這台掛掉的期間，櫃台標了別堂的請假
    cloud.data = { absences: [{ occId: 'sys:9:2026-08-24:0', leave: [{ name: '小華' }] }] };
    await syncReplayBatch(batch, () => cloud.ref, cloud.runTx);
    assertEqDeep(cloud.data.absences.map(a => a.occId).sort(),
      ['sys:1:2026-08-24:0', 'sys:9:2026-08-24:0'], '調課那筆補回來，櫃台那筆也還在');
    queueCleanup();
  });

  atest('syncMainOps + applyMainOps 拆開後跟 syncMergeMain 完全等價', async () => {
    const cloudDoc = { courses: [{ id: 1, name: '舊' }, { id: 2, name: '別台的' }] };
    const base = { courses: [{ id: 1, name: '舊' }] };
    const local = { courses: [{ id: 1, name: '新' }] };
    const viaMerge = syncMergeMain(cloudDoc, ['courses'], local, base);
    const viaOps = applyMainOps(cloudDoc, syncMainOps(['courses'], local, base));
    assertEqDeep(viaOps.payload, viaMerge.payload);
  });

  test('syncMainHasOps：沒動任何一筆 → false，動了 → true', () => {
    const none = syncMainOps(['courses'], { courses: [{ id: 1 }] }, { courses: [{ id: 1 }] });
    assertFalse(syncMainHasOps(none));
    const some = syncMainOps(['courses'], { courses: [{ id: 1, v: 2 }] }, { courses: [{ id: 1, v: 1 }] });
    assertTrue(syncMainHasOps(some));
  });

});
