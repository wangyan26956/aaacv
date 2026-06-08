import { getConfig } from './config';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

let messages: ChatMessage[] = [];

export function addMessage(msg: ChatMessage): void {
  messages.push(msg);
  const limit = getConfig().maxHistoryLength;
  while (messages.length > limit) {
    messages.shift();
  }
}

export function getMessages(): ChatMessage[] {
  return [...messages];
}

export function getApiMessages(): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

export function clearHistory(): void {
  messages = [];
}

export function newChat(): void {
  messages = [];
}
