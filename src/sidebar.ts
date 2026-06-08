import * as vscode from 'vscode';
import { streamChat } from './claudeService';
import { getFullContext } from './contextProvider';
import { setWebviewPoster } from './commands';
import { writeFile } from './fileOps';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'claudeCode.chatView';
  private _v?: vscode.WebviewView;

  constructor(private _u: vscode.Uri) {}

  resolveWebviewView(wv: vscode.WebviewView): void {
    this._v = wv;
    wv.webview.options = { enableScripts: true, localResourceRoots: [this._u] };
    wv.webview.html = html();
    setWebviewPoster((m: any) => wv.webview.postMessage(m));
    wv.webview.onDidReceiveMessage((d: any) => {
      if (d.t === 's') this._chat(d.x, wv.webview);
      else if (d.t === 'c') this._ctx(wv.webview);
      else if (d.t === 'f') this._mk(d.p, d.z, wv.webview);
      else if (d.t === 'a') this._mka(d.l, wv.webview);
    });
  }

  private async _chat(t: string, wv: vscode.Webview): Promise<void> {
    wv.postMessage({ t: 'm', r: 'u', x: t });
    wv.postMessage({ t: 'st' });
    try {
      await streamChat(t, (c) => wv.postMessage({ t: 'tk', x: c }), () => {});
    } catch (e: any) { wv.postMessage({ t: 'er', x: String(e?.message || e) }); }
    wv.postMessage({ t: 'dn' });
  }

  private async _ctx(wv: vscode.Webview): Promise<void> {
    try { const c = await getFullContext(); if (c) wv.postMessage({ t: 'ct', f: c.filePath, l: c.language }); } catch {}
  }

  private async _mk(p: string, z: string, wv: vscode.Webview): Promise<void> {
    try { await writeFile(p, z); wv.postMessage({ t: 'ok', p }); vscode.window.showInformationMessage('Created: ' + p); }
    catch (e: any) { wv.postMessage({ t: 'fl', p, e: e.message }); }
  }

  private async _mka(l: { p: string; z: string }[], wv: vscode.Webview): Promise<void> {
    let n = 0; for (const f of l) {
      try { await writeFile(f.p, f.z); wv.postMessage({ t: 'ok', p: f.p }); n++; }
      catch (e: any) { wv.postMessage({ t: 'fl', p: f.p, e: e.message }); }
    }
    vscode.window.showInformationMessage('Done: ' + n + '/' + l.length);
  }
}

function html(): string {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src ' + "'none'" + '; style-src ' + "'unsafe-inline'" + '; script-src ' + "'unsafe-inline'" + ';">' +
    '<style>' +
    '*{margin:0;padding:0;box-sizing:border-box}' +
    'body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);height:100vh;display:flex;flex-direction:column}' +
    '#hdr{display:none;padding:4px 10px;font-size:11px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-bottom:1px solid var(--vscode-panel-border)}' +
    '#hdr.on{display:block}' +
    '#msgs{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}' +
    '.m{padding:7px 10px;border-radius:6px;max-width:100%;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}' +
    '.m.u{align-self:flex-end;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}' +
    '.m.a{align-self:flex-start;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border)}' +
    '.lbl{font-size:10px;font-weight:600;text-transform:uppercase;opacity:.65;margin-bottom:3px}' +
    '#foot{border-top:1px solid var(--vscode-panel-border);padding:6px;display:flex;gap:5px}' +
    '#foot textarea{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:3px;padding:7px;font-family:inherit;font-size:13px;resize:none;min-height:34px;max-height:100px}' +
    '#foot textarea:focus{outline:1px solid var(--vscode-focusBorder)}' +
    '#foot button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:0 12px;cursor:pointer;font-size:12px}' +
    '#foot button:hover{background:var(--vscode-button-hoverBackground)}' +
    '#foot button:disabled{opacity:.4}' +
    '.emp{text-align:center;color:var(--vscode-descriptionForeground);padding:30px 15px;margin-top:30px}' +
    '</style></head><body><div id="hdr"></div>' +
    '<div id="msgs"><div class="emp" id="emp"><b>Code AI</b><br>Ask me to build anything.</div></div>' +
    '<div id="foot"><textarea id="tin" placeholder="Say something..." rows="1"></textarea><button id="btn">Send</button></div>' +
    '<script>' +
    '(function(){' +
    'var V=acquireVsCodeApi();' +
    'var B=document.getElementById("msgs");' +
    'var I=document.getElementById("tin");' +
    'var N=document.getElementById("btn");' +
    'var H=document.getElementById("hdr");' +
    'var E=document.getElementById("emp");' +
    'var busy=false,cur=null;' +
    'function esc(s){var d=document.createElement("div");d.textContent=s||"";return d.innerHTML}' +
    'function put(r,t){' +
    '  if(E){E.remove();E=null}' +
    '  var d=document.createElement("div");' +
    '  d.className="m "+(r==="u"?"u":"a");' +
    '  d.innerHTML="<div class=\\"lbl\\">"+(r==="u"?"You":"AI")+"<\\/div><div>"+esc(t)+"<\\/div>";' +
    '  B.appendChild(d);B.scrollTop=B.scrollHeight;return d' +
    '}' +
    'function send(){' +
    '  var t=I.value.trim();if(!t||busy)return;' +
    '  I.value="";busy=true;N.disabled=true;' +
    '  V.postMessage({t:"s",x:t});' +
    '}' +
    'N.onclick=send;' +
    'I.onkeydown=function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};' +
    'window.addEventListener("message",function(e){' +
    '  var d=e.data;' +
    '  if(d.t==="m")put(d.r,d.x);' +
    '  else if(d.t==="st"){cur=put("a","");busy=true}' +
    '  else if(d.t==="tk"&&cur){var c=cur.children[1];c.textContent+=d.x;B.scrollTop=B.scrollHeight}' +
    '  else if(d.t==="dn"){busy=false;N.disabled=false;cur=null}' +
    '  else if(d.t==="er"&&cur){cur.children[1].textContent="Error: "+d.x;busy=false;N.disabled=false;cur=null}' +
    '  else if(d.t==="ct"){H.className="on";H.textContent=(d.l||"")+" | "+(d.f||"")}' +
    '});' +
    'V.postMessage({t:"c"});' +
    '})();' +
    '</script></body></html>';
}
