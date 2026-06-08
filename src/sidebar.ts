import * as vscode from 'vscode';
import { streamChat } from './claudeService';
import { getFullContext } from './contextProvider';
import { setWebviewPoster } from './commands';
import { writeFile } from './fileOps';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'claudeCode.chatView';
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._html();

    setWebviewPoster((msg: any) => webviewView.webview.postMessage(msg));

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'sendMessage':
          await this._handleChatMessage(data.content, webviewView.webview);
          break;
        case 'getContext':
          await this._sendContext(webviewView.webview);
          break;
        case 'createFile':
          await this._handleCreateFile(data.filePath, data.content, webviewView.webview);
          break;
        case 'createAllFiles':
          await this._handleCreateAllFiles(data.files, webviewView.webview);
          break;
      }
    });
  }

  private async _handleChatMessage(content: string, webview: vscode.Webview): Promise<void> {
    webview.postMessage({ type: 'addMessage', role: 'user', content });
    webview.postMessage({ type: 'startStream' });
    await streamChat(
      content,
      (text) => webview.postMessage({ type: 'streamChunk', content: text }),
      (text) => webview.postMessage({ type: 'thinking', text })
    );
    webview.postMessage({ type: 'endStream' });
  }

  private async _sendContext(webview: vscode.Webview): Promise<void> {
    const ctx = await getFullContext();
    if (ctx) {
      webview.postMessage({ type: 'contextUpdate', filePath: ctx.filePath, language: ctx.language });
    }
  }

  private async _handleCreateFile(filePath: string, content: string, webview: vscode.Webview): Promise<void> {
    try {
      const absPath = await writeFile(filePath, content);
      webview.postMessage({ type: 'fileCreated', filePath, absPath });
      vscode.window.showInformationMessage(`Created: ${filePath}`);
    } catch (err: any) {
      webview.postMessage({ type: 'fileError', filePath, error: err.message });
      vscode.window.showErrorMessage(`Failed: ${err.message}`);
    }
  }

  private async _handleCreateAllFiles(
    files: { path: string; content: string }[],
    webview: vscode.Webview
  ): Promise<void> {
    let created = 0;
    for (const f of files) {
      try {
        await writeFile(f.path, f.content);
        webview.postMessage({ type: 'fileCreated', filePath: f.path });
        created++;
      } catch (err: any) {
        webview.postMessage({ type: 'fileError', filePath: f.path, error: err.message });
      }
    }
    vscode.window.showInformationMessage(`Created ${created}/${files.length} files.`);
  }

  private _html(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);height:100vh;display:flex;flex-direction:column}
#context-bar{padding:6px 10px;font-size:11px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-bottom:1px solid var(--vscode-panel-border);display:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#context-bar.visible{display:block}
#messages{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:12px}
.message{padding:8px 12px;border-radius:8px;max-width:100%;word-wrap:break-word;line-height:1.5;position:relative}
.message.user{align-self:flex-end;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.message.assistant{align-self:flex-start;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border)}
.role-label{font-size:10px;font-weight:600;text-transform:uppercase;opacity:0.7;margin-bottom:4px}
.message pre{background:var(--vscode-textCodeBlock-background);padding:10px;border-radius:4px;overflow-x:auto;margin:6px 0;font-size:12px}
.message code{font-family:var(--vscode-editor-font-family,monospace);font-size:12px}
.message :not(pre)>code{background:var(--vscode-textCodeBlock-background);padding:2px 4px;border-radius:3px}

.code-actions{display:flex;gap:4px;margin-top:4px}
.code-actions button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border);border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px}
.code-actions button:hover{background:var(--vscode-button-secondaryHoverBackground)}
.code-actions button.create-file-btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none}
.code-actions button.create-file-btn:hover{background:var(--vscode-button-hoverBackground)}
.code-actions button.done{background:var(--vscode-inputValidation-infoBackground);color:var(--vscode-inputValidation-infoForeground);cursor:default}
.file-path-hint{font-size:11px;color:var(--vscode-descriptionForeground);margin-bottom:2px;font-family:var(--vscode-editor-font-family)}

.all-files-bar{display:flex;gap:6px;align-items:center;padding:6px 10px;background:var(--vscode-badge-background);border-top:1px solid var(--vscode-panel-border)}
.all-files-bar button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:3px 10px;cursor:pointer;font-size:11px}
.all-files-bar button:hover{background:var(--vscode-button-hoverBackground)}
.all-files-bar span{font-size:11px;color:var(--vscode-descriptionForeground)}

.thinking-box{margin:8px 0;border:1px solid var(--vscode-panel-border);border-radius:6px;overflow:hidden;font-size:12px}
.thinking-toggle{display:flex;align-items:center;gap:6px;width:100%;padding:6px 10px;background:var(--vscode-sideBar-background);border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:11px;font-family:var(--vscode-font-family)}
.thinking-toggle:hover{background:var(--vscode-list-hoverBackground)}
.thinking-toggle .arrow{display:inline-block;transition:transform .15s;font-size:10px}
.thinking-toggle.open .arrow{transform:rotate(90deg)}
.thinking-content{display:none;padding:8px 10px;background:var(--vscode-textCodeBlock-background);color:var(--vscode-descriptionForeground);max-height:200px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;border-top:1px solid var(--vscode-panel-border);font-size:11px;line-height:1.5}
.thinking-content.open{display:block}

