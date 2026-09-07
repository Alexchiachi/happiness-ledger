# 幸福影響力記帳本 · 專案脈絡

> 給 AI 助理與新加入的開發者。**動手改任何東西之前請先讀「不要做的事」一節** ——
> 那裡每一條都對應一個曾經真實發生、且靜默吞掉使用者資料的問題。

---

## 這是什麼

一件**數位行為藝術作品**，不是一般的網頁應用。任何人可以免登入留下一則生活中的
微小覺察或善意，紀錄以 Git commit 的形式永久封存。

判斷取捨時請記得：**這件作品的承諾是「恆久銘記」。** 因此
「使用者的文字絕不遺失」與「狀態必須說真話」的優先序，高於效能與程式碼美感。

線上位址：<https://alexchiachi.github.io/happiness-ledger/>

---

## 系統實際的形狀

```
訪客填表（index.html，GitHub Pages）
    │  POST（mode: 'no-cors'）
    ▼
Google Apps Script（gas/Code.gs，持 fine-grained token）
    │  代為呼叫 GitHub API 建立 Issue
    ▼
GitHub Issue（標籤 happiness-record）
    │  觸發 opened 事件
    ▼
.github/workflows/record-to-ledger.yml
    │  執行 .github/scripts/update-ledger.js
    ▼
data/records/*.md（逐筆封存）＋ data/ledger.json（聚合）
    │  commit 到 main
    ▼
GitHub Pages 重建 → 首頁卡片牆 fetch ./data/ledger.json
```

**訪客不需要 GitHub 帳號，因為 GAS 持有憑證。** 這是「免登入」承諾的實作方式。

---

## 檔案地圖

| 路徑 | 說明 |
| :--- | :--- |
| `index.html` | 整個前端。單一檔案，無框架、無建置流程 |
| `gas/Code.gs` | GAS 中繼的原始碼**副本**。實際執行的在 Google，**不會自動同步** |
| `gas/README.md` | 部署步驟、token 權限、錯誤碼對照 |
| `.github/workflows/record-to-ledger.yml` | Issue → 帳本的自動化 |
| `.github/scripts/update-ledger.js` | 解析與寫入的實際邏輯 |
| `.github/ISSUE_TEMPLATE/` | 中英文存入表單 |
| `data/ledger.json` | 卡片牆的資料來源 |
| `data/records/*.md` | 逐筆封存 |
| `tools/import-records.js` | 從外部帳本遷移紀錄 |
| `docs/CN_LEDGER_SPEC.md` | 大陸版建置規格與資料契約 |
| `docs/LEDGER_PROTOCOL.md` | 兩本帳本之間的協定：角色、交接流程、交握訊息 |
| `CONTRIBUTING.md` | 內容準則（四要四不）|

---

## 資料形狀

**`data/ledger.json`** —— 陣列，依 `date` 新到舊排序：

```json
{
  "id": 16,
  "date": "2026-09-02T13:49:07.000Z",
  "author": "簡家旗",
  "category": "🧘 身心安頓",
  "content": "……",
  "source": "cn",
  "origin_id": "cn-20260915-0042"
}
```

`id` 是 **GitHub Issue 編號**。`source` 與 `origin_id` 僅遷移紀錄才有。

**Issue 內文**由 `### 小標題` 分段，解析器靠這些標題取值：

```
### 您的稱呼 / 筆名     （或英文 Your Name / Moniker）
### 幸福微類型          （或英文 Micro-Category）
### 幸福感知內容        （或英文 Your Moment of Awareness）
### 原始存入時間        （可選，遷移用）
### 來源                （可選，遷移用）
### 原始編號            （可選，遷移用）
```

---

## 不要做的事

以下每一條都對應一個曾經發生、且**靜默**造成損害的問題。

### ❌ 不要在 `on.issues.types` 加回 `labeled` 或 `reopened`

GAS 建立 Issue 時就帶上 `happiness-record` 標籤，GitHub 因此對同一筆存入送出
`opened` 與 `labeled` **兩個**事件。兩個 job 以相同的 base SHA 各自重寫
`ledger.json`，再搶著 `git push` —— 落後者以 non-fast-forward 失敗，紀錄整筆消失，
Issue 也不會被關閉。歷史上 13 個 run 有 7 個因此失敗，issue #7 的紀錄就是這樣沒的。

**只留 `[opened]`。**

### ❌ 不要用 `concurrency` 群組來解決寫入競爭

GitHub 在同一群組中**只保留最新一個排隊的 run，較早排隊者會被取消**。
高併發時它會替你丟棄紀錄 —— 正是要避免的失敗模式。

### ❌ 不要用 `git pull --rebase` 來解決推送衝突

並行的 run 都會**整份重寫** `ledger.json`，rebase 必然衝突。
正確做法是「重置到最新遠端狀態 → 重算 → 再推」，見 workflow 中的重試迴圈。

