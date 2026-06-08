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
    webviewView.webview.html = this._getHtml();

    setWebviewPoster((msg: any) => webviewView.webview.postMessage(msg));

    webviewView.webview.onDidReceiveMessage(async (data: any) => {
      switch (data.type) {
        case 'sendMessage':
          await this._onChat(data.content, webviewView.webview);
          break;
        case 'getContext':
          await this._onContext(webviewView.webview);
          break;
        case 'createFile':
          await this._onCreateFile(data.path, data.content, webviewView.webview);
          break;
        case 'createFiles':
          await this._onCreateFiles(data.files, webviewView.webview);
          break;
      }
    });
  }

  private async _onChat(content: string, webview: vscode.Webview): Promise<void> {
    webview.postMessage({ type: 'addMsg', role: 'user', content });
    webview.postMessage({ type: 'start' });
    try {
      await streamChat(
        content,
        (t) => webview.postMessage({ type: 'chunk', content: t }),
        (t) => webview.postMessage({ type: 'think', text: t })
      );
    } catch (err: any) {
      webview.postMessage({ type: 'err', content: String(err?.message || err) });
    }
    webview.postMessage({ type: 'end' });
  }

  private async _onContext(webview: vscode.Webview): Promise<void> {
    try {
      const ctx = await getFullContext();
      if (ctx) webview.postMessage({ type: 'ctx', filePath: ctx.filePath, language: ctx.language });
    } catch { /* ignore */ }
  }

  private async _onCreateFile(path: string, content: string, webview: vscode.Webview): Promise<void> {
    try {
      await writeFile(path, content);
      webview.postMessage({ type: 'ok', path });
      vscode.window.showInformationMessage('Created: ' + path);
    } catch (err: any) {
      webview.postMessage({ type: 'fail', path, error: err.message });
    }
  }

  private async _onCreateFiles(files: { path: string; content: string }[], webview: vscode.Webview): Promise<void> {
    let ok = 0;
    for (const f of files) {
      try { await writeFile(f.path, f.content); webview.postMessage({ type: 'ok', path: f.path }); ok++; }
      catch (err: any) { webview.postMessage({ type: 'fail', path: f.path, error: err.message }); }
    }
    vscode.window.showInformationMessage('Created ' + ok + '/' + files.length + ' files.');
  }

  private _getHtml(): string {
    const tripleBacktick = String.raw`\x60\x60\x60`;
    return String.raw`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);height:100vh;display:flex;flex-direction:column}
#bar{display:none;padding:4px 10px;font-size:11px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-bottom:1px solid var(--vscode-panel-border)}
#bar.on{display:block}
#msgs{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
.m{position:relative;padding:7px 10px;border-radius:6px;max-width:100%;word-wrap:break-word;line-height:1.45}
.m.u{align-self:flex-end;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
.m.a{align-self:flex-start;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);white-space:pre-wrap}
.m .l{font-size:10px;font-weight:600;text-transform:uppercase;opacity:.65;margin-bottom:3px}
.cb{background:var(--vscode-textCodeBlock-background);padding:8px;border-radius:3px;overflow-x:auto;margin:5px 0;font-size:11px;font-family:var(--vscode-editor-font-family,monospace);white-space:pre}
.acts{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap}
.acts button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-panel-border);border-radius:3px;padding:2px 7px;cursor:pointer;font-size:10px}
.acts button:hover{background:var(--vscode-button-secondaryHoverBackground)}
.acts .nf{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;font-weight:600}
.acts .nf:hover{background:var(--vscode-button-hoverBackground)}
.acts .done{background:var(--vscode-inputValidation-infoBackground);cursor:default;opacity:.7}
#inp{border-top:1px solid var(--vscode-panel-border);padding:6px;display:flex;gap:5px}
#inp textarea{flex:1;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:3px;padding:7px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size,13px);resize:none;min-height:34px;max-height:100px}
#inp textarea:focus{outline:1px solid var(--vscode-focusBorder)}
#inp button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:0 12px;cursor:pointer;font-size:12px}
#inp button:hover{background:var(--vscode-button-hoverBackground)}
#inp button:disabled{opacity:.4}
.emp{text-align:center;color:var(--vscode-descriptionForeground);padding:30px 15px;margin-top:30px}
.emp h3{margin-bottom:6px;font-size:14px}
.emp p{font-size:11px;line-height:1.5}
.thk{margin:6px 0;border:1px solid var(--vscode-panel-border);border-radius:4px;overflow:hidden;font-size:11px}
.thk-t{display:flex;align-items:center;gap:4px;width:100%;padding:4px 8px;background:var(--vscode-sideBar-background);border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:10px;font-family:inherit}
.thk-t:hover{background:var(--vscode-list-hoverBackground)}
.thk-t .ar{transition:transform .15s;font-size:9px}
.thk-t.on .ar{transform:rotate(90deg)}
.thk-b{display:none;padding:6px 8px;background:var(--vscode-textCodeBlock-background);color:var(--vscode-descriptionForeground);max-height:160px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;border-top:1px solid var(--vscode-panel-border);font-size:10px;line-height:1.4}
.thk-b.on{display:block}
#pen{display:none;justify-content:space-between;align-items:center;padding:5px 8px;background:var(--vscode-badge-background);border-top:1px solid var(--vscode-panel-border)}
#pen.on{display:flex}
#pen span{font-size:10px;color:var(--vscode-descriptionForeground)}
#pen button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:10px}
</style></head><body>
<div id="bar"></div>
<div id="msgs"><div class="emp"><h3>Code AI</h3><p>Ask me to build anything.</p></div></div>
<div id="pen"><span id="pcnt">0 pending</span><button id="wall">Write All</button></div>
<div id="inp"><textarea id="uinput" placeholder="e.g., Create a Python web app..." rows="1"></textarea><button id="sbtn">Send</button></div>
<script>
(function(){
var V=acquireVsCodeApi();
var msgs=document.getElementById('msgs');
var uin=document.getElementById('uinput');
var sbtn=document.getElementById('sbtn');
var bar=document.getElementById('bar');
var pen=document.getElementById('pen');
var pcnt=document.getElementById('pcnt');
var wall=document.getElementById('wall');
var streaming=false;
var cur=null;

function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}

function markdown(text){
  // Simple: find code blocks using indexOf, no regex
  var bt='` + tripleBacktick + `';
  var result='';
  var i=0;
  var inCode=false;
  var lang='';
  while(true){
    var pos=text.indexOf(bt,i);
    if(pos===-1){
      if(inCode){
        result+='<div class="cb">'+esc(text.substring(i))+'</div>';
      }else{
        var t=text.substring(i).replace(/\n/g,'<br>');
        // bold
        t=t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
        // italic
        t=t.replace(/\*(.+?)\*/g,'<em>$1</em>');
        // inline code
        t=t.replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
        result+=t;
      }
      break;
    }
    if(!inCode){
      var t=text.substring(i,pos).replace(/\n/g,'<br>');
      t=t.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
      t=t.replace(/\*(.+?)\*/g,'<em>$1</em>');
      t=t.replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
      result+=t;
      inCode=true;
      i=pos+3;
      // check for language hint
      var nl=text.indexOf('\n',i);
      if(nl!==-1&&nl<i+30&&nl===pos+3+text.substring(i,nl).length&&!text.substring(i,nl).includes(' ')){
        lang=text.substring(i,nl);
        i=nl+1;
      }
      result+='<div class="cb">';
      if(lang)result+='<span style="font-size:10px;opacity:.6">'+esc(lang)+'</span>\n';
    }else{
      result+=esc(text.substring(i,pos))+'</div>';
      inCode=false;
      lang='';
      i=pos+3;
    }
  }
  if(inCode)result+='</div>';
  return result;
}

function addMsg(role,text){
  var e=msgs.querySelector('.emp');if(e)e.remove();
  var d=document.createElement('div');
  d.className='m '+(role==='user'?'u':'a');
  var l=document.createElement('div');l.className='l';
  l.textContent=role==='user'?'You':'AI';
  d.appendChild(l);
  var b=document.createElement('div');b.className='body';
  b.innerHTML=markdown(text);
  d.appendChild(b);
  wireCodes(d);
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
  return d
}

function wireCodes(msgDiv){
  var cbs=msgDiv.querySelectorAll('.cb');
  for(var j=0;j<cbs.length;j++){
    var cb=cbs[j];
    // skip if already has actions
    if(cb.nextElementSibling&&cb.nextElementSibling.classList.contains('acts'))continue;
    var codeText=cb.textContent||'';
    // strip the lang label line if present
    if(codeText.startsWith('\n'))codeText=codeText.substring(1);
    var nl2=codeText.indexOf('\n');
    if(nl2>0&&nl2<30&&!codeText.substring(0,nl2).includes(' ')&&codeText.substring(0,nl2).length<20){
      codeText=codeText.substring(nl2+1);
    }
    // detect file path from preceding text
    var fp='';
    var prev=cb.previousElementSibling;
    while(prev&&prev.tagName!=='DIV'||(prev&&!prev.classList.contains('cb')&&prev.tagName!=='HR')){
      if(!prev){break}
      prev=prev.previousElementSibling;
    }
    // check previous sibling for file path hint
    var pp=cb.parentElement;
    var all=pp.innerHTML;
    var idx=all.indexOf('>'+cb.outerHTML);
    if(idx===-1)idx=all.indexOf(cb.outerHTML);
    if(idx>0){
      var before=all.substring(Math.max(0,idx-300),idx);
      var fm=before.match(/FILE[:\s]+(\S+)/);
      if(fm)fp=fm[1];
    }

    var acts=document.createElement('div');acts.className='acts';
    var nb=document.createElement('button');nb.className='nf';
    nb.textContent=fp?'Create: '+fp:'Create File...';
    (function(p,code){
      nb.addEventListener('click',function(){
        var pp=p||prompt('Path:');
        if(!pp)return;
        V.postMessage({type:'createFile',path:pp,content:code});
        nb.disabled=true;nb.className='done';nb.textContent='Created';updPen();
      });
    })(fp,codeText);
    acts.appendChild(nb);
    var cp=document.createElement('button');cp.textContent='Copy';
    cp.addEventListener('click',function(){
      navigator.clipboard.writeText(codeText);cp.textContent='Copied!';
      setTimeout(function(){cp.textContent='Copy'},1500);
    });
    acts.appendChild(cp);
    cb.insertAdjacentElement('afterend',acts);
  }
}

function updPen(){
  var btns=msgs.querySelectorAll('.nf:not(.done):not(:disabled)');
  if(btns.length===0){pen.classList.remove('on')}
  else{pen.classList.add('on');pcnt.textContent=btns.length+' pending'}
}

function addThink(t){
  if(!cur)return;
  var ex=cur.querySelector('.thk');
  if(ex){ex.querySelector('.thk-b').textContent=t;ex.querySelector('.thk-b').scrollTop=9999}
  else{
    var box=document.createElement('div');box.className='thk';
    box.innerHTML='<button class="thk-t on"><span class="ar">&#9654;</span> Thinking</button><div class="thk-b on">'+esc(t)+'</div>';
    box.querySelector('.thk-t').addEventListener('click',function(){
      var on=box.querySelector('.thk-b').classList.toggle('on');
      box.querySelector('.thk-t').classList.toggle('on',on);
    });
    cur.querySelector('.body').appendChild(box);
  }
  msgs.scrollTop=msgs.scrollHeight
}

function sendMsg(){
  var t=uin.value.trim();if(!t||streaming)return;
  uin.value='';streaming=true;sbtn.disabled=true;
  V.postMessage({type:'sendMessage',content:t});
}

sbtn.addEventListener('click',sendMsg);
uin.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg()}});

wall.addEventListener('click',function(){
  var files=[];
  msgs.querySelectorAll('.nf:not(.done):not(:disabled)').forEach(function(btn){
    var cb=btn.parentElement.previousElementSibling;
    var code=cb.textContent||'';
    var nl=code.indexOf('\n');
    if(nl>0&&nl<30&&!code.substring(0,nl).includes(' '))code=code.substring(nl+1);
    var p='';
    if(btn.textContent.startsWith('Create: '))p=btn.textContent.slice(8);
    if(!p){p=prompt('Path:');if(!p)return}
    files.push({path:p,content:code});
    btn.disabled=true;btn.className='done';btn.textContent='Writing...';
  });
  if(files.length>0)V.postMessage({type:'createFiles',files:files});
  updPen()
});

window.addEventListener('message',function(e){
  var d=e.data;
  switch(d.type){
    case'addMsg':addMsg(d.role,d.content);break;
    case'clear':msgs.innerHTML='<div class="emp"><h3>Code AI</h3><p>Ask me to build anything.</p></div>';break;
    case'start':cur=addMsg('assistant','');break;
    case'chunk':if(cur){var b=cur.querySelector('.body');var raw=b.getAttribute('data-raw')||'';raw+=d.content;b.setAttribute('data-raw',raw);b.innerHTML=markdown(raw);wireCodes(cur);msgs.scrollTop=msgs.scrollHeight}break;
    case'think':addThink(d.text);break;
    case'end':streaming=false;sbtn.disabled=false;if(cur){wireCodes(cur);updPen()}cur=null;break;
    case'err':if(cur){cur.querySelector('.body').innerHTML='<span style="color:var(--vscode-errorForeground)">'+esc(d.content)+'</span>'}streaming=false;sbtn.disabled=false;cur=null;break;
    case'ctx':bar.classList.add('on');bar.textContent=(d.language||'')+' | '+(d.filePath||'');break;
    case'ok':msgs.querySelectorAll('.nf').forEach(function(b){if(b.textContent==='Create: '+d.path){b.className='done';b.textContent='Created';b.disabled=true}});updPen();break;
    case'fail':msgs.querySelectorAll('.nf').forEach(function(b){if(b.textContent==='Create: '+d.path){b.textContent='Error'}});updPen();break;
  }
});

V.postMessage({type:'getContext'});
})();
</script></body></html>`;
  }
}
