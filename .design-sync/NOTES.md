# design-sync 筆記（HOBE 行政系統）

- **此 repo 是純前端靜態專案（無 npm / 無 Storybook / 無 build）**，不走 design-sync 的 converter 流程。同步 = 直接鏡射上傳，路徑雲端本機一對一：
  - `design/components/*.html`（每檔一張 @dsCard 卡，第一行 `<!-- @dsCard group="…" -->`）
  - `design/components/README.md`、`style.css`、`tokens.css`
- **卡片索引在雲端根目錄 `_ds_manifest.json`**：新增/改組別/排序都要改它的 `cards` 陣列（面板組別順序 = 陣列首次出現順序；七組順序：基礎 Foundations → App 骨架 → 課程頁 → 待補課頁 → 學生頁 → 設定後台 → 手機版）。本機鏡本放 `.design-sync/_ds_manifest.json`，改完推這份。其餘欄位（tokens、namespace…）別動；tokens 值要跟 `tokens.css` 一致。
- **⚠️ app 會自己重編 manifest**（實測 2026-07-04）：寫入哨兵檔 `_ds_needs_recompile` 後，app 開專案時會從各卡第一行 `@dsCard` **重新產生** `_ds_manifest.json`——手寫的 cards 排序被打掉（組別被重排）、手寫欄位可能被洗掉。因此：
  - 卡片的檢視寬度寫在 `@dsCard` 註解裡：`<!-- @dsCard group="…" width="1200" -->`（桌面卡 ≥1200、courses-page 1280、mobile-nav 390；style.css 手機斷點 900/768，寬度太窄會觸發手機版 media query 只能看到手機樣式）。manifest 的 `cards[].viewport.width` 同步寫一份保險。
  - 只推 HTML 不動索引時，**不要**寫哨兵檔；需要 app 重建索引（新增卡）才寫。若重編後發現 viewport/排序又跑掉，重推一次 manifest（不寫哨兵）即可救回。
  - 重編的排序規則（實測）：組別按 Unicode 碼位排、組內按檔名字母排。重編後裝置分組會變成「共用 → 手機版 → 電腦版…」，想要「電腦版優先」就得重推 manifest。
- **分組方案（2026-07-07 定案）**：最外層先分裝置——「電腦版・〈頁面〉」×5（App 骨架／課程頁／待補課頁／學生頁／設定後台）→「手機版」→「共用・基礎」（tokens/字體/按鈕等通用件）。新卡的 group 照此格式。
- **⚠️ 面板實測忽略所有寬度控制**：manifest 的 `cards[].viewport`、`register_assets` 的 viewport（工具文件說 @dsCard 專案不吃舊式登記）、`@dsCard width` 屬性——三條路都無效，縮圖一律窄框渲染（會觸發手機版 media query）。**不要用「卡內自縮放 iframe 腳本」補救**：它會把 Edit 檢視的縮放（放大鏡 %）整個抵銷掉，已踩過、已回退。目前結論＝縮圖將就看、完整桌面版進 Edit 看。
- preview 卡靠相對路徑 `../../tokens.css`、`../../style.css` 吃全站 CSS——改了 `style.css` 或 `tokens.css` 記得一併推。
- 驗證方式：headless Chrome 截圖 `file://` 開卡片檔即可（相對 CSS 路徑在本機檔案系統也解得開）。
- 慣例文件 = `design/components/README.md`（已上傳，卡片規則寫在裡面），不用另外做 conventions.md / converter README。
- 2026-07-04 完整同步過一次：26 張卡 + 七組重分類 + courses-page 新卡 + style.css。
