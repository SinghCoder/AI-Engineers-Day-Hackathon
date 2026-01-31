import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { CallbackHandler } from "langfuse-langchain";
import {
  ILLMService,
  ConversationMessage,
  ExtractedIntent,
  DriftAnalysis,
  DriftCheckParams,
} from "../core/llm-service";
import { ExtractIntentsResponseSchema, DriftAnalysisSchema } from "./schemas";
import {
  EXTRACT_INTENTS_SYSTEM_PROMPT,
  DETECT_DRIFT_SYSTEM_PROMPT,
  formatConversationForExtraction,
  formatDriftCheckInput,
} from "./prompts";

export interface LLMConfig {
  provider: "openai" | "anthropic" | "ollama";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  langfuse?: {
    publicKey: string;
    secretKey: string;
    baseUrl?: string;
  };
}

export class LangChainLLMService implements ILLMService {
  private model: BaseChatModel;
  private langfuseHandler?: CallbackHandler;

  constructor(config: LLMConfig) {
    // Set up Langfuse callback if configured
    if (config.langfuse) {
      this.langfuseHandler = new CallbackHandler({
        publicKey: config.langfuse.publicKey,
        secretKey: config.langfuse.secretKey,
        baseUrl: config.langfuse.baseUrl ?? "http://localhost:3000",
      });
    }

    switch (config.provider) {
      case "openai":
        this.model = new ChatOpenAI({
          modelName: config.model ?? "gpt-5-mini",
          temperature: 1,
          openAIApiKey: config.apiKey,
        });
        break;
      default:
        this.model = new ChatOpenAI({
          modelName: config.model ?? "gpt-5-mini",
          temperature: 1,
          openAIApiKey: config.apiKey,
        });
    }
  }

  private getCallbacks() {
    return this.langfuseHandler ? [this.langfuseHandler] : [];
  }

  async extractIntents(messages: ConversationMessage[]): Promise<ExtractedIntent[]> {
    const structuredModel = this.model.withStructuredOutput(ExtractIntentsResponseSchema);
    
    const conversationText = formatConversationForExtraction(messages);
    
    const result = await structuredModel.invoke(
      [
        new SystemMessage(EXTRACT_INTENTS_SYSTEM_PROMPT),
        new HumanMessage(conversationText),
      ],
      { callbacks: this.getCallbacks() }
    );

    return result.intents;
  }

  async detectDrift(params: DriftCheckParams): Promise<DriftAnalysis> {
    const structuredModel = this.model.withStructuredOutput(DriftAnalysisSchema);
    
    const intentsForPrompt = params.intents.map((i) => ({
      id: i.id,
      title: i.title,
      statement: i.statement,
      evidence: i.sources[0]?.metadata?.evidence as string | undefined,
    }));

    const input = formatDriftCheckInput({
      intents: intentsForPrompt,
      code: params.code,
      filePath: params.filePath,
      language: params.language,
    });

    const result = await structuredModel.invoke(
      [
        new SystemMessage(DETECT_DRIFT_SYSTEM_PROMPT),
        new HumanMessage(input),
      ],
      { callbacks: this.getCallbacks() }
    );

    return result as DriftAnalysis;
  }

  async shutdown(): Promise<void> {
    if (this.langfuseHandler) {
      await this.langfuseHandler.shutdownAsync();
    }
  }
}
