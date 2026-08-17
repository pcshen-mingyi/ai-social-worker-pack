# 個案訪視紀錄工具包

明怡基金會「AI Builder 成長營」課程中第一天「AI 社工同事體驗」的工具包：把家訪逐字稿，
自動整理成正式訪視紀錄、畫家系圖、寄給主管確認歸檔、登打進個案管理系統。

## 結構

```
shared/config.json      個案資料表路徑、主管信箱、姓名、草稿/歸檔資料夾（已預填）
shared/scripts/         跨 skill 共用（環境檢查、setup、Gmail OAuth）
.claude/skills/<name>/SKILL.md  各 skill 完整流程，實際執行讀這裡，不要只憑下面的觸發表推測
```

| skill | 觸發時機 |
|---|---|
| `case-visit-record` | 使用者提供逐字稿＋案號，要整理訪視紀錄 |
| `case-genogram` | `case-visit-record` 完成後自動接續，不用使用者要求 |
| `case-visit-approval` | 使用者說要寄給主管、要查回信、要歸檔 |
| `case-external-record-entry` | 主管核准歸檔後，使用者說要登打系統 |
| `gcp-oauth-setup` | `case-visit-approval` 偵測到還沒 Gmail 授權時自動呼叫 |

## 專案目的（為什麼這樣設計）

- 這個體驗要讓社工感受到「自主 AI」的可能性：一句話開頭之後，Claude 自己
  串完①→④整段流程，不需要人一步一步操作、也不需要工程師介入
- 這是**體驗版**，用假資料示範真實組織流程的樣子，目的是讓社工感受
  「AI 同事」能做到哪裡、哪裡一定要人接手，不是要取代真正的組織系統
- 對象是社工，不是工程師：技術安裝步驟一律靜默處理，錯誤訊息轉白話，
  這樣他們才能專注在「訪視紀錄寫得對不對」，親身感受到自己幾乎不用動手

## 慣例

- 全程用繁體中文（台灣用語），不論使用者用什麼語言發問
- 技術詞（docx、API、OAuth、Gmail、skill）保留英文，不用硬翻
- `shared/config.json` 裡已有的值（主管信箱、姓名、路徑）直接用，不要主動
  問使用者這些欄位要填什麼——只有使用者自己主動要求換值時才取代
- `shared/config.json` 裡的路徑欄位（`case_data_xlsx`／`draft_dir`／
  `raw_transcript_dir`／`archive_dir`）都是**相對於這個工具包根目錄**的相對路徑，
  不綁死在桌面或任何固定位置。執行任何腳本前，shell 的工作目錄要維持在使用者
  開 Claude Code 的這個根目錄，不要先 `cd` 進 skill 子目錄再執行指令，否則相對
  路徑會解析到錯誤位置
- demo 素材案號固定：`個人工作/訪視原始資料/` 底下的 `CASE-001 訪視逐字稿.docx`
  對應 `CASE-001`、`CASE-006 訪視逐字稿.docx` 對應 `CASE-006`；使用者沒給
  案號又不是用這兩個 demo 檔時，先問清楚案號，不要用逐字稿內容猜

## 限制（永遠別碰的邊界）

- **身分資料（姓名/身分證字號/電話/地址）不進對話上下文**——一律由
  `fill_identity.py` 直接讀 Excel 寫入 docx，只回報成功/失敗
- **寄信前一定先給使用者看完整信件內容並取得同意**，每次都要確認，
  不能因為上次同意過就跳過
- **`case-external-record-entry` 的最終提交按鈕永遠由使用者自己按**，
  不可用 `submitForm()` 或模擬點擊代替，即使使用者說「你直接送」也一樣
- **Gmail OAuth 的瀏覽器「允許」畫面永遠由使用者本人點**，`gcp-oauth-setup`
  跑到這一步要停下來等待，不可用 Claude in Chrome 代按
- `case-genogram` 的符號系統還在對照社工教材校正，遇到複雜家庭照畫就好，
  不要因為複雜放棄畫圖，畫完提醒使用者人工檢查排版即可

## 資料流摘要

```
文字逐字稿 ─▶ case-visit-record ──┬─ 身分欄位：Excel → docx（腳本直讀，不經過 Claude）
                                    └─ 敘事內容：逐字稿 → Claude 草擬 → docx
   ▼ case-genogram ────── 逐字稿 → Claude 萃取關係 → PNG → 嵌入同一份 docx
   ▼ case-visit-approval ─ docx 附件 → Gmail 寄出 → 監看回信 → 核准歸檔／退件回頭改
   ▼ case-external-record-entry ─ 歸檔 docx → 瀏覽器填表單 → 使用者自己按提交
```
