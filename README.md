# 個案訪視紀錄體驗包

明怡基金會「AI Builder 成長營」的體驗包：用 Claude Code 走一次完整的個案訪視紀錄流程——
逐字稿整理成正式紀錄 → 自動畫家系圖 → 寄給主管確認 → 核准歸檔 → 登打到個案管理系統。

> 全部使用示範假資料，不影響任何機構的正式表單。

## 下載

**固定下載連結（永遠指向最新版）：**

https://github.com/pcshen-mingyi/ai-social-worker-pack/releases/latest/download/AI-social-worker-pack.zip

下載後解壓縮，會得到「個案訪視紀錄體驗包」資料夾。

Mac 與 Windows 都可以用，**不需要安裝 Python 或任何套件**。

## 安裝與開始

1. 解壓縮後，把裡面的**三個資料夾**（`AI社工同事`、`明怡服務紀錄資料夾`、`個人工作`）
   搬出來，放在你想要的位置、**同一層**（桌面、下載資料夾、隨身碟都可以）。
2. 用 Claude Code 打開 `AI社工同事` 資料夾。
3. 跟 Claude 說：「幫我整理 CASE-001 的訪視紀錄」。

其餘設定（個案資料表路徑、主管信箱、姓名、系統網址）都已經幫你填好，
**體驗前不需要準備任何東西，也不需要安裝任何套件**——所有腳本都是 Node.js，
Claude Code 本身就帶了 Node，Mac 與 Windows 都一樣。

詳細說明請看包內的 `AI社工同事/README.md`。

## 內含的 skill

| Skill | 做什麼 |
|---|---|
| `case-visit-record` | 把訪視逐字稿整理成正式個案紀錄表 |
| `case-genogram` | 依紀錄內容自動繪製家系圖 |
| `case-visit-approval` | 寄送紀錄給主管確認、核准後歸檔 |
| `case-external-record-entry` | 把核准的紀錄登打進個案管理系統 |
| `gcp-oauth-setup` | 需要寄信時，引導完成 Gmail 授權設定 |
