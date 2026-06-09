import * as vscode from 'vscode';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join, dirname } from 'path';

const execAsync = promisify(exec);

// Shared VS Code terminal for showing commands to the user
let _codeAiTerm: vscode.Terminal | null = null;
function getCodeAiTerminal(): vscode.Terminal {
  if (!_codeAiTerm) {
    _codeAiTerm = vscode.window.createTerminal('Code AI');
  }
  return _codeAiTerm;
}

// ---- Tool Definitions ----

export interface ToolDef {
  name: string;
  description: string;
  parameters: string; // JSON schema string
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  callId?: string;
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content with line numbers.',
    parameters: `{
  "path": "relative or absolute path to the file",
  "offset": "optional, line number to start reading from (1-indexed)",
  "limit": "optional, max number of lines to read"
}`,
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with new content. Directories are created automatically.',
    parameters: `{
  "path": "relative path to the file (relative to workspace root)",
  "content": "the complete file content to write"
}`,
  },
  {
    name: 'grep',
    description: 'Search for a regex pattern across files. Returns matching file paths and line numbers.',
    parameters: `{
  "pattern": "regex pattern to search for",
  "path": "optional, directory or file to search in (default: workspace root)",
  "glob": "optional, file pattern filter like *.ts",
  "context": "optional, lines of context around matches (default: 2)"
}`,
  },
  {
    name: 'bash',
    description: 'Run a shell command (PowerShell on Windows). SAFETY: This runs real commands! Confirm the command is safe before using.',
    parameters: `{
  "command": "the command to run",
  "description": "brief description of what this command does"
}`,
  },
  {
    name: 'list_files',
    description: 'List files in a directory, optionally filtered by glob pattern.',
    parameters: `{
  "dir": "optional, directory to list (default: workspace root)",
  "pattern": "optional, glob pattern like **/*.ts"
}`,
  },
];

function toToolPrompt(): string {
  return TOOL_DEFS.map(
    (t) =>
      `<tool name="${t.name}">
<description>${t.description}</description>
<parameters>${t.parameters}</parameters>
</tool>`,
  ).join('\n');
}

export function getToolSystemPrompt(): string {
  return `
## Available Tools

You have access to the following tools. To use a tool, output a <tool> block with EXACTLY this format:

<tool name="tool_name">
{"key": "value", ...}
</tool>

After each <tool> block, the tool result will be injected into the conversation.
You can call multiple tools in a single response. The results will all be available before you reply.

IMPORTANT: Use FORWARD SLASHES in all paths! Example: c:/work/project/src/file.ts NOT c:\\work\\project\\src\\file.ts
Backslashes break JSON parsing. Forward slashes work everywhere: relative paths like "src/file.ts", absolute like "c:/work/project/src/file.ts".

Do NOT guess file contents — use read_file to read first.
Do NOT hallucinate code — use write_file to create files, then confirm.

${toToolPrompt()}

## Path Rules
- Always use FORWARD SLASHES: c:/work/project/src/main.ts
- Relative paths are fine: src/main.ts (resolved from workspace root)
- Never use backslashes \\\\ — they break the JSON parser

## Tool Usage Rules
1. list_files first to explore the project structure
2. read_file before editing — always read a file before modifying it
3. grep to find where code lives — search before guessing file locations
4. write_file creates or overwrites — provide COMPLETE file content, never partial
5. bash for git, npm, builds — describe what the command does
6. When done, respond with plain text (no tool blocks)

## Example
User: "What does the login function do?"
<tool name="grep">
{"pattern": "function login", "glob": "*.ts"}
</tool>
[Tool result shows matches]
<tool name="read_file">
{"path": "src/auth.ts", "offset": 42, "limit": 30}
</tool>
[Tool result shows the code]
The login function validates credentials against the database...
`.trim();
}

// ---- Tool Execution ----

function getWorkspaceRoot(): string {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) throw new Error('No workspace folder open');
  return ws.uri.fsPath;
}

