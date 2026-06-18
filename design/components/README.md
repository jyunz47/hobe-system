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

- `foundations.html` — 色彩、圓角 tokens
- `buttons.html` — 按鈕全系列
- `sidebar.html` — 側欄導覽

待補：課程卡、登入頁、統計卡、時段選擇器…（逐顆加）。
