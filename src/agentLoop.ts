import { getConfig } from './config';
import { addMessage } from './chatHistory';
import { getFullContext, ctxToPrompt } from './contextProvider';
import {
  getToolSystemPrompt,
  parseToolCalls,
  executeTool,
  type ToolCall,
} from './tools';
import { sseRequest } from './sseClient';
import { classifyError, getRetryDelay, sleep } from './errorClassifier';

const MAX_AGENT_TURNS = 10;
const MAX_RETRIES = 2;

export type AgentProgressCallback = (event: AgentEvent) => void;

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_result'; call: ToolCall; result: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

function buildAgentPrompt(userMessage: string, ctxStr: string): string {
  return [
    getToolSystemPrompt(),
    '',
    '## Project Context',
    ctxStr,
    '',
    '---',
    `User: ${userMessage}`,
    '',
    'Respond to the user. Use tools as needed. When done, reply in plain text without any tool blocks.',
  ].join('\n');
}

function buildToolResultPrompt(results: string[]): string {
  return [
    '<tool_results>',
    ...results,
    '</tool_results>',
    '',
    'Continue based on these results. Use more tools or give a plain text answer.',
  ].join('\n');
}

function cleanForDisplay(text: string): string {
  return text
    .replace(/<tool\s+name="[^"]+"\s*>\s*\n?[\s\S]*?\n?\s*<\/tool>/g, '')
    .trim();
}

export async function runAgent(
  userMessage: string,
  onProgress: AgentProgressCallback,
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.token) {
    onProgress({ type: 'error', message: 'AIA token is not set.' });
    return;
  }

  let ctxStr = '';
  try {
    const ctx = await getFullContext();
    ctxStr = ctxToPrompt(ctx);
  } catch {
    // continue without context
  }

  addMessage({ role: 'user', content: userMessage, timestamp: Date.now() });

  let currentPrompt = buildAgentPrompt(userMessage, ctxStr);
  let allDisplayText = '';

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    // Accumulate full response + display text locally during streaming
    let fullResponse = '';
    let displayText = '';

    let lastErr = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await sleep(getRetryDelay(attempt - 1));
      }
      try {
        fullResponse = await sseRequest(
          cfg.baseUrl,
          currentPrompt,
          cfg.token,
          cfg.verifySsl,
          (delta) => {
            // Show non-tool text as it streams in, stripping any <tool> content
            const cleanDelta = delta.replace(/<tool[\s\S]*$/g, '');
            if (cleanDelta) {
              displayText += cleanDelta;
              onProgress({ type: 'text', text: cleanDelta });
            }
          },
          (think) => {
            onProgress({ type: 'thinking', text: think });
          },
        );
        break;
      } catch (e: any) {
        const classified = classifyError(e);
        lastErr = classified.message;
        if (!classified.retryable || attempt >= MAX_RETRIES) {
          onProgress({ type: 'error', message: lastErr });
          return;
        }
      }
    }

    if (!fullResponse && lastErr) {
      onProgress({ type: 'error', message: lastErr });
      return;
    }

    allDisplayText += displayText;

    // Parse tool calls from the full response
    const toolCalls = parseToolCalls(fullResponse);

    if (toolCalls.length === 0) {
      addMessage({
        role: 'assistant',
        content: cleanForDisplay(fullResponse),
        timestamp: Date.now(),
      });
      onProgress({ type: 'done' });
      return;
    }

    // Execute tools
    const results: string[] = [];
    for (const call of toolCalls) {
      onProgress({ type: 'tool_start', call });
      let result: string;
      try {
        result = await executeTool(call);
      } catch (e: any) {
        result = `Error: ${e.message}`;
      }
      onProgress({ type: 'tool_result', call, result });
      results.push(
        `Tool ${call.name}: ${JSON.stringify(call.args)}\nResult:\n${result}`,
      );
    }

    // Build next prompt with tool results
    currentPrompt = buildToolResultPrompt(results);
  }

  onProgress({
    type: 'error',
    message: `Reached ${MAX_AGENT_TURNS} agent turns. Stopping.`,
  });
}
