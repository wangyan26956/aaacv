/**
 * AIA → Anthropic Messages API proxy.
 *
 * Usage:
 *   npx ts-node src/proxy-server.ts
 *
 * Then configure Claude Code VSCode:
 *   ANTHROPIC_BASE_URL = http://127.0.0.1:9999
 *   ANTHROPIC_AUTH_TOKEN = anything (proxy ignores it)
 *
 * Env vars (optional):
 *   AIA_TOKEN       — JWT token for AIA
 *   AIA_BASE_URL    — AIA API endpoint
 *   AIA_KB_ID       — model selector (default: deepseek)
 *   PROXY_PORT      — listen port (default: 9999)
 */

import * as http from 'http';
import * as https from 'https';

// ========== Config ==========

const AIA_TOKEN = process.env.AIA_TOKEN || '';
const AIA_BASE_URL =
  process.env.AIA_BASE_URL ||
  'https://jvs-cn.aia.biz/p/staff_assistant/baixiaosheng/model_ask_question';
const AIA_KB_ID = process.env.AIA_KB_ID || 'deepseek';
const PORT = parseInt(process.env.PROXY_PORT || '9999', 10);

// ========== Helpers ==========

function genId(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block.type === 'text') return block.text || '';
        if (block.type === 'image') return '[Image]';
        if (block.type === 'tool_use') return `[Tool: ${block.name}]`;
        if (block.type === 'tool_result') return `[Tool result: ${block.content}]`;
        return '';
      })
      .join('\n');
  }
  return String(content || '');
}

// ========== Anthropic → AIA message conversion ==========

function convertMessages(body: any): { question: string; history: any[] } {
  const parts: string[] = [];

  // System prompt
  const system = body.system;
  if (typeof system === 'string') {
    parts.push(system);
  } else if (Array.isArray(system)) {
    for (const block of system) {
      if (block.type === 'text') parts.push(block.text);
    }
  }

  // Tools as text
  if (Array.isArray(body.tools)) {
    const toolDescs = body.tools.map(
      (t: any) =>
        `Tool: ${t.name} — ${t.description || ''}\nParameters: ${JSON.stringify(t.input_schema || {})}`,
    );
    parts.push('\nAvailable tools:\n' + toolDescs.join('\n'));
  }

  // Messages
  const messages: any[] = body.messages || [];
  const history: any[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const role = msg.role;
    const text = extractText(msg.content);

    if (i === messages.length - 1 && role === 'user') {
      // Last user message → question
      parts.push(text);
    } else {
      history.push({ role, content: text });
    }
  }

  return {
    question: parts.join('\n\n'),
    history,
  };
}

// ========== AIA SSE → Anthropic SSE translation ==========

function translateAiaToAnthropic(
  res: http.ServerResponse,
  onDone: () => void,
): (raw: string) => void {
  let buf = '';
  let fullText = '';
  let fullThink = '';
  let contentBlockStarted = false;
  let thinkingBlockStarted = false;

  return (raw: string) => {
    buf += raw;
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') {
        // End thinking block if open
        if (thinkingBlockStarted) {
          res.write(
            `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
          );
          thinkingBlockStarted = false;
        }
        // End content block if open
        if (contentBlockStarted) {
          res.write(
            `event: content_block_stop\ndata: {"type":"content_block_stop","index":${thinkingBlockStarted ? 0 : 0}}\n\n`,
          );
          contentBlockStarted = false;
        }
        res.write(
          `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":0,"output_tokens":0}}\n\n`,
        );
        res.write(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
        onDone();
        return;
      }

      try {
        const ev = JSON.parse(payload);
        const think = ev.thinking || '';
        const text = ev.gpt_response || '';

        // Thinking stream
        if (think && think !== fullThink) {
          const delta = think.slice(fullThink.length);
          if (delta) {
            if (!thinkingBlockStarted) {
              res.write(
                `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n`,
              );
              thinkingBlockStarted = true;
            }
            const escaped = JSON.stringify(delta);
            res.write(
              `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":${escaped}}}\n\n`,
            );
            fullThink = think;
          }
        }

        // Content stream
        if (text && text !== fullText) {
          // If thinking block was open, close it first
          if (thinkingBlockStarted) {
            res.write(
              `event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`,
            );
            thinkingBlockStarted = false;
          }

          const delta = text.slice(fullText.length);
          if (delta) {
            if (!contentBlockStarted) {
              res.write(
                `event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n`,
              );
              contentBlockStarted = true;
            }
            const escaped = JSON.stringify(delta);
            res.write(
              `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":${escaped}}}\n\n`,
            );
            fullText = text;
          }
        }
      } catch {
        // skip malformed
      }
    }
  };
}

