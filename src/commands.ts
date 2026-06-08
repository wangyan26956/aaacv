import * as vscode from 'vscode';
import { runPrompt } from './claudeService';
import { newChat, clearHistory } from './chatHistory';
import { getEditorContext } from './contextProvider';

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

export function registerCommands(context: vscode.ExtensionContext): void {
  const subs = context.subscriptions;

  subs.push(
    vscode.commands.registerCommand('claudeCode.explainCode', async () => {
      const ctx = getEditorContext();
      if (!ctx?.selectedText) {
        vscode.window.showWarningMessage('Select some code to explain.');
        return;
      }
      ensureChatOpen();
      const prompt = `Explain the following ${ctx.language} code in detail:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``;
      const result = await runPrompt(prompt, 'You are a senior software engineer explaining code. Be clear and educational.');
      showInChat(result);
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.generateCode', async () => {
      const desc = await vscode.window.showInputBox({
        prompt: 'Describe the code you want to generate',
        placeHolder: 'e.g., A Python function that sorts a list of dictionaries by a key'
      });
      if (!desc) return;
      ensureChatOpen();
      const ctx = getEditorContext();
      const lang = ctx?.language ?? '';
      const prompt = `Generate code based on the following description. Use ${lang || 'the appropriate language'}.\n\nDescription: ${desc}`;
      const result = await runPrompt(prompt, 'You are an expert programmer. Generate production-quality, well-structured code.');
      showInChat(result);
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.refactor', async () => {
      const ctx = getEditorContext();
      if (!ctx?.selectedText) {
        vscode.window.showWarningMessage('Select some code to refactor.');
        return;
      }
      ensureChatOpen();
      const prompt = `Refactor the following ${ctx.language} code. Improve readability, performance, and maintainability. Explain the changes you made:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``;
      const result = await runPrompt(prompt, 'You are an expert software engineer. Provide refactored code with explanations.');
      showInChat(result);
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.fixBug', async () => {
      const ctx = getEditorContext();
      if (!ctx?.selectedText) {
        vscode.window.showWarningMessage('Select the buggy code to fix.');
        return;
      }
      ensureChatOpen();
      const prompt = `This ${ctx.language} code has a bug. Find and fix it. Explain what was wrong and how you fixed it:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``;
      const result = await runPrompt(prompt, 'You are a debugging expert. Find bugs, explain root causes, and provide fixes.');
      showInChat(result);
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.reviewCode', async () => {
      const ctx = getEditorContext();
      if (!ctx?.selectedText) {
        vscode.window.showWarningMessage('Select some code to review.');
        return;
      }
      ensureChatOpen();
      const prompt = `Review the following ${ctx.language} code. Identify issues with: correctness, security, performance, style, and best practices. Provide specific suggestions:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``;
      const result = await runPrompt(prompt, 'You are a thorough code reviewer. Be constructive and specific.');
      showInChat(result);
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.addTests', async () => {
      const ctx = getEditorContext();
      if (!ctx?.selectedText) {
        vscode.window.showWarningMessage('Select the code to generate tests for.');
        return;
      }
      ensureChatOpen();
      const prompt = `Write comprehensive unit tests for the following ${ctx.language} code. Cover edge cases and error conditions:\n\n\`\`\`${ctx.language}\n${ctx.selectedText}\n\`\`\``;
      const result = await runPrompt(prompt, 'You are a QA engineer. Write thorough, well-structured tests.');
      showInChat(result);
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.newChat', () => {
      newChat();
      if (postToWebview) {
        postToWebview({ type: 'clearMessages' });
      }
      vscode.window.showInformationMessage('Code AI: New chat started.');
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.clearHistory', () => {
      clearHistory();
      if (postToWebview) {
        postToWebview({ type: 'clearMessages' });
      }
      vscode.window.showInformationMessage('Code AI: Chat history cleared.');
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.openChat', () => {
      ensureChatOpen();
    })
  );

  subs.push(
    vscode.commands.registerCommand('claudeCode.toggleChat', () => {
      vscode.commands.executeCommand('workbench.view.extension.claude-code-sidebar');
    })
  );
}
