# GAS 中繼原始碼

`Code.gs` 是部署在 Google Apps Script 的網頁應用程式原始碼 —— 訪客在網頁送出的每一筆幸福紀錄，都會先經過它。

## 它在整條管線的位置

```
訪客填表（index.html）
    │  POST
    ▼
Code.gs（GAS 網頁應用程式，持 GitHub token）
    │  代為建立 Issue
    ▼
GitHub Issue（標籤 happiness-record）
    │  觸發
    ▼
.github/workflows/record-to-ledger.yml
    │  解析、寫入、commit
    ▼
data/records/*.md + data/ledger.json
    │
    ▼
GitHub Pages → 網頁上的卡片牆
```

## ⚠️ 這份檔案不會自動同步

GAS 沒有連著這個 repo。這裡放的是**部署版本的副本**，目的是讓這段關鍵程式碼有版本歷史、改壞了回得去。

**在 GAS 改完之後，請把改動一併同步回這個檔案並 commit。** 反之亦然。

## Token 放在哪

**不在這份檔案裡，也不要寫進來。**

Token 存放於 GAS 的**指令碼屬性**：

> ⚙️ 專案設定 → 指令碼屬性 → `GITHUB_TOKEN`

使用的是 **fine-grained personal access token**，權限範圍：

| 項目 | 設定 |
| :--- | :--- |
| Repository access | Only select repositories → `happiness-ledger` |
| Repository permissions | Issues: **Read and write** |
| （自動附加） | Metadata: Read-only |

它只能做一件事：在這個 repo 開 issue。不能推程式碼，不能碰其他 repo。

**換 token 時只要改指令碼屬性的值，不必修改程式碼、也不必重新部署。**

## 修改程式碼後的部署步驟

1. 在 GAS 編輯器修改 `Code.gs`
2. **儲存**（Ctrl / ⌘ + S）—— 沒存的話函式選單不會更新
3. 選 `testToken` → **執行** → 執行記錄出現 `回應碼：200` 代表 token 正常
4. **部署 → 管理部署 → ✏️ → 版本選「新版本」→ 部署**
5. 把改動同步回這個檔案並 commit

> 步驟 4 不能省。留在舊版本的話，公開網址跑的還是舊程式碼。

## 疑難排解

| 現象 | 原因 |
| :--- | :--- |
| `401` | Authorization 用了 `'token '` 而不是 `'Bearer '`，或 token 貼錯／含多餘空白 |
| `403` | 權限不足，或撞到 GitHub 建立內容的速率限制 |
| `404` | 產生 token 時沒有選到 `happiness-ledger` |
| 網頁顯示成功但帳本沒有紀錄 | 前端目前使用 `mode: 'no-cors'`，讀不到回應，所以一律顯示成功。到 GAS 左側「⏱ 執行項目」查看實際錯誤 |

最後那一項是目前已知的缺口：**故障時訪客仍會看到「已永久記錄」**。修法是拿掉 `no-cors`，改為輪詢 `data/ledger.json` 來確認紀錄是否真的入帳。
