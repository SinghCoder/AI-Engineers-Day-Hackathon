import * as fs from "fs/promises";
import {
  IIntentSource,
  IntentSourceType,
  RawIntent,
  ExtractOptions,
} from "../../core/intent-source";
import { ILLMService } from "../../core/llm-service";
import { ConversationMessage } from "../../models/conversation";

export class LocalMarkdownChatSource implements IIntentSource {
  readonly id = "local-markdown-chat";
  readonly name = "Local Markdown Chat";
  readonly type: IntentSourceType = "conversation";

  private filePath: string;
  private llmService: ILLMService;

  constructor(filePath: string, llmService: ILLMService) {
    this.filePath = filePath;
    this.llmService = llmService;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  async extractIntents(options?: ExtractOptions): Promise<RawIntent[]> {
    const content = await fs.readFile(this.filePath, "utf-8");
    const messages = this.parseMarkdown(content);

    if (messages.length === 0) {
      return [];
    }

    const extracted = await this.llmService.extractIntents(messages);

    return extracted.map((intent) => ({
      title: intent.title,
      statement: intent.statement,
      confidence: intent.confidence,
      evidence: [
        {
          type: "quote" as const,
          content: intent.evidence,
          location: this.filePath,
        },
      ],
      suggestedTags: intent.tags,
      sourceRef: {
        sourceId: this.id,
        sourceType: this.type,
        uri: this.filePath,
        timestamp: new Date(),
      },
    }));
  }

  private parseMarkdown(content: string): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    
    // Match patterns like "User:", "Assistant:", "Human:", "AI:", etc.
    const pattern = /^(User|Human|Assistant|AI|Bot|System|GPT|Claude):\s*/gim;
    const parts = content.split(pattern).filter(Boolean);

    for (let i = 0; i < parts.length - 1; i += 2) {
      const role = parts[i];
      const messageContent = parts[i + 1]?.trim();
      
      if (messageContent) {
        messages.push({
          role: this.normalizeRole(role),
          content: messageContent,
        });
      }
    }

    return messages;
  }

  private normalizeRole(role: string): "user" | "assistant" | "system" {
    const r = role.toLowerCase();
    if (r === "user" || r === "human") return "user";
    if (r === "system") return "system";
    return "assistant";
  }
}
