import * as vscode from 'vscode';

export function getConfig(): AiaConfig {
  const cfg = vscode.workspace.getConfiguration('claudeCode');
  return {
    token: cfg.get<string>('token', ''),
    baseUrl: cfg.get<string>('baseUrl', 'https://jvs-cn.aia.biz/p/staff_assistant/baixiaosheng/model_ask_question'),
    kbId: cfg.get<string>('kbId', 'deepseek'),
    reasoningModel: cfg.get<boolean>('reasoningModel', true),
    webSearch: cfg.get<boolean>('webSearch', true),
    verifySsl: cfg.get<boolean>('verifySsl', false),
    showThinking: cfg.get<boolean>('showThinking', false),
    maxHistoryLength: cfg.get<number>('maxHistoryLength', 50),
  };
}

export interface AiaConfig {
  token: string;
  baseUrl: string;
  kbId: string;
  reasoningModel: boolean;
  webSearch: boolean;
  verifySsl: boolean;
  showThinking: boolean;
  maxHistoryLength: number;
}
