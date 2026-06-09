// Message types shared between extension host and webview

// Direction: Webview -> Extension
export interface ToExtensionSendMessage {
  t: 's';
  x: string;
}

export interface ToExtensionRequestContext {
  t: 'c';
}

export interface ToExtensionCreateFile {
  t: 'f';
  p: string;
  z: string;
}

export interface ToExtensionCreateFiles {
  t: 'a';
  l: { p: string; z: string }[];
}

export type ToExtensionMessage =
  | ToExtensionSendMessage
  | ToExtensionRequestContext
  | ToExtensionCreateFile
  | ToExtensionCreateFiles;

// Direction: Extension -> Webview
export interface ToWebviewSimpleMessage {
  t: 'm';
  r: 'user' | 'assistant';
  x: string;
}

export interface ToWebviewStreamStart {
  t: 'st';
}

export interface ToWebviewStreamToken {
  t: 'tk';
  x: string;
}

export interface ToWebviewThinkingToken {
  t: 'th';
  x: string;
}

export interface ToWebviewStreamDone {
  t: 'dn';
}

export interface ToWebviewStreamError {
  t: 'er';
  x: string;
}

export interface ToWebviewContextInfo {
  t: 'ct';
  f: string;
  l: string;
}

export interface ToWebviewFileCreated {
  t: 'ok';
  p: string;
}

export interface ToWebviewFileFailed {
  t: 'fl';
  p: string;
  e: string;
}

export interface ToWebviewClearMessages {
  t: 'clear';
}

export interface ToWebviewInitHistory {
  t: 'hist';
  msgs: { role: 'user' | 'assistant'; content: string }[];
}

export type ToWebviewMessage =
  | ToWebviewSimpleMessage
  | ToWebviewStreamStart
  | ToWebviewStreamToken
  | ToWebviewThinkingToken
  | ToWebviewStreamDone
  | ToWebviewStreamError
  | ToWebviewContextInfo
  | ToWebviewFileCreated
  | ToWebviewFileFailed
  | ToWebviewClearMessages
  | ToWebviewInitHistory;
