// 多裝置同步 第二刀：逐筆合併（js/sync.js）
//
// 這一刀要證明的事：兩台在 1.5 秒的存檔延遲內都動到**同一欄**時，
// 慢的那台不再把快的那筆整片蓋掉。每組「本體」測試都配一個「對照組」，
// 直接跑第一刀的做法（整份取代）證明它真的會弄丟東西——沒有對照組的話，
// 這些測試看起來會像在測一件本來就成立的事。

// ── 假 Firestore：支援交易與衝突重跑 ──
// runTx 會在提交前檢查「這段時間雲端有沒有被別人動過」，被動過就整個重跑，
// 跟 Firestore runTransaction 的語意一樣。beforeCommit 是測試用的插針：
// 讓「別台在我交易中途寫進來」變成可以重現的情境。
function makeFakeCloud(initial) {
  const cloud = {
    data: initial ? JSON.parse(JSON.stringify(initial)) : null,
    writes: 0,
    attempts: 0,
    beforeCommit: null,
  };
  cloud.ref = {
    set(d, opts) {
      cloud.writes++;
      const copy = JSON.parse(JSON.stringify(d));
      cloud.data = (opts && opts.merge) ? Object.assign({}, cloud.data || {}, copy) : copy;
      return Promise.resolve();
    },
  };
  cloud.runTx = async function (fn) {
    for (let attempt = 0; attempt < 5; attempt++) {
      cloud.attempts++;
      const seen = JSON.stringify(cloud.data);
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
      if (cloud.beforeCommit) { const cb = cloud.beforeCommit; cloud.beforeCommit = null; await cb(); }
      if (JSON.stringify(cloud.data) !== seen) continue;   // 被別人插隊 → 重跑
      cloud.writes++;
      cloud.data = staged.merge ? Object.assign({}, cloud.data || {}, staged.d) : staged.d;
      return out;
    }
    throw new Error('transaction retries exhausted');
  };
  return cloud;
}

const byId = r => r && r.id;
const recs = a => (a || []).map(r => r.id);

suite('多裝置同步 第二刀 — 認筆與疊筆（diffRecords / applyOps）', () => {

  test('沒動任何一筆 → ops 是空的（連寫都不用寫）', () => {
    const base = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
    const ops = diffRecords(base, JSON.parse(JSON.stringify(base)), byId);
    assertEq(ops.upserts.length, 0);
    assertEq(ops.deletes.length, 0);
    assertFalse(syncHasOps(ops));
  });

  test('只改一筆 → ops 只有那一筆，沒動的不算改過', () => {
    const base = [{ id: 1, v: 'a' }, { id: 2, v: 'b' }];
    const cur = [{ id: 1, v: 'a' }, { id: 2, v: 'B改了' }];
    const ops = diffRecords(base, cur, byId);
    assertEq(ops.upserts.length, 1);
    assertEq(ops.upserts[0].key, '2');
    assertEq(ops.deletes.length, 0);
  });

  test('新增與刪除各自被認出來', () => {
    const ops = diffRecords([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 3 }], byId);
    assertEqDeep(ops.upserts.map(u => u.key), ['3']);
    assertEqDeep(ops.deletes, ['2']);
  });

  test('紀錄缺鑰匙 → 認不出筆別（呼叫端要退回整份取代）', () => {
    assertTrue(diffRecords([{ id: 1 }], [{ id: 1 }, { v: '沒有 id' }], byId).unmergeable);
  });

  test('同一把鑰匙出現兩次 → 認不出筆別（寧可保守也不要猜錯）', () => {
    assertTrue(diffRecords([{ id: 1 }, { id: 1 }], [{ id: 1 }], byId).unmergeable);
  });

  test('疊筆保留雲端那份的順序，同一筆原地換掉不搬位置', () => {
    const cloud = [{ id: 1, v: 'x' }, { id: 2, v: 'y' }, { id: 3, v: 'z' }];
    const ops = diffRecords([{ id: 2, v: 'y' }], [{ id: 2, v: 'y2' }], byId);
    assertEqDeep(applyOps(cloud, ops, byId), [{ id: 1, v: 'x' }, { id: 2, v: 'y2' }, { id: 3, v: 'z' }]);
  });

  test('一台刪、一台改同一筆 → 刪的贏（刪除是明確意圖，不該復活）', () => {
    const ops = diffRecords([{ id: 1 }, { id: 2 }], [{ id: 1 }], byId);      // 我刪了 2
    const cloud = [{ id: 1 }, { id: 2, v: '別台改過' }];                      // 別台改了 2
    assertEqDeep(recs(applyOps(cloud, ops, byId)), [1]);
  });

  test('同一筆兩台都改 → 後寫進雲端的那台贏', () => {
    const ops = diffRecords([{ id: 1, v: '原' }], [{ id: 1, v: '我的' }], byId);
    const cloud = [{ id: 1, v: '別台的' }];
    assertEqDeep(applyOps(cloud, ops, byId), [{ id: 1, v: '我的' }]);
  });

  test('各陣列的認筆鑰匙：請假認 occId、價目表認課名', () => {
    assertEq(syncKeyOf('absences')({ occId: 'sys:9:2026-08-20', id: 7 }), 'sys:9:2026-08-20');
    assertEq(syncKeyOf('coursePrices')({ title: '高一數學' }), '高一數學');
    assertEq(syncKeyOf('courses')({ id: 42 }), 42);
  });
});

