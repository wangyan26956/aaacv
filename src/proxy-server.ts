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

// ---- Streaming Tool Block Parser ----
// Parses <tool name="xxx">JSON</tool> from streaming text and emits
// proper Anthropic tool_use content blocks. Handles partial tags.

function makeTooluId(): string {
  return 'toolu_' + genId().replace(/-/g, '').slice(0, 8);
}

interface ContentBlock {
  idx: number;
  type: 'text' | 'tool_use';
  closed: boolean;
  toolName?: string;
  toolId?: string;
}

function makeTranslator(res: http.ServerResponse, msgId: string, onDone: () => void): (raw: string) => void {
  let buf = '', fullText = '', fullThink = '', thinkIdx = -1;
  let totalTokens = 0;
  let nextIdx = 1; // next available content block index (0 = thinking)
  let curBlock: ContentBlock | null = null;
  let lastSafePos = 0; // position in fullText that has been safely emitted

  // Regex for complete tool blocks (same as tools.ts)
  const TOOL_RE = /<tool\s+name="([^"]+)"\s*>\s*\n?([\s\S]*?)\n?\s*<\/tool>/g;

  const flushThink = () => {
    if (thinkIdx >= 0) {
      res.write(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${thinkIdx}}\n\n`);
      thinkIdx = -1;
    }
  };

  const closeBlock = () => {
    if (curBlock && !curBlock.closed) {
      curBlock.closed = true;
      res.write(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${curBlock.idx}}\n\n`);
    }
    curBlock = null;
  };

  const openTextBlock = () => {
    if (curBlock?.type === 'text' && !curBlock.closed) return; // already open
    closeBlock();
    curBlock = { idx: nextIdx++, type: 'text', closed: false };
    res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":${curBlock.idx},"content_block":{"type":"text","text":""}}\n\n`);
  };

  const emitText = (t: string) => {
    if (!t) return;
    openTextBlock();
    res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":${curBlock!.idx},"delta":{"type":"text_delta","text":${JSON.stringify(t)}}}\n\n`);
  };

  const emitToolBlock = (name: string, argsJson: string) => {
    let args: Record<string, unknown>;
    try { args = JSON.parse(argsJson); } catch { return false; } // invalid JSON → treat as text
    closeBlock();
    const toolId = makeTooluId();
    curBlock = { idx: nextIdx++, type: 'tool_use', closed: false, toolName: name, toolId };
    res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":${curBlock.idx},"content_block":{"type":"tool_use","id":"${toolId}","name":"${name}","input":{}}}\n\n`);
    const jsonStr = JSON.stringify(args);
    res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":${curBlock.idx},"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(jsonStr)}}}\n\n`);
    closeBlock();
    return true;
  };

  // Process newly available text, emitting completed segments
  const processSegments = () => {
    const unprocessed = fullText.slice(lastSafePos);
    if (!unprocessed) return;

    // Find all complete <tool>...</tool> blocks in the unprocessed region
    const toolMatches: Array<{ start: number; end: number; name: string; argsJson: string }> = [];
    TOOL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TOOL_RE.exec(unprocessed)) !== null) {
      toolMatches.push({ start: m.index, end: m.index + m[0].length, name: m[1], argsJson: m[2].trim() });
    }

    if (toolMatches.length === 0) {
      // No complete tool blocks. Check if a partial <tool tag is starting.
      const partialIdx = unprocessed.search(/<tool\s/);
      if (partialIdx !== -1) {
        // Emit safe text before the partial tag
        emitText(unprocessed.slice(0, partialIdx));
        lastSafePos += partialIdx;
        return;
      }
      // No tool tags at all — emit everything
      emitText(unprocessed);
      lastSafePos += unprocessed.length;
      return;
    }

    // Process text between tool blocks
    let cursor = 0;
    for (const tm of toolMatches) {
      const before = unprocessed.slice(cursor, tm.start);
      emitText(before);

      // Try to emit as tool_use; fall back to text if JSON is invalid
      if (!emitToolBlock(tm.name, tm.argsJson)) {
        emitText(unprocessed.slice(tm.start, tm.end));
      }
      cursor = tm.end;
    }
    lastSafePos += cursor;

    // After last complete tool block, check for trailing partial tag
    const trailing = unprocessed.slice(cursor);
    const partialIdx = trailing.search(/<tool\s/);
    if (partialIdx !== -1) {
      emitText(trailing.slice(0, partialIdx));
      lastSafePos += partialIdx;
    } else {
      emitText(trailing);
      lastSafePos += trailing.length;
    }
  };

  return (raw: string) => {
    buf += raw; const lines = buf.split('\n'); buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const p = line.slice(6).trim();
      if (DEBUG) hdr('AIA SSE:', p.slice(0, 200));
      if (p === '[DONE]') {
        flushThink();
        // Emit any remaining unprocessed text
        const remaining = fullText.slice(lastSafePos);
        if (remaining.trim()) { emitText(remaining); lastSafePos += remaining.length; }
        closeBlock();
        const outTokens = totalTokens || Math.ceil(fullText.length / 2.5);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { input_tokens: 0, output_tokens: outTokens } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
        return onDone();
      }
      try {
        const ev = JSON.parse(p);
        const mt = ev.message_type;
        const think = ev.thinking || '';
        const rawText: string = ev.gpt_response || '';

        // Only emit text when message_type is 4 or 5 (matches AIA client logic)
        const text = (mt === 4 || mt === 5) ? rawText : '';
        if (ev.total_tokens) totalTokens = ev.total_tokens;

        // Thinking
        if (think && think !== fullThink) {
          const d = think.slice(fullThink.length); if (!d) continue;
          if (thinkIdx < 0) { thinkIdx = 0; res.write(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n`); }
          res.write(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":${JSON.stringify(d)}}}\n\n`);
          fullThink = think;
        }

        // Text — with tool-block parsing
        if (text && text !== fullText) {
          flushThink();
          fullText = text;
          processSegments();
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

      // Anthropic Messages API requires message_start as the very first event
      const msgId = 'msg_' + genId();
      res.write(`event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: { id: msgId, type: 'message', role: 'assistant', content: [], model: PROXY_MODEL, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
      })}\n\n`);

      const { question, history } = convertMessages(parsed);

      const onData = makeTranslator(res, msgId, () => { hdr(`#${n} stream done`); res.end(); });
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
