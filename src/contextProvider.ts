import * as vscode from 'vscode';

export interface EditorContext {
  selectedText: string;
  filePath: string;
  language: string;
  workspaceRoot: string;
}

export function getEditorContext(): EditorContext | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  const doc = editor.document;
  const selection = editor.selection;

  return {
    selectedText: selection.isEmpty
      ? doc.getText()
      : doc.getText(selection),
    filePath: doc.uri.fsPath,
    language: doc.languageId,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
  };
}

export function buildContextString(ctx: EditorContext): string {
  const parts = [
    `Current file: ${ctx.filePath}`,
    `Language: ${ctx.language}`,
  ];

  if (ctx.workspaceRoot) {
    parts.push(`Workspace: ${ctx.workspaceRoot}`);
  }

  if (ctx.selectedText) {
    const maxLen = 4000;
    const text = ctx.selectedText.length > maxLen
      ? ctx.selectedText.substring(0, maxLen) + '\n... (truncated)'
      : ctx.selectedText;
    parts.push(`\nCode context:\n\`\`\`${ctx.language}\n${text}\n\`\`\``);
  }

  return parts.join('\n');
}