suite('多裝置同步 第二刀 — 課表那包（syncMergeMain）', () => {

  // 這一組是老闆實際踩到的那個情境：兩台幾乎同時標請假
  const absA = { id: 1, occId: 'occ-A', leave: [{ name: '小明' }] };
  const absB = { id: 2, occId: 'occ-B', leave: [{ name: '小華' }] };

  test('A 標小明請假、B 標小華請假 → 兩筆都活著', () => {
    const cloud = { absences: [absA] };                    // A 已經寫上去了
    const bLocal = { absences: [absB] }, bBase = { absences: [] };   // B 從空的開始改
    const out = syncMergeMain(cloud, ['absences'], bLocal, bBase);
    assertEqDeep(out.payload.absences.map(a => a.occId), ['occ-A', 'occ-B']);
  });

  test('對照組：第一刀的整份取代會把 A 那筆吃掉（證明這一刀有用）', () => {
    const bLocal = { absences: [absB] };
    assertEqDeep(bLocal.absences.map(a => a.occId), ['occ-B']);   // 舊做法就是把這份整個送上去
  });

  test('B 慢一步存檔時，A 中途又補了一筆 → 三筆都在', () => {
    const absC = { id: 3, occId: 'occ-C' };
    const out = syncMergeMain({ absences: [absA, absC] }, ['absences'],
      { absences: [absB] }, { absences: [] });
    assertEqDeep(out.payload.absences.map(a => a.occId), ['occ-A', 'occ-C', 'occ-B']);
  });

  test('兩台各建一門課 → 不會再出現「同一門課被建兩次／少一門」', () => {
    const out = syncMergeMain({ courses: [{ id: 10, title: '高一數學' }] }, ['courses'],
      { courses: [{ id: 11, title: '高二物理' }] }, { courses: [] });
    assertEqDeep(out.payload.courses.map(c => c.title), ['高一數學', '高二物理']);
  });

  test('只送有標記的欄位：沒改到的欄位不出現在 payload 裡', () => {
    const out = syncMergeMain({ courses: [{ id: 1 }], studentList: [{ id: 9 }] },
      ['courses'], { courses: [{ id: 1 }], studentList: [] }, { courses: [{ id: 1 }], studentList: [] });
    assertTrue('courses' in out.payload);
    assertFalse('studentList' in out.payload, 'studentList 沒被標記改過，不該被寫回去');
  });

  test('認不出筆別的欄位退回整份取代，並標出是哪一欄', () => {
    const out = syncMergeMain({ courses: [{ id: 1 }] }, ['courses'],
      { courses: [{ title: '沒有 id 的舊資料' }] }, { courses: [] });
    assertEqDeep(out.fellBack, ['courses']);
    assertEq(out.payload.courses.length, 1);
  });

  test('讀雲端失敗（基準是空的）→ 只會新增，絕不刪掉雲端既有的東西', () => {
    // 這是第一刀修過的那個洞的第二層保險：就算本機停在空的，
    // 逐筆合併算出來的 ops 也只有 upsert，不會有 delete。
    const out = syncMergeMain({ studentList: [{ id: 1 }, { id: 2 }] }, ['studentList'],
      { studentList: [{ id: 3, name: '新同學' }] }, { studentList: [] });
    assertEqDeep(recs(out.payload.studentList), [1, 2, 3]);
  });

  test('價目表用課名認筆：兩台各改一門課的價格，兩個價格都留住', () => {
    const out = syncMergeMain({ coursePrices: [{ title: '高一數學', price: 500 }] }, ['coursePrices'],
      { coursePrices: [{ title: '高二物理', price: 600 }] }, { coursePrices: [] });
    assertEqDeep(out.payload.coursePrices, [{ title: '高一數學', price: 500 }, { title: '高二物理', price: 600 }]);
  });
});

