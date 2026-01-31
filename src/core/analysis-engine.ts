import { DriftEvent } from "../models/drift";

export interface FileChange {
  fileUri: string;
  changeType: "created" | "modified" | "deleted";
  content?: string;
}

export interface AnalysisOptions {
  checkIntentViolations?: boolean;
  useCache?: boolean;
}

export interface AnalysisWarning {
  message: string;
  fileUri?: string;
}

export interface AnalysisResult {
  driftEvents: DriftEvent[];
  filesAnalyzed: number;
  intentsChecked: number;
  duration: number;
  warnings: AnalysisWarning[];
}

export interface IAnalysisEngine {
  analyzeFile(fileUri: string, options?: AnalysisOptions): Promise<AnalysisResult>;
  analyzeChanges(changes: FileChange[]): Promise<AnalysisResult>;
}
