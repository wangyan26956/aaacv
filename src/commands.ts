import * as vscode from 'vscode';
import { runPrompt } from './claudeService';
import { newChat, clearHistory } from './chatHistory';
import { getFullContext } from './contextProvider';

type WebviewPoster = (msg: any) => void;

let postToWebview: WebviewPoster | null = null;

export function setWebviewPoster(poster: WebviewPoster): void {
  postToWebview = poster;
}

function ensureChatOpen(): void {
  vscode.commands.executeCommand('claudeCode.chatView.focus');
}

function showInChat(text: string): void {
  ensureChatOpen();
  if (postToWebview) {
    postToWebview({ type: 'addMessage', role: 'assistant', content: text });
  }
}

function selectedOnly(ctx: any): boolean {
  if (!ctx?.selectedText) {
    vscode.window.showWarningMessage('Select some code first.');
    return false;
  }
  return true;
}

export function registerCommands(context: vscode.ExtensionContext): void {
  const subs = context.subscriptions;

  subs.push(vscode.commands.registerCommand('claudeCode.explainCode', async () => {
    const ctx = await getFullContext();
    if (!selectedOnly(ctx)) return;
    ensureChatOpen();
    const result = await runPrompt(
      `Explain the following ${ctx.language} code in detail:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``,
      'You are a senior software engineer. Be clear and educational.'
    );
    showInChat(result);
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.generateCode', async () => {
    const desc = await vscode.window.showInputBox({
      prompt: 'Describe the code you want to generate',
      placeHolder: 'e.g., A Python function that sorts a list of dictionaries by a key'
    });
    if (!desc) return;
    ensureChatOpen();
    const ctx = await getFullContext();
    const result = await runPrompt(
      `Generate code based on this description. Use ${ctx.language || 'the appropriate language'}.\n\nDescription: ${desc}`,
      'You are an expert programmer. Generate production-quality code.'
    );
    showInChat(result);
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.refactor', async () => {
    const ctx = await getFullContext();
    if (!selectedOnly(ctx)) return;
    ensureChatOpen();
    const result = await runPrompt(
      `Refactor the following ${ctx.language} code. Improve readability, performance, and maintainability. Explain changes:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``,
      'You are an expert software engineer. Provide refactored code with explanations.'
    );
    showInChat(result);
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.fixBug', async () => {
    const ctx = await getFullContext();
    if (!selectedOnly(ctx)) return;
    ensureChatOpen();
    const result = await runPrompt(
      `This ${ctx.language} code has a bug. Find and fix it. Explain what was wrong and how you fixed it:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``,
      'You are a debugging expert. Find bugs, explain root causes, and provide fixes.'
    );
    showInChat(result);
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.reviewCode', async () => {
    const ctx = await getFullContext();
    if (!selectedOnly(ctx)) return;
    ensureChatOpen();
    const result = await runPrompt(
      `Review the following ${ctx.language} code. Identify issues with correctness, security, performance, style, and best practices:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``,
      'You are a thorough code reviewer. Be constructive and specific.'
    );
    showInChat(result);
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.addTests', async () => {
    const ctx = await getFullContext();
    if (!selectedOnly(ctx)) return;
    ensureChatOpen();
    const result = await runPrompt(
      `Write comprehensive unit tests for the following ${ctx.language} code. Cover edge cases and error conditions:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``,
      'You are a QA engineer. Write thorough, well-structured tests.'
    );
    showInChat(result);
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.newChat', () => {
    newChat();
    if (postToWebview) postToWebview({ type: 'clearMessages' });
    vscode.window.showInformationMessage('Code AI: New chat started.');
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.clearHistory', () => {
    clearHistory();
    if (postToWebview) postToWebview({ type: 'clearMessages' });
    vscode.window.showInformationMessage('Code AI: Chat history cleared.');
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.openChat', () => {
    ensureChatOpen();
  }));

  subs.push(vscode.commands.registerCommand('claudeCode.toggleChat', () => {
    vscode.commands.executeCommand('workbench.view.extension.claude-code-sidebar');
  }));
}
