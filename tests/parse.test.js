// parseEv / cleanDesc / buildTitle 測試
// 載入順序：js/parse.js → test-runner.js → 本檔

// ── 工具：建造假的 Google Calendar event ──
function ev(opts) {
  return {
    id: opts.id || 't1',
    summary: opts.title || '',
    description: opts.desc || '',
    start: { dateTime: opts.start || '2026-01-15T10:00:00+08:00' },
    end: { dateTime: opts.end || '2026-01-15T11:00:00+08:00' },
    _calId: opts.calId || 'cal1',
    _calName: opts.calName || '一般課程'
  };
}

// ────────────────────────────────────────────────────────
suite('cleanDesc：HTML 清理', () => {

  test('純文字保持不變', () => {
    assertEq(cleanDesc('王老師\n小明'), '王老師\n小明');
  });

  test('<br> 換成換行', () => {
    assertEq(cleanDesc('王老師<br>小明'), '王老師\n小明');
  });

  test('<br/> 換成換行', () => {
    assertEq(cleanDesc('王老師<br/>小明'), '王老師\n小明');
  });

  test('</p> 與 </div> 換成換行（單換行就足以分行）', () => {
    assertEq(cleanDesc('<p>王老師</p><p>小明</p>'), '王老師\n小明');
    assertEq(cleanDesc('<div>王老師</div><div>小明</div>'), '王老師\n小明');
  });

  test('HTML 實體解碼', () => {
    assertEq(cleanDesc('A&amp;B'), 'A&B');
    assertEq(cleanDesc('&lt;test&gt;'), '<test>');
    assertEq(cleanDesc('a&#65;b'), 'aAb');
    assertEq(cleanDesc('A&nbsp;B'), 'A B');
  });

  test('空輸入回傳空字串', () => {
    assertEq(cleanDesc(''), '');
    assertEq(cleanDesc(null), '');
    assertEq(cleanDesc(undefined), '');
  });

  test('\\r\\n 正規化為 \\n', () => {
    assertEq(cleanDesc('王老師\r\n小明\r小華'), '王老師\n小明\n小華');
  });
});

// ────────────────────────────────────────────────────────
suite('基本課程類型判斷', () => {

  test('團班（含「班」）→ group', () => {
    const r = parseEv(ev({ title: '國二數學班', desc: '小教室 王老師\n小明、小華' }));
    assertEq(r.type, 'group');
  });

  test('家教 1 人 → one', () => {
    const r = parseEv(ev({ title: '小明家教', desc: '108 李老師\n小明' }));
    assertEq(r.type, 'one');
  });

  test('家教 2 人 → pair', () => {
    const r = parseEv(ev({ title: '小明、小華家教', desc: '108 李老師\n小明、小華' }));
    assertEq(r.type, 'pair');
  });

  test('練習課（行事曆名稱「練習課」）→ practice', () => {
    const r = parseEv(ev({ title: '寒假練習', calName: '練習課', desc: '大教室 哲豪\n小明' }));
    assertEq(r.type, 'practice');
  });

  test('練習課（標題含「練習」）→ practice', () => {
    const r = parseEv(ev({ title: '乾弘練習', desc: '大教室 哲豪\n乾弘' }));
    assertEq(r.type, 'practice');
  });

  test('一般班（含頓號與「班」）→ pair', () => {
    const r = parseEv(ev({ title: '小明、小華英文班', desc: '108 老師\n小明、小華' }));
    assertEq(r.type, 'pair');
  });

  test('沒類別關鍵字 → group（預設）', () => {
    const r = parseEv(ev({ title: '課程', desc: '老師\n小明' }));
    assertEq(r.type, 'group');
  });
});

