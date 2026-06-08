import * as https from 'https';
import * as http from 'http';
import { getConfig } from './config';
import { addMessage } from './chatHistory';
import { getFullContext, ctxToPrompt } from './contextProvider';

const FILE_SYSTEM_INSTRUCTION = `
You are an AI coding assistant that can CREATE and MODIFY files in the user's project.
When you want to create or overwrite a file, use this exact format:

### FILE: relative/path/to/file.ts
\`\`\`language
// file content here
\`\`\`

The user will see a [Create File] button for each code block. They expect you to actually write complete, working code files.
Always output the full file content, not partial or placeholder code.
When creating a project, output ALL necessary files in one response using multiple ### FILE: blocks.
`.trim();

function genId(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface SseEvent {
  gpt_response?: string;
  thinking?: string;
  message_type?: number;
  finished?: number;
}

function sse(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  skipSsl: boolean,
  onData: (e: SseEvent) => void,
  onDone: () => void,
  onErr: (err: Error) => void
): void {
  const u = new URL(url);
  const t = u.protocol === 'https:' ? https : http;

  const req = t.request({
    hostname: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search,
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    rejectUnauthorized: !skipSsl,
  }, res => {
    let buf = '';
    res.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw.trim() === '[DONE]') return onDone();
        try { onData(JSON.parse(raw)); } catch { /* skip */ }
      }
    });
    res.on('end', onDone);
    res.on('error', onErr);
  });
  req.on('error', onErr);
  req.write(JSON.stringify(body));
  req.end();
}

function mkHeaders(token: string): Record<string, string> {
  return {
    authorization: token,
    referer: 'https://nfoprd-cn.aia.biz/',
    'staff_assistant-header': 'staff_assistant',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
  };
}

function mkBody(question: string): Record<string, unknown> {
  const cfg = getConfig();
  return {
    code: 'direct_model',
    question: question + '\n',
    history: [],
    kb_id: cfg.kbId,
    chat_id: genId(),
    reasoning_model: cfg.reasoningModel ? 1 : 0,
    web_search: cfg.webSearch ? 1 : 0,
    regenerate: 0,
    quote_message_id: '',
  };
}

export async function streamChat(
  userMessage: string,
  onChunk: (text: string) => void,
  onThinking: (text: string) => void
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.token) {
    onChunk('**Error:** AIA token is not set.');
    return;
  }

  const ctx = await getFullContext();
  const prompt = ctxToPrompt(ctx);
  const question = `Instructions:\n${FILE_SYSTEM_INSTRUCTION}\n\nProject context:\n${prompt}\n\n---\nUser: ${userMessage}`;

  return new Promise(resolve => {
    let full = '';
    sse(
      cfg.baseUrl, mkBody(question), mkHeaders(cfg.token), cfg.verifySsl,
      (ev) => {
        const txt = ev.gpt_response || '';
        const think = ev.thinking || '';
        const mt = ev.message_type;
        if (think && cfg.showThinking) onThinking(think);
        if (txt && (mt === 4 || mt === 5)) {
          const delta = txt.slice(full.length);
          if (delta) { full = txt; onChunk(delta); }
        }
      },
      () => {
        addMessage({ role: 'user', content: userMessage, timestamp: Date.now() });
        addMessage({ role: 'assistant', content: full, timestamp: Date.now() });
        resolve();
      },
      (err) => { onChunk(`**Error:** ${err.message}`); resolve(); }
    );
  });
}

export async function runPrompt(prompt: string, extra?: string): Promise<string> {
  const cfg = getConfig();
  if (!cfg.token) return '**Error:** AIA token is not set.';

  const ctx = await getFullContext();
  let question = `Instructions:\n${FILE_SYSTEM_INSTRUCTION}\n\nProject context:\n${ctxToPrompt(ctx)}\n\n---\n${prompt}`;
  if (extra) question = `${extra}\n\n---\n${question}`;

  return new Promise(resolve => {
    let full = '';
    sse(
      cfg.baseUrl, mkBody(question), mkHeaders(cfg.token), cfg.verifySsl,
      (ev) => {
        const txt = ev.gpt_response || '';
        const mt = ev.message_type;
        if (txt && (mt === 4 || mt === 5)) full = txt;
      },
      () => {
        addMessage({ role: 'user', content: prompt, timestamp: Date.now() });
        addMessage({ role: 'assistant', content: full, timestamp: Date.now() });
        resolve(full || '_(No response)_');
      },
      (err) => resolve(`**Error:** ${err.message}`)
    );
  });
}