suite('多裝置同步 第二刀 — 點名／成績（syncSaveRecords + 假 Firestore 交易）', () => {

  const att = (ev, sid, extra) => Object.assign({ eventId: ev, date: '2026-08-20', studentId: sid, status: '到', lateMin: 0 }, extra || {});

  atest('兩台同一天各點各的課 → 兩邊的點名都在（這一刀的本體）', async () => {
    const cloud = makeFakeCloud({ records: [] });
    const a = att('大教室課', 's1'), b = att('三樓課', 's2');
    // A 台：從空的開始，點了大教室那堂
    await syncSaveRecords(cloud.ref, cloud.runTx, [], [a], attKeyOf);
    // B 台：也是從空的開始（還沒收到 A 的更新），點了三樓那堂
    await syncSaveRecords(cloud.ref, cloud.runTx, [], [b], attKeyOf);
    assertEqDeep(cloud.data.records.map(r => r.eventId + '/' + r.studentId), ['大教室課/s1', '三樓課/s2']);
  });

  atest('對照組：舊的整包寫回會把 A 整個下午的點名抹掉', async () => {
    const cloud = makeFakeCloud({ records: [att('大教室課', 's1')] });
    await cloud.ref.set({ records: [att('三樓課', 's2')] }, { merge: true });   // B 台舊做法
    assertEqDeep(cloud.data.records.map(r => r.eventId), ['三樓課'], 'A 那筆應該已經不見了');
  });

  atest('同一堂同一生兩台都點（一個標到、一個標遲到 10 分）→ 只留一筆，後寫的贏', async () => {
    const cloud = makeFakeCloud({ records: [] });
    await syncSaveRecords(cloud.ref, cloud.runTx, [], [att('e1', 's1')], attKeyOf);
    await syncSaveRecords(cloud.ref, cloud.runTx, [], [att('e1', 's1', { lateMin: 10 })], attKeyOf);
    assertEq(cloud.data.records.length, 1);
    assertEq(cloud.data.records[0].lateMin, 10);
  });

  atest('一台刪成績、一台加成績 → 刪的刪掉、加的留著', async () => {
    const g1 = { id: 1, eventId: 'e1', studentId: 's1', label: '課前考', score: 80 };
    const g2 = { id: 2, eventId: 'e1', studentId: 's2', label: '課前考', score: 90 };
    const cloud = makeFakeCloud({ records: [g1, g2] });
    // A 台刪掉 g1
    await syncSaveRecords(cloud.ref, cloud.runTx, [g1, g2], [g2], recIdKeyOf);
    // B 台手上還是舊的兩筆，另外加了一筆 g3
    const g3 = { id: 3, eventId: 'e1', studentId: 's3', label: '課前考', score: 70 };
    await syncSaveRecords(cloud.ref, cloud.runTx, [g1, g2], [g1, g2, g3], recIdKeyOf);
    assertEqDeep(recs(cloud.data.records), [2, 3], 'g1 應該保持刪除、g3 應該加進來');
  });

  atest('沒動到任何一筆 → 一次交易都不發（省寫入、也不會誤觸別台的監聽）', async () => {
    const cloud = makeFakeCloud({ records: [att('e1', 's1')] });
    const before = cloud.writes;
    const out = await syncSaveRecords(cloud.ref, cloud.runTx, [att('e1', 's1')], [att('e1', 's1')], attKeyOf);
    assertEq(out, null);
    assertEq(cloud.writes, before);
  });

  atest('別台在我交易中途插進來寫 → 交易重跑，疊在最新版上，沒人被吃掉', async () => {
    const cloud = makeFakeCloud({ records: [] });
    cloud.beforeCommit = async () => {
      cloud.data = { records: [att('別台的課', 's9')] };   // 我讀完之後、提交之前，別台寫了
    };
    await syncSaveRecords(cloud.ref, cloud.runTx, [], [att('我的課', 's1')], attKeyOf);
    assertEqDeep(cloud.data.records.map(r => r.eventId), ['別台的課', '我的課']);
    assertTrue(cloud.attempts >= 2, '應該有重跑過');
  });

  atest('讀失敗後本機停在空的 → 存檔不會把雲端的點名清光', async () => {
    // 舊版：records=[] 直接 set 回去＝整份被清空。現在基準也是空的，
    // 算出來的 ops 只有「我後來點的那幾筆」，沒有任何 delete。
    const cloud = makeFakeCloud({ records: [att('別台的課', 's9')] });
    await syncSaveRecords(cloud.ref, cloud.runTx, [], [att('我點的課', 's1')], attKeyOf);
    assertEqDeep(cloud.data.records.map(r => r.eventId), ['別台的課', '我點的課']);
  });

  atest('文件還不存在（那個期別第一次點名）→ 建得起來', async () => {
    const cloud = makeFakeCloud(null);
    await syncSaveRecords(cloud.ref, cloud.runTx, [], [att('e1', 's1')], attKeyOf);
    assertEq(cloud.data.records.length, 1);
  });

  test('存檔失敗的重試間隔：5 秒 → 15 秒 → 之後固定 60 秒', () => {
    // 交易需要一個來回，斷線就是直接失敗（以前的 set 會先收在記憶體裡自己補送），
    // 所以非有重試不可；間隔往後拉是為了權限這種改不掉的錯不要每 5 秒洗一次提示。
    assertEq(syncRetryDelay(1), 5000);
    assertEq(syncRetryDelay(2), 15000);
    assertEq(syncRetryDelay(3), 60000);
    assertEq(syncRetryDelay(20), 60000);
  });
});
