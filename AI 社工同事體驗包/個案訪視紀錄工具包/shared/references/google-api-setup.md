# Google API 設定流程（Gmail）

`case-visit-approval` 需要直接呼叫 Gmail API（不是透過 MCP 工具）寄送/監看主管確認信，
所以每個要用這個 skill 包的人都需要**自己**在 Google Cloud 建一組 OAuth 憑證。
這份文件記錄完整步驟，之後可以照抄，也是 `shared/scripts/google_auth.py` 的前置設定。

訪視紀錄 docx 是直接附加在確認信裡寄出，不會上傳到 Drive，所以不需要 Drive API。

**這一步一定要使用者本人操作**——建立 Cloud 專案、啟用 API、跑 OAuth 同意畫面
都需要登入 Google 帳號，AI 不能代替你登入或輸入密碼。

> 如果你已經裝了 Claude in Chrome，可以叫 Claude 用 `gcp-oauth-setup` skill
> 自動跑完下面第 1-5 步（開專案、啟用 API、設定同意畫面、加範圍、建憑證），
> 你只需要在最後跳出瀏覽器要求「允許」時自己點一下。這份文件仍然是完整的
> 手動步驟參考，兩種方式最終結果一樣。

## 1. 建立 Google Cloud 專案

1. 前往 https://console.cloud.google.com/projectcreate
2. 專案名稱隨意（例如 `case-visit-toolkit`），機構通常會自動帶入組織
3. 按「建立」

## 2. 啟用 Gmail API

前往 `console.cloud.google.com/apis/library/gmail.googleapis.com`，按「啟用」。

## 3. 設定 OAuth 同意畫面

前往 `console.cloud.google.com/auth/overview`，按「開始」：

1. **應用程式資訊**：應用程式名稱隨意，使用者支援電子郵件選自己
2. **目標對象**：如果是 Google Workspace 機構帳號，選「**內部**」
   （不需要 Google 驗證、沒有測試人數上限；一般 Gmail 帳號沒有這個選項，
   只能選「外部」，那就要把自己加進測試使用者清單）
3. **聯絡資訊**：填自己的信箱
4. **完成**：勾選同意條款，按「建立」

## 4. 新增 OAuth 範圍（scopes）

前往 `console.cloud.google.com/auth/scopes`，按「新增或移除範圍」，捲到最下面
「手動新增範圍」文字框，貼上：

```
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
```

各範圍用途：

| Scope | 用途 |
|---|---|
| `gmail.send` | 寄出主管確認信（訪視紀錄 docx 直接附加在信件裡） |
| `gmail.modify` | 監看主管回信、核准後貼標籤歸檔（`gmail.modify` 已包含讀取，不用再加 `gmail.readonly`） |

按「新增至資料表」→「更新」。

## 5. 建立 OAuth 用戶端 ID

前往 `console.cloud.google.com/apis/credentials`：

1. 「建立憑證」→「OAuth 用戶端 ID」
2. 應用程式類型選「**電腦版應用程式**」（舊版介面叫「桌面應用程式」／Desktop app）
   ——本機腳本用 `InstalledAppFlow` 跑一次性授權，不需要 redirect URI
3. 建立後下載 JSON，重新命名成 `client_secret.json`

## 6. 放到正確路徑、跑本機授權

把 `client_secret.json` 放到 `shared/.credentials/client_secret.json`（這個資料夾
已在 `.gitignore` 排除，不會被 commit，也**只屬於你自己**，不要傳給其他人）。
然後執行：

```bash
python3 shared/scripts/google_auth.py
```

第一次執行會跳出瀏覽器要你登入、按「允許」，成功後會在同一個資料夾產生
`token.json`（之後自動使用、過期會自動 refresh，不用重跑）。

## 常見狀況

- **「Google 尚未驗證這個應用程式」警告**：如果同意畫面選「內部」，不會出現這個警告；
  選「外部」且還在測試模式，會出現，這是正常的，點「進階」→「前往 (應用程式名稱)（不安全）」
  即可繼續（僅限你自己是測試使用者時這樣做）。
- **不小心按了兩次「建立憑證」**：`OAuth 2.0 用戶端 ID` 列表裡出現重複項目，
  刪掉多的那個即可，功能完全相同，純粹是入口點不同。