// ────────────────────────────────────────────────────────
suite('教室與老師解析', () => {

  test('教室 + 老師', () => {
    const r = parseEv(ev({ title: '國二數學班', desc: '小教室 王老師\n小明' }));
    assertEq(r.classroom, '小教室');
    assertEq(r.teacher, '王老師');
  });

  test('沒教室時 classroom 為空，整行視為老師', () => {
    const r = parseEv(ev({ title: '國二數學班', desc: '王老師\n小明' }));
    assertEq(r.classroom, '');
    assertEq(r.teacher, '王老師');
  });

  test('石牌分校 classroom', () => {
    const r = parseEv(ev({ title: '國二數學班', desc: '石牌分校 老師\n小明' }));
    assertEq(r.classroom, '石牌分校');
  });

  test('教室 108 / 208 / 309 都能辨識', () => {
    assertEq(parseEv(ev({ title: 'XX', desc: '108 老師\n小明' })).classroom, '108');
    assertEq(parseEv(ev({ title: 'XX', desc: '208 老師\n小明' })).classroom, '208');
    assertEq(parseEv(ev({ title: 'XX', desc: '309 老師\n小明' })).classroom, '309');
  });

  test('大教室', () => {
    const r = parseEv(ev({ title: 'XX', desc: '大教室 老師\n小明' }));
    assertEq(r.classroom, '大教室');
  });
});

// ────────────────────────────────────────────────────────
suite('學生名單解析', () => {

  test('多人學生（頓號分隔）', () => {
    const r = parseEv(ev({ title: '國二數學班', desc: '小教室 王老師\n小明、小華、小強' }));
    assertEqDeep(r.students, ['小明', '小華', '小強']);
  });

  test('學生名含年級括號 → 保留原文', () => {
    const r = parseEv(ev({ title: 'XX', desc: '老師\n（國小）子晴、（國二）小明' }));
    assertEqDeep(r.students, ['（國小）子晴', '（國二）小明']);
  });

  test('練習課科目分組（數理：軒豪、則勛）', () => {
    const r = parseEv(ev({
      title: '練習課', calName: '練習課',
      desc: '大教室 哲豪\n數理：軒豪、則勛\n英文：小明'
    }));
    assertEqDeep(r.students, ['軒豪', '則勛', '小明']);
    assertEq(r.studentGroups.length, 2);
    assertEq(r.studentGroups[0].subject, '數理');
    assertEqDeep(r.studentGroups[0].students, ['軒豪', '則勛']);
    assertEq(r.studentGroups[1].subject, '英文');
    assertEqDeep(r.studentGroups[1].students, ['小明']);
  });

  test('沒學生時 students 為空陣列', () => {
    const r = parseEv(ev({ title: '會議', desc: '王老師' }));
    assertEqDeep(r.students, []);
  });

  test('單人學生', () => {
    const r = parseEv(ev({ title: 'XX', desc: '老師\n小明' }));
    assertEqDeep(r.students, ['小明']);
  });
});

// ────────────────────────────────────────────────────────
suite('備註行解析', () => {

  test('含數字與符號的備註行 → 收到 notes，不算學生', () => {
    const r = parseEv(ev({ title: 'XX', desc: '小教室 王老師\n小明\n請帶 12/15 段考卷' }));
    assertEqDeep(r.students, ['小明']);
    assertEq(r.notes, '請帶 12/15 段考卷');
  });

  test('多行備註以全形空格連接', () => {
    const r = parseEv(ev({
      title: 'XX',
      desc: '老師\n小明\n備註：12 月段考週\n請準時'
    }));
    assertEq(r.notes, '備註：12 月段考週　請準時');
  });

  test('指令動詞開頭的短中文不會被當作學生名（請/需/別/勿/麻煩/記得/務必/注意）', () => {
    // 這是過去的真實 bug：「請準時」會被當成名叫「請準時」的學生
    const cases = [
      { desc: '老師\n小明\n請帶筆',     note: '請帶筆' },
      { desc: '老師\n小明\n需考卷',     note: '需考卷' },
      { desc: '老師\n小明\n別遲到',     note: '別遲到' },
      { desc: '老師\n小明\n勿缺席',     note: '勿缺席' },
      { desc: '老師\n小明\n麻煩準時',   note: '麻煩準時' },
      { desc: '老師\n小明\n記得帶課本', note: '記得帶課本' },
      { desc: '老師\n小明\n務必到',     note: '務必到' },
      { desc: '老師\n小明\n注意服裝',   note: '注意服裝' },
    ];
    cases.forEach(c => {
      const r = parseEv(ev({ title: 'XX', desc: c.desc }));
      assertEqDeep(r.students, ['小明'], `學生只應該有「小明」（備註是「${c.note}」）`);
      assertEq(r.notes, c.note, `備註應該是「${c.note}」`);
    });
  });
});

