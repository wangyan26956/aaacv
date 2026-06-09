/**
 * AIA -> Anthropic Messages API proxy.
 * Lets Claude Code VSCode use internal AIA API.
 *
 * Usage:
 *   $env:AIA_TOKEN = "your-jwt"
 *   npm run proxy
 *
 * Claude Code settings.json:
 *   { "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:9999", "ANTHROPIC_AUTH_TOKEN": "x" } }
 *
 * Debug mode:  $env:DEBUG = "1"
 */

import * as http from 'http';
import * as https from 'https';

const AIA_TOKEN = process.env.AIA_TOKEN || '';
const AIA_BASE_URL = process.env.AIA_BASE_URL || 'https://jvs-cn.aia.biz/p/staff_assistant/baixiaosheng/model_ask_question';
const AIA_KB_ID = process.env.AIA_KB_ID || 'deepseek';
const PROXY_MODEL = 'claude-sonnet-4-6';
const PORT = parseInt(process.env.PROXY_PORT || '9999', 10);
const DEBUG = process.env.DEBUG === '1';
const TIMEOUT = parseInt(process.env.PROXY_TIMEOUT || '120000', 10);

let reqNum = 0;

function genId(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function hdr(msg: string, ...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`, ...args);
}

// Strip Anthropic billing/metadata lines from system prompt
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
      if (b.type === 'text') { const c = cleanSystemText(b.text); if (c) parts.push(c); }
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
  const payload = JSON.stringify({ code: 'direct_model', question: question + '\n', history, kb_id: AIA_KB_ID, chat_id: genId(), reasoning_model: 1, web_search: 0, regenerate: 0, quote_message_id: '' });
  const headers = { authorization: AIA_TOKEN, referer: 'https://nfoprd-cn.aia.biz/', 'staff_assistant-header': 'staff_assistant', 'Content-Type': 'application/json', Accept: 'text/event-stream' };

  function doRequest(urlStr: string, maxRedirects: number): void {
    const u = new URL(urlStr);
    hdr(`AIA request -> ${u.hostname}:${u.port || 443} (${payload.length}b)`);
    const t = u.protocol === 'https:' ? https : http;
    const req = t.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: 'POST', rejectUnauthorized: false, timeout: TIMEOUT,
      headers,
    }, res => {
      const code = res.statusCode || 0;
      hdr(`AIA response: ${code}`);

      // Follow redirects
      if (code >= 300 && code < 400 && maxRedirects > 0 && res.headers.location) {
        const loc = res.headers.location;
        hdr(`AIA redirect -> ${loc}`);
        // Drain and follow
        res.on('data', () => {});
        res.on('end', () => doRequest(loc, maxRedirects - 1));
        return;
      }

      if (code !== 200) {
        let errBody = '';
        res.on('data', (c: Buffer) => errBody += c.toString());
        res.on('end', () => { hdr(`AIA error ${code}: ${errBody.slice(0, 200)}`); onErr(new Error(`AIA returned ${code}`)); });
        return;
      }

      res.on('data', (c: Buffer) => onData(c.toString()));
      res.on('end', () => { hdr('AIA response end'); onEnd(); });
      res.on('error', e => { hdr('AIA response error:', e.message); onErr(e); });
    });
    req.on('timeout', () => { req.destroy(); onErr(new Error('AIA request timeout')); });
    req.on('error', e => { hdr('AIA request error:', e.message); onErr(e); });
    req.write(payload);
    req.end();
  }

  doRequest(AIA_BASE_URL, 2);
}

function makeTranslator(res: http.ServerResponse, onDone: () => void): (raw: string) => void {
  let buf = '', fullText = '', fullThink = '', textIdx = -1, thinkIdx = -1;
  let firstToken = true;

  const flushThink = () => { if (thinkIdx >= 0) { res.write(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${thinkIdx}}\n\n`); thinkIdx = -1; } };
  const flushText = () => { if (textIdx >= 0) { res.write(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${textIdx}}\n\n`); textIdx = -1; } };

  return (raw: string) => {
    buf += raw; const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const p = line.slice(6).trim();
      if (DEBUG) hdr('AIA SSE:', p.slice(0, 200));
      if (p === '[DONE]') {
        if (firstToken) { hdr('WARN: AIA returned [DONE] with 0 tokens!'); }
        flushThink(); flushText();
        res.write(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":0,"output_tokens":0}}\n\n`);
        res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
        return onDone();
      }
      try {
        const ev = JSON.parse(p);
        const think = ev.thinking || '';
        const text = ev.gpt_response || '';
        if (think && think !== fullThink) {
          firstToken = false;
          const d = think.slice(fullThink.length); if (!d) continue;
          if (thinkIdx < 0) { thinkIdx = 0; res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n`); }
          res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":${JSON.stringify(d)}}}\n\n`);
          fullThink = think;
        }
        if (text && text !== fullText) {
          firstToken = false;
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

// ---- Server ----
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const rawUrl = req.url || '/';
  const path = rawUrl.split('?')[0];
  const n = ++reqNum;

  // /v1/models
  if (path === '/v1/models' && req.method === 'GET') {
    hdr(`#${n} GET ${rawUrl} -> 200`);
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
      const tokens = Math.ceil(body.length / 3);
      hdr(`#${n} POST ${rawUrl} -> 200 (tokens=${tokens})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ input_tokens: tokens }));
    });
    return;
  }

  // /v1/messages
  if (path === '/v1/messages' && req.method === 'POST') {
    let body = '';
    hdr(`#${n} POST ${rawUrl} - waiting for body...`);

    // Timeout for body delivery
    const bodyTimer = setTimeout(() => {
      hdr(`#${n} TIMEOUT waiting for body (got ${body.length}b)`);
      res.writeHead(408, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body timeout' }));
    }, 30000);

    req.on('data', c => { body += c.toString(); });
    req.on('error', e => { hdr(`#${n} req error:`, e.message); clearTimeout(bodyTimer); });
    req.on('end', () => {
      clearTimeout(bodyTimer);
      hdr(`#${n} body received: ${body.length}b`);

      let parsed: any;
      try { parsed = JSON.parse(body); } catch (e: any) {
        hdr(`#${n} JSON parse error:`, e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON: ' + e.message }));
        return;
      }

      const stream = parsed.stream !== false;
      hdr(`#${n} -> 200 ${stream ? 'STREAM' : 'SYNC'} | model=${parsed.model || '?'} | messages=${(parsed.messages||[]).length}`);

      if (!stream) {
        const { question, history } = convertMessages(parsed);
        hdr(`#${n} sync q(${question.length}c)`);
        let full = '';
        callAia(question, history,
          c => { const m = c.match(/"gpt_response"\s*:\s*"((?:[^"\\]|\\.)*)"/); if (m) full = m[1]; },
          () => {
            hdr(`#${n} sync done (${full.length}c)`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id: 'msg_' + genId(), type: 'message', role: 'assistant', model: PROXY_MODEL, content: [{ type: 'text', text: full }], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }));
          },
          err => { hdr(`#${n} sync error:`, err.message); res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });

      const { question, history } = convertMessages(parsed);

      const onData = makeTranslator(res, () => { hdr(`#${n} stream done`); res.end(); });
      callAia(question, history, onData,
        () => { hdr(`#${n} AIA closed`); res.end(); },
        err => {
          hdr(`#${n} AIA error:`, err.message);
          try { res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: err.message } })}\n\n`); } catch {}
          res.end();
        });
    });
    return;
  }

  hdr(`#${n} ${req.method || '?'} ${rawUrl} -> 404`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  hdr(`proxy started on http://127.0.0.1:${PORT}`);
  hdr(`KB: ${AIA_KB_ID} | Model: ${PROXY_MODEL} | Token: ${AIA_TOKEN ? 'OK' : 'NOT SET'}`);
  hdr(`Timeout: ${TIMEOUT}ms`);
  if (DEBUG) hdr('DEBUG mode ON');
  console.log('');
});
