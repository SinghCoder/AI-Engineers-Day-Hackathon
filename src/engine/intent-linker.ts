import { IIntentStore } from "../core/store";
import { IAttributionSource, AttributionSpan } from "../core/attribution-source";
import { IntentNode, IntentLink, createIntentLink } from "../models/intent";
import { SourceReference } from "../core/intent-source";
import { ConversationLoader } from "../core/intent-mesh-core";

/**
 * Links intents to code based on:
 * 1. Conversation URL matching (from Agent Trace)
 * 2. Semantic similarity (future)
 */
export class IntentLinker {
  constructor(
    private readonly store: IIntentStore,
    private readonly attributionSource: IAttributionSource,
    private readonly conversationLoader?: ConversationLoader
  ) {}

  /**
   * Auto-link an intent to code using Agent Trace conversation URLs
   */
  async linkIntentByConversation(intent: IntentNode): Promise<IntentLink[]> {
    const links: IntentLink[] = [];

    // Get conversation IDs from the intent's sources
    const conversationIds = this.extractConversationIds(intent.sources);
    
    if (conversationIds.length === 0 || !this.conversationLoader) {
      return links;
    }

    // Use conversation loader to find files and ranges
    for (const conversationId of conversationIds) {
      try {
        const fileRanges = await (this.conversationLoader as any).getFileRangesForConversation?.(conversationId);
        
        if (fileRanges && Array.isArray(fileRanges)) {
          for (const range of fileRanges) {
            const link = await this.createLink(
              intent.id,
              `file://${range.filePath}`,
              range.startLine,
              range.endLine,
              `Auto-linked from conversation ${conversationId}`
            );
            links.push(link);
          }
        }
      } catch (error) {
        // Conversation loader error - continue silently
      }
    }
    
    return links;
  }

  /**
   * Link intent to a specific file range (manual or after finding a match)
   */
  async createLink(
    intentId: string,
    fileUri: string,
    startLine?: number,
    endLine?: number,
    rationale?: string
  ): Promise<IntentLink> {
    const link = createIntentLink({
      intentId,
      fileUri,
      startLine,
      endLine,
      linkType: startLine ? "inferred" : "manual",
      confidence: 0.8,
      rationale,
    });

    await this.store.saveLink(link);
    return link;
  }

  /**
   * Find intents that should apply to a given file based on existing links
   */
  async getIntentsForFile(fileUri: string): Promise<IntentNode[]> {
    const links = await this.store.getLinksForFile(fileUri);
    const intentIds = [...new Set(links.map((l) => l.intentId))];
    
    const intents: IntentNode[] = [];
    for (const id of intentIds) {
      const intent = await this.store.getIntent(id);
      if (intent && intent.status === "active") {
        intents.push(intent);
      }
    }
    
    return intents;
  }

  /**
   * Get links that apply to a specific range in a file
   */
  async getLinksForRange(
    fileUri: string,
    startLine: number,
    endLine: number
  ): Promise<IntentLink[]> {
    const fileLinks = await this.store.getLinksForFile(fileUri);
    
    return fileLinks.filter((link) => {
      // If link has no line range, it applies to whole file
      if (!link.startLine || !link.endLine) {
        return true;
      }
      // Check if ranges overlap
      return link.startLine <= endLine && link.endLine >= startLine;
    });
  }

  private extractConversationIds(sources: SourceReference[]): string[] {
    const ids: string[] = [];
    
    for (const source of sources) {
      if (source.uri && source.sourceType === "conversation") {
        // Extract ID from cursor://composer/xxx format
        const match = source.uri.match(/cursor:\/\/composer\/([a-f0-9-]+)/i);
        if (match) {
          ids.push(match[1]);
        }
      }
    }
    
    return ids;
  }
}
