// 一次性修補工具：把舊行事曆搬遷來的請假紀錄補上課程編號（courseId）
//
// 為什麼要補：那批紀錄的 courseId 是 null，系統只能靠「課名」認它屬於哪門課。而課名有兩種靠不住：
//   ① 同名多門（系統裡三門都叫「國二數學班」）→ 一筆請假被算進三門，多收費次數多算
//   ② 課名停在改年級之前（舊紀錄寫「高一數學班」，那批學生現在在「高二數學班」，
//      而系統裡另有一門真的高一數學班）→ 照課名補會把請假算到別班學生頭上
//
// 所以判斷**以「名單重疊」為主**，上課時段與課名只在同分時當判準（課的時間也會改，
// 例如佳潼數學家教從 18:30 搬到 17:00，名單沒變）：
//   候選 = 那一天有課的所有系統課程（不限同名）
//   寫入條件 = 名單有重疊 且 重疊率唯一最高（並列時先看時段吻合、再看課名相同）
//   其餘一律列出候選，讓人自己指定
//
// 怎麼用：整份貼進瀏覽器 console（在系統頁面上，已登入）。
//   1. 貼上後自動印出盤點表，**不會改任何東西**
//   2. 逐列看過（特別是「課名」欄不一樣的）→ 沒問題就 _bf.apply()
//   3. 要自己指定的：_bf.set('<occId>', <courseId>)，然後 _bf.show() 覆核、_bf.apply() 寫入
//   4. 想看某一筆的完整候選：_bf.why('<occId>')
// 補完重新整理即可。這支不掛進 index，用完就算了。
//
// 注意：候選只含「開課中」的課程。已結束的課（多半是上一期的）配不到，會停在「對不到課」，
// 那些屬於歷史期別、不影響現在的多收費判斷，維持 null 即可。