// ────────────────────────────────────────────────────────
suite('請假標題解析', () => {

  test('單人請假（一對二中一人）→ 部分請假', () => {
    const r = parseEv(ev({
      title: '【小明請假】國二數學',
      desc: '小教室 老師\n小明、小華'
    }));
    assertEq(r.isAbsent, true);
    assertEq(r.absType, '學生請假');
    assertEq(r.absentWho, '小明');
    assertEqDeep(r.absentStudents, ['小明']);
    assertEq(r.origTitle, '國二數學');
    assertEq(r.isPartialAbsent, true);
    assertEq(r.isFullAbsent, false);
  });

  test('多人請假（全員都在請假列）→ 全員請假', () => {
    const r = parseEv(ev({
      title: '【小明、小華請假】國二數學',
      desc: '小教室 老師\n小明、小華'
    }));
    assertEqDeep(r.absentStudents, ['小明', '小華']);
    assertEq(r.isPartialAbsent, false);
    assertEq(r.isFullAbsent, true);
  });

  test('老師請假', () => {
    const r = parseEv(ev({
      title: '【老師請假】國二數學',
      desc: '小教室 王老師\n小明、小華'
    }));
    assertEq(r.isAbsent, true);
    assertEq(r.absType, '老師請假');
    assertEq(r.isFullAbsent, true);
    assertEqDeep(r.absentStudents, []);
  });

  test('一對一全員請假', () => {
    const r = parseEv(ev({
      title: '【小明請假】小明家教',
      desc: '108 老師\n小明'
    }));
    assertEq(r.isFullAbsent, true);
    assertEq(r.isPartialAbsent, false);
    assertEq(r.origTitle, '小明家教');
  });

  test('沒請假時 isAbsent=false', () => {
    const r = parseEv(ev({ title: '國二數學班', desc: '小教室 老師\n小明' }));
    assertEq(r.isAbsent, false);
    assertEq(r.absType, '');
    assertEqDeep(r.absentStudents, []);
    assertEq(r.origTitle, '國二數學班');
  });
});

// ────────────────────────────────────────────────────────
suite('曠課標題解析', () => {

  test('單人曠課 → isNoShow，且不被當成請假', () => {
    const r = parseEv(ev({
      title: '【小明曠課】國二數學',
      desc: '小教室 老師\n小明、小華'
    }));
    assertEq(r.isNoShow, true);
    assertEqDeep(r.noShowStudents, ['小明']);
    assertEq(r.origTitle, '國二數學');
    assertEq(r.isAbsent, false);
    assertEq(r.absType, '');
  });

  test('多人曠課', () => {
    const r = parseEv(ev({
      title: '【小明、小華曠課】國二數學',
      desc: '小教室 老師\n小明、小華'
    }));
    assertEqDeep(r.noShowStudents, ['小明', '小華']);
    assertEq(r.origTitle, '國二數學');
  });

  test('沒曠課時 isNoShow=false', () => {
    const r = parseEv(ev({ title: '國二數學班', desc: '小教室 老師\n小明' }));
    assertEq(r.isNoShow, false);
    assertEqDeep(r.noShowStudents, []);
  });
});

// ────────────────────────────────────────────────────────
suite('請假＋曠課並存', () => {

  test('請假與曠課同時存在', () => {
    const r = parseEv(ev({
      title: '【小明請假】【小華曠課】國二數學',
      desc: '小教室 老師\n小明、小華'
    }));
    assertEq(r.isAbsent, true);
    assertEqDeep(r.absentStudents, ['小明']);
    assertEq(r.isNoShow, true);
    assertEqDeep(r.noShowStudents, ['小華']);
    assertEq(r.origTitle, '國二數學');
  });

  test('標記順序顛倒也能正確解析', () => {
    const r = parseEv(ev({
      title: '【小華曠課】【小明請假】國二數學',
      desc: '小教室 老師\n小明、小華'
    }));
    assertEqDeep(r.absentStudents, ['小明']);
    assertEqDeep(r.noShowStudents, ['小華']);
    assertEq(r.origTitle, '國二數學');
  });

  test('非標記的【】不被當標記吃掉', () => {
    const r = parseEv(ev({ title: '【特訓】數學', desc: '小教室 老師\n小明' }));
    assertEq(r.origTitle, '【特訓】數學');
    assertEq(r.isAbsent, false);
    assertEq(r.isNoShow, false);
  });
});

