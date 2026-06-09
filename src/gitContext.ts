import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MAX_STATUS_CHARS = 2000;

export interface GitContext {
  branch: string;
  defaultBranch: string;
  status: string;
  recentCommits: string;
  userName: string;
}

let cachedGitContext: GitContext | null | undefined = undefined;

export async function getGitContext(
  cwd: string,
): Promise<GitContext | null> {
  if (cachedGitContext !== undefined) {
    return cachedGitContext;
  }

  try {
    const [branch, defaultBranch, status, log, userName] = await Promise.all([
      execFileAsync('git', ['-C', cwd, 'branch', '--show-current'])
        .then((r) => r.stdout.trim())
        .catch(() => ''),
      execFileAsync('git', [
        '-C',
        cwd,
        'rev-parse',
        '--abbrev-ref',
        'origin/HEAD',
      ])
        .then((r) => r.stdout.trim().replace('origin/', ''))
        .catch(() => 'main'),
      execFileAsync('git', [
        '-C',
        cwd,
        '--no-optional-locks',
        'status',
        '--short',
      ])
        .then((r) => r.stdout.trim())
        .catch(() => ''),
      execFileAsync('git', [
        '-C',
        cwd,
        '--no-optional-locks',
        'log',
        '--oneline',
        '-n',
        '5',
      ])
        .then((r) => r.stdout.trim())
        .catch(() => ''),
      execFileAsync('git', ['-C', cwd, 'config', 'user.name'])
        .then((r) => r.stdout.trim())
        .catch(() => ''),
    ]);

    if (!branch && !status) {
      cachedGitContext = null;
      return null;
    }

    const truncatedStatus =
      status.length > MAX_STATUS_CHARS
        ? status.substring(0, MAX_STATUS_CHARS) +
          '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" directly)'
        : status;

    cachedGitContext = {
      branch,
      defaultBranch,
      status: truncatedStatus,
      recentCommits: log,
      userName,
    };
  } catch {
    cachedGitContext = null;
  }

  return cachedGitContext;
}

export function formatGitContext(gc: GitContext): string {
  return [
    'This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.',
    `Current branch: ${gc.branch}`,
    `Main branch (you will usually use this for PRs): ${gc.defaultBranch}`,
    ...(gc.userName ? [`Git user: ${gc.userName}`] : []),
    `Status:\n${gc.status || '(clean)'}`,
    `Recent commits:\n${gc.recentCommits}`,
  ].join('\n\n');
}

export function clearGitContextCache(): void {
  cachedGitContext = undefined;
}
