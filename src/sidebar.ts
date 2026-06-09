import * as vscode from 'vscode';
import { streamChatAgent } from './claudeService';
import { getFullContext } from './contextProvider';
import { setWebviewPoster } from './commands';
import { writeFile } from './fileOps';
import { getConfig } from './config';
import { getMessages, setMessages } from './chatHistory';
import { saveChatToHistory, loadChatHistory } from './chatPersistence';
import type { AgentProgressCallback } from './agentLoop';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'claudeCode.chatView';
  private _view?: vscode.WebviewView;
  private _extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this._extensionUri = extensionUri;
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = await this._buildHtml(webviewView.webview);

    setWebviewPoster((msg: any) => webviewView.webview.postMessage(msg));

    webviewView.webview.onDidReceiveMessage((data: any) => {
      switch (data.t) {
        case 's':
          this._handleSendMessage(data.x);
          break;
        case 'c':
          this._handleRequestContext();
          break;
        case 'f':
          this._handleCreateFile(data.p, data.z);
          break;
        case 'a':
          this._handleCreateFiles(data.l);
          break;
      }
    });

    this._restoreHistory(webviewView.webview);
  }

  private async _buildHtml(webview: vscode.Webview): Promise<string> {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'),
    );
    const css = await this._loadCss(webview);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'unsafe-inline';">
  <style>${css}</style>
</head>
<body>
  <div id="hdr"></div>
  <div id="msgs">
    <div class="emp" id="emp"><b>Code AI</b><br>Ask me to build anything.</div>
  </div>
  <div id="foot">
    <textarea id="tin" placeholder="${getConfig().provider === 'qwen' ? 'Say something... (Qwen)' : 'Say something... (AIA)'}" rows="1"></textarea>
    <button id="btn">Send</button>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async _loadCss(webview: vscode.Webview): Promise<string> {
    const distCssUri = vscode.Uri.joinPath(this._extensionUri, 'dist', 'style.css');
    try {
      const bytes = await vscode.workspace.fs.readFile(distCssUri);
      return new TextDecoder().decode(bytes);
    } catch {
      try {
        const srcCssUri = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'style.css');
        const bytes = await vscode.workspace.fs.readFile(srcCssUri);
        return new TextDecoder().decode(bytes);
      } catch {
        return '';
      }
    }
  }

  private async _handleSendMessage(text: string): Promise<void> {
    const webview = this._view?.webview;
    if (!webview) return;

    // Show user message
    webview.postMessage({ t: 'm', r: 'user', x: text });

    // Start agent mode — AI always has tools
    webview.postMessage({ t: 'st' });

    const onProgress: AgentProgressCallback = (ev) => {
      webview.postMessage(ev);
    };

    await streamChatAgent(text, onProgress);

    webview.postMessage({ t: 'dn' });
    this._saveToDisk();
  }

  private async _handleRequestContext(): Promise<void> {
    try {
      const ctx = await getFullContext();
      if (ctx && this._view) {
        this._view.webview.postMessage({ t: 'ct', f: ctx.filePath, l: ctx.language });
      }
    } catch {
      // non-critical
    }
  }

  private async _handleCreateFile(relPath: string, content: string): Promise<void> {
    try {
      await writeFile(relPath, content);
      this._view?.webview.postMessage({ t: 'ok', p: relPath });
      vscode.window.showInformationMessage('Created: ' + relPath);
    } catch (e: any) {
      this._view?.webview.postMessage({ t: 'fl', p: relPath, e: e.message });
    }
  }

  private async _handleCreateFiles(files: { p: string; z: string }[]): Promise<void> {
    let done = 0;
    for (const f of files) {
      try {
        await writeFile(f.p, f.z);
        this._view?.webview.postMessage({ t: 'ok', p: f.p });
        done++;
      } catch (e: any) {
        this._view?.webview.postMessage({ t: 'fl', p: f.p, e: e.message });
      }
    }
    vscode.window.showInformationMessage('Done: ' + done + '/' + files.length);
  }

  private async _restoreHistory(webview: vscode.Webview): Promise<void> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown';
    const diskMsgs = await loadChatHistory(root);
    if (diskMsgs.length > 0) {
      setMessages(diskMsgs);
      webview.postMessage({
        t: 'hist',
        msgs: diskMsgs
          .filter((m: any) => m.role !== 'system')
          .map((m: any) => ({ role: m.role, content: m.content })),
      });
      return;
    }
    const msgs = getMessages();
    if (msgs.length > 0) {
      webview.postMessage({
        t: 'hist',
        msgs: msgs
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content })),
      });
    }
  }

  private _saveToDisk(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown';
    const msgs = getMessages();
    saveChatToHistory(msgs, root, 'session-' + Date.now());
  }
}
