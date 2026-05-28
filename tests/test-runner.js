// 極簡測試框架（零依賴）
// 提供：suite(name, fn), test(name, fn), assertEq, assertEqDeep, assertTrue, assertFalse
//
// 用法：在 .test.js 檔案中呼叫 suite(...) 註冊，整份 HTML 載入完後自動執行所有測試

const _suites = [];
let _passed = 0, _failed = 0;
let _currentSection = null;

function suite(name, fn) {
  _suites.push({ name, fn });
}

function test(name, fn) {
  try {
    fn();
    const div = document.createElement('div');
    div.className = 'case pass';
    div.textContent = '✓ ' + name;
    _currentSection.appendChild(div);
    _passed++;
  } catch (e) {
    const div = document.createElement('div');
    div.className = 'case fail';
    div.innerHTML = '✗ ' + escapeHtml(name) + '<pre>' + escapeHtml(e.message) + '</pre>';
    _currentSection.appendChild(div);
    _failed++;
    console.error('[FAIL]', name, e);
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      (msg ? msg + '\n' : '') +
      'expected: ' + JSON.stringify(expected) + '\n' +
      'actual:   ' + JSON.stringify(actual)
    );
  }
}

function assertEqDeep(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      (msg ? msg + '\n' : '') +
      'expected: ' + e + '\n' +
      'actual:   ' + a
    );
  }
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'expected true, got falsy');
}

function assertFalse(cond, msg) {
  if (cond) throw new Error(msg || 'expected false, got truthy');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 載入完後（含所有 sibling script），跑所有 suites
setTimeout(() => {
  const root = document.getElementById('results');
  _suites.forEach(({ name, fn }) => {
    const section = document.createElement('section');
    section.innerHTML = '<h2>' + escapeHtml(name) + '</h2>';
    root.appendChild(section);
    _currentSection = section;
    fn();
  });
  const total = _passed + _failed;
  const summary = document.createElement('div');
  summary.className = 'summary ' + (_failed === 0 ? 'all-pass' : 'has-fail');
  summary.innerHTML = '<strong>' + _passed + ' / ' + total + ' 通過</strong>' +
    (_failed > 0 ? '，' + _failed + ' 失敗' : ' ✓ 全綠');
  root.prepend(summary);
}, 0);
