# Cloudflare Worker 中繼

`src/index.js` 是 `gas/Code.gs` 的替代品：接收前端的匿名 POST，代為在 GitHub 建立 Issue。
後面的流程（workflow → 帳本 → Pages）完全不變。

## 為什麼換

| | GAS | Worker |
| :--- | :--- | :--- |
| 前端讀得到結果 | 要繞一次跨網域轉址，不穩定 | 直接回 CORS 標頭 |
| 實際執行的程式碼 | Google 上的那份，repo 只是副本 | 就是 repo 裡這份（`wrangler deploy`）|
| 節流 | 只有瀏覽器 localStorage | 伺服端依 IP，每 60 秒 2 次 |
| 內容檢查 | 只擋空白 | 長度上限、不收連結、`###` 不能偽造欄位 |
| 中國大陸 | `script.google.com` 必定不通 | 自訂網域**可能**連得到，需實測 |

## 這個 Worker 不做的事

- **不寫帳本、不存資料。** 帳本只有 workflow 一個寫入者，不要加 D1 / KV。
- **不用 Turnstile。** 它要載入 `challenges.cloudflare.com`，會破壞「載入時外部請求數為 0」，在大陸也可能不通。
- **不走 `workers.dev`。** 該網域在大陸常被封鎖，所以 `wrangler.toml` 設了 `workers_dev = false`。

## 部署步驟

### 0. 前提：daoissimple.com 的 DNS 由 Cloudflare 代管

Worker 要綁 `ledger-api.daoissimple.com`，這個網域就得是 Cloudflare 上的一個 zone。
到 Cloudflare 儀表板看得到 `daoissimple.com` 就代表已經是了，可以跳到第 1 步。

如果還不是（DNS 目前在網域商或 WordPress 主機那邊）：

1. Cloudflare → **Add a domain** → 輸入 `daoissimple.com` → 選 Free 方案
2. Cloudflare 會掃描現有 DNS 紀錄。**請逐筆對照原本的紀錄**，特別是：
   - 網站的 `A` / `CNAME`（WordPress 主機）
   - `MX`、`TXT`（SPF、DKIM）—— **漏了這些，信箱會收不到信**
3. 確認無誤後，到網域商把 nameserver 改成 Cloudflare 給的兩組
4. 等狀態變成 **Active**（通常數分鐘到數小時）

> 若不想動整個網域的 DNS，也可以另買一個便宜網域專門給中繼用，步驟相同。

### 1. 產生兩把 token

**Cloudflare API token**（在代管 `daoissimple.com` 的那個帳號）：

1. 右上角頭像 → My Profile → API Tokens → Create Token → 範本 **Edit Cloudflare Workers**
2. Account Resources：只選該帳號；Zone Resources：Specific zone → `daoissimple.com`
3. 另加一條權限 **Zone → DNS → Edit**（綁自訂網域時會建立 DNS 紀錄）

同一個帳號的 **Account ID** 在網域概覽頁右側「API」區塊。

**GitHub fine-grained token**（給 Worker 開 Issue 用，可沿用 GAS 那一把，建議另開）：

| 項目 | 設定 |
| :--- | :--- |
| Repository access | Only select repositories → `happiness-ledger` |
| Repository permissions | Issues: **Read and write** |

### 2. 放進 GitHub，由 Actions 部署

repo → **Settings → Secrets and variables → Actions → New repository secret**，新增三個：

| 名稱 | 內容 |
| :--- | :--- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID |
| `LEDGER_ISSUES_TOKEN` | GitHub fine-grained token（repo secret 不能以 `GITHUB_` 開頭，部署時會寫成 Worker 的 `GITHUB_TOKEN`）|

接著到 **Actions → Deploy Worker Relay → Run workflow** 執行第一次部署。
之後只要 `worker/` 有改動合併到 `main`，就會自動重新部署（`.github/workflows/deploy-worker.yml`）。
secrets 未設齊時部署步驟會略過，不會失敗。

換 token：更新 repo secret 後重跑一次這個 workflow。

<details>
<summary>也可以在自己電腦上部署</summary>

```bash
cd worker
npx wrangler login
npx wrangler secret put GITHUB_TOKEN     # 貼上 GitHub token
npx wrangler deploy
```
</details>

### 3. 驗證

```bash
node test.mjs                            # 本機邏輯檢查，不會建立 Issue

# 線上：送一筆蜜罐請求，應回 {"ok":true} 且不會建立 Issue
curl -s -X POST https://ledger-api.daoissimple.com/ \
  -H 'Origin: https://alexchiachi.github.io' \
  -d '{"nickname":"x","category":"x","content":"x","honeypot":"test"}'
```

確認無誤後，實際從網頁送一筆，看 Issue 與帳本是否都出現。

### 4. 前端切換

把 `index.html` 裡的 `RELAY_ENDPOINT` 改成 `https://ledger-api.daoissimple.com/`，合併到 `main`。

GAS 先不要停用，觀察一兩週再說 —— 要退回只需把 `RELAY_ENDPOINT` 改回去。

### 5. 從中國大陸實測

請大陸的朋友開啟網頁、送出一筆，並回報是否看見「微光已存入帳本」。
在有實測結果之前，`docs/CN_LEDGER_SPEC.md` 的大陸版計畫照常進行。

## 回應格式

與 GAS 相同，前端兩邊通用：

| 狀態 | 內容 | 前端行為 |
| :--- | :--- | :--- |
| `200` | `{ ok: true, number }` | 清空表單，輪詢帳本直到該筆出現 |
| `200` | `{ ok: true }`（蜜罐）| 同上，但以內容比對 |
| `400` / `413` | `{ ok: false, error }` | 顯示 `error`，**保留表單文字** |
| `403` | 來源不在 `ALLOWED_ORIGINS` | — |
| `429` | 被節流 | 顯示 `error`，保留文字 |
| `502` | GitHub 拒絕或連不上 | 顯示 `error`，保留文字；實際原因看 `wrangler tail` |

## 疑難排解

| 現象 | 原因 |
| :--- | :--- |
| 部署時「找不到 zone」 | 第 0 步未完成，`daoissimple.com` 還不在 Cloudflare |
| `502` 且記錄顯示 GitHub `401` | token 貼錯，或 Authorization 被改成 `'token '` |
| `502` 且記錄顯示 GitHub `404` | 產生 token 時沒選到 `happiness-ledger` |
| 網頁顯示「無法確認是否送達」 | 前端讀不到回應：網路不通，或網頁網址不在 `ALLOWED_ORIGINS` |

即時記錄：`npx wrangler tail`