// ========== AIA API call ==========

function callAia(
  question: string,
  history: any[],
  onData: (chunk: string) => void,
  onEnd: () => void,
  onError: (err: Error) => void,
): void {
  const body = JSON.stringify({
    code: 'direct_model',
    question: question + '\n',
    history,
    kb_id: AIA_KB_ID,
    chat_id: genId(),
    reasoning_model: 1,
    web_search: 0,
    regenerate: 0,
    quote_message_id: '',
  });

  const headers: Record<string, string> = {
    authorization: AIA_TOKEN,
    referer: 'https://nfoprd-cn.aia.biz/',
    'staff_assistant-header': 'staff_assistant',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

  const u = new URL(AIA_BASE_URL);
  const t = u.protocol === 'https:' ? https : http;

  const req = t.request(
    {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: 'POST',
      headers,
      rejectUnauthorized: false,
    },
    (res) => {
      res.on('data', (chunk: Buffer) => onData(chunk.toString()));
      res.on('end', onEnd);
      res.on('error', onError);
    },
  );
  req.on('error', onError);
  req.write(body);
  req.end();
}

// ========== HTTP Server ==========

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', provider: 'aia', kbId: AIA_KB_ID }));
    return;
  }

  // Count tokens (dummy — Claude Code needs this)
  if (req.url === '/v1/messages/count_tokens' && req.method === 'POST') {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const approxTokens = Math.ceil(body.length / 3);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ input_tokens: approxTokens }));
    });
    return;
  }

  // Messages endpoint
  if (req.url === '/v1/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      let parsed: any;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const stream = parsed.stream !== false;

      if (!stream) {
        // Non-streaming: collect and return
        const { question, history } = convertMessages(parsed);
        let full = '';
        callAia(
          question,
          history,
          (chunk) => {
            // Parse SSE to extract text
            const match = chunk.match(/"gpt_response"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (match) full = match[1];
          },
          () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'msg_' + genId(),
                type: 'message',
                role: 'assistant',
                content: [{ type: 'text', text: full }],
                model: AIA_KB_ID,
                stop_reason: 'end_turn',
                usage: { input_tokens: 0, output_tokens: 0 },
              }),
            );
          },
          (err) => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          },
        );
        return;
      }

      // Streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const { question, history } = convertMessages(parsed);

      console.log(
        `[proxy] → AIA (${AIA_KB_ID}) q=${question.slice(0, 80)}...`,
      );

      const onData = translateAiaToAnthropic(res, () => res.end());

      callAia(question, history, onData, () => {}, (err) => {
        console.error('[proxy] AIA error:', err.message);
        res.write(
          `event: error\ndata: {"type":"error","error":{"message":${JSON.stringify(err.message)}}}\n\n`,
        );
        res.end();
      });
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  AIA → Anthropic proxy: http://127.0.0.1:${PORT}`);
  console.log(`  KB ID: ${AIA_KB_ID}`);
  console.log(`  Token: ${AIA_TOKEN ? '✓ set' : '✗ NOT SET — export AIA_TOKEN=...'}`);
  console.log(`\n  Claude Code config:`);
  console.log(`    ANTHROPIC_BASE_URL = http://127.0.0.1:${PORT}`);
  console.log(`    ANTHROPIC_AUTH_TOKEN = anything\n`);
});
