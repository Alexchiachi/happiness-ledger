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

// 以 Issue 建立時間為準，而非執行時間：這是使用者實際存入的時刻，
// 也讓重試產生的內容完全一致。
const dateStr = new Date(issue.created_at || Date.now()).toISOString();

const extractSection = (heading) => {
  const regex = new RegExp(`### ${heading}[\\s\\S]*?\\n([\\s\\S]*?)(?=###|$)`);
  const match = body.match(regex);
  return match ? match[1].trim() : '';
};

const nickname = extractSection('您的稱呼 / 筆名') || extractSection('您的稱呼') || extractSection('Your Name / Moniker') || issue.user?.login || '匿名旅人';
const category = extractSection('幸福微類型') || extractSection('Micro-Category') || '✨ 幸福微光';
const content = extractSection('幸福感知內容') || extractSection('Your Moment of Awareness') || body || '無感知內容';

const dataDir = path.join(process.env.GITHUB_WORKSPACE || process.cwd(), 'data');
const recordDir = path.join(dataDir, 'records');
if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true });

// JSON.stringify 產出合法的 YAML 雙引號字串，暱稱或類型含引號時不會破壞 frontmatter。
const fileName = `${dateStr.split('T')[0]}-record-${issueNumber}.md`;
const mdContent = `---\nid: ${issueNumber}\ndate: ${dateStr}\nauthor: ${JSON.stringify(nickname)}\ncategory: ${JSON.stringify(category)}\n---\n\n${content}\n`;
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
ledger.unshift({ id: issueNumber, date: dateStr, author: nickname, category: category, content: content });

fs.writeFileSync(jsonPath, JSON.stringify(ledger, null, 2), 'utf8');
console.log(`已寫入紀錄 #${issueNumber}（${nickname} / ${category}）`);