// ────────────────────────────────────────────────────────
suite('調課標題解析', () => {

  test('調課無理由', () => {
    const r = parseEv(ev({
      title: '【調課】國二數學',
      desc: '小教室 老師\n小明、小華'
    }));
    assertEq(r.isRescheduled, true);
    assertEq(r.rescheduleReason, '');
    assertEq(r.absType, '調課');
    assertEq(r.isFullAbsent, true);
    assertEqDeep(r.absentStudents, ['小明', '小華']);
    assertEq(r.origTitle, '國二數學');
  });

  test('調課有理由', () => {
    const r = parseEv(ev({
      title: '【調課:學生出國】國二數學',
      desc: '小教室 老師\n小明'
    }));
    assertEq(r.isRescheduled, true);
    assertEq(r.rescheduleReason, '學生出國');
    assertEq(r.origTitle, '國二數學');
  });

  test('調課（全形冒號）也能解析', () => {
    const r = parseEv(ev({
      title: '【調課：學生出國】國二數學',
      desc: '小教室 老師\n小明'
    }));
    assertEq(r.isRescheduled, true);
    assertEq(r.rescheduleReason, '學生出國');
  });
});

// ────────────────────────────────────────────────────────
suite('時間與持續時間', () => {

  test('startDt / endDt / durMins 都正確', () => {
    const r = parseEv(ev({
      start: '2026-01-15T10:00:00+08:00',
      end: '2026-01-15T11:30:00+08:00',
      title: 'XX'
    }));
    assertEq(r.durMins, 90);
    assertEq(r.startDt instanceof Date, true);
    assertEq(r.endDt instanceof Date, true);
    assertEq(r.startDt.getHours(), 10);
    assertEq(r.startDt.getMinutes(), 0);
    assertEq(r.endDt.getHours(), 11);
    assertEq(r.endDt.getMinutes(), 30);
  });
});

// ────────────────────────────────────────────────────────
suite('邊界情況', () => {

  test('空標題與空備註', () => {
    const r = parseEv(ev({ title: '', desc: '' }));
    assertEq(r.title, '');
    assertEq(r.classroom, '');
    assertEq(r.teacher, '');
    assertEqDeep(r.students, []);
    assertEq(r.type, 'group');
    assertEq(r.isAbsent, false);
    assertEq(r.isRescheduled, false);
  });

  test('HTML 標籤備註也能解析（cleanDesc 處理）', () => {
    const r = parseEv(ev({ title: 'XX', desc: '小教室 老師<br>小明、小華' }));
    assertEq(r.classroom, '小教室');
    assertEq(r.teacher, '老師');
    assertEqDeep(r.students, ['小明', '小華']);
  });

  test('calId 與 calName 從 _calId/_calName 帶入', () => {
    const r = parseEv(ev({ title: 'XX', calId: 'my-cal', calName: '補課' }));
    assertEq(r.calId, 'my-cal');
    assertEq(r.calName, '補課');
  });
});

// ────────────────────────────────────────────────────────
suite('buildTitle：建構新標題', () => {

  test('老師請假', () => {
    assertEq(buildTitle('國二數學', 'teacher', []), '【老師請假】國二數學');
  });

  test('學生請假（單人）', () => {
    assertEq(buildTitle('國二數學', 'student', ['小明']), '【小明請假】國二數學');
  });

  test('學生請假（多人）', () => {
    assertEq(buildTitle('國二數學', 'student', ['小明', '小華']), '【小明、小華請假】國二數學');
  });

  test('空學生陣列 → 回傳 null', () => {
    assertEq(buildTitle('國二數學', 'student', []), null);
    assertEq(buildTitle('國二數學', 'student', null), null);
  });
});
