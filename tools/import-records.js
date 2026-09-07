#!/usr/bin/env node
/**
 * 把外部帳本（例如中國大陸版）匯出的紀錄，逐筆建立成 GitHub Issue，
 * 交由既有的 record-to-ledger 流程寫入帳本。
 *
 *   node tools/import-records.js <匯出檔.json> [--dry-run] [--limit N] [--interval 秒]
 *
 * 設計要點
 * - 只走 Issue 這一條路，不直接改 data/ledger.json。帳本永遠只有一個寫入者。
 * - 逐筆送出並間隔等待，讓每個 workflow 跑完再送下一筆，避免推送競爭
 *   與 GitHub 建立內容的次級速率限制。
 * - 以 tools/imported-ids.json 記錄已匯入的來源編號，重跑不會重複匯入。
 *
 * 匯出檔格式見 docs/CN_LEDGER_SPEC.md。
 */

const fs = require('fs');
const path = require('path');

const REPO = 'Alexchiachi/happiness-ledger';
const MANIFEST = path.join(__dirname, 'imported-ids.json');
const VALID_SOURCES = /^[a-z0-9][a-z0-9_-]{0,15}$/;

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const limit = Number((args.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || Infinity;
const interval = Number((args.find(a => a.startsWith('--interval=')) || '').split('=')[1]) || 25;

if (!file) {
  console.error('用法：node tools/import-records.js <匯出檔.json> [--dry-run] [--limit=N] [--interval=秒]');
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN;
if (!token && !dryRun) {
  console.error('缺少環境變數 GITHUB_TOKEN（需具備該 repo 的 Issues 寫入權限）。');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 逐欄位驗證單筆紀錄，回傳錯誤訊息陣列（空陣列代表通過）。 */
function validate(rec, idx) {
  const errs = [];
  const at = `第 ${idx + 1} 筆`;
  if (!rec || typeof rec !== 'object') return [`${at}：不是物件`];

  if (typeof rec.id !== 'string' || !rec.id.trim()) errs.push(`${at}：id 必須是非空字串`);
  if (typeof rec.author !== 'string' || !rec.author.trim()) errs.push(`${at}：author 必須是非空字串`);
  if (typeof rec.content !== 'string' || !rec.content.trim()) errs.push(`${at}：content 必須是非空字串`);
  if (typeof rec.category !== 'string' || !rec.category.trim()) errs.push(`${at}：category 必須是非空字串`);

  if (typeof rec.date !== 'string' || isNaN(new Date(rec.date).getTime())) {
    errs.push(`${at}：date 必須是可解析的 ISO 8601 字串`);
  }
  if (typeof rec.source !== 'string' || !VALID_SOURCES.test(rec.source)) {
    errs.push(`${at}：source 必須是小寫英數字代號（例如 "cn"）`);
  }
  if (typeof rec.author === 'string' && rec.author.length > 40) errs.push(`${at}：author 超過 40 字`);
  if (typeof rec.content === 'string' && rec.content.length > 2000) errs.push(`${at}：content 超過 2000 字`);
  return errs;
}

function buildIssue(rec) {
  const body =
    `### 您的稱呼 / 筆名\n\n${rec.author}\n\n` +
    `### 幸福微類型\n\n${rec.category}\n\n` +
    `### 幸福感知內容\n\n${rec.content}\n\n` +
    `### 原始存入時間\n\n${new Date(rec.date).toISOString()}\n\n` +
    `### 來源\n\n${rec.source}\n\n` +
    `### 原始編號\n\n${rec.id}`;
  return { title: `【幸福存入】: ${rec.author} 的微光覺察`, body, labels: ['happiness-record'] };
}

async function createIssue(payload) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'happiness-ledger-import'
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub 回應 ${res.status}：${text.slice(0, 300)}`);
  return JSON.parse(text);
}

(async () => {
  const records = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(records)) {
    console.error('匯出檔最外層必須是陣列。');
    process.exit(1);
  }

  // 先整批驗證，有錯就整批不做 —— 寧可一筆都不匯入，也不要匯入一半。
  const errors = records.flatMap(validate);
  if (errors.length) {
    console.error(`驗證未通過，共 ${errors.length} 項問題：`);
    errors.slice(0, 20).forEach(e => console.error('  ' + e));
    if (errors.length > 20) console.error(`  …另有 ${errors.length - 20} 項`);
    process.exit(1);
  }

  const seen = new Set(records.map(r => `${r.source}:${r.id}`));
  if (seen.size !== records.length) {
    console.error('匯出檔內有重複的 source + id 組合。');
    process.exit(1);
  }

  let imported = [];
  if (fs.existsSync(MANIFEST)) imported = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const already = new Set(imported.map(r => r.key));

  const pending = records.filter(r => !already.has(`${r.source}:${r.id}`)).slice(0, limit);

  console.log(`匯出檔共 ${records.length} 筆，已匯入 ${records.length - pending.length} 筆，待匯入 ${pending.length} 筆。`);
  if (dryRun) {
    console.log('\n--dry-run：只顯示，不建立任何 Issue。\n');
    pending.forEach((r, i) => {
      console.log(`[${i + 1}] ${r.source}:${r.id}  ${new Date(r.date).toISOString()}  ${r.author} / ${r.category}`);
      console.log(`    ${r.content.replace(/\n/g, ' ').slice(0, 60)}…`);
    });
    return;
  }
  if (!pending.length) return;

  console.log(`每筆間隔 ${interval} 秒送出，預估 ${Math.ceil(pending.length * interval / 60)} 分鐘。\n`);

  for (let i = 0; i < pending.length; i++) {
    const rec = pending[i];
    try {
      const issue = await createIssue(buildIssue(rec));
      imported.push({
        key: `${rec.source}:${rec.id}`,
        issue: issue.number,
        imported_at: new Date().toISOString()
      });
      fs.writeFileSync(MANIFEST, JSON.stringify(imported, null, 2) + '\n', 'utf8');
      console.log(`[${i + 1}/${pending.length}] ${rec.source}:${rec.id} → issue #${issue.number}`);
    } catch (err) {
      console.error(`[${i + 1}/${pending.length}] ${rec.source}:${rec.id} 失敗：${err.message}`);
      console.error('已中止。清單已存檔，修正後重跑會從這一筆繼續。');
      process.exit(1);
    }
    if (i < pending.length - 1) await sleep(interval * 1000);
  }

  console.log(`\n完成。請 commit tools/imported-ids.json。`);
})();
