import { renderMarkdown, renderMarkdownWithCodeActions } from './markdown';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};
const vscode = acquireVsCodeApi();

// State
let msgs: HTMLElement;
let input: HTMLTextAreaElement;
let btn: HTMLButtonElement;
let btnAgent: HTMLButtonElement;
let hdr: HTMLElement;
let empty: HTMLElement;
let busy = false;
let agentMode = false;
let curBubble: HTMLElement | null = null;
let curBuf = '';
let thinkingBuf = '';
let thinkingSection: HTMLDetailsElement | null = null;
let thinkingContent: HTMLElement | null = null;
let thinkingStart = 0;
let lastMsgText = '';

function hideEmpty(): void {
  if (empty) { empty.remove(); empty = null as any; }
}

function addBubble(role: string): HTMLElement {
  hideEmpty();
  const d = document.createElement('div');
  d.className = 'm ' + (role === 'user' ? 'u' : 'a');
  d.innerHTML = '<div class="lbl">' + (role === 'user' ? 'You' : role === 'tool' ? 'Tool' : 'AI') + '</div><div class="mc"></div>';
  msgs.appendChild(d);
  scrollBottom();
  return d;
}

function addToolBubble(name: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'm a tool-msg';
  d.innerHTML = '<div class="lbl tool-lbl">Tool: ' + escapeHtml(name) + '</div><div class="mc"></div>';
  msgs.appendChild(d);
  scrollBottom();
  return d;
}

function addThinkingSection(parent: HTMLElement): { el: HTMLDetailsElement; content: HTMLElement } {
  const details = document.createElement('details') as HTMLDetailsElement;
  details.className = 'think';
  details.open = true;
  details.innerHTML =
    '<summary>Thinking...</summary>' +
    '<div class="think-content"></div>';
  parent.appendChild(details);
  return { el: details, content: details.querySelector('.think-content')! };
}

function finalizeThinking(): void {
  if (!thinkingSection) return;
  const elapsed = thinkingStart ? ((Date.now() - thinkingStart) / 1000).toFixed(1) : '0.0';
  const summary = thinkingSection.querySelector('summary')!;
  summary.textContent = 'Thinking (' + elapsed + 's)';
  thinkingSection.open = false;
  thinkingSection = null;
  thinkingContent = null;
  thinkingBuf = '';
}

function scrollBottom(): void {
  msgs.scrollTop = msgs.scrollHeight;
}

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- Message Handler ----

