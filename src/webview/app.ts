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
let hdr: HTMLElement;
let empty: HTMLElement;
let busy = false;
let curBubble: HTMLElement | null = null;
let curBuf = '';
let thinkingBuf = '';
let thinkingSection: HTMLDetailsElement | null = null;
let thinkingContent: HTMLElement | null = null;
let thinkingStart = 0;

function hideEmpty(): void {
  if (empty) { empty.remove(); empty = null as any; }
}

function addBubble(role: string): HTMLElement {
  hideEmpty();
  const d = document.createElement('div');
  d.className = 'm ' + (role === 'user' ? 'u' : 'a');
  d.innerHTML = '<div class="lbl">' + (role === 'user' ? 'You' : 'AI') + '</div><div class="mc"></div>';
  msgs.appendChild(d);
  scrollBottom();
  return d;
}

function addToolBubble(name: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'm a tool-msg';
  d.innerHTML = '<div class="lbl tool-lbl">' + escapeHtml(name) + '</div><div class="mc"></div>';
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

// ---- Message Handler ----
// Events from agent mode use {type: '...'} format
// Events from old protocol use {t: '...'} format

function handleMessage(data: any): void {
  // Agent events (sent by sidebar during agent mode)
  const evType = data.type;
  if (evType) {
    switch (evType) {
      case 'thinking':
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

      case 'text':
        if (curBubble) {
          curBuf += data.text;
          curBubble.querySelector('.mc')!.innerHTML = renderMarkdown(curBuf);
          scrollBottom();
        }
        return;

      case 'tool_start':
        finalizeThinking();
        addToolBubble(data.call.name);
        scrollBottom();
        return;

      case 'tool_result':
        // Show result in a tool bubble
        {
          const result = data.result || '';
          const truncated = result.length > 2000 ? result.slice(0, 2000) + '\n... (truncated)' : result;
          const d = document.createElement('div');
          d.className = 'm a tool-result-msg';
          d.innerHTML = '<div class="tool-result-text"><pre>' + escapeHtml(truncated) + '</pre></div>';
          msgs.appendChild(d);
          scrollBottom();
        }
        return;

      case 'done':
        finalizeThinking();
        busy = false;
        btn.disabled = false;
        curBubble = null;
        curBuf = '';
        return;

      case 'error':
        if (curBubble) {
          curBubble.classList.add('err');
          curBubble.querySelector('.mc')!.innerHTML += '<p class="err-msg">' + escapeHtml(data.message) + '</p>';
        }
        busy = false;
        btn.disabled = false;
        curBubble = null;
        curBuf = '';
        return;
    }
  }

  // Standard protocol messages
  switch (data.t) {
    case 'm':
      {
        const bubble = addBubble(data.r);
        const mc = bubble.querySelector('.mc')!;
        mc.innerHTML = data.r === 'assistant'
          ? renderMarkdownWithCodeActions(data.x)
          : '<p>' + escapeHtml(data.x) + '</p>';
      }
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
      curBubble = null;
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
      curBubble = null;
      curBuf = '';
      break;

    case 'ct':
      hdr.className = 'on';
      hdr.textContent = (data.l || '') + ' | ' + (data.f || '');
      break;

    case 'clear':
      msgs.innerHTML = '<div class="emp" id="emp"><b>Code AI</b><br>Ask me to build anything.</div>';
      empty = msgs.querySelector('#emp')!;
      busy = false;
      btn.disabled = false;
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
  vscode.postMessage({ t: 's', x: text });
}

// ---- Init ----

function init(): void {
  msgs = document.getElementById('msgs')!;
  input = document.getElementById('tin') as HTMLTextAreaElement;
  btn = document.getElementById('btn') as HTMLButtonElement;
  hdr = document.getElementById('hdr')!;
  empty = document.getElementById('emp')!;

  btn.onclick = send;

  input.onkeydown = function (e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  window.addEventListener('message', function (e: MessageEvent) {
    handleMessage(e.data);
  });

  // Request context from extension
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