### ❌ 不要把 token 寫進程式碼

它存在 GAS 的**指令碼屬性** `GITHUB_TOKEN`。是 fine-grained token，
只授權這一個 repo 的 Issues 讀寫。

換 token 只需改屬性值，**不必修改程式碼、不必重新部署**。

### ❌ 不要把 `Authorization` 改成 `'token ' + ...`

fine-grained token 必須用 **`Bearer`**。用舊寫法會拿到 401，而
`muteHttpExceptions` 會吞掉它、`no-cors` 再遮一層 —— 你會看到「已存入」但什麼都沒發生。

### ❌ 不要引入網頁字型

`index.html` 刻意不使用 Google Fonts。字型 `<link>` 是**阻擋渲染**的請求，
在連不到的網路環境（例如中國大陸）會讓頁面長時間空白。CJK 網頁字型也動輒數 MB。

**目前頁面載入時的外部請求數為 0，請維持這個狀態。**

### ❌ 不要直接改寫 `data/ledger.json`

帳本維持**單一寫入者**：只有 workflow 會寫。遷移也走 Issue（見 `tools/import-records.js`），
不走捷徑。

### ❌ 不要用執行時間當作紀錄的時間戳

用 Issue 的 `created_at`（使用者實際存入的時刻），若有 `原始存入時間` 欄位則以它為準。
用執行時間會讓重試產生不一致的內容，也會讓遷移進來的舊紀錄顯示成遷移當天的日期。

---

## 已知的缺口（尚未修，不是疏漏）

### 前端看不見失敗

`index.html` 用 `mode: 'no-cors'` 送出，拿到的是 opaque response：
狀態碼恆為 0、body 讀不到，**不論 GAS 回什麼都會 resolve**。
於是程式碼無條件顯示「已永久記錄」。

雪上加霜的是 `setTimeout(loadLedger, 5000)`：workflow 本身就要 12～16 秒，
後面還有 Pages 重建 —— **5 秒後重載必定看不到自己那筆**。

**修法**（已設計未實作）：拿掉 `no-cors`（`text/plain` 本身就避開 preflight，
`no-cors` 是多餘的），改為輪詢 `./data/ledger.json` 直到自己那筆出現。
注意 CORS 若不通不可重試 POST —— 請求已送出，重試會產生重複紀錄。

### 中國大陸無法送出

`script.google.com` 在大陸不通，`fonts.googleapis.com` 亦然（字型已移除）。
`alexchiachi.github.io` 實測可開。解法見 `docs/CN_LEDGER_SPEC.md`。

### 其他

- 載入失敗被顯示成「帳本是空的」，兩者應該分開
- 卡片牆無分頁、無分類篩選，紀錄變多會是一面牆
- `records/*.md` 目前沒有任何東西讀取；`ledger.json` 才是網站的真相來源，
  主從關係其實應該倒過來（md 為真相，json 為衍生產物）
- 30 秒節流只在 localStorage，換無痕視窗即失效
- issue #2 與 #7 仍為開啟狀態且無對應紀錄（修正前的舊傷）

---

## 怎麼驗證改動

**沒有測試框架、沒有 CI 檢查 PR。** `issues` 事件觸發的 workflow 一律讀取
**預設分支**上的檔案 —— 因此 workflow 的改動在合併前不會執行，合併本身就是測試。
請在本機驗證後再合併。

### workflow / 解析器

用假的 Issue 事件直接跑腳本：

```bash
GITHUB_EVENT_PATH=<事件.json> GITHUB_WORKSPACE=<暫存目錄> node .github/scripts/update-ledger.js
```

事件 JSON 只需要 `{"issue":{"number":N,"created_at":"…","user":{"login":"…"},"body":"…"}}`。

要驗證推送競爭，可用 `git init --bare` 建假 origin，開多個平行 worker 跑同一段重試迴圈，
確認每一筆都寫入。

### 前端

```bash
python3 -m http.server 8899          # 在 repo 根目錄
```

Playwright 已可用（Chromium 在 `/opt/pw-browsers/chromium`）。實測時**務必攔截外部請求並確認為 0**。

### 對比度

修改色彩後請重算 WCAG 對比。現況（皆通過 AA）：

| 用途 | 比值 |
| :--- | ---: |
| `--text-muted` `#776c5f` / 頁面底 | 4.64:1 |
| `--accent-on-light` `#7f6249` / 膠囊底 | 4.82:1 |

### GAS

`gas/Code.gs` 改動後**必須手動同步到 Google**，並在部署時選「新版本」。
編輯器裡執行 `testToken` 可確認 token 有效（看到 `回應碼：200`）。

---

## 這件作品的語言

繁體中文為主，中英雙語並陳。文案帶有安靜、克制的調性
（「微光」「存入」「安住此心」），**不要改成一般產品的語氣**。

錯誤訊息也一樣：要誠實，但不必冷硬。
