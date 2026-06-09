/**
 * AIA → Anthropic Messages API proxy.
 * Lets Claude Code VSCode use internal AIA API.
 *
 * Usage:
 *   $env:AIA_TOKEN = "your-jwt"
 *   npm run proxy
 *
 * Claude Code settings.json:
 *   { "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:9999", "ANTHROPIC_AUTH_TOKEN": "x" } }
 */

import * as http from 'http';
import * as https from 'https';

const AIA_TOKEN = process.env.AIA_TOKEN || '';
const AIA_BASE_URL = process.env.AIA_BASE_URL || 'https://jvs-cn.aia.biz/p/staff_assistant/baixiaosheng/model_ask_question';
const AIA_KB_ID = process.env.AIA_KB_ID || 'deepseek';
const PROXY_MODEL = 'claude-sonnet-4-6';
const PORT = parseInt(process.env.PROXY_PORT || '9999', 10);
const DEBUG = process.env.DEBUG === '1';

function genId(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Strip Anthropic billing/metadata headers injected into system prompt
function cleanSystemText(s: string): string {
  return s.replace(/^x-anthropic-billing-header:[^\n]*\n?/gm, '')
          .replace(/^anthropic-beta:[^\n]*\n?/gm, '')
          .replace(/^anthropic-version:[^\n]*\n?/gm, '');
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b: any) => {
      if (b.type === 'text') return b.text || '';
      if (b.type === 'image') return '[Image]';
      if (b.type === 'tool_use') return `[Tool: ${b.name} ${JSON.stringify(b.input)}]`;
      if (b.type === 'tool_result') return `[Tool Result: ${JSON.stringify(b.content)}]`;
      return '';
    }).join('\n');
  }
  return String(content || '');
}

function convertMessages(body: any): { question: string; history: any[] } {
  const parts: string[] = [];
  const system = body.system;
  if (typeof system === 'string') parts.push(cleanSystemText(system));
  else if (Array.isArray(system)) {
    for (const b of system) {
      if (b.type === 'text') { const cleaned = cleanSystemText(b.text); if (cleaned) parts.push(cleaned); }
    }
  }
  if (Array.isArray(body.tools)) {
    parts.push('\nAvailable tools:\n' + body.tools.map((t: any) =>
      `Tool: ${t.name} - ${t.description || ''}\nParams: ${JSON.stringify(t.input_schema || {})}`).join('\n'));
  }
  const messages = body.messages || [];
  const history: any[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]; const text = extractText(m.content);
    if (i === messages.length - 1 && m.role === 'user') parts.push(text);
    else history.push({ role: m.role, content: text });
  }
  return { question: parts.join('\n\n'), history };
}

function callAia(question: string, history: any[], onData: (c: string) => void, onEnd: () => void, onErr: (e: Error) => void): void {
  const body = JSON.stringify({ code: 'direct_model', question: question + '\n', history, kb_id: AIA_KB_ID, chat_id: genId(), reasoning_model: 1, web_search: 0, regenerate: 0, quote_message_id: '' });
  const u = new URL(AIA_BASE_URL);
  const t = u.protocol === 'https:' ? https : http;
  const req = t.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search, method: 'POST', rejectUnauthorized: false,
    headers: { authorization: AIA_TOKEN, referer: 'https://nfoprd-cn.aia.biz/', 'staff_assistant-header': 'staff_assistant', 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  }, res => { res.on('data', (c: Buffer) => onData(c.toString())); res.on('end', onEnd); res.on('error', onErr); });
  req.on('error', onErr); req.write(body); req.end();
}