window._bf = (() => {
  // 名單重疊率（Jaccard）的下限。實測資料裡真正對到的都是 0.67 以上，而「一個人剛好也在某個
  // 大班上課」這種假配對只有 0.14（＝1/7，杰緒英文家教被配到七人的國三理化班），中間斷層很乾淨。
  // 訂 0.5：寧可多幾筆要人工，也不要把請假算到別班頭上。
  const MIN_OVERLAP = 0.5;
  const manual = new Map();          // occId → courseId（人工指定，優先於自動判斷）
  const hhmm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const recs = () => (driveData.absences || []).filter(a => a.courseId == null && a.snapshot);

  // 一筆舊紀錄 → 它其實是哪門系統課
  function resolve(a) {
    const sn = a.snapshot || {}, title = sn.title || '';
    const day = new Date(sn.start || a.date); day.setHours(0, 0, 0, 0);
    const roster = new Set(sn.students || []);
    const wantTime = sn.start ? hhmm(new Date(sn.start)) : null;

    // 候選＝那一天有課的所有課程（不限同名——課名可能停在改年級之前）
    const cands = expandCoursesForRange(day, day).map(o => {
      const hit = (o.students || []).filter(n => roster.has(n)).length;
      const union = new Set([...(o.students || []), ...roster]).size || 1;
      return {
        courseId: o.courseId, 課名: o.origTitle, 時間: hhmm(o.startDt),
        時段吻合: wantTime ? hhmm(o.startDt) === wantTime : false,
        課名相同: o.origTitle === title,
        名單重疊: +(hit / union).toFixed(2),
        對到幾人: hit, 該堂名單: (o.students || []).join('、'),
      };
    }).sort((x, y) => y.名單重疊 - x.名單重疊);

    if (manual.has(a.occId)) return { status: '人工指定', pick: manual.get(a.occId), cands };

    // 名單重疊是主要證據：課名會因為改年級而過時、上課時間也會被搬，只有「是哪一批人」最穩
    const pool = cands.filter(c => c.名單重疊 >= MIN_OVERLAP);
    if (!pool.length) {
      const near = cands.some(c => c.名單重疊 > 0);
      return { status: !cands.length ? '對不到課'
        : near ? `名單重疊太低（<${MIN_OVERLAP}）·要人工` : '名單全對不上·要人工', pick: null, cands };
    }

    const best = Math.max(...pool.map(c => c.名單重疊));
    let top = pool.filter(c => c.名單重疊 === best);
    if (top.length > 1 && top.some(c => c.時段吻合)) top = top.filter(c => c.時段吻合);   // 並列時先看時段
    if (top.length > 1 && top.some(c => c.課名相同)) top = top.filter(c => c.課名相同);   // 再看課名
    const ids = [...new Set(top.map(c => c.courseId))];
    if (ids.length !== 1) return { status: '有歧義·要人工', pick: null, cands };
    const w = top[0];
    const diff = [w.課名相同 ? null : '課名', w.時段吻合 ? null : '時段'].filter(Boolean);
    return {
      status: diff.length ? `⚠ ${diff.join('與')}不同·靠名單判出` : '課名+時段+名單都合',
      pick: ids[0], cands,
    };
  }

  const scan = () => recs().map(a => ({ rec: a, ...resolve(a) }));

  function show() {
    const rows = scan();
    console.table(rows.map(r => {
      const p = r.cands.find(c => c.courseId === r.pick);
      return {
        occId: r.rec.occId,
        日期: String(r.rec.date).slice(0, 10),
        舊課名: r.rec.snapshot?.title,
        判定: r.status,
        要寫入: r.pick,
        對到的課: p ? p.課名 : '—',
        名單重疊: p ? p.名單重疊 : '—',
        舊名單: (r.rec.snapshot?.students || []).join('、'),
        請假: (r.rec.leave || []).map(x => x.name).join('、'),
        曠課: (r.rec.noShow || []).map(x => x.name).join('、'),
        調課: !!r.rec.resched,
      };
    }));
    // 統計照「判定」分群（⚠ 那幾種是動態組出來的字串）
    const tally = {};
    rows.forEach(r => { tally[r.status] = (tally[r.status] || 0) + 1; });
    console.log(`共 ${rows.length} 筆待補｜可寫入 ${rows.filter(r => r.pick).length}｜要人工 ${rows.filter(r => !r.pick).length}`);
    console.table(Object.entries(tally).map(([判定, 筆數]) => ({ 判定, 筆數 })));
    const warn = rows.filter(r => r.status.startsWith('⚠'));
    if (warn.length) console.log(`⚠ 有 ${warn.length} 筆是「課名或時段跟現在對不上」、純靠名單判出來的，`
      + `請確認舊名單跟對到的課是同一批人（第 ${warn.map(r => rows.indexOf(r)).join(', ')} 列）`);
    const todo = rows.filter(r => !r.pick);
    if (todo.length) console.log(`要人工的在第 ${todo.map(r => rows.indexOf(r)).join(', ')} 列`
      + `　→ _bf.why(列號) 看候選、_bf.set(列號, <courseId>) 指定`);
    console.log('確認無誤後執行：_bf.apply()');
    return rows;
  }

  // 查一筆的完整候選。可以給：列號、學生名字、課名關鍵字、或完整/部分 occId（不用手打整串 id）
  function pick1(q, rows) {
    rows = rows || scan();
    if (typeof q === 'number') return rows[q];
    const s = String(q);
    return rows.find(x => x.rec.occId === s)
      || rows.find(x => x.rec.occId.includes(s))
      || rows.find(x => [...(x.rec.leave || []), ...(x.rec.noShow || [])].some(y => y.name === s))
      || rows.find(x => (x.rec.snapshot?.title || '').includes(s));
  }

  function why(q) {
    const rows = scan();
    // 名字或關鍵字對到多筆時，全部列出來讓人挑
    const many = typeof q === 'string'
      ? rows.filter(x => [...(x.rec.leave || []), ...(x.rec.noShow || [])].some(y => y.name === q))
      : [];
    if (many.length > 1) {
      console.log(`「${q}」有 ${many.length} 筆，列號：${many.map(r => rows.indexOf(r)).join(', ')}`);
      console.table(many.map(r => ({ 列: rows.indexOf(r), 日期: String(r.rec.date).slice(0, 10),
        舊課名: r.rec.snapshot?.title, 判定: r.status, 要寫入: r.pick })));
      return many;
    }
    const r = many[0] || pick1(q, rows);
    if (!r) { console.warn('查無這筆：', q); return; }
    console.log(`第 ${rows.indexOf(r)} 列　${String(r.rec.date).slice(0, 10)}　舊課名「${r.rec.snapshot?.title}」`
      + `　舊名單：${(r.rec.snapshot?.students || []).join('、') || '(空)'}`
      + `　判定：${r.status}${r.pick ? '　→ ' + r.pick : ''}`);
    console.table(r.cands);
    return r;
  }

  // 同 why()：第一個參數可以給列號、學生名字、課名關鍵字或部分 occId
  function set(q, courseId) {
    const co = (driveData.courses || []).find(c => c.id === courseId);
    if (!co) { console.warn('查無這門課：', courseId); return; }
    const rows = scan();
    const r = pick1(q, rows);
    if (!r) { console.warn('查無這筆待補紀錄：', q); return; }
    manual.set(r.rec.occId, courseId);
    console.log(`已指定 第 ${rows.indexOf(r)} 列（${String(r.rec.date).slice(0, 10)} ${r.rec.snapshot?.title}）`
      + ` → ${courseId}「${co.name}」（再跑 _bf.show() 覆核、_bf.apply() 寫入）`);
  }

  function apply() {
    const rows = scan().filter(r => r.pick);
    if (!rows.length) { console.log('沒有可寫入的紀錄'); return 0; }
    const list = getAbsences().slice();
    let n = 0;
    rows.forEach(r => {
      const t = list.find(a => a.occId === r.rec.occId);
      if (t && t.courseId == null) { t.courseId = r.pick; t.updatedAt = new Date().toISOString(); n++; }
    });
    saveAbsences(list);
    console.log(`已寫入 ${n} 筆 courseId。等 2 秒存檔完成後重新整理頁面即可生效。`);
    return n;
  }

  show();
  return { show, why, set, apply, scan };
})();
