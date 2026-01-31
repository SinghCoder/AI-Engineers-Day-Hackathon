export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
}

export interface Conversation {
  id: string;
  messages: ConversationMessage[];
  url?: string;
  provider?: "cursor" | "amp" | "chatgpt" | "claude" | "unknown";
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}
