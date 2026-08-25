---
name: case-visit-approval
description: 把訪視紀錄寄給主管確認，監看回信，核准後歸檔、退件則回頭修改再重寄。當使用者說「訪視紀錄寫好了，要給主管確認」「幫我發信給督導確認」「主管回信了，看一下」「這份紀錄要歸檔」時使用。
---

# 個案訪視紀錄——主管確認與歸檔

訪視紀錄 docx 完成後（③ 主管確認歸檔），把 docx 直接附加在信件裡寄給主管，
之後監看回信：核准就歸檔，退件就帶著主管的意見回到 `case-visit-record` 修改，
改完再重新走一次這個流程，直到核准為止。

這個 skill 用 Google API（Gmail）直接寄信，**不是只建草稿**——設定方式見
`shared/references/google-api-setup.md`。

> 下面指令裡的 `scripts/` 是相對於**這個 skill 資料夾**的路徑，執行時請換成完整路徑。

## 第一次使用前

`shared/config.json` 已經預先填好體驗用的主管信箱、訪視人員姓名、歸檔資料夾，
不需要另外設定。

執行任何寄信步驟前，先確認 `shared/.credentials/token.json` 是否存在。
**不存在就直接呼叫 `gcp-oauth-setup` skill**，不要只是叫使用者自己去讀
`google-api-setup.md`——那份文件是備用的手動參考，正常情況下應該由
`gcp-oauth-setup` 自動用 Claude in Chrome 跑完 GCP 專案/API/OAuth 同意畫面
這些設定，**唯一要使用者自己做的一步**是最後跳出瀏覽器「允許」畫面時本人
登入 Google 點一下——這是把「用使用者自己的 Gmail 帳號寄信」的權限交出去，
AI 沒辦法也不能代替完成。`gcp-oauth-setup` 跑完、確認 `token.json` 產生後，
再繼續下面的流程。

下面步驟裡 `--to`、`--staff-name`、`--archive-dir` 的值，**直接**從
`shared/config.json`（`supervisor_email`、`default_staff_name`、`archive_dir`）帶入，
**不要主動問使用者這些欄位要填什麼**——只有使用者自己主動在對話中提出要用不同的值時，
才用他說的值取代 config.json 的預設值。

## 使用時機

- `case-visit-record` + `case-genogram` 兩者皆完成、訪視紀錄 docx 已含家系圖，使用者要送主管確認
- 使用者說「主管回信了」「查一下有沒有回信」，要接續檢查回信狀態

## 流程

### 1. 寄出前，先跟使用者確認

向使用者展示**完整的信件內容**（不只是三項摘要）：主旨、開頭問候、三項摘要、
結尾固定語句、簽名檔，全部照下面範本的實際格式呈現，讓使用者看到的就是等於
真正會寄出去的內容。取得明確同意後才寄出——寄信是有實際外部影響的動作，
必須每次都先確認。

信件範本（腳本自動套用，主旨、開頭、結尾這些固定格式**不會變動**，只有三項摘要
是每次依訪視內容而不同）：

主旨：`訪視紀錄確認｜{案號}｜{訪視日期}`

```
主任，您好：

這是 {訪視日期} {訪視人姓名} 的訪視紀錄，請協助確認（詳見附件）。

• 現況摘要：…
• 需求評估摘要：…
• 處遇計畫摘要：…

若您確認無誤，再麻煩請核准；如需調整，請不吝給予修改建議，我會依建議調整後重新寄出給您確認，謝謝！

{簽名檔（自動抓 Gmail sendAs 預設設定；若未設定則以訪視人姓名署名）}
```

### 2. 寄出確認信

```bash
node scripts/send_for_approval.mjs \
  --docx 輸出檔.docx \
  --to {shared/config.json 的 supervisor_email，或使用者指定的信箱} \
  --case-id CASE-001 \
  --visit-date 2026/08/06 \
  --staff-name "{shared/config.json 的 default_staff_name，或使用者指定的姓名}" \
  --summary-situation "案主現況重點" \
  --summary-needs "評估的主要需求" \
  --summary-plan "處遇計畫重點"
```

這支腳本會把 docx 直接附加在信件裡、真的寄出這封信（不是建草稿）。
執行後會印出 **Gmail thread id**——記下來，下一步要用。

告訴使用者信已寄出，並記下 thread id（可以先幫使用者存在案件的暫存筆記裡）。

### 3. 監看回信（每 2 分鐘自動檢查，不用使用者開口問）

信寄出後，**主動**開始背景監看，不用等使用者說「查一下回信了沒」：

1. 用 `/loop` 排程每 2 分鐘執行一次：
   ```bash
   node scripts/check_approval.mjs --thread-id <上一步的 thread id>
   ```
2. 每次執行如果**還沒有新回覆**，不用跟使用者說什麼，靜靜等下一次檢查即可
   （不要每 2 分鐘都跳出來說「還沒收到回信」，這樣太打擾）。
3. 一旦偵測到**新回覆**：
   - 立刻在這個對話框跳出來告訴使用者，附上回覆全文
   - 由你自己判斷這是「核准」還是「退件並要求修改」——不用套關鍵字，直接讀語意判斷即可
   - 跟使用者確認你的判斷（例如：「主管回覆看起來是核准，我理解正確嗎？」）
   - **停止這個 thread 的監看**（呼叫 `/loop` 的停止機制），不要收到一次回覆後還繼續每
     2 分鐘檢查同一封信
4. 如果後續走到 4b 退件重寄，重新寄出後要**重新啟動監看**（同一個 thread id 或新 thread
   都算「新一輪」，都要回到步驟 1 重新開始每 2 分鐘檢查）。

如果使用者自己主動問「查一下有沒有回信」，直接執行一次 `check_approval.mjs` 回報結果即可，
不影響背景監看的排程。

### 4a. 如果核准 → 歸檔

```bash
node scripts/mark_archived.mjs \
  --thread-id <thread id> \
  --docx 輸出檔.docx \
  --archive-dir {shared/config.json 的 archive_dir} \
  --case-id CASE-001 \
  --visit-date 20260804
```

（`--case-id` 與 `--visit-date` 必填，腳本用這兩個欄位產生歸檔檔名
`CASE-001_訪視紀錄_20260804.docx`；`--visit-date` 格式為 `YYYYMMDD`。）

會在 Gmail 這個 thread 貼上「已歸檔」標籤並封存，同時把本機 docx 搬到 `已歸檔/` 資料夾。
完成後告訴使用者：訪視紀錄已歸檔，接下來如果要登打外部系統，可以接續使用
`case-external-record-entry` skill。

### 4b. 如果退件 → 回頭修改

把主管回覆裡的具體修改意見整理給使用者看，確認要怎麼調整後，回到
`case-visit-record` 的步驟 3（從逐字稿草擬敘事內容），依主管意見修改對應段落
（**只改被要求調整的部分**，不要整份重寫），改完後回到本 skill 的步驟 1，
重新確認、重新寄出。同一個案子可以重複用同一個 thread id 繼續追蹤，或視情況
開新的確認信——跟使用者確認想怎麼做。