function handleMessage(data: any): void {
  const t = data.t || data.type;

  // Agent events
  if (t === 'thinking' && !data.t) {
    thinkingBuf += data.text || '';
    if (!thinkingSection && curBubble) {
      const s = addThinkingSection(curBubble);
      thinkingSection = s.el;
      thinkingContent = s.content;
    }
    if (thinkingContent) {
      thinkingContent.textContent = thinkingBuf;
      scrollBottom();
    }
    return;
  }
  if (t === 'tool_start' && !data.t) {
    if (busy && curBubble && thinkingSection) {
      finalizeThinking();
    }
    const toolBubble = addToolBubble(data.call.name);
    toolBubble.querySelector('.mc')!.innerHTML =
      '<pre class="tool-args">' + escapeHtml(JSON.stringify(data.call.args, null, 2)) + '</pre>' +
      '<div class="tool-status"><span class="spinner"></span> Running...</div>';
    toolBubble.setAttribute('data-call', JSON.stringify(data.call));
    scrollBottom();
    return;
  }
  if (t === 'tool_result' && !data.t) {
    // Update the last tool bubble with the result
    const toolBubbles = msgs.querySelectorAll('.tool-msg');
    const last = toolBubbles[toolBubbles.length - 1] as HTMLElement;
    if (last) {
      const statusEl = last.querySelector('.tool-status');
      if (statusEl) {
        const result = data.result || '';
        const truncated = result.length > 2000 ? result.slice(0, 2000) + '\n... (truncated)' : result;
        statusEl.innerHTML = '<pre class="tool-result">' + escapeHtml(truncated) + '</pre>';
      }
    }
    scrollBottom();
    return;
  }
  if (t === 'error' && !data.t) {
    if (curBubble) {
      curBubble.classList.add('err');
      const mc = curBubble.querySelector('.mc')!;
      mc.innerHTML += '<p class="err-msg">' + escapeHtml(data.message) + '</p>';
    }
    busy = false;
    btn.disabled = false;
    btnAgent.disabled = false;
    curBubble = null;
    curBuf = '';
    return;
  }

  // Standard protocol messages
  switch (t) {
    case 'm':
      const bubble = addBubble(data.r);
      const mc = bubble.querySelector('.mc')!;
      mc.innerHTML = data.r === 'assistant'
        ? renderMarkdownWithCodeActions(data.x)
        : '<p>' + escapeHtml(data.x) + '</p>';
      lastMsgText = data.x;
      break;

    case 'st':
      curBubble = addBubble('assistant');
      curBuf = '';
      thinkingBuf = '';
      thinkingSection = null;
      thinkingContent = null;
      thinkingStart = Date.now();
      busy = true;
      btn.disabled = true;
      btnAgent.disabled = true;
      break;

    case 'tk':
      curBuf += data.x;
      if (curBubble) {
        curBubble.querySelector('.mc')!.innerHTML = renderMarkdown(curBuf);
        scrollBottom();
      }
      break;

    case 'th':
      thinkingBuf += data.x;
      if (!thinkingSection && curBubble) {
        const s = addThinkingSection(curBubble);
        thinkingSection = s.el;
        thinkingContent = s.content;
      }
      if (thinkingContent) {
        thinkingContent.textContent = thinkingBuf;
        scrollBottom();
      }
      break;

    case 'dn':
      finalizeThinking();
      busy = false;
      btn.disabled = false;
      btnAgent.disabled = false;
      curBubble = null;
      lastMsgText = curBuf;
      curBuf = '';
      break;

    case 'er':
      finalizeThinking();
      if (curBubble) {
        curBubble.classList.add('err');
        curBubble.querySelector('.mc')!.innerHTML = '<p>' + escapeHtml(data.x) + '</p>';
      }
      busy = false;
      btn.disabled = false;
      btnAgent.disabled = false;
      curBubble = null;
      curBuf = '';
      break;

    case 'ct':
      hdr.className = 'on';
      hdr.textContent = (data.l || '') + ' | ' + (data.f || '');
      break;

    case 'ok':
      // File created
      break;

    case 'fl':
      // File failed
      break;

    case 'clear':
      msgs.innerHTML = '<div class="emp" id="emp"><b>Code AI</b><br>Ask me to build anything.</div>';
      empty = msgs.querySelector('#emp')!;
      busy = false;
      btn.disabled = false;
      btnAgent.disabled = false;
      curBubble = null;
      curBuf = '';
      break;

    case 'hist':
      for (const msg of data.msgs) {
        const bubble = addBubble(msg.role);
        const mc = bubble.querySelector('.mc')!;
        mc.innerHTML = msg.role === 'assistant'
          ? renderMarkdownWithCodeActions(msg.content)
          : '<p>' + escapeHtml(msg.content) + '</p>';
      }
      break;
  }
}

// ---- Send ----

function send(): void {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  busy = true;
  btn.disabled = true;
  btnAgent.disabled = true;
  vscode.postMessage({ t: 's', x: text, agent: agentMode });
}

function toggleAgent(): void {
  agentMode = !agentMode;
  btnAgent.classList.toggle('active', agentMode);
  btnAgent.title = agentMode
    ? 'Agent mode ON — AI can read/write files and run commands'
    : 'Agent mode OFF — click to enable autonomous tool use';
  input.placeholder = agentMode
    ? 'Agent mode — say what you want done...'
    : 'Say something...';
}

// ---- Init ----

function init(): void {
  msgs = document.getElementById('msgs')!;
  input = document.getElementById('tin') as HTMLTextAreaElement;
  btn = document.getElementById('btn') as HTMLButtonElement;
  btnAgent = document.getElementById('btn-agent') as HTMLButtonElement;
  hdr = document.getElementById('hdr')!;
  empty = document.getElementById('emp')!;

  btn.onclick = send;
  btnAgent.onclick = toggleAgent;
  btnAgent.title = 'Agent mode OFF — click to enable autonomous tool use';

  input.onkeydown = function (e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Enter' && e.ctrlKey) { toggleAgent(); }
  };

  window.addEventListener('message', function (e: MessageEvent) {
    handleMessage(e.data);
  });

  // Request context
  vscode.postMessage({ t: 'c' });

  // Code copy button delegation
  msgs.addEventListener('click', function (e: Event) {
    const target = e.target as HTMLElement;
    if (target.classList.contains('cb-copy')) {
      const code = target.getAttribute('data-code') || '';
      navigator.clipboard.writeText(code).then(() => {
        target.textContent = 'Copied!';
        target.classList.add('copied');
        setTimeout(() => {
          target.textContent = 'Copy';
          target.classList.remove('copied');
        }, 1500);
      }).catch(() => {});
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