function resolvePath(relPath: string): string {
  // Normalize backslashes to forward slashes (AI sometimes outputs them anyway)
  const fixed = relPath.replace(/\\/g, '/');
  const root = getWorkspaceRoot().replace(/\\/g, '/');

  // Already absolute? (e.g., c:/work/...)
  if (/^[a-zA-Z]:[/\\]/.test(fixed) || fixed.startsWith('/')) {
    return fixed;
  }
  // Remove leading ./ if present
  const clean = fixed.replace(/^\.\//, '');
  return join(root, clean).replace(/\\/g, '/');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function execReadFile(args: Record<string, unknown>): Promise<string> {
  const path = resolvePath(String(args.path || ''));
  const offset = Number(args.offset) || 1;
  const limit = Number(args.limit) || 200;

  // Check if it's a directory before trying to read
  try {
    const stat = await import('fs/promises').then(m => m.stat(path));
    if (stat.isDirectory()) {
      // List the directory contents instead
      const files = await import('fs/promises').then(m => m.readdir(path));
      const items = files.slice(0, 50).join('\n');
      return `"${path}" is a directory, not a file. Contents:\n${items}\n${files.length > 50 ? `\n... (${files.length - 50} more items)` : ''}\n\nUse read_file with a specific file path.`;
    }
  } catch {
    // File doesn't exist yet or can't stat — proceed to read attempt
  }

  const content = await readFile(path, 'utf-8');
  const lines = content.split('\n');
  const start = Math.max(0, offset - 1);
  const slice = limit ? lines.slice(start, start + limit) : lines.slice(start);
  return slice.map((line, i) => `${String(start + i + 1).padStart(4, ' ')}| ${line}`).join('\n');
}

async function execWriteFile(args: Record<string, unknown>): Promise<string> {
  const relPath = String(args.path || '');
  const content = String(args.content || '');
  const fullPath = resolvePath(relPath);

  // Security: validate path is within workspace
  const root = getWorkspaceRoot();
  if (!fullPath.startsWith(root)) {
    throw new Error(`Path must be inside workspace: ${relPath}`);
  }

  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');

  // Open in editor
  const doc = await vscode.workspace.openTextDocument(fullPath);
  await vscode.window.showTextDocument(doc, { preview: false });

  const lines = content.split('\n');
  return `Wrote ${lines.length} lines to ${relPath}`;
}

async function execGrep(args: Record<string, unknown>): Promise<string> {
  const pattern = String(args.pattern);
  const searchPath = args.path ? resolvePath(String(args.path)) : getWorkspaceRoot();
  const glob = args.glob ? String(args.glob) : null;
  const context = Number(args.context) || 2;
  const cwd = getWorkspaceRoot();

  // Try ripgrep → findstr (Windows) → git grep
  // All via exec() to avoid spawn/EPERM issues
  const tryRg = async (): Promise<string> => {
    const { stdout } = await execAsync(`rg --no-heading --line-number -C ${context} ${glob ? '-g ' + glob : ''} ${JSON.stringify(pattern)} "${searchPath}"`, { timeout: 10000, maxBuffer: 1024 * 500, cwd });
    return formatGrepOutput(stdout.trim());
  };

  const tryFindStr = async (): Promise<string> => {
    // findstr searches *.* under the given path with /s (recursive)
    const { stdout } = await execAsync(`findstr /s /n /i /c:${JSON.stringify(pattern)} "${searchPath}\\*.*"`, { timeout: 10000, cwd, maxBuffer: 1024 * 500 });
    return formatGrepOutput(stdout.trim());
  };

  const tryGitGrep = async (): Promise<string> => {
    const { stdout } = await execAsync(`git grep -n -C ${context} "${pattern.replace(/"/g, '\\"')}"`, { timeout: 10000, cwd, maxBuffer: 1024 * 500 });
    return formatGrepOutput(stdout.trim());
  };

  const attempts = [tryRg];
  if (process.platform === 'win32') {
    attempts.push(tryFindStr, tryGitGrep);
  } else {
    attempts.push(tryGitGrep);
  }

  for (const fn of attempts) {
    try {
      const result = await fn();
      if (result && result !== 'No matches found') return result;
    } catch { /* try next */ }
  }

  return 'No matches found';
}

function formatGrepOutput(stdout: string): string {
  if (!stdout) return 'No matches found';
  const lines = stdout.split('\n');
  if (lines.length > 100) {
    return lines.slice(0, 100).join('\n') + `\n... (${lines.length - 100} more matches, narrow your search)`;
  }
  return stdout;
}

async function execBash(args: Record<string, unknown>): Promise<string> {
  const command = String(args.command || '');
  const desc = String(args.description || '');

  // Safety check
  const dangerous = /\brm\s+-rf\b|\bgit\s+push\s+--force\b|\bformat\s+[A-Z]:|\bdel\s+\/[sq]\b/i;
  if (dangerous.test(command)) {
    return `BLOCKED: This command looks dangerous. Description: ${desc}`;
  }

  const cwd = getWorkspaceRoot();

  // Echo to VS Code terminal so user can watch
  const term = getCodeAiTerminal();
  term.show(true); // bring terminal into view
  term.sendText(command, false); // send command, don't auto-execute newline twice

  // Use exec() — runs through system shell (cmd.exe on Windows), no EPERM
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: 30000,
      maxBuffer: 1024 * 500,
      cwd,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    });
    const out = stdout.trim();
    const err = stderr.trim();
    if (out && err) return `${out}\n\n[stderr]:\n${err}`;
    return out || err || '(command completed, no output)';
  } catch (e: any) {
    if (e.killed) return 'Command timed out after 30s';
    return `Exit ${e.code || 'error'}: ${e.stderr || e.stdout || e.message}`;
  }
}

