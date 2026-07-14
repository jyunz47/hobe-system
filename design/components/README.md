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
- 分組最外層先分裝置：「電腦版・〈頁面〉」與「手機版」；tokens、字體、按鈕等兩邊共用的
  進「共用・基礎」。手機寬度的 preview 一律進「手機版」，不跟桌面卡混在同一組。

## 同步方式

在 Claude Code 打 `/design-sync`：列出 / 建立雲端 design-system 專案 → 比對差異 →
核准計畫 → 一顆一顆同步。

## 目前涵蓋

**共用・基礎** —— 全站視覺語言（桌面手機通用）
- `foundations.html` — 色彩、圓角 tokens
- `calendar-colors.html` — 行事曆六類色（--cal-* token，全站課程色唯一真相來源）
- `typography.html` — 字體階層（Noto Sans TC / DM Sans / DM Mono / Newsreader）
- `buttons.html` — 按鈕全系列
- `form-elements.html` — 表單元素（date / 搜尋框 / 修課登記列 / 價目表列）
- `small-elements.html` — 小元素（sec-hd / legend / date-nav / nbadge / tc-badge*）

**電腦版・App 骨架** —— 登入與全站框架
- `login.html` — 登入頁（雙欄品牌牆 + 登入卡）
- `sidebar.html` — 側欄導覽
- `topbar.html` — 頂列（標題 + 副標 + 更新/登出）

**電腦版・課程頁** —— 主畫面與課程流程
- `courses-page.html` — ⭐ 課程分頁全頁快照（教室時段＋進行中 hero＋今日課程＋本週）；主介面重新設計以這張為基準
- `course-card.html` — 課程卡（進行中／展開／請假／調課）
- `timeline.html` — 教室時段時間軸（每間教室一列、block 依時段排）
- `week-view.html` — 週檢視（七日摘要 chips + 焦點日課程卡，含請假/調課態）
- `event-modal.html` — 課程詳情 modal（兩 screen：請假展開態 / 調課展開態，互斥）
- `attendance-panel.html` — 點名面板（全部到 + 到主鈕 + 未到弱化 + 請假鎖定 + 需對帳）
- `absence-panel.html` — 請假面板（老師請假 / 團班多生學生請假兩態）

**電腦版・待補課頁**
- `makeup-stats.html` — 待補課統計卡（待安排／已安排／已完成）
- `makeup-list.html` — 待補課清單卡（待安排／已安排／不補課三態）
- `slot-picker.html` — 補課時段選擇器（stepper + 日期/時段/教室 chips + 分校 toggle + 確認）

**電腦版・學生頁**
- `student-card.html` — 學生卡與面板（在學/歷屆分頁、年級分區）
- `student-modal.html` — 學生詳情四格統計 + 出缺勤列
- `student-edit.html` — 學生編輯面板（資料 + 修課登記 + 危險區）

**電腦版・設定後台**
- `course-overview.html` — 週課表矩陣（類型分區 × 週一～日七欄 + 課卡含「需登記成績」開關 + 未分類區）
- `course-modal.html` — 課程詳情置中 modal（一般課程改單價/加退學生、練習課唯讀）
- `admin-modals.html` — 共用 .stu-modal 殼：變更狀態 / 徹底刪除 / 課程價目表

**手機版** —— 手機寬度檢視的 preview（新的手機畫面一律進這組）
- `mobile-nav.html` — 手機底欄分頁（側欄在 ≤768px 的狀態，以手機寬度檢視）

待補：課表對帳 UI（五桶差異）、Add Course Inline Panel（目前隱藏）、其他頁的全頁快照…（逐顆加）。
