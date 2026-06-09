import * as vscode from 'vscode';
import { ChatViewProvider } from './sidebar';
import { registerCommands } from './commands';
import { initPersistence, flushPendingChat } from './chatPersistence';

export function activate(context: vscode.ExtensionContext): void {
  initPersistence(context);

  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      provider,
    ),
  );

  registerCommands(context);

  vscode.window.showInformationMessage(
    'Code AI is ready. Set your token in settings to get started.',
  );
}

export async function deactivate(): Promise<void> {
  await flushPendingChat();
}
