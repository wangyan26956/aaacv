import * as vscode from 'vscode';

export interface FullContext {
  selectedText: string;
  filePath: string;
  language: string;
  workspaceRoot: string;
  projectTree: string;
  openFiles: string[];
}

async function scanProjectTree(root: vscode.Uri): Promise<string> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(root, '**/*.{js,jsx,ts,tsx,html,css,scss,py,java,cpp,go,php,vue,json}'),
    new vscode.RelativePattern(root, '**/node_modules/**')
  );
  const lines = files.map(f => vscode.workspace.asRelativePath(f));
  return lines.length ? lines.join('\n') : '';
}

export async function getFullContext(): Promise<FullContext> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const editor = vscode.window.activeTextEditor;

  const openFiles: string[] = [];
  for (const grp of vscode.window.tabGroups.all) {
    for (const tab of grp.tabs) {
      const input = tab.input as any;
      if (input?.uri) {
        openFiles.push(vscode.workspace.asRelativePath(input.uri));
      }
    }
  }

  const ctx: FullContext = {
    filePath: editor ? vscode.workspace.asRelativePath(editor.document.uri) : '',
    selectedText: '',
    language: editor?.document.languageId ?? '',
    workspaceRoot: workspaceRoot?.fsPath ?? '',
    projectTree: '',
    openFiles,
  };

  if (editor) {
    const sel = editor.selection;
    ctx.selectedText = sel.isEmpty
      ? editor.document.getText()
      : editor.document.getText(sel);
  }

  if (workspaceRoot) {
    ctx.projectTree = await scanProjectTree(workspaceRoot);
  }

  return ctx;
}

export function ctxToPrompt(ctx: FullContext): string {
  const p: string[] = [];

  if (ctx.workspaceRoot) {
    p.push(`Workspace: ${ctx.workspaceRoot}`);
  }
  if (ctx.projectTree) {
    p.push(`Project files:\n${ctx.projectTree}`);
  }
  if (ctx.openFiles.length > 0) {
    p.push(`Open tabs: ${ctx.openFiles.join(', ')}`);
  }
  if (ctx.filePath) {
    p.push(`Current file: ${ctx.filePath}`);
    p.push(`Language: ${ctx.language}`);
  }
  if (ctx.selectedText) {
    const cap = 4000;
    const text = ctx.selectedText.length > cap
      ? ctx.selectedText.substring(0, cap) + '\n... (truncated)'
      : ctx.selectedText;
    p.push(`\nCode:\n\`\`\`${ctx.language}\n${text}\n\`\`\``);
  }

  return p.join('\n');
}
