// 麦门会餐 · 麦当劳官方 MCP 客户端
// 协议：Streamable HTTP，参考 https://modelcontextprotocol.io/specification/2025-06-18
// 说明：连接检查实现（../contest-setup/mcd.mjs）由 Codex 准备；本文件为业务实现，由 WorkBuddy 独立编写，
//       增加了工具注册、inputSchema 校验、tools/call、超时分类与错误脱敏。

import { validate as validateJsonSchema } from './schema.mjs';
export const ALLOWED_TOOLS = Object.freeze(['query-nearby-stores', 'query-meals', 'query-meal-detail', 'query-store-coupons', 'calculate-price']);
const MCP_URL = 'https://mcp.mcd.cn';
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export class McpError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = 'McpError';
    this.kind = kind; // 'auth' | 'timeout' | 'network' | 'protocol' | 'tool'
    this.detail = detail; // 脱敏后的补充信息（绝不包含 Token 或原始响应体）
  }
}

/**
 * 读取凭据：优先环境变量 MCD_MCP_TOKEN，其次 .local/config.json 的 token 字段。
 * 返回 { token, source } 或 { token: null, source: null }。绝不回传 Token 本身到调用方以外。
 */
export async function loadCredential(env = process.env, readFile = defaultReadFile, cwd = process.cwd()) {
  if (env.MCD_MCP_TOKEN && env.MCD_MCP_TOKEN.trim()) {
    return { token: env.MCD_MCP_TOKEN.trim(), source: 'env' };
  }
  try {
    const raw = await readFile(`${cwd}/.local/config.json`, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg && typeof cfg.token === 'string' && cfg.token.trim()) {
      return { token: cfg.token.trim(), source: '.local/config.json' };
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      throw new McpError('auth', '本地凭据文件存在但无法解析，请检查 .local/config.json 的 JSON 格式。');
    }
  }
  return { token: null, source: null };
}

async function defaultReadFile(path, encoding) {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, encoding);
}

/**
 * 创建一个已初始化的 MCP 会话。
 */
export async function connectMcp(token, options = {}) {
  const timeoutMs = options.timeoutMs ?? 25000;
  const fetcher = options.fetcher ?? fetch;
  let nextId = 0;
  let session = null;
  let version = null;

  async function rpc(method, params, { notification = false, timeout = timeoutMs } = {}) {
    const id = notification ? undefined : ++nextId;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (session) headers['Mcp-Session-Id'] = session;
    if (version) headers['MCP-Protocol-Version'] = version;
    const body = JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, ...(params ? { params } : {}) });
    const signal = AbortSignal.timeout(timeout);
    let res;
    try {
      res = await fetcher(MCP_URL, { method: 'POST', redirect: 'error', signal, headers, body });
    } catch (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new McpError('timeout', '麦当劳 MCP 请求超时，请稍后重试。', { method });
      }
      throw new McpError('network', '无法连接麦当劳 MCP 服务，请检查网络。', { method });
    }
    if (res.status === 401 || res.status === 403) {
      throw new McpError('auth', `麦当劳 MCP 认证失败（HTTP ${res.status}），请检查 Token 是否已激活。`, { status: res.status });
    }
    if (!res.ok) {
      throw new McpError('network', `麦当劳 MCP HTTP ${res.status}，请稍后重试。`, { status: res.status, method });
    }
    session = res.headers.get('Mcp-Session-Id') || session;
    if (notification) {
      await res.body?.cancel();
      return;
    }
    let data;
    if ((res.headers.get('Content-Type') || '').includes('text/event-stream')) {
      data = await readSseResponse(res, id, method);
    } else {
      try {
        data = await res.json();
      } catch {
        throw new McpError('protocol', '麦当劳 MCP 返回了无法解析的响应。', { method });
      }
    }
    if (data.id !== id) throw new McpError('protocol', '麦当劳 MCP 响应标识不匹配。', { method });
    if (data.error) {
      // 不把上游原始 message 回传，避免错误首行夹带手机号、地址或凭据片段。
      throw new McpError('tool', `麦当劳 MCP 工具调用失败（错误码 ${String(data.error.code ?? 'unknown')}）。`, { method, code: data.error.code });
    }
    return data.result;
  }

  const init = await rpc('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'maimen-huican', version: '0.1.0' },
  });
  version = init.protocolVersion;
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new McpError('protocol', 'MCP 协议版本尚不兼容。', { version });
  }
  await rpc('notifications/initialized', undefined, { notification: true });

  // tools/list 分页读取
  const tools = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const result = await rpc('tools/list', cursor ? { cursor } : {});
    tools.push(...(result.tools ?? []));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  if (cursor) throw new McpError('protocol', '工具目录分页超过预期。', {});

  return {
    serverInfo: init.serverInfo,
    protocolVersion: version,
    tools,
    /** 按真实 inputSchema 校验参数并调用工具 */
    async callTool(name, args) {
      if (!ALLOWED_TOOLS.includes(name)) throw new McpError('policy', '本版本禁止调用此工具。');
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        throw new McpError('tool', `服务端未提供工具 ${name}。`, { available: tools.map((t) => t.name) });
      }
      const schemaProblems = validateJsonSchema(args ?? {}, tool.inputSchema ?? {});
      if (schemaProblems.length) {
        throw new McpError('tool', `调用 ${name} 的参数不符合服务端 inputSchema，已停止请求。`, { problems: schemaProblems.slice(0, 10) });
      }
      const result = await rpc('tools/call', { name, arguments: args ?? {} });
      if (result && result.isError) {
        throw new McpError('tool', `工具 ${name} 执行失败。`, { method: 'tools/call', tool: name });
      }
      return result;
    },
    close() {
      session = null;
    },
  };
}

