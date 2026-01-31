import * as fs from "fs/promises";
import * as path from "path";
import {
  IIntentSource,
  IntentSourceType,
  RawIntent,
  ExtractOptions,
} from "../../core/intent-source";
import { ILLMService } from "../../core/llm-service";
import { Conversation, ConversationMessage } from "../../models/conversation";

interface JsonChatFormat {
  // Support multiple common formats
  messages?: Array<{
    role: string;
    content: string;
    timestamp?: string;
  }>;
  // ChatGPT export format
  mapping?: Record<string, {
    message?: {
      author: { role: string };
      content: { parts: string[] };
    };
  }>;
  // Simple array format
  conversation?: Array<{
    role: string;
    content: string;
  }>;
  // Metadata
  url?: string;
  id?: string;
  title?: string;
}

export class LocalJsonChatSource implements IIntentSource {
  readonly id = "local-json-chat";
  readonly name = "Local JSON Chat";
  readonly type: IntentSourceType = "conversation";

  private filePath: string;
  private llmService: ILLMService;
  private conversationUrl?: string;

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
    const json: JsonChatFormat = JSON.parse(content);
    
    const messages = this.parseMessages(json);
    this.conversationUrl = json.url || json.id;

    if (messages.length === 0) {
      return [];
    }

    // Use LLM to extract intents
    const extracted = await this.llmService.extractIntents(messages);

    // Convert to RawIntent format
    return extracted.map((intent) => ({
      title: intent.title,
      statement: intent.statement,
      confidence: intent.confidence,
      evidence: [
        {
          type: "quote" as const,
          content: intent.evidence,
          location: this.conversationUrl,
        },
      ],
      suggestedTags: intent.tags,
      sourceRef: {
        sourceId: this.id,
        sourceType: this.type,
        uri: this.conversationUrl || this.filePath,
        timestamp: new Date(),
        metadata: {
          filePath: this.filePath,
        },
      },
    }));
  }

  private parseMessages(json: JsonChatFormat): ConversationMessage[] {
    // Try different formats
    if (json.messages && Array.isArray(json.messages)) {
      return json.messages.map((m) => ({
        role: this.normalizeRole(m.role),
        content: m.content,
        timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
      }));
    }

    if (json.conversation && Array.isArray(json.conversation)) {
      return json.conversation.map((m) => ({
        role: this.normalizeRole(m.role),
        content: m.content,
      }));
    }

    // ChatGPT export format
    if (json.mapping) {
      const messages: ConversationMessage[] = [];
      for (const node of Object.values(json.mapping)) {
        if (node.message?.content?.parts) {
          messages.push({
            role: this.normalizeRole(node.message.author.role),
            content: node.message.content.parts.join("\n"),
          });
        }
      }
      return messages;
    }

    return [];
  }

  private normalizeRole(role: string): "user" | "assistant" | "system" {
    const r = role.toLowerCase();
    if (r === "user" || r === "human") return "user";
    if (r === "assistant" || r === "ai" || r === "bot" || r === "gpt") return "assistant";
    if (r === "system") return "system";
    return "assistant";
  }
}