#input-area{border-top:1px solid var(--vscode-panel-border);padding:8px;display:flex;gap:6px}
#input-area textarea{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:4px;padding:8px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);resize:none;min-height:36px;max-height:120px}
#input-area textarea:focus{outline:1px solid var(--vscode-focusBorder)}
#input-area button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:0 14px;cursor:pointer;font-size:12px;white-space:nowrap}
#input-area button:hover{background:var(--vscode-button-hoverBackground)}
#input-area button:disabled{opacity:.5;cursor:not-allowed}
.streaming .message.assistant:last-child{border-color:var(--vscode-focusBorder)}
.empty-state{text-align:center;color:var(--vscode-descriptionForeground);padding:40px 20px;margin-top:40px}
.empty-state h3{margin-bottom:8px}
.empty-state p{font-size:12px;line-height:1.6}
</style>
</head>
<body>
<div id="context-bar"></div>
<div id="messages">
  <div class="empty-state" id="empty-state">
    <h3>Code AI</h3>
    <p>Ask me to build anything.<br>I can create files directly in your project.</p>
  </div>
</div>
<div id="all-files-bar" class="all-files-bar" style="display:none">
  <span id="all-files-count"></span>
  <button id="write-all-btn">Write All Files</button>
</div>
<div id="input-area">
  <textarea id="user-input" placeholder="e.g., Create a Python Flask API with user auth..." rows="1"></textarea>
  <button id="send-btn">Send</button>