async function readSseResponse(res, id, method) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data;
  try {
    while (!data) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const text = frame.split('\n').filter((x) => x.startsWith('data:')).map((x) => x.slice(5).trimStart()).join('\n');
        if (!text) continue;
        const event = JSON.parse(text);
        if (event.id === id) {
          data = event;
          break;
        }
      }
      if (chunk.done && !data) throw new McpError('timeout', '麦当劳 MCP 未返回完整响应。', { method });
    }
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError('network', '读取麦当劳 MCP 响应流失败。', { method });
  } finally {
    await reader.cancel().catch(() => {});
  }
  return data;
}

/** 从 tools/call 结果中提取文本（用于错误摘要） */
export function extractText(result) {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

/** 只保留首行并截断，避免把服务端原始内容（可能含个人信息）写入日志 */
export function summarizeError(text) {
  if (typeof text !== 'string') return '未知错误';
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  return line.length > 120 ? `${line.slice(0, 120)}…` : line || '未知错误';
}

/**
 * 按真实 inputSchema 校验参数（required、type、enum）。只做基础校验，不猜服务端未声明的字段。
 */
export function validateAgainstSchema(args, schema, prefix = '') {
  const problems = [];
  if (!schema || typeof schema !== 'object') return problems;
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null) {
      problems.push(`${prefix}${key} 为必填字段`);
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const sub = schema.properties?.[key];
    if (!sub) {
      if (schema.additionalProperties === false) problems.push(`${prefix}${key} 不在服务端声明的参数中`);
      continue;
    }
    const type = Array.isArray(sub.type) ? sub.type[0] : sub.type;
    if (type && !checkType(value, type)) {
      problems.push(`${prefix}${key} 应为 ${type} 类型`);
      continue;
    }
    if (sub.enum && !sub.enum.includes(value)) {
      problems.push(`${prefix}${key} 应为以下取值之一：${sub.enum.join('、')}`);
    }
    if (type === 'array' && sub.items?.type === 'object' && Array.isArray(value)) {
      value.forEach((item, i) => problems.push(...validateAgainstSchema(item ?? {}, sub.items, `${prefix}${key}[${i}].`)));
    }
    if (type === 'object' && sub.properties && typeof value === 'object') {
      problems.push(...validateAgainstSchema(value ?? {}, sub, `${prefix}${key}.`));
    }
  }
  return problems;
}

function checkType(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'null': return value === null;
    default: return true;
  }
}