function makeTranslator(res: http.ServerResponse, onDone: () => void): (raw: string) => void {
  let buf = '', fullText = '', fullThink = '', textIdx = -1, thinkIdx = -1;

  const flushThink = () => { if (thinkIdx >= 0) { res.write(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${thinkIdx}}\n\n`); thinkIdx = -1; } };
  const flushText = () => { if (textIdx >= 0) { res.write(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${textIdx}}\n\n`); textIdx = -1; } };

  return (raw: string) => {
    buf += raw; const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const p = line.slice(6).trim();
      if (p === '[DONE]') {
        flushThink(); flushText();
        res.write(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":0,"output_tokens":0}}\n\n`);
        res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
        return onDone();
      }
      try {
        const ev = JSON.parse(p);
        if (DEBUG) console.log('[proxy] AIA event:', JSON.stringify(ev).slice(0, 200));
        const think = ev.thinking || '';
        const text = ev.gpt_response || '';
        if (think && think !== fullThink) {
          const d = think.slice(fullThink.length); if (!d) continue;
          if (thinkIdx < 0) { thinkIdx = 0; res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n`); }
          res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":${JSON.stringify(d)}}}\n\n`);
          fullThink = think;
        }
        if (text && text !== fullText) {
          const d = text.slice(fullText.length); if (!d) continue;
          if (thinkIdx >= 0) flushThink();
          if (textIdx < 0) { textIdx = 1; res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n`); }
          res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":${JSON.stringify(d)}}}\n\n`);
          fullText = text;
        }
      } catch { /* skip */ }
    }
  };
}

function log(method: string | undefined, url: string, status: number, extra?: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${method || '?'} ${url} -> ${status}${extra ? ' ' + extra : ''}`);
}

// ---- Server ----
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const rawUrl = req.url || '/';
  const path = rawUrl.split('?')[0];

  // /v1/models
  if (path === '/v1/models' && req.method === 'GET') {
    log('GET', rawUrl, 200);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        { id: PROXY_MODEL, type: 'model', display_name: 'Claude Sonnet 4.6 (via AIA)' },
        { id: 'claude-opus-4-7', type: 'model', display_name: 'Claude Opus 4.7 (via AIA)' },
        { id: 'claude-haiku-4-5-20251001', type: 'model', display_name: 'Claude Haiku 4.5 (via AIA)' },
      ],
    }));
    return;
  }

  // Health
  if (path === '/' || path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', provider: 'aia', kbId: AIA_KB_ID }));
    return;
  }

  // /v1/messages/count_tokens
  if (path === '/v1/messages/count_tokens' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      log('POST', rawUrl, 200, `input_tokens=${Math.ceil(body.length / 3)}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ input_tokens: Math.ceil(body.length / 3) }));
    });
    return;
  }

  // /v1/messages
  if (path === '/v1/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      let parsed: any;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      const stream = parsed.stream !== false;
      log('POST', rawUrl, 200, stream ? '(stream)' : '(sync)');

      if (!stream) {
        const { question, history } = convertMessages(parsed);
        let full = '';
        callAia(question, history, c => { const m = c.match(/"gpt_response"\s*:\s*"((?:[^"\\]|\\.)*)"/); if (m) full = m[1]; },
          () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'msg_' + genId(), type: 'message', role: 'assistant', model: PROXY_MODEL, content: [{ type: 'text', text: full }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }));
          },
          err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

      const { question, history } = convertMessages(parsed);
      console.log(`[proxy] q(${question.length}c): ${question.slice(0, 120).replace(/\n/g, '\\n')}...`);

      const onData = makeTranslator(res, () => { console.log('[proxy] AIA stream done'); res.end(); });
      callAia(question, history, onData,
        () => { console.log('[proxy] AIA connection closed'); res.end(); },
        err => {
        console.error('[proxy] AIA error:', err.message);
        res.write(`event: error\ndata: {"type":"error","error":{"message":${JSON.stringify(err.message)}}}\n\n`);
        res.end();
      });
    });
    return;
  }

  log(req.method, rawUrl, 404);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AIA -> Anthropic proxy: http://127.0.0.1:${PORT}`);
  console.log(`  KB ID   : ${AIA_KB_ID}`);
  console.log(`  Model   : ${PROXY_MODEL}`);
  console.log(`  Token   : ${AIA_TOKEN ? 'OK' : 'NOT SET'}`);
  console.log(`\n  settings.json:`);
  console.log(`  { "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:${PORT}", "ANTHROPIC_AUTH_TOKEN": "x" } }\n`);
});
