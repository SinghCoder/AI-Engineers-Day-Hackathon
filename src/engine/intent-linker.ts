import { IIntentStore } from "../core/store";
import { IAttributionSource, AttributionSpan } from "../core/attribution-source";
import { IntentNode, IntentLink, createIntentLink } from "../models/intent";
import { SourceReference } from "../core/intent-source";

/**
 * Links intents to code based on:
 * 1. Conversation URL matching (from Agent Trace)
 * 2. Semantic similarity (future)
 */
export class IntentLinker {
  constructor(
    private readonly store: IIntentStore,
    private readonly attributionSource: IAttributionSource
  ) {}

  /**
   * Auto-link an intent to code using Agent Trace conversation URLs
   */
  async linkIntentByConversation(intent: IntentNode): Promise<IntentLink[]> {
    const links: IntentLink[] = [];

    // Get all conversation URLs from the intent's sources
    const conversationUrls = this.extractConversationUrls(intent.sources);
    
    if (conversationUrls.length === 0) {
      return links;
    }

    // Check if attribution source is available
    if (!(await this.attributionSource.isAvailable())) {
      return links;
    }

    // This is a simplified approach - in production, we'd scan all files
    // For MVP, we'll rely on the attribution source being pre-loaded
    await this.attributionSource.refresh();

    // We need to iterate over files that have attribution
    // For now, this is a placeholder - the actual implementation would
    // need access to workspace files
    
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

  private extractConversationUrls(sources: SourceReference[]): string[] {
    const urls: string[] = [];
    
    for (const source of sources) {
      if (source.uri && source.sourceType === "conversation") {
        urls.push(source.uri);
      }
    }
    
    return urls;
  }
}
