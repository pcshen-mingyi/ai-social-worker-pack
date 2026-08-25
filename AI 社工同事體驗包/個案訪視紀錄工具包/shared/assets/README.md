# 內附資產

## NotoSansTC-subset.ttf（335KB）

家系圖上的中文由這份字型渲染。**這是子集字型**，只包含體驗包已知會用到的
1,205 個字元（demo 個案資料、逐字稿、關係詞、標籤、ASCII 與常用標點）。

授權：SIL Open Font License，見 `NotoSansTC-OFL.txt`（OFL 要求隨附授權，不可移除）。
原始字型：Noto Sans TC（Google Fonts），完整版 11MB。

### ⚠️ 只涵蓋 demo 資料

換成**真實個案**的話，姓名裡可能出現子集以外的字。程式遇到缺字會畫一個
**空心方框**並在訊息裡列出缺哪些字——刻意做成看得見，因為預設行為是
「靜默消失」：「陳美玲」會變成「陳美」，看的人不會發現名字少了一個字。

要跑真實資料，把這裡換成**完整版 Noto Sans TC**（11MB）即可，程式不用改。

## vendor/opentype.min.mjs（239KB）

讀字型檔、取出文字輪廓。**純 JavaScript，沒有原生二進位檔**，Mac 與 Windows
共用同一份，學員不需要 `npm install`。

授權：MIT，見 `../vendor/opentype.js-LICENSE`。
