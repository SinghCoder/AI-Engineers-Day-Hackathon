import {
  IAnalysisEngine,
  FileChange,
  AnalysisOptions,
  AnalysisResult,
} from "../core/analysis-engine";
import { IIntentStore } from "../core/store";
import { IAttributionSource } from "../core/attribution-source";
import { ILLMService } from "../core/llm-service";
import { DriftDetector, LogFn } from "./drift-detector";
import { DriftEvent } from "../models/drift";

export class AnalysisEngine implements IAnalysisEngine {
  private detector: DriftDetector;

  constructor(
    private readonly store: IIntentStore,
    private readonly attributionSource: IAttributionSource,
    private readonly llmService: ILLMService,
    logFn?: LogFn
  ) {
    this.detector = new DriftDetector(store, attributionSource, llmService, logFn);
  }

  async analyzeFile(fileUri: string, options?: AnalysisOptions): Promise<AnalysisResult> {
    const startTime = Date.now();
    const warnings: { message: string; fileUri?: string }[] = [];

    // Clear existing drift events for this file
    if (!options?.useCache) {
      await this.store.clearDriftEvents(fileUri);
    }

    // Run detection
    const { events, intentsChecked } = await this.detector.detectInFile(fileUri);

    // Save new drift events
    for (const event of events) {
      await this.store.saveDriftEvent(event);
    }

    return {
      driftEvents: events,
      filesAnalyzed: 1,
      intentsChecked,
      duration: Date.now() - startTime,
      warnings,
    };
  }

  async analyzeChanges(changes: FileChange[]): Promise<AnalysisResult> {
    const startTime = Date.now();
    const allEvents: DriftEvent[] = [];
    const warnings: { message: string; fileUri?: string }[] = [];
    let totalIntentsChecked = 0;

    for (const change of changes) {
      if (change.changeType === "deleted") {
        // Clear drift events for deleted files
        await this.store.clearDriftEvents(change.fileUri);
        continue;
      }

      const result = await this.analyzeFile(change.fileUri);
      allEvents.push(...result.driftEvents);
      totalIntentsChecked += result.intentsChecked;
      warnings.push(...result.warnings);
    }

    return {
      driftEvents: allEvents,
      filesAnalyzed: changes.length,
      intentsChecked: totalIntentsChecked,
      duration: Date.now() - startTime,
      warnings,
    };
  }
}
