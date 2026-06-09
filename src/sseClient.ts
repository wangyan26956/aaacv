import * as https from 'https';
import * as http from 'http';
import { getConfig } from './config';

function genId(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
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

function mkHeaders(token: string): Record<string, string> {
  return {
    authorization: token,
    referer: 'https://nfoprd-cn.aia.biz/',
    'staff_assistant-header': 'staff_assistant',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
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

export function sseRequest(
  url: string,
  question: string,
  token: string,
  skipSsl: boolean,
  onToken: (text: string) => void,
  onThinking: (text: string) => void,
): Promise<string> {
  const cfg = getConfig();
  const body = mkBody(question);
  const headers = mkHeaders(token);

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const t = u.protocol === 'https:' ? https : http;
    let full = '';

    const req = t.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        rejectUnauthorized: !skipSsl,
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6);
            if (raw.trim() === '[DONE]') return resolve(full);
            try {
              const ev: SseEvent = JSON.parse(raw);
              const txt = ev.gpt_response || '';
              const think = ev.thinking || '';
              const mt = ev.message_type;
              if (think && cfg.showThinking) onThinking(think);
              if (txt && (mt === 4 || mt === 5)) {
                const delta = txt.slice(full.length);
                if (delta) {
                  full = txt;
                  onToken(delta);
                }
              }
            } catch {
              // skip malformed SSE events
            }
          }
        });
        res.on('end', () => resolve(full));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}
