---
name: case-external-record-entry
description: 把主管核准歸檔的訪視紀錄內容，填入明怡個案管理網路系統（Vercel）並提交。當使用者說「登打外部系統」「幫我上系統」「把紀錄送到系統」時使用。需要 Claude-in-Chrome（使用者真實的 Chrome 瀏覽器）。
---

# 個案訪視紀錄——外部系統登打

把 `case-visit-approval` 核准歸檔的訪視紀錄，透過瀏覽器自動操作填入
**明怡基金會個案管理系統**並提交至 Google Sheets。

系統網址：`https://deploy-nine-blue-62.vercel.app/visit.html`

---

## 使用時機

- `case-visit-approval` 已核准、docx 已歸檔
- 使用者說「登打外部系統」「幫我上系統」「把紀錄送到系統」

## 第一次使用前

`shared/config.json` 已預先填好 `default_staff_name`，下面步驟 3「訪視人員」
欄位直接用這個值即可，不需要另外設定。

---

## 路徑碼（完整步驟）

### 步驟 1：導航至訪視表單

```
navigate: https://deploy-nine-blue-62.vercel.app/visit.html
```

驗證：頁面標題應為「訪視紀錄｜明怡基金會個案管理系統」

---

### 步驟 2：選擇個案

```javascript
// 方法 A：form_input（建議）
// 找到 combobox「— 請選擇個案 —」，設值為案號，例如 "CASE-001"

// 方法 B：JavaScript
document.getElementById('case-select').value = 'CASE-001';  // ← 替換案號
document.getElementById('case-select').dispatchEvent(new Event('change', {bubbles: true}));
```

**驗證**：選完後頁面展開個案基本資料卡，右上角出現「第 N 次訪視」藍色標籤。
若沒有展開，代表 `change` 事件未觸發，重新執行方法 B。

---

### 步驟 3：填入基本訪視資訊

```javascript
// 訪視日期（格式：YYYY-MM-DD）
const dateEl = document.getElementById('f-date');
dateEl.value = '2026-08-05';  // ← 替換實際日期
dateEl.dispatchEvent(new Event('input', {bubbles: true}));

// 訪視方式（三選一：'電話' / '視訊' / '實地'）
document.querySelector('input[name="method"][value="實地"]').click();
// ← 替換實際訪視方式

// 訪視人員（直接用 shared/config.json 的 default_staff_name，不要主動問使用者；
// 只有使用者自己主動說要換人時才改用他說的值）
const workerEl = document.getElementById('f-worker');
workerEl.value = '{訪視人員姓名}';  // ← 替換實際社工姓名
workerEl.dispatchEvent(new Event('input', {bubbles: true}));
```

---

### 步驟 4：填入訪視紀錄四欄

> `setField` 在此定義，步驟 5 繼續使用同一函數。步驟 4 和 5 請在**同一個 console 執行環境**中連續執行，不要重新整理頁面。

```javascript
function setField(id, text) {
  const el = document.getElementById(id);
  el.value = text;
  el.dispatchEvent(new Event('input', {bubbles: true}));
}

// 主述議題（f-main-issue）
setField('f-main-issue', `[填入案主本次主述的問題與需求]`);

// 個案概況（f-case-overview）
setField('f-case-overview', `[填入案主家庭、生活、健康狀況概述]`);

// 各項評估（f-assessment）
// 格式：每項用【標題】開頭，換行分隔
setField('f-assessment', `【生活自理與日常功能】
[事實描述 → 專業判斷]

【醫療與復健需求】
[事實描述 → 專業判斷]

【居家與無障礙環境】
[事實描述 → 專業判斷]

【家庭支持與照顧者負荷】
[事實描述 → 專業判斷]

【經濟與福利資源使用】
[事實描述 → 專業判斷]`);

// 需求評估（f-needs）
// 格式：依優先順序列點
setField('f-needs', `1.（最優先）[最急迫需求]
2.（次要）[次要需求]
3.（第三）[第三需求]`);
```

---

### 步驟 5：填入處遇計畫建議三欄

```javascript
// 短期目標（f-short，1–3個月）
setField('f-short', `1.【優先】[最急迫行動]（預計完成時間）
2.【次要】[次要行動]`);

// 中長期目標（f-mid，3–12個月）
setField('f-mid', `1. [中期目標]（時程）
2. [長期目標]（時程）`);

// 轉介資源（f-referral）
setField('f-referral', `1. [資源名稱]：[說明]
2. [資源名稱]：[說明]`);
```

---

### 步驟 6：交由使用者提交（不可代按）

**表單填完後，一律停下來、截圖給使用者看，由使用者自己按下頁面上的「提交」按鈕。**
提交是無法復原的動作，任何情況下都不要用 `submitForm()` 或模擬點擊事件代替使用者送出，
即使使用者說「你直接送」也一樣——回覆使用者：提交需要他親自按，並請他確認畫面上的內容
無誤後按下即可。

**驗證（使用者按下之後）**：等待 2–3 秒後執行：

```javascript
document.getElementById('success-overlay').className;
// 回傳應包含 "show" → 提交成功
```

若不含 `show`，可能原因：
- 訪視日期未填（`f-date` 為空）
- 訪視方式未選（`input[name="method"]:checked` 為 null）
- fetch 請求失敗（Apps Script 端問題）

---

## 欄位對照表

| 欄位 ID | 說明 | 類型 |
|---------|------|------|
| `case-select` | 個案選擇 | `<select>` |
| `f-date` | 訪視日期 | `<input type="date">` |
| `input[name="method"]` | 訪視方式（電話/視訊/實地） | `<input type="radio">` |
| `f-worker` | 訪視人員 | `<input type="text">` |
| `f-main-issue` | 主述議題 | `<textarea>` |
| `f-case-overview` | 個案概況 | `<textarea>` |
| `f-assessment` | 各項評估 | `<textarea>` |
| `f-needs` | 需求評估 | `<textarea>` |
| `f-short` | 短期目標 | `<textarea>` |
| `f-mid` | 中長期目標 | `<textarea>` |
| `f-referral` | 轉介資源 | `<textarea>` |

---

## 資料流向

提交後寫入明怡基金會個案訪視紀錄