async function execListFiles(args: Record<string, unknown>): Promise<string> {
  const dir = args.dir || args.path ? resolvePath(String(args.dir || args.path)) : getWorkspaceRoot();
  const pattern = args.pattern ? String(args.pattern) : null;

  try {
    const globPattern = pattern || '**/*';
    const files = await vscode.workspace.findFiles(
      globPattern,
      '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/.next/**}',
      200,
    );
    // Filter: only files under the requested dir
    const normalizedDir = dir.replace(/\\/g, '/').toLowerCase();
    let paths = files
      .map((f) => vscode.workspace.asRelativePath(f).replace(/\\/g, '/'))
      .filter((p) => p.toLowerCase().startsWith(normalizedDir.toLowerCase()) || normalizedDir === getWorkspaceRoot().replace(/\\/g, '/').toLowerCase())
      .sort();

    // If no files found with workspace-relative filter, try without filter
    if (paths.length === 0 && !args.dir && !args.path) {
      paths = files.map((f) => vscode.workspace.asRelativePath(f).replace(/\\/g, '/')).sort();
    }

    if (paths.length >= 200) {
      return paths.slice(0, 200).join('\n') + `\n... (shown 200 of many files, use glob to narrow)`;
    }
    return paths.join('\n') || `No files found in ${dir}`;
  } catch (e: any) {
    return `Error listing files: ${e.message}`;
  }
}

export async function executeTool(call: ToolCall): Promise<string> {
  try {
    switch (call.name) {
      case 'read_file':
        return await execReadFile(call.args);
      case 'write_file':
        return await execWriteFile(call.args);
      case 'grep':
        return await execGrep(call.args);
      case 'bash':
        return await execBash(call.args);
      case 'list_files':
        return await execListFiles(call.args);
      default:
        return `Unknown tool: ${call.name}. Available: read_file, write_file, grep, bash, list_files`;
    }
  } catch (e: any) {
    return `Error: ${e.message}`;
  }
}

// ---- Tool Block Parser ----

const TOOL_BLOCK_RE = /<tool\s+name="([^"]+)"\s*>\s*\n?([\s\S]*?)\n?\s*<\/tool>/g;

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  let match: RegExpExecArray | null;
  while ((match = TOOL_BLOCK_RE.exec(text)) !== null) {
    try {
      const args = JSON.parse(match[2].trim());
      calls.push({ name: match[1], args });
    } catch {
      // Skip malformed tool calls
    }
  }
  return calls;
}

export function stripToolBlocks(text: string): string {
  return text.replace(TOOL_BLOCK_RE, '').trim();
}
