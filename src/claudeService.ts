import * as https from 'https';
import * as http from 'http';
import { getConfig } from './config';
import { addMessage } from './chatHistory';
import { getEditorContext, buildContextString } from './contextProvider';

function generateId(): string {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface SseEvent {
  gpt_response?: string;
  thinking?: string;
  message_type?: number;
  finished?: number;
}

function streamRequest(
  postUrl: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  verifySsl: boolean,
  onData: (event: SseEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void
): void {
  const parsed = new URL(postUrl);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname + parsed.search,
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    rejectUnauthorized: verifySsl,
  };

  const req = transport.request(options, (res) => {
    let buffer = '';
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr.trim() === '[DONE]') {
            onDone();
            return;
          }
          try {
            const event = JSON.parse(dataStr) as SseEvent;
            onData(event);
          } catch {
            // skip unparseable lines
          }
        }
      }
    });
    res.on('end', onDone);
    res.on('error', onError);
  });

  req.on('error', onError);
  req.write(JSON.stringify(payload));
  req.end();
}

export interface StreamChunk {
  content: string;
}

export async function streamChat(
  userMessage: string,
  onChunk: (chunk: StreamChunk) => void,
  onThinking: (text: string) => void,
  includeContext: boolean = true
): Promise<void> {
  const config = getConfig();

  if (!config.token) {
    onChunk({ content: '**Error:** AIA token is not set. Please set `claudeCode.token` in VSCode settings.' });
    return;
  }

  let question = userMessage;

  if (includeContext) {
    const ctx = getEditorContext();
    if (ctx) {
      const contextStr = buildContextString(ctx);
      question = `${contextStr}\n\n---\n\nUser question: ${userMessage}`;
    }
  }

  const payload = {
    code: 'direct_model',
    question: question + '\n',
    history: [],
    kb_id: config.kbId,
    chat_id: generateId(),
    reasoning_model: config.reasoningModel ? 1 : 0,
    web_search: config.webSearch ? 1 : 0,
    regenerate: 0,
    quote_message_id: '',
  };

  const headers: Record<string, string> = {
    authorization: config.token,
    referer: 'https://nfoprd-cn.aia.biz/',
    'staff_assistant-header': 'staff_assistant',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
  };

  return new Promise((resolve) => {
    let fullResponse = '';

    streamRequest(
      config.baseUrl,
      payload,
      headers,
      config.verifySsl,
      (event) => {
        const gptResponse = event.gpt_response || '';
        const thinking = event.thinking || '';
        const msgType = event.message_type;

        if (thinking && config.showThinking) {
          onThinking(thinking);
        }

        if (gptResponse && (msgType === 4 || msgType === 5)) {
          const newPart = gptResponse.slice(fullResponse.length);
          if (newPart) {
            fullResponse = gptResponse;
            onChunk({ content: newPart });
          }
        }
      },
      () => {
        addMessage({ role: 'user', content: userMessage, timestamp: Date.now() });
        addMessage({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
        resolve();
      },
      (err) => {
        onChunk({ content: `**Error:** ${err.message}` });
        resolve();
      }
    );
  });
}

export async function runPrompt(
  prompt: string,
  systemExtra?: string
): Promise<string> {
  const config = getConfig();

  if (!config.token) {
    return '**Error:** AIA token is not set.';
  }

  let question = prompt;
  if (systemExtra) {
    question = `${systemExtra}\n\n---\n\n${prompt}`;
  }

  const ctx = getEditorContext();
  if (ctx) {
    question = `${buildContextString(ctx)}\n\n---\n\n${question}`;
  }

  const payload = {
    code: 'direct_model',
    question: question + '\n',
    history: [],
    kb_id: config.kbId,
    chat_id: generateId(),
    reasoning_model: config.reasoningModel ? 1 : 0,
    web_search: config.webSearch ? 1 : 0,
    regenerate: 0,
    quote_message_id: '',
  };

  const headers: Record<string, string> = {
    authorization: config.token,
    referer: 'https://nfoprd-cn.aia.biz/',
    'staff_assistant-header': 'staff_assistant',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0',
  };

  return new Promise((resolve) => {
    let fullResponse = '';

    streamRequest(
      config.baseUrl,
      payload,
      headers,
      config.verifySsl,
      (event) => {
        const gptResponse = event.gpt_response || '';
        const msgType = event.message_type;
        if (gptResponse && (msgType === 4 || msgType === 5)) {
          fullResponse = gptResponse;
        }
      },
      () => {
        addMessage({ role: 'user', content: prompt, timestamp: Date.now() });
        addMessage({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
        resolve(fullResponse || '_(No response)_');
      },
      (err) => {
        resolve(`**Error:** ${err.message}`);
      }
    );
  });
}
