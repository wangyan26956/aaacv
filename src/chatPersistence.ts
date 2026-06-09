import * as vscode from 'vscode';
import { appendFile, readFile, writeFile, mkdir } from 'fs/promises';
import type { ChatMessage } from './chatHistory';

const HISTORY_FILE = 'chat-history.jsonl';
const MAX_HISTORY_ITEMS = 100;

interface HistoryEntry {
  display: string;
  messages: ChatMessage[];
  timestamp: number;
  project: string;
  sessionId: string;
}

let pendingEntries: HistoryEntry[] = [];
let isWriting = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let context: vscode.ExtensionContext | null = null;

export function initPersistence(extContext: vscode.ExtensionContext): void {
  context = extContext;
}

function getHistoryPath(): string {
  if (!context) throw new Error('Persistence not initialized');
  // Use globalStorageUri for cross-workspace persistence
  return vscode.Uri.joinPath(
    context.globalStorageUri,
    HISTORY_FILE,
  ).fsPath;
}

async function ensureStorageDir(): Promise<void> {
  if (!context) return;
  await mkdir(context.globalStorageUri.fsPath, { recursive: true }).catch(
    () => {},
  );
}

async function immediateFlush(): Promise<void> {
  if (pendingEntries.length === 0 || !context) return;

  const entries = pendingEntries.splice(0);
  const historyPath = getHistoryPath();

  await ensureStorageDir();
  const lines = entries.map((e) => JSON.stringify(e) + '\n');
  await appendFile(historyPath, lines.join(''), { encoding: 'utf-8' });
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);

  flushTimer = setTimeout(async () => {
    if (isWriting) return;
    isWriting = true;
    flushTimer = null;
    try {
      await immediateFlush();
    } finally {
      isWriting = false;
      if (pendingEntries.length > 0) {
        scheduleFlush();
      }
    }
  }, 500);
}

export async function saveChatToHistory(
  messages: ChatMessage[],
  projectRoot: string,
  sessionId: string,
): Promise<void> {
  if (!context || messages.length === 0) return;

  const firstUserMsg = messages.find((m) => m.role === 'user');
  const display = firstUserMsg
    ? firstUserMsg.content.substring(0, 80)
    : 'Empty chat';

  pendingEntries.push({
    display,
    messages: [...messages],
    timestamp: Date.now(),
    project: projectRoot,
    sessionId,
  });

  scheduleFlush();
}

export async function loadChatHistory(
  projectRoot: string,
): Promise<ChatMessage[]> {
  if (!context) return [];

  const historyPath = getHistoryPath();

  try {
    const content = await readFile(historyPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    // Read in reverse (newest first) — adopted from ccread reverse-line pattern
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry: HistoryEntry = JSON.parse(lines[i]);
        if (entry.project === projectRoot) {
          return entry.messages;
        }
      } catch {
        // skip corrupted lines
      }
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      console.error('Failed to load chat history:', e);
    }
  }

  return [];
}

export async function flushPendingChat(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await immediateFlush();
}
