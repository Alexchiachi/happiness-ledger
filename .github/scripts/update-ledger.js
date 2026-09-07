// 從 Issue 事件解析一筆幸福紀錄，寫入 data/records/*.md 與 data/ledger.json。
// 設計為可重複執行（idempotent）：workflow 在 push 被拒時會重置到最新的
// origin/main 後再次呼叫本腳本，因此同一個 Issue 重跑任意次數結果都相同。

const fs = require('fs');
const path = require('path');

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath || !fs.existsSync(eventPath)) {
  console.log('找不到事件資料，略過。');
  process.exit(0);
}

const issue = JSON.parse(fs.readFileSync(eventPath, 'utf8')).issue;
if (!issue) {
  console.log('此次執行沒有對應的 Issue（例如手動觸發），略過。');
  process.exit(0);
}

const body = issue.body || '';
const issueNumber = issue.number;

const extractSection = (heading) => {
  const regex = new RegExp(`### ${heading}[\\s\\S]*?\\n([\\s\\S]*?)(?=###|$)`);
  const match = body.match(regex);
  return match ? match[1].trim() : '';
};

// 時間戳：預設用 Issue 建立時間（使用者實際存入的時刻，且重試時不變）。
// 若 Issue 帶有「原始存入時間」欄位則以它為準 —— 這是為了從別的帳本
// （例如中國大陸版）遷移紀錄時，保留當事人真正存入的那一刻，而不是
// 遷移作業當天的時間。詳見 docs/CN_LEDGER_SPEC.md。
const rawOriginalDate = extractSection('原始存入時間');
let dateStr = new Date(issue.created_at || Date.now()).toISOString();
if (rawOriginalDate) {
  const parsed = new Date(rawOriginalDate);
  if (!isNaN(parsed.getTime())) {
    dateStr = parsed.toISOString();
  } else {
    console.error(`原始存入時間無法解析，改用 Issue 建立時間：${rawOriginalDate}`);
  }
}

const nickname = extractSection('您的稱呼 / 筆名') || extractSection('您的稱呼') || extractSection('Your Name / Moniker') || issue.user?.login || '匿名旅人';
const category = extractSection('幸福微類型') || extractSection('Micro-Category') || '✨ 幸福微光';
const content = extractSection('幸福感知內容') || extractSection('Your Moment of Awareness') || body || '無感知內容';

// 遷移用的可選欄位：來源帳本代號與該帳本內的原始編號，供追溯與去重。
const source = extractSection('來源') || '';
const originId = extractSection('原始編號') || '';

const dataDir = path.join(process.env.GITHUB_WORKSPACE || process.cwd(), 'data');
const recordDir = path.join(dataDir, 'records');
if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true });

// JSON.stringify 產出合法的 YAML 雙引號字串，暱稱或類型含引號時不會破壞 frontmatter。
const fileName = `${dateStr.split('T')[0]}-record-${issueNumber}.md`;
let frontmatter = `id: ${issueNumber}\ndate: ${dateStr}\nauthor: ${JSON.stringify(nickname)}\ncategory: ${JSON.stringify(category)}`;
if (source) frontmatter += `\nsource: ${JSON.stringify(source)}`;
if (originId) frontmatter += `\norigin_id: ${JSON.stringify(originId)}`;
const mdContent = `---\n${frontmatter}\n---\n\n${content}\n`;
fs.writeFileSync(path.join(recordDir, fileName), mdContent, 'utf8');

const jsonPath = path.join(dataDir, 'ledger.json');
let ledger = [];
if (fs.existsSync(jsonPath)) {
  try {
    ledger = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    ledger = [];
  }
}
if (!Array.isArray(ledger)) ledger = [];

ledger = ledger.filter(item => item.id !== issueNumber);

const entry = { id: issueNumber, date: dateStr, author: nickname, category: category, content: content };
if (source) entry.source = source;
if (originId) entry.origin_id = originId;
ledger.push(entry);

// 依時間新到舊排序。平常每筆新紀錄都是最新的，排序結果與原本的
// unshift 相同；但遷移進來的舊紀錄若直接置頂，卡片牆的時序就亂了。
ledger.sort((a, b) => new Date(b.date) - new Date(a.date));

fs.writeFileSync(jsonPath, JSON.stringify(ledger, null, 2), 'utf8');
console.log(`已寫入紀錄 #${issueNumber}（${nickname} / ${category}）`);
