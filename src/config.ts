import * as vscode from 'vscode';

export type Provider = 'aia' | 'qwen';

export function getConfig(): AiaConfig {
  const cfg = vscode.workspace.getConfiguration('claudeCode');
  return {
    // Provider selection
    provider: (cfg.get<string>('provider', 'aia') as Provider) || 'aia',

    // AIA (internal API)
    token: cfg.get<string>('token', ''),
    baseUrl: cfg.get<string>('baseUrl',
      'https://jvs-cn.aia.biz/p/staff_assistant/baixiaosheng/model_ask_question',
    ),
    kbId: cfg.get<string>('kbId', 'deepseek'),
    reasoningModel: cfg.get<boolean>('reasoningModel', true),
    webSearch: cfg.get<boolean>('webSearch', true),

    // Qwen (DashScope)
    qwenApiKey: cfg.get<string>('qwenApiKey', ''),
    qwenModel: cfg.get<string>('qwenModel', 'qwen-plus'),
    qwenBaseUrl: cfg.get<string>('qwenBaseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),

    // Common
    verifySsl: cfg.get<boolean>('verifySsl', false),
    showThinking: cfg.get<boolean>('showThinking', false),
    maxHistoryLength: cfg.get<number>('maxHistoryLength', 50),
  };
}

export interface AiaConfig {
  provider: Provider;
  // AIA
  token: string;
  baseUrl: string;
  kbId: string;
  reasoningModel: boolean;
  webSearch: boolean;
  // Qwen
  qwenApiKey: string;
  qwenModel: string;
  qwenBaseUrl: string;
  // Common
  verifySsl: boolean;
  showThinking: boolean;
  maxHistoryLength: number;
}