</div>
<script>
(function(){
var vscode = acquireVsCodeApi();
var messagesEl = document.getElementById('messages');
var inputEl = document.getElementById('user-input');
var sendBtn = document.getElementById('send-btn');
var contextBar = document.getElementById('context-bar');
var emptyState = document.getElementById('empty-state');
var allFilesBar = document.getElementById('all-files-bar');
var allFilesCount = document.getElementById('all-files-count');
var writeAllBtn = document.getElementById('write-all-btn');
var streaming = false;
var streamMsgEl = null;

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function parseFileBlocks(text) {
  var blocks = [];
  var re = /###\\s*FILE:\\s*(\\S+)\\s*\\n\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ path: m[1], lang: m[2], code: m[3].trim() });
  }
  return blocks;
}

function renderMarkdown(text) {
  var html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // file blocks: ### FILE: path\n\`\`\`...\`\`\`
  html = html.replace(/###\\s*FILE:\\s*(\\S+)\\s*\\n\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, function(_, path, lang, code) {
    var cleanCode = escapeHtml(code.trim());
    var langLabel = lang ? '<code style="font-size:10px;opacity:0.7">' + escapeHtml(lang) + '</code>' : '';
    var fileLabel = escapeHtml(path);
    return '<div class="file-path-hint">\u{1F4C4} ' + fileLabel + '</div>' +
      '<pre data-file-path="' + escapeHtml(path) + '">' + langLabel + '<code>' + cleanCode + '</code></pre>' +
      '<div class="code-actions">' +
        '<button class="create-file-btn" data-path="' + escapeHtml(path) + '">Create File</button>' +
        '<button class="copy-code-btn" data-path="' + escapeHtml(path) + '">Copy</button>' +
      '</div>';
  });
  // regular code blocks
  html = html.replace(/\`\`\`(\\w*)\\n?([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
    var langLabel = lang ? '<code style="font-size:10px;opacity:0.7">' + escapeHtml(lang) + '</code>' : '';
    return '<pre>' + langLabel + '<code>' + escapeHtml(code.trim()) + '</code></pre>' +
      '<div class="code-actions">' +
        '<button class="make-file-btn">Create File...</button>' +
        '<button class="copy-code-btn">Copy</button>' +
      '</div>';
  });
  html = html.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  html = html.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
  html = html.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
  html = html.replace(/\\n/g,'<br>');
  return html;
}

function getCodeFromPre(pre) {
  var c = pre.querySelector('code');
  return c ? c.textContent : '';
}

function updateAllFilesBar() {
  var btns = messagesEl.querySelectorAll('.create-file-btn:not(.done)');
  if (btns.length === 0) {
    allFilesBar.style.display = 'none';
    return;
  }
  allFilesBar.style.display = 'flex';
  allFilesCount.textContent = btns.length + ' file(s) pending';
}

function addMessage(role, content) {
  if (emptyState) { emptyState.remove(); emptyState = null; }
  var div = document.createElement('div');
  div.className = 'message ' + role;
  var label = document.createElement('div');
  label.className = 'role-label';
  label.textContent = role === 'user' ? 'You' : 'AI';
  div.appendChild(label);

  var body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = renderMarkdown(content);
  div.appendChild(body);

  // wire up file buttons
  div.querySelectorAll('.create-file-btn').forEach(function(btn) {
    var path = btn.getAttribute('data-path');
    var pre = btn.closest('.code-actions').previousElementSibling;
    btn.addEventListener('click', function() {
      vscode.postMessage({ type: 'createFile', filePath: path, content: getCodeFromPre(pre) });
      btn.classList.add('done');
      btn.textContent = 'Created';
      btn.disabled = true;
      updateAllFilesBar();
    });
  });
  div.querySelectorAll('.make-file-btn').forEach(function(btn) {
    var pre = btn.closest('.code-actions').previousElementSibling;
    btn.addEventListener('click', function() {
      var p = prompt('File path (relative to workspace):');
      if (p) {
        vscode.postMessage({ type: 'createFile', filePath: p, content: getCodeFromPre(pre) });
        btn.classList.add('done');
        btn.textContent = 'Created';
        btn.disabled = true;
        updateAllFilesBar();
      }
    });
  });
  div.querySelectorAll('.copy-code-btn').forEach(function(btn) {
    var pre = btn.closest('.code-actions').previousElementSibling;
    btn.addEventListener('click', function() {
      navigator.clipboard.writeText(getCodeFromPre(pre));
      btn.textContent = 'Copied!';
      setTimeout(function(){ btn.textContent = 'Copy'; }, 1500);
    });
  });

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  updateAllFilesBar();
  return div;
}

writeAllBtn.addEventListener('click', function() {
  var files = [];
  messagesEl.querySelectorAll('.create-file-btn:not(.done)').forEach(function(btn) {
    var path = btn.getAttribute('data-path');
    var pre = btn.closest('.code-actions').previousElementSibling;
    files.push({ path: path, content: getCodeFromPre(pre) });
    btn.classList.add('done');
    btn.textContent = 'Writing...';
    btn.disabled = true;
  });
  if (files.length > 0) {
    vscode.postMessage({ type: 'createAllFiles', files: files });
  }
  updateAllFilesBar();
});

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
    });
    streamMsgEl.querySelector('.message-body').appendChild(box);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function sendMessage() {
  var text = inputEl.value.trim();
  if (!text || streaming) return;
  inputEl.value = '';
  streaming = true;
  sendBtn.disabled = true;
  vscode.postMessage({ type: 'sendMessage', content: text });
}

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

window.addEventListener('message', function(event) {
  var msg = event.data;
  switch (msg.type) {
    case 'addMessage':
      addMessage(msg.role, msg.content);
      break;
    case 'clearMessages':
      messagesEl.innerHTML = '<div class="empty-state" id="empty-state"><h3>Code AI</h3><p>Ask me to build anything.</p></div>';
      emptyState = document.getElementById('empty-state');
      allFilesBar.style.display = 'none';
      break;
    case 'startStream':
      messagesEl.classList.add('streaming');
      streamMsgEl = addMessage('assistant', '');
      break;
    case 'streamChunk':
      if (streamMsgEl) {
        var body = streamMsgEl.querySelector('.message-body');
        var current = body.getAttribute('data-raw') || '';
        current += msg.content;
        body.setAttribute('data-raw', current);
        body.innerHTML = renderMarkdown(current);
        // re-wire buttons
        streamMsgEl.querySelectorAll('.create-file-btn').forEach(function(btn) {
          var path = btn.getAttribute('data-path');
          var pre = btn.closest('.code-actions').previousElementSibling;
          btn.onclick = function() {
            vscode.postMessage({ type: 'createFile', filePath: path, content: getCodeFromPre(pre) });
            btn.classList.add('done');
            btn.textContent = 'Created';
            btn.disabled = true;
            updateAllFilesBar();
          };
        });
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
      if (streamMsgEl) updateAllFilesBar();
      streamMsgEl = null;
      break;
    case 'streamError':
      if (streamMsgEl) {
        streamMsgEl.querySelector('.message-body').innerHTML =
          '<span style="color:var(--vscode-errorForeground)">' + escapeHtml(msg.content) + '</span>';
      }
      streaming = false;
      sendBtn.disabled = false;
      messagesEl.classList.remove('streaming');
      streamMsgEl = null;
      break;
    case 'fileCreated':
      var btns = messagesEl.querySelectorAll('.create-file-btn[data-path="' + msg.filePath + '"]');
      btns.forEach(function(b) { b.classList.add('done'); b.textContent = 'Created'; b.disabled = true; });
      updateAllFilesBar();
      break;
    case 'fileError':
      var ebtns = messagesEl.querySelectorAll('.create-file-btn[data-path="' + msg.filePath + '"]');
      ebtns.forEach(function(b) { b.classList.add('done'); b.textContent = 'Error'; });
      updateAllFilesBar();
      break;
    case 'contextUpdate':
      contextBar.className = 'visible';
      contextBar.textContent = msg.language + ' | ' + msg.filePath;
      break;
  }
});

vscode.postMessage({ type: 'getContext' });
})();
</script>
</body>
</html>`;
  }
}
