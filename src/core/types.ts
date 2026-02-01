/**
 * Core types - no vscode dependencies
 */

// Simple event emitter interface (replaces vscode.EventEmitter)
export interface Disposable {
  dispose(): void;
}

export interface Event<T> {
  (listener: (e: T) => void): Disposable;
}

// Simple logger type
export type LogFn = (message: string, ...args: any[]) => void;

// File content reader - abstracts away fs access
export interface FileReader {
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

// Git operations interface
export interface GitOperations {
  getChangedFiles(options?: { since?: string; staged?: boolean }): Promise<string[]>;
  getFileDiff(filePath: string, options?: { since?: string; context?: number }): Promise<string>;
  getDiff(options?: { since?: string }): Promise<string>;
  getCurrentRevision(): Promise<string>;
  getWorkspaceRoot(): string;
}
