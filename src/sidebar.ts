import * as vscode from 'vscode';
import { streamChat } from './claudeService';
import { getEditorContext } from './contextProvider';
import { setWebviewPoster } from './commands';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeCode.chatView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    setWebviewPoster((msg: any) => {
      webviewView.webview.postMessage(msg);
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this._handleChatMessage(data.content, webviewView.webview);
          break;
        case 'getContext':
          this._sendContext(webviewView.webview);
          break;
      }
    });
  }

  private async _handleChatMessage(
    content: string,
    webview: vscode.Webview
  ): Promise<void> {
    webview.postMessage({ type: 'addMessage', role: 'user', content });

    webview.postMessage({ type: 'startStream' });

    await streamChat(
      content,
      (chunk) => {
        webview.postMessage({ type: 'streamChunk', content: chunk.content });
      },
      (thinking) => {
        webview.postMessage({ type: 'thinking', text: thinking });
      }
    );

    webview.postMessage({ type: 'endStream' });
  }

  private _sendContext(webview: vscode.Webview): void {
    const ctx = getEditorContext();
    if (ctx) {
      webview.postMessage({
        type: 'contextUpdate',
        filePath: ctx.filePath,
        language: ctx.language,
      });
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #context-bar {
      padding: 6px 10px;
      font-size: 11px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
      display: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #context-bar.visible { display: block; }
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .message {
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 100%;
      word-wrap: break-word;
      line-height: 1.5;
    }
    .message.user {
      align-self: flex-end;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .message.assistant {
      align-self: flex-start;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
    }
    .message .role-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      opacity: 0.7;
      margin-bottom: 4px;
    }
    .message pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 6px 0;
      font-size: 12px;
    }
    .message code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .message :not(pre) > code {
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 4px;
      border-radius: 3px;
    }
    .copy-btn {
      position: absolute;
      top: 4px;
      right: 8px;
      background: none;
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      opacity: 0;
      transition: opacity 0.15s;
    }
    .message.assistant:hover .copy-btn { opacity: 0.7; }
    .message.assistant:hover .copy-btn:hover { opacity: 1; }
    .message.assistant { position: relative; }

    /* Thinking section */
    .thinking-box {
      margin: 8px 0;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      overflow: hidden;
      font-size: 12px;
    }
    .thinking-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 6px 10px;
      background: var(--vscode-sideBar-background);
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 11px;
      font-family: var(--vscode-font-family);
    }
    .thinking-toggle:hover {
      background: var(--vscode-list-hoverBackground);
    }
    .thinking-toggle .arrow {
      display: inline-block;
      transition: transform 0.15s;
      font-size: 10px;
    }
    .thinking-toggle.open .arrow { transform: rotate(90deg); }
    .thinking-content {
      display: none;
      padding: 8px 10px;
      background: var(--vscode-textCodeBlock-background);
      color: var(--vscode-descriptionForeground);
      max-height: 200px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
      border-top: 1px solid var(--vscode-panel-border);
      font-size: 11px;
      line-height: 1.5;
    }
    .thinking-content.open { display: block; }
    #input-area {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 8px;
      display: flex;
      gap: 6px;
    }
    #input-area textarea {
      flex: 1;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 8px;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      resize: none;
      min-height: 36px;
      max-height: 120px;
    }
    #input-area textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }
    #input-area button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 0 14px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    #input-area button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    #input-area button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .streaming .message.assistant:last-child {
      border-color: var(--vscode-focusBorder);
    }
    .empty-state {
      text-align: center;
      color: var(--vscode-descriptionForeground);
      padding: 40px 20px;
      margin-top: 40px;
    }
    .empty-state h3 { margin-bottom: 8px; }
    .empty-state p { font-size: 12px; line-height: 1.6; }
  </style>
