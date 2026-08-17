---
name: gcp-oauth-setup
description: 用 Claude in Chrome 自動跑完 Google Cloud OAuth 設定（建專案、啟用 Gmail API、設定同意畫面、加範圍、建 OAuth 用戶端 ID、下載 client_secret.json），只在最後跳出瀏覽器「允許」畫面時停下來讓使用者自己按。當使用者說「幫我設定 Gmail 授權」「跑一次 google-api-setup」「我要開始體驗，先弄 OAuth」時使用。
---

# GCP OAuth 自動設定

`shared/references/google-api-setup.md` 描述的 6 個步驟，這個 skill 用 Claude in Chrome
自動操作 Google Cloud Console 跑完前 5 步。**跑 `google_auth.py` 跳出瀏覽器要求
「允許」時一定要停下來等使用者自己點**——這是把「用這個帳號寄信」的權限交出去，
任何情況都不能由 Claude 代按，包括這個 skill 本身也不例外。

執行前確認：Claude in Chrome 已連接，且使用者已經在瀏覽器登入要拿來寄信的那個
Google 帳號（機構帳號或個人 Gmail 皆可）。

## 步骤

1. **建立專案**：`navigate` 到 `console.cloud.google.com/projectcreate`，
   應用程式名稱欄位填一個好識別的名稱（例如 `case-visit-toolkit`），組織欄位
   通常會自動帶入，直接按「建立」。等 2-3 秒讓專案建立完成。

   > 建立前先用 `console.cloud.google.com/cloud-resource-manager` 檢查有沒有
   > 同名專案已存在——如果之前已經做過一次設定，直接重用舊專案即可，不要
   > 重複建立。

2. **啟用 Gmail API**：navigate 到
   `console.cloud.google.com/apis/library/gmail.googleapis.com?project=<PROJECT_ID>`，
   按一次「啟用」按鈕（藍色主按鈕，通常在畫面左上角應用程式介紹下方）。

3. **設定 OAuth 同意畫面**：navigate 到
   `console.cloud.google.com/auth/overview?project=<PROJECT_ID>`。
   - 如果畫面顯示「尚未設定 Google 驗證平台」，按「開始」跑精靈：
     1. **應用程式資訊**：應用程式名稱隨意（例如「個案訪視紀錄工具包」），
        使用者支援電子郵件下拉選單選使用者自己的帳號，按「下一步」
     2. **目標對象**：機構 Workspace 帳號會看到「內部」選項，選它
        （不需要驗證、沒有測試人數上限）；一般 Gmail 帳號只有「外部」，
        選了之後這個帳號自己會自動被列為測試使用者。按「下一步」
     3. **聯絡資訊**：填使用者的信箱，按「下一步」
     4. **完成**：勾選「我同意《Google API 服務：使用者資料政策》」，按「建立」
   - 如果畫面已經是總覽頁（不是「開始」按鈕），代表已經設定過，直接跳到下一步。

4. **新增範圍**：navigate 到 `console.cloud.google.com/auth/scopes?project=<PROJECT_ID>`，
   按「新增或移除範圍」，在彈出視窗最下面「手動新增範圍」文字框貼上（用逗號分隔）：
   ```
   https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.modify
   ```
   按「新增至資料表」，勾選會自動打勾，往下捲，按「Save」。
   （`gmail.modify` 會被歸類在「受限制範圍」區塊，這是正常的，不影響功能。）

5. **建立 OAuth 用戶端 ID**：navigate 到
   `console.cloud.google.com/apis/credentials?project=<PROJECT_ID>`，
   按「建立憑證」→「OAuth 用戶端 ID」。應用程式類型選單裡選
   **「電腦版應用程式」**（注意：這是目前 GCP 介面的新名稱，等同舊版文件寫的
   「桌面應用程式」/ Desktop app，本機腳本用 `InstalledAppFlow` 不需要 redirect
   URI）。名稱用預設值即可，按「建立」。

6. **下載並歸位憑證**：建立完成的彈出視窗裡按「下載 JSON」，檔案會存到
   使用者的 `~/Downloads/` 資料夾，檔名類似
   `client_secret_<CLIENT_ID>.apps.googleusercontent.com.json`。用 Bash 把它
   搬到 `shared/.credentials/client_secret.json`（資料夾不存在就先建立）：
   ```bash
   mkdir -p shared/.credentials
   mv ~/Downloads/client_secret_*.json shared/.credentials/client_secret.json
   ```
   如果 Downloads 資料夾裡有多個 client_secret_*.json（例如使用者之前也下載過
   別的），用檔案的建立時間挑最新的一個，並提醒使用者確認。

7. **本機授權（唯一需要人工的一步）**：告訴使用者接下來會跳出瀏覽器要求登入、
   按「允許」，然後執行：
   ```bash
   python3 shared/scripts/google_auth.py
   ```
   這一步結束後**停下來等待**，不要嘗試用 Claude in Chrome 去點那個「允許」
   按鈕——即使技術上做得到也不可以，這個授權動作規定必須由帳號本人親自按。
   跑完之後 `shared/.credentials/token.json` 會自動產生，之後不用再重跑。

## 收尾

跑完後可以用這個確認整個設定生效：
```bash
python3 -c "
import json
t = json.load(open('shared/.credentials/token.json'))
print('scopes:', t.get('scopes'))
print('has refresh_token:', 'refresh_token' in t)
"
```
應該要看到 `gmail.send`、`gmail.modify` 兩個 scope 都在，而且 `has refresh_token: True`。
