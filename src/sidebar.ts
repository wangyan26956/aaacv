import * as vscode from 'vscode';
import { streamChat } from './claudeService';
import { getFullContext } from './contextProvider';
import { setWebviewPoster } from './commands';
import { writeFile } from './fileOps';

const BT = '```';

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

    webviewView.webview.onDidReceiveMessage(async (data: any) => {
      switch (data.type) {
        case 'send':
          await this._chat(data.text, webviewView.webview);
          break;
        case 'ctx':
          await this._ctx(webviewView.webview);
          break;
        case 'mk':
          await this._mk(data.path, data.code, webviewView.webview);
          break;
        case 'mkall':
          await this._mkall(data.list, webviewView.webview);
          break;
      }
    });
  }

  private async _chat(text: string, wv: vscode.Webview): Promise<void> {
    wv.postMessage({ type: 'msg', role: 'u', text });
    wv.postMessage({ type: 'start' });
    try {
      await streamChat(
        text,
        (t) => wv.postMessage({ type: 'tok', text: t }),
        (t) => wv.postMessage({ type: 'think', text: t })
      );
    } catch (e: any) { wv.postMessage({ type: 'err', text: String(e?.message || e) }); }
    wv.postMessage({ type: 'done' });
  }

  private async _ctx(wv: vscode.Webview): Promise<void> {
    try {
      const c = await getFullContext();
      if (c) wv.postMessage({ type: 'ctxv', file: c.filePath, lang: c.language });
    } catch { /* ok */ }
  }

  private async _mk(path: string, code: string, wv: vscode.Webview): Promise<void> {
    try { await writeFile(path, code); wv.postMessage({ type: 'ok', path }); }
    catch (e: any) { wv.postMessage({ type: 'fail', path, err: e.message }); }
  }

  private async _mkall(list: { path: string; code: string }[], wv: vscode.Webview): Promise<void> {
    let n = 0;
    for (const f of list) {
      try { await writeFile(f.path, f.code); wv.postMessage({ type: 'ok', path: f.path }); n++; }
      catch (e: any) { wv.postMessage({ type: 'fail', path: f.path, err: e.message }); }
    }
    vscode.window.showInformationMessage('Done: ' + n + '/' + list.length);
  }

  private _html(): string {
    // Minimal HTML - no regex, no markdown, just plain text chat with code creation buttons
    return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n' +
      '<meta http-equiv="Content-Security-Policy" content="default-src ' + "'none'" + '; style-src ' + "'unsafe-inline'" + '; script-src ' + "'unsafe-inline'" + ';">\n' +
      '<style>\n' +
      '*{margin:0;padding:0;box-sizing:border-box}\n' +
      'body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);background:var(--vscode-sideBar-background);height:100vh;display:flex;flex-direction:column}\n' +
      '#bar{display:none;padding:4px 10px;font-size:11px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-bottom:1px solid var(--vscode-panel-border)}\n' +
      '#bar.on{display:block}\n' +
      '#box{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}\n' +
      '.m{position:relative;padding:7px 10px;border-radius:6px;max-width:100%;word-wrap:break-word;line-height:1.45;white-space:pre-wrap}\n' +
      '.m.u{align-self:flex-end;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}\n' +
      '.m.a{align-self:flex-start;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border)}\n' +
      '.lbl{font-size:10px;font-weight:600;text-transform:uppercase;opacity:.65;margin-bottom:3px}\n' +
      '.cb{background:var(--vscode-textCodeBlock-background);padding:6px 8px;border-radius:3px;overflow-x:auto;margin:5px 0;font-size:11px;font-family:var(--vscode-editor-font-family,monospace);white-space:pre;max-height:300px;overflow-y:auto}\n' +
      '.btns{display:flex;gap:4px;margin-top:3px;flex-wrap:wrap}\n' +
      '.btns button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border);border-radius:3px;padding:2px 7px;cursor:pointer;font-size:10px}\n' +
      '.btns button:hover{background:var(--vscode-button-secondaryHoverBackground)}\n' +
      '.btns .cr{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;font-weight:600}\n' +
      '.btns .cr:hover{background:var(--vscode-button-hoverBackground)}\n' +
      '#foot{border-top:1px solid var(--vscode-panel-border);padding:6px;display:flex;gap:5px}\n' +
      '#foot textarea{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:3px;padding:7px;font-family:inherit;font-size:13px;resize:none;min-height:34px;max-height:100px}\n' +
      '#foot textarea:focus{outline:1px solid var(--vscode-focusBorder)}\n' +
      '#foot button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:0 12px;cursor:pointer;font-size:12px}\n' +
      '#foot button:hover{background:var(--vscode-button-hoverBackground)}\n' +
      '#foot button:disabled{opacity:.4}\n' +
      '.emp{text-align:center;color:var(--vscode-descriptionForeground);padding:30px 15px;margin-top:30px}\n' +
      '</style>\n</head>\n<body>\n' +
      '<div id="bar"></div>\n' +
      '<div id="box"><div class="emp" id="emp"><b>Code AI</b><br>Ask me to build anything.</div></div>\n' +
      '<div id="foot"><textarea id="inp" placeholder="Say something..." rows="1"></textarea><button id="snd">Send</button></div>\n' +
      '<script>\n' +
      '(function(){\n' +
      'var V=acquireVsCodeApi();\n' +
      'var box=document.getElementById("box");\n' +
      'var inp=document.getElementById("inp");\n' +
      'var snd=document.getElementById("snd");\n' +
      'var bar=document.getElementById("bar");\n' +
      'var emp=document.getElementById("emp");\n' +
      'var busy=false;\n' +
      'var cur=null;\n' +
      '\n' +
      'function esc(s){var d=document.createElement("div");d.textContent=s;return d.innerHTML}\n' +
      '\n' +
      '// Simple markdown: split by ```, wrap code blocks\n' +
      'function render(text){\n' +
      '  var i=0,out="",inCode=false;\n' +
      '  while(true){\n' +
      '    var p=text.indexOf("```",i);\n' +
      '    if(p===-1){out+=esc(text.slice(i));break}\n' +
      '    if(!inCode){out+=esc(text.slice(i,p));inCode=true;i=p+3;\n' +
      '      var nl=text.indexOf("\\n",i);\n' +
      '      if(nl!==-1&&nl<i+20&&text.slice(i,nl).indexOf(" ")===-1)i=nl+1;\n' +
      '      out+=\'<div class="cb">\'}\n' +
      '    else{out+=esc(text.slice(i,p))+"</div>";inCode=false;i=p+3}\n' +
      '  }\n' +
      '  if(inCode)out+="</div>";\n' +
      '  out=out.replace(/\\n/g,"<br>");\n' +
      '  out=out.replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>");\n' +
      '  out=out.replace(/\\*(.+?)\\*/g,"<em>$1</em>");\n' +
      '  out=out.replace(/`([^`]+)`/g,"<code>$1</code>");\n' +
      '  return out;\n' +
      '}\n' +
      '\n' +
      'function append(role,text){\n' +
      '  if(emp)emp.remove();\n' +
      '  var d=document.createElement("div");\n' +
      '  d.className="m "+(role==="u"?"u":"a");\n' +
      '  d.innerHTML=\'<div class="lbl">\'+(role==="u"?"You":"AI")+\'</div>\'+render(text);\n' +
      '  addButtons(d);\n' +
      '  box.appendChild(d);\n' +
      '  box.scrollTop=box.scrollHeight;\n' +
      '  return d\n' +
      '}\n' +
      '\n' +
      'function addButtons(msgEl){\n' +
      '  var cbs=msgEl.querySelectorAll(".cb");\n' +
      '  for(var j=0;j<cbs.length;j++){\n' +
      '    var cb=cbs[j];\n' +
      '    if(cb.nextElementSibling&&cb.nextElementSibling.className==="btns")continue;\n' +
      '    var code=cb.textContent||"";\n' +
      '    // Try to detect file path\n' +
      '    var fp="";\n' +
      '    try{\n' +
      '      var html=msgEl.innerHTML;\n' +
      '      var ci=html.indexOf(cb.outerHTML);\n' +
      '      if(ci>0){\n' +
      '        var pre=html.substring(Math.max(0,ci-400),ci);\n' +
      '        var m=pre.match(/FILE[:\\s]+(\\S+)/);\n' +
      '        if(m)fp=m[1];\n' +
      '      }\n' +
      '    }catch(e){}\n' +
      '    var div=document.createElement("div");div.className="btns";\n' +
      '    var nb=document.createElement("button");nb.className="cr";\n' +
      '    nb.textContent=fp?"Create: "+fp:"Create File...";\n' +
      '    (function(pth,code){\n' +
      '      nb.onclick=function(){\n' +
      '        var p=pth||prompt("Path:");if(!p)return;\n' +
      '        V.postMessage({type:"mk",path:p,code:code});\n' +
      '        nb.disabled=true;nb.textContent="Done";\n' +
      '      }\n' +
      '    })(fp,code);\n' +
      '    div.appendChild(nb);\n' +
      '    var cb2=document.createElement("button");cb2.textContent="Copy";\n' +
      '    cb2.onclick=function(){navigator.clipboard.writeText(code);cb2.textContent="Copied!";setTimeout(function(){cb2.textContent="Copy"},1500)};\n' +
      '    div.appendChild(cb2);\n' +
      '    cb.insertAdjacentElement("afterend",div);\n' +
      '  }\n' +
      '}\n' +
      '\n' +
      'function send(){\n' +
      '  var t=inp.value.trim();if(!t||busy)return;\n' +
      '  inp.value="";busy=true;snd.disabled=true;\n' +
      '  V.postMessage({type:"send",text:t});\n' +
      '}\n' +
      'snd.onclick=send;\n' +
      'inp.onkeydown=function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};\n' +
      '\n' +
      'window.addEventListener("message",function(e){\n' +
      '  var d=e.data;\n' +
      '  if(d.type==="msg")append(d.role,d.text);\n' +
      '  else if(d.type==="start"){cur=append("a","");busy=true}\n' +
      '  else if(d.type==="tok"&&cur){var b=cur;var raw=b.getAttribute("data-r")||"";raw+=d.text;b.setAttribute("data-r",raw);b.innerHTML=\'<div class="lbl">AI</div>\'+render(raw);addButtons(b);box.scrollTop=box.scrollHeight}\n' +
      '  else if(d.type==="think"&&cur){/* skip thinking for now */}\n' +
      '  else if(d.type==="done"){busy=false;snd.disabled=false;cur=null}\n' +
      '  else if(d.type==="err"&&cur){cur.innerHTML=\'<div class="lbl">AI</div><span style="color:var(--vscode-errorForeground)">\'+esc(d.text)+"</span>";busy=false;snd.disabled=false;cur=null}\n' +
      '  else if(d.type==="ctxv"){bar.className="on";bar.textContent=(d.lang||"")+" | "+(d.file||"")}\n' +
      '  else if(d.type==="ok"){var cbs=box.querySelectorAll(".cr");for(var i=0;i<cbs.length;i++){if(cbs[i].textContent==="Create: "+d.path){cbs[i].disabled=true;cbs[i].textContent="Created"}}}\n' +
      '});\n' +
      'V.postMessage({type:"ctx"});\n' +
      '})();\n' +
      '</script>\n</body>\n</html>';
  }
}
