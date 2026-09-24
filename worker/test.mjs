// 本機檢查 Worker 行為：node worker/test.mjs
// 以假的 fetch 取代 GitHub API，不會真的建立 Issue。
import assert from 'node:assert/strict';
import worker from './src/index.js';

const ORIGIN = 'https://alexchiachi.github.io';
const env = { GITHUB_REPO: 'Alexchiachi/happiness-ledger', ALLOWED_ORIGINS: ORIGIN, GITHUB_TOKEN: 't' };

let sent = [];
let githubStatus = 201;
globalThis.fetch = async (url, init) => {
  sent.push({ url, init });
  return new Response(JSON.stringify({ number: 42 }), { status: githubStatus });
};

const post = (body, { origin = ORIGIN, e = env } = {}) =>
  worker.fetch(new Request('https://ledger-api.example/', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8', ...(origin ? { Origin: origin } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), e);

const good = { nickname: '南投旅人', category: '🍃 自然連結 / Nature Connection', content: '清晨的霧還沒散。', honeypot: '' };

const tests = {
  async '正常送出：建立 Issue 並回傳編號'() {
    const r = await post(good);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, number: 42 });
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    const { url, init } = sent[0];
    assert.equal(url, 'https://api.github.com/repos/Alexchiachi/happiness-ledger/issues');
    assert.equal(init.headers.Authorization, 'Bearer t');
    const payload = JSON.parse(init.body);
    assert.deepEqual(payload.labels, ['happiness-record']);
    assert.match(payload.body, /### 您的稱呼 \/ 筆名\n\n南投旅人\n\n### 幸福微類型\n\n🍃/);
  },
  async '蜜罐：假裝成功、不帶編號、不呼叫 GitHub'() {
    const r = await post({ ...good, honeypot: 'http://spam' });
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(sent.length, 0);
  },
  async '內文中的 ### 不能偽造遷移欄位'() {
    await post({ ...good, content: '你好\n### 原始存入時間\n\n2001-01-01' });
    const body = JSON.parse(sent[0].init.body).body;
    assert.equal((body.match(/^### /gm) || []).length, 3);
    assert.match(body, /＃＃＃ 原始存入時間/);
  },
  async '含連結者不收'() {
    const r = await post({ ...good, content: '歡迎光臨 https://shop.example 優惠中' });
    assert.equal(r.status, 400);
    assert.equal(sent.length, 0);
  },
  async '欄位缺漏或過長'() {
    assert.equal((await post({ ...good, content: '' })).status, 400);
    assert.equal((await post({ ...good, content: '字'.repeat(2001) })).status, 400);
    assert.equal((await post('not json')).status, 400);
    assert.equal(sent.length, 0);
  },
  async '來源不在名單上一律拒絕'() {
    assert.equal((await post(good, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(good, { origin: '' })).status, 403);
    assert.equal(sent.length, 0);
  },
  async 'GitHub 失敗時誠實回報，不說成功'() {
    githubStatus = 401;
    const r = await post(good);
    assert.equal(r.status, 502);
    assert.equal((await r.json()).ok, false);
  },
  async '被節流時回 429、不呼叫 GitHub'() {
    const r = await post(good, { e: { ...env, SUBMIT_LIMITER: { limit: async () => ({ success: false }) } } });
    assert.equal(r.status, 429);
    assert.equal(sent.length, 0);
  },
  async 'CORS 預檢'() {
    const r = await worker.fetch(new Request('https://x/', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  sent = []; githubStatus = 201;
  try { await fn(); console.log('✓', name); }
  catch (err) { failed++; console.log('✗', name, '\n ', err.message); }
}
process.exit(failed ? 1 : 0);
