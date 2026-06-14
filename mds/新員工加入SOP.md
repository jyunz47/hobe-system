# 新員工加入系統 SOP

> 新員工要能完整使用系統，需開通**三道門**。少一道就會卡：登不進、或登進去某些資料讀不到。
> 假設新員工 Google 帳號為 `xxx@gmail.com`，用你的 owner 帳號操作。

---

## 門 1：Google 登入許可（Google Cloud Console）

不開 → 連 Google 登入畫面都過不了，跳「403 access_denied / 未完成驗證程序」。

1. 打開 https://console.cloud.google.com/apis/credentials/consent?project=hobe-494909
2. 找「**測試使用者 / Test users**」→「**+ 新增使用者**」
3. 填 `xxx@gmail.com` → 儲存

## 門 2：資料庫白名單（Firestore）

不開 → 能登入，但學生／補課資料讀不到，跳「此帳號未獲授權」。

1. 編輯本專案 [`firestore.rules`](../firestore.rules)，在 email 白名單加一行 `xxx@gmail.com`（注意逗號）
2. 打開 https://console.firebase.google.com/project/hobe-494909/firestore/rules
3. 把整份規則貼上 → 先用「Rules Playground」測 allow/deny → 按「**發布**」
4. （順手）把 `firestore.rules` 的改動 commit 留底

## 門 3：行事曆共用（Google 日曆）

不開 → 能登入、學生資料正常，但「今日/本週課程」全空（課程存在 Google 行事曆，不在資料庫）。

1. 用 owner 帳號開 https://calendar.google.com
2. 把這 **6 本**行事曆逐一分享給 `xxx@gmail.com`：
   **一般課程、補課、調課、試聽、練習課、加課**
   （每本：⋮ →「設定和共用」→「與特定使用者共用」→ 新增 → 權限選「變更活動」）
3. 請新員工去 Gmail 收「已與您共用日曆」的信，點「**加入這個日曆**」把 6 本加進他的日曆清單
4. 新員工**重新登入系統一次**（系統登入當下才抓日曆清單，分享要重登才生效）

---

## 驗收

新員工登入 https://jyunz47.github.io/hobe-system/ ，三項都正常 = 完成：
- ✅ 能登入（門 1）
- ✅ 學生管理頁看得到學生（門 2）
- ✅ 今日/本週課程顯示得出來（門 3）

## 常見卡點

- **課程空白**：通常是門 3 沒接受邀請或沒重登。先確認日曆清單裡有那 6 本，再重登。
- **診斷**：系統頁面 F12 → Console 輸入 `calendarIds`，空的 `{}` = 日曆沒抓到（回門 3）。
