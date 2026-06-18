# HOBE 元件 gallery（design-sync 來源）

這個資料夾是 Claude Design 橋樑的「本機這一端」。每個 `*.html` 是一顆獨立元件的
preview，第一行 `<!-- @dsCard group="…" -->` 讓 claude.ai/design 的 Design System
面板自動建卡片。

## 規則

- 每顆元件一個檔，**不要把多個元件塞進同一檔** —— 這樣 `/design-sync` 才能一個元件
  一個元件比對，改一顆只同步一顆。
- preview 一律 `link` 根目錄的 `../../tokens.css` 與 `../../style.css`，確保長相跟正式
  app 完全一致（同一份 CSS，零漂移）。
- 改外觀優先改 `tokens.css`（色彩、圓角）；改元件結構才動對應的 component 檔。

## 同步方式

在 Claude Code 打 `/design-sync`：列出 / 建立雲端 design-system 專案 → 比對差異 →
核准計畫 → 一顆一顆同步。

## 目前涵蓋

**Foundations / 框架**
- `foundations.html` — 色彩、圓角 tokens
- `sidebar.html` — 側欄導覽

**P1 高頻元件**
- `buttons.html` — 按鈕全系列
- `course-card.html` — 課程卡（進行中／展開／請假／調課）
- `login.html` — 登入頁（雙欄品牌牆 + 登入卡）
- `makeup-stats.html` — 待補課統計卡（待安排／已安排／已完成）
- `student-card.html` — 學生卡與面板（在學/歷屆分頁、年級分區）
- `student-modal.html` — 學生詳情四格統計 + 出缺勤列

**P2 中頻元件**
- `week-view.html` — 週檢視（七日摘要 chips + 焦點日課程卡，含請假/調課態）

待補（P2/P3）：時間軸、補課時段選擇器、補課清單卡、Topbar、手機底欄、表單元素、Typography、請假面板、學生編輯、行政小工具 modal…（逐顆加）。
