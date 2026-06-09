import * as https from 'https';
import * as http from 'http';
import { getConfig } from './config';

function genId(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export type StreamCallback = (token: string) => void;
export type ThinkCallback = (think: string) => void;

// ========== AIA (internal API) ==========

function sseRequestAia(
  url: string,
  question: string,
  cfg: ReturnType<typeof getConfig>,
  onToken: StreamCallback,
  onThink: ThinkCallback,
): Promise<string> {
  const body = {
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

  const headers: Record<string, string> = {
    authorization: cfg.token,
    referer: 'https://nfoprd-cn.aia.biz/',
    'staff_assistant-header': 'staff_assistant',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };

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
        headers,
        rejectUnauthorized: !cfg.verifySsl,
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
              const ev = JSON.parse(raw);
              const txt = ev.gpt_response || '';
              const think = ev.thinking || '';
              const mt = ev.message_type;
              if (think && cfg.showThinking) onThink(think);
              if (txt && (mt === 4 || mt === 5)) {
                const delta = txt.slice(full.length);
                if (delta) {
                  full = txt;
                  onToken(delta);
                }
              }
            } catch {
              // skip malformed
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

// ========== Qwen (DashScope OpenAI-compatible API) ==========

function sseRequestQwen(
  question: string,
  cfg: ReturnType<typeof getConfig>,
  onToken: StreamCallback,
  onThink: ThinkCallback,
): Promise<string> {
  const messages = [{ role: 'user', content: question }];

  const body = JSON.stringify({
    model: cfg.qwenModel || 'qwen-plus',
    messages,
    stream: true,
    stream_options: { include_usage: true },
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.qwenApiKey}`,
    Accept: 'text/event-stream',
  };

  const baseUrl = cfg.qwenBaseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const url = baseUrl + '/chat/completions';
  const u = new URL(url);

  return new Promise((resolve, reject) => {
    const t = u.protocol === 'https:' ? https : http;
    let full = '';

    const req = t.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'POST',
        headers,
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') return resolve(full);
            try {
              const ev = JSON.parse(raw);
              const choice = ev.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta;
              if (!delta) continue;

              // Reasoning/thinking (qwen3 models use reasoning_content)
              const thinking = delta.reasoning_content || '';
              if (thinking && cfg.showThinking) {
                onThink(thinking);
              }

              // Content token
              const content = delta.content || '';
              if (content) {
                full += content;
                onToken(content);
              }

              // Handle finish_reason early resolve
              if (choice.finish_reason === 'stop') {
                resolve(full);
              }
            } catch {
              // skip malformed
            }
          }
        });
        res.on('end', () => resolve(full));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ========== Unified entry point ==========

export function chat(
  question: string,
  onToken: StreamCallback,
  onThink: ThinkCallback,
): Promise<string> {
  const cfg = getConfig();
  const provider = cfg.provider || 'aia';

  if (provider === 'qwen') {
    if (!cfg.qwenApiKey) {
      return Promise.reject(new Error('Qwen API key not set. Configure claudeCode.qwenApiKey in settings.'));
    }
    return sseRequestQwen(question, cfg, onToken, onThink);
  }

  // Default: AIA
  if (!cfg.token) {
    return Promise.reject(new Error('AIA token not set. Configure claudeCode.token in settings.'));
  }
  return sseRequestAia(cfg.baseUrl, question, cfg, onToken, onThink);
}
