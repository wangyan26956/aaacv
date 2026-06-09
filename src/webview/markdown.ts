import { marked } from 'marked';

// Characters that indicate markdown syntax (adopted from ccread/src/components/Markdown.tsx)
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function hasMarkdownSyntax(s: string): boolean {
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}

export function renderMarkdown(content: string): string {
  if (!hasMarkdownSyntax(content)) {
    return `<p>${escapeHtml(content)}</p>`;
  }
  return marked.parse(content, { gfm: true, breaks: false }) as string;
}

// Custom renderer that adds action buttons to code blocks
export function renderMarkdownWithCodeActions(content: string): string {
  if (!content) return '';
  if (!hasMarkdownSyntax(content)) {
    return `<p>${escapeHtml(content)}</p>`;
  }

  const renderer = new marked.Renderer();
  renderer.code = function ({ text, lang }: { text: string; lang?: string }) {
    const langLabel = lang ? `<span class="cb-lang">${escapeHtml(lang)}</span>` : '';
    const escapedCode = escapeHtml(text);
    return (
      `<div class="code-block">` +
      `<div class="cb-header">${langLabel}<button class="cb-copy" data-code="${escapeHtml(text)}" title="Copy code">Copy</button></div>` +
      `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapedCode}</code></pre>` +
      `</div>`
    );
  };

  return marked.parse(content, { gfm: true, breaks: false, renderer }) as string;
}
