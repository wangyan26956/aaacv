import * as vscode from 'vscode';
import * as path from 'path';

export async function writeFile(relativePath: string, content: string): Promise<string> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) throw new Error('No workspace folder open.');

  const absPath = path.join(root.uri.fsPath, relativePath);
  const dir = path.dirname(absPath);

  await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
  await vscode.workspace.fs.writeFile(vscode.Uri.file(absPath), Buffer.from(content, 'utf-8'));

  // Open the file in editor
  const doc = await vscode.workspace.openTextDocument(absPath);
  await vscode.window.showTextDocument(doc);

  return absPath;
}
