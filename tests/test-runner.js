// 極簡測試框架（零依賴）
// 提供：suite(name, fn), test(name, fn), assertEq, assertEqDeep, assertTrue, assertFalse
//
// 用法：在 .test.js 檔案中呼叫 suite(...) 註冊，整份 HTML 載入完後自動執行所有測試

const _suites = [];
const _pending = [];          // atest 註冊的非同步測試：全部跑完才結算總數
let _passed = 0, _failed = 0;
let _currentSection = null;

function suite(name, fn) {
  _suites.push({ name, fn });
}

// 非同步版的 test（給要 await 假 Firestore 交易的同步測試用）。
// 跟 test 一樣就地把結果塞回自己那個 section，只是等 promise 回來才塞。
function atest(name, fn) {
  const section = _currentSection;
  _pending.push(
    Promise.resolve().then(fn).then(() => {
      const div = document.createElement('div');
      div.className = 'case pass';
      div.textContent = '✓ ' + name;
      section.appendChild(div);
      _passed++;
    }, e => {
      const div = document.createElement('div');
      div.className = 'case fail';
      div.innerHTML = '✗ ' + escapeHtml(name) + '<pre>' + escapeHtml(e.message) + '</pre>';
      section.appendChild(div);
      _failed++;
      console.error('[FAIL]', name, e);
    })
  );
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

// 載入完後（含所有 sibling script），跑所有 suites。
// ⚠ 這裡要等 DOMContentLoaded，不能用 setTimeout(0)：本檔是 <script>，後面還有好幾個
// 測試檔要下載。冷快取時瀏覽器會在等網路的空檔把 timer 跑掉 → 那時只註冊了前兩個檔，
// 畫面顯示「26/26 全綠」，其實有一半的測試根本沒跑（安靜地少測，最危險的那種）。
async function _runAllSuites() {
  const root = document.getElementById('results');
  _suites.forEach(({ name, fn }) => {
    const section = document.createElement('section');
    section.innerHTML = '<h2>' + escapeHtml(name) + '</h2>';
    root.appendChild(section);
    _currentSection = section;
    fn();
  });
  // 等 atest 註冊的非同步測試全部回來，總數才算得準
  if (_pending.length) await Promise.all(_pending);
  const total = _passed + _failed;
  const summary = document.createElement('div');
  summary.className = 'summary ' + (_failed === 0 ? 'all-pass' : 'has-fail');
  summary.innerHTML = '<strong>' + _passed + ' / ' + total + ' 通過</strong>' +
    (_failed > 0 ? '，' + _failed + ' 失敗' : ' ✓ 全綠');
  root.prepend(summary);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _runAllSuites);
else setTimeout(_runAllSuites, 0);
