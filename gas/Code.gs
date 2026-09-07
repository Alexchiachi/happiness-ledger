/**
 * 幸福影響力記帳本 — Google Apps Script 中繼
 *
 * 這是部署在 Google Apps Script 的網頁應用程式原始碼。
 * 職責：接收前端的匿名 POST，代為在 GitHub 建立 Issue，
 *       後續由 .github/workflows/record-to-ledger.yml 寫入帳本。
 *
 * ⚠️ 這份檔案裡「沒有」token，也不要在這裡貼 token。
 *    Token 存放於 GAS 的「⚙️ 專案設定 → 指令碼屬性 → GITHUB_TOKEN」。
 *
 * ⚠️ 本檔案是部署版本的副本，不會自動同步。
 *    在 GAS 改完之後，記得把改動同步回這裡。詳見 gas/README.md。
 */

const GITHUB_REPO = 'Alexchiachi/happiness-ledger';

function getToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    throw new Error('找不到 token。請到「⚙️ 專案設定 → 指令碼屬性」新增一個叫 GITHUB_TOKEN 的屬性。');
  }
  return token;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { nickname, category, content, honeypot } = data;

    // 蜜罐：真人看不到這個欄位，機器人才會填。填了就假裝收下但丟掉。
    // 刻意不回報失敗，否則機器人會換個方法再來。
    if (honeypot && honeypot.trim() !== '') {
      return json_({ ok: true });
    }

    if (!nickname || !content) {
      return json_({ ok: false, error: '欄位不得為空' });
    }

    // 這些 ### 小標題是給 workflow 的解析器辨識欄位用的，不要隨意更動。
    const issueBody =
      `### 您的稱呼 / 筆名\n\n${nickname}\n\n` +
      `### 幸福微類型\n\n${category}\n\n` +
      `### 幸福感知內容\n\n${content}`;

    const response = UrlFetchApp.fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/issues`,
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          // fine-grained token 必須用 Bearer；用舊的 'token ' 會拿到 401
          'Authorization': 'Bearer ' + getToken_(),
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'GAS-Relay'
        },
        payload: JSON.stringify({
          title: `【幸福存入】: ${nickname} 的微光覺察`,
          body: issueBody,
          labels: ['happiness-record']
        }),
        muteHttpExceptions: true
      }
    );

    const code = response.getResponseCode();
    const text = response.getContentText();

    // 失敗要留下痕跡。舊版把 GitHub 的錯誤原文當成正常內容回傳，
    // 導致前端一律當成功處理，訪客看到「已永久記錄」但其實沒有。
    if (code < 200 || code >= 300) {
      console.error(`GitHub 回應 ${code}：${text}`);
      return json_({ ok: false, error: `GitHub 回應 ${code}` });
    }

    return json_({ ok: true, number: JSON.parse(text).number });

  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: String(err) });
  }
}

/**
 * 測試用：確認 token 還有效。
 * 在 GAS 編輯器選這個函式直接按「執行」，不需要部署。
 * 執行記錄出現 200 就代表正常。
 */
function testToken() {
  const r = UrlFetchApp.fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
    headers: {
      'Authorization': 'Bearer ' + getToken_(),
      'Accept': 'application/vnd.github+json'
    },
    muteHttpExceptions: true
  });
  Logger.log('回應碼：' + r.getResponseCode());
  Logger.log(r.getContentText().slice(0, 200));
}