</head>
<body>
  <div id="context-bar"></div>
  <div id="messages">
    <div class="empty-state" id="empty-state">
      <h3>Code AI</h3>
      <p>Ask me anything about your code.<br>Select code and right-click for quick actions.</p>
    </div>
  </div>
  <div id="input-area">
    <textarea id="user-input" placeholder="Ask AI..." rows="1"></textarea>
    <button id="send-btn">Send</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const inputEl = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const contextBar = document.getElementById('context-bar');
    const emptyState = document.getElementById('empty-state');
    let streaming = false;
    let streamMsgEl = null;

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderMarkdown(text) {
      var html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html = html.replace(/\\\`\\\`\\\`(\\w*)\\n?([\\s\\S]*?)\\\`\\\`\\\`/g, function(_, lang, code) {
        var langLabel = lang ? '<div class="role-label">' + escapeHtml(lang) + '</div>' : '';
        return '<pre>' + langLabel + '<code>' + escapeHtml(code.trim()) + '</code></pre>';
      });
      html = html.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
      html = html.replace(/\\n/g, '<br>');
      return html;
    }

    function addMessage(role, content) {
      if (emptyState) emptyState.remove();
      var div = document.createElement('div');
      div.className = 'message ' + role;
      var label = document.createElement('div');
      label.className = 'role-label';
      label.textContent = role === 'user' ? 'You' : 'AI';
      div.appendChild(label);
      if (role === 'assistant') {
        var copyBtn = document.createElement('button');
        copyBtn.className = 'copy-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = function() {
          navigator.clipboard.writeText(content);
          copyBtn.textContent = 'Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
        };
        div.appendChild(copyBtn);
      }
      var body = document.createElement('div');
      body.className = 'message-body';
      body.innerHTML = renderMarkdown(content);
      div.appendChild(body);
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    function insertThinking(thinkingText) {
      if (!streamMsgEl) return;
      var existing = streamMsgEl.querySelector('.thinking-box');
      if (existing) {
        var content = existing.querySelector('.thinking-content');
        content.textContent = thinkingText;
        content.scrollTop = content.scrollHeight;
      } else {
        var box = document.createElement('div');
        box.className = 'thinking-box';
        box.innerHTML =
          '<button class="thinking-toggle open"><span class="arrow">▶</span> Thinking...</button>' +
          '<div class="thinking-content open">' + escapeHtml(thinkingText) + '</div>';
        var toggle = box.querySelector('.thinking-toggle');
        var content = box.querySelector('.thinking-content');
        toggle.addEventListener('click', function() {
          var isOpen = content.classList.toggle('open');
          toggle.classList.toggle('open', isOpen);
          toggle.querySelector('.arrow').textContent = isOpen ? '▶' : '▶';
        });
        streamMsgEl.querySelector('.message-body').appendChild(box);
        content.scrollTop = content.scrollHeight;
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function sendMessage() {
      var text = inputEl.value.trim();
      if (!text || streaming) return;
      inputEl.value = '';
      addMessage('user', text);
      messagesEl.classList.add('streaming');
      streaming = true;
      sendBtn.disabled = true;
      vscode.postMessage({ type: 'sendMessage', content: text });
    }

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    window.addEventListener('message', function(event) {
      var msg = event.data;
      switch (msg.type) {
        case 'addMessage':
          addMessage(msg.role, msg.content);
          break;
        case 'clearMessages':
          messagesEl.innerHTML = '';
          var clone = emptyState.cloneNode(true);
          clone.id = 'empty-state';
          messagesEl.appendChild(clone);
          break;
        case 'startStream':
          streamMsgEl = addMessage('assistant', '');
          break;
        case 'streamChunk':
          if (streamMsgEl) {
            var body = streamMsgEl.querySelector('.message-body');
            var current = body.getAttribute('data-raw') || '';
            current += msg.content;
            body.setAttribute('data-raw', current);
            body.innerHTML = renderMarkdown(current);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
          break;
        case 'thinking':
          insertThinking(msg.text);
          break;
        case 'endStream':
          streaming = false;
          sendBtn.disabled = false;
          messagesEl.classList.remove('streaming');
          streamMsgEl = null;
          break;
        case 'streamError':
          if (streamMsgEl) {
            var body = streamMsgEl.querySelector('.message-body');
            body.innerHTML = '<span style="color:var(--vscode-errorForeground)">' + escapeHtml(msg.content) + '</span>';
          }
          streaming = false;
          sendBtn.disabled = false;
          messagesEl.classList.remove('streaming');
          streamMsgEl = null;
          break;
        case 'contextUpdate':
          contextBar.className = 'visible';
          contextBar.textContent = msg.language + ' | ' + msg.filePath;
          break;
      }
    });

    vscode.postMessage({ type: 'getContext' });
  </script>
</body>
</html>`;
  }
}
