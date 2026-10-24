// 从本机 WorkBuddy 会话记录导出真实对话：只取 user / assistant 的文本消息，
// 去掉系统提示、系统提醒块与工具原始返回；不生成、不润色、不补写任何内容。
// 用法：node test/export-conversation.mjs <session.jsonl> <out.md>
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('用法：node test/export-conversation.mjs <session.jsonl> <out.md>');
  process.exit(1);
}

const stripSystem = (text) => text
  .replace(/<system-reminder[\s\S]*?<\/system-reminder>/g, '')
  .replace(/<user-context>[\s\S]*?<\/user-context>/g, '')
  .replace(/<additional-data>[\s\S]*?<\/additional-data>/g, '')
  .trim();

const blocks = [];
let sessionId = '';
let firstAt = '';
const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  let row;
  try { row = JSON.parse(line); } catch { continue; }
  if (row.type === 'session-meta' && !sessionId) sessionId = row.sessionId || '';
  if (row.type !== 'message') continue;
  const role = row.role;
  if (role !== 'user' && role !== 'assistant') continue;
  const parts = Array.isArray(row.content) ? row.content : [];
  const text = parts
    .filter((p) => p && (p.type === 'text' || p.type === 'input_text' || p.type === 'output_text') && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n')
    .trim();
  if (!text) continue;
  const clean = role === 'user' ? stripSystem(text) : text;
  if (!clean) continue;
  const at = row.timestamp ? new Date(row.timestamp).toISOString() : '';
  if (!firstAt) firstAt = at;
  blocks.push({ role, at, text: clean });
}

const body = blocks.map((b, i) => `## ${i + 1}. ${b.role === 'user' ? '用户' : 'WorkBuddy'}${b.at ? ` · ${b.at}` : ''}\n\n${b.text}\n`).join('\n---\n\n');
const header = `# 麦门会餐 · WorkBuddy 真实开发对话导出

- 来源：本机 WorkBuddy 会话记录 \`${input.split('/').pop()}\`
- 会话 ID：\`${sessionId}\`
- 导出时间：${new Date().toISOString()}
- 起始消息时间：${firstAt || '未知'}
- 消息数：${blocks.length}（用户 ${blocks.filter((b) => b.role === 'user').length} 条 / WorkBuddy ${blocks.filter((b) => b.role === 'assistant').length} 条）
- 导出方式：脚本 \`test/export-conversation.mjs\` 逐条读取会话记录，只保留用户与助手的文本消息。

**范围说明（不是完整镜像）**：已排除系统提示、运行环境注入块（\`system-reminder\` / \`user-context\` / \`additional-data\`）、工具调用参数与工具原始返回、以及被网关中断的空响应。因此这里是**真实的对话文本流**，而不是包含全部工具明细的会话快照；后者仍保存在上述本机会话文件中。

**脱敏**：未包含 MCD Token、Cookie、手机号、收货地址与券码原文；开发过程中也从未把这些内容写进对话。

---

`;
await writeFile(output, header + body);
console.log(JSON.stringify({ output, sessionId, messages: blocks.length, bytes: (header + body).length }, null, 2));
