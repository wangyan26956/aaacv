import { getConfig } from './config';
import { addMessage } from './chatHistory';
import { getFullContext, ctxToPrompt } from './contextProvider';
import { classifyError, getRetryDelay, sleep } from './errorClassifier';
import { sseRequest } from './sseClient';
import { runAgent, type AgentProgressCallback } from './agentLoop';

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

// ---- Simple Chat (no tools) ----

export async function streamChat(
  userMessage: string,
  onChunk: (text: string) => void,
  onThinking: (text: string) => void,
  maxRetries = 3,
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.token) {
    onChunk('**Error:** AIA token is not set.');
    return;
  }

  let question = `Instructions:\n${FILE_SYSTEM_INSTRUCTION}\n\nUser: ${userMessage}`;
  try {
    const ctx = await getFullContext();
    const prompt = ctxToPrompt(ctx);
    question = `Instructions:\n${FILE_SYSTEM_INSTRUCTION}\n\nProject context:\n${prompt}\n\n---\nUser: ${userMessage}`;
  } catch {
    // continue without context
  }

  let lastErrorMsg = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = getRetryDelay(attempt - 1);
      onChunk(`\n\n_Retrying (attempt ${attempt}/${maxRetries})..._\n\n`);
      await sleep(delay);
    }

    try {
      const full = await sseRequest(
        cfg.baseUrl, question, cfg.token, cfg.verifySsl,
        onChunk, onThinking,
      );
      addMessage({ role: 'user', content: userMessage, timestamp: Date.now() });
      addMessage({ role: 'assistant', content: full, timestamp: Date.now() });
      return;
    } catch (err: any) {
      const classified = classifyError(err);
      lastErrorMsg = classified.message;
      if (!classified.retryable || attempt >= maxRetries) {
        addMessage({ role: 'user', content: userMessage, timestamp: Date.now() });
        addMessage({ role: 'assistant', content: `**Error:** ${lastErrorMsg}`, timestamp: Date.now() });
        onChunk(`\n\n**Error:** ${lastErrorMsg}`);
        return;
      }
    }
  }
  onChunk(`\n\n**Error:** ${lastErrorMsg}`);
}

// ---- Agent Chat (with tools) ----

export async function streamChatAgent(
  userMessage: string,
  onProgress: AgentProgressCallback,
): Promise<void> {
  await runAgent(userMessage, onProgress);
}

// ---- One-shot Prompt ----

export async function runPrompt(
  promptStr: string,
  extra?: string,
  maxRetries = 2,
): Promise<string> {
  const cfg = getConfig();
  if (!cfg.token) return '**Error:** AIA token is not set.';

  let question = `Instructions:\n${FILE_SYSTEM_INSTRUCTION}\n\n${promptStr}`;
  try {
    const ctx = await getFullContext();
    const ctxStr = ctxToPrompt(ctx);
    question = `Instructions:\n${FILE_SYSTEM_INSTRUCTION}\n\nProject context:\n${ctxStr}\n\n---\n${promptStr}`;
  } catch { /* continue without context */ }
  if (extra) question = `${extra}\n\n---\n${question}`;

  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(getRetryDelay(attempt - 1));
    try {
      const full = await sseRequest(
        cfg.baseUrl, question, cfg.token, cfg.verifySsl,
        () => {}, () => {},
      );
      addMessage({ role: 'user', content: promptStr, timestamp: Date.now() });
      addMessage({ role: 'assistant', content: full, timestamp: Date.now() });
      return full || '_(No response)_';
    } catch (err: any) {
      const classified = classifyError(err);
      lastError = classified.message;
      if (!classified.retryable || attempt >= maxRetries) {
        addMessage({ role: 'user', content: promptStr, timestamp: Date.now() });
        addMessage({ role: 'assistant', content: `**Error:** ${lastError}`, timestamp: Date.now() });
        return `**Error:** ${lastError}`;
      }
    }
  }
  addMessage({ role: 'user', content: promptStr, timestamp: Date.now() });
  addMessage({ role: 'assistant', content: `**Error:** ${lastError}`, timestamp: Date.now() });
  return `**Error:** ${lastError}`;
}
