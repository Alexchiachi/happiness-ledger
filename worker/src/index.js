/**
 * 幸福影響力記帳本 — Cloudflare Worker 中繼
 *
 * 職責與 gas/Code.gs 相同：接收前端的匿名 POST，代為在 GitHub 建立 Issue，
 * 後續由 .github/workflows/record-to-ledger.yml 寫入帳本。
 *
 * 與 GAS 版的差別：
 *   - 回應帶 CORS 標頭，前端讀得到真正的結果，不必再用 no-cors 盲送
 *   - 節流、長度與連結檢查在伺服端，換無痕視窗也繞不過
 *   - repo 裡的這份就是實際執行的程式碼（wrangler deploy），沒有副本同步問題
 *
 * ⚠️ Token 不在這裡。它是 Worker 的 secret：`wrangler secret put GITHUB_TOKEN`。
 * ⚠️ 這個 Worker 只做一件事：開 Issue。不要讓它直接寫帳本或存資料 ——
 *    帳本只有 workflow 一個寫入者。
 */

const MAX_NICKNAME = 40;
const MAX_CATEGORY = 60;
const MAX_CONTENT = 2000;
const MAX_BODY_BYTES = 16 * 1024;

// 對應解析器依賴的 ### 小標題。使用者文字裡若出現 ###，會截斷欄位，
// 甚至能偽造「原始存入時間」「來源」等遷移欄位，所以一律換成全形。
const neutralize = (s) => s.replace(/#{3,}/g, (m) => '＃'.repeat(m.length));

const LINK_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|cn|tw|shop|xyz|top)\b/i;

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function reply(status, obj, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(origin ? corsHeaders(origin) : {}) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const originOk = allowedOrigins(env).includes(origin);

    if (request.method === 'OPTIONS') {
      return originOk ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : new Response(null, { status: 403 });
    }
    if (request.method !== 'POST') {
      return reply(405, { ok: false, error: '只接受 POST' }, originOk ? origin : '');
    }
    // 瀏覽器一定會帶 Origin；沒帶或不在名單上的，多半不是從記帳本頁面來的。
    if (!originOk) {
      return reply(403, { ok: false, error: '來源不在允許名單內' });
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return reply(413, { ok: false, error: '內容過長' }, origin);
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return reply(400, { ok: false, error: '無法解讀送出的內容' }, origin);
    }

    const nickname = String(data.nickname || '').trim();
    const category = String(data.category || '').trim();
    const content = String(data.content || '').trim();
    const honeypot = String(data.honeypot || '').trim();

    // 蜜罐：真人看不到這個欄位，機器人才會填。假裝收下但丟掉，
    // 刻意不回報失敗，否則機器人會換個方法再來。不帶 number，前端不會去等它入帳。
    if (honeypot) {
      return reply(200, { ok: true }, origin);
    }

    if (!nickname || !content || !category) {
      return reply(400, { ok: false, error: '稱呼、類型與內容都需要填寫' }, origin);
    }
    if (nickname.length > MAX_NICKNAME || category.length > MAX_CATEGORY || content.length > MAX_CONTENT) {
      return reply(400, { ok: false, error: `內容請精簡一些（稱呼 ${MAX_NICKNAME} 字、內容 ${MAX_CONTENT} 字以內）` }, origin);
    }
    if (LINK_PATTERN.test(nickname) || LINK_PATTERN.test(content)) {
      return reply(400, { ok: false, error: '帳本不收錄連結，請只留下文字' }, origin);
    }

    // 依 IP 節流。沒有綁定限流器時（例如本機測試）就略過。
    if (env.SUBMIT_LIMITER) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.SUBMIT_LIMITER.limit({ key: ip });
      if (!success) {
        return reply(429, { ok: false, error: '請稍後片刻再存入，給心靈留一點停頓的時間' }, origin);
      }
    }

    if (!env.GITHUB_TOKEN) {
      console.error('找不到 GITHUB_TOKEN secret');
      return reply(500, { ok: false, error: '中繼尚未設定完成' }, origin);
    }

    // 這些 ### 小標題是給 workflow 的解析器辨識欄位用的，不要隨意更動。
    const issueBody =
      `### 您的稱呼 / 筆名\n\n${neutralize(nickname)}\n\n` +
      `### 幸福微類型\n\n${neutralize(category)}\n\n` +
      `### 幸福感知內容\n\n${neutralize(content)}`;

    let res;
    try {
      res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
        method: 'POST',
        headers: {
          // fine-grained token 必須用 Bearer；用舊的 'token ' 會拿到 401
          'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'happiness-ledger-worker',
        },
        body: JSON.stringify({
          title: `【幸福存入】: ${nickname.replace(/\s+/g, ' ')} 的微光覺察`,
          body: issueBody,
          labels: ['happiness-record'],
        }),
      });
    } catch (err) {
      console.error('連線 GitHub 失敗', err);
      return reply(502, { ok: false, error: '暫時無法連上帳本，請稍後再試' }, origin);
    }

    if (!res.ok) {
      console.error(`GitHub 回應 ${res.status}：${await res.text()}`);
      return reply(502, { ok: false, error: `帳本暫時無法收下這筆紀錄（GitHub ${res.status}）` }, origin);
    }

    const issue = await res.json();
    return reply(200, { ok: true, number: issue.number }, origin);
  },
};
