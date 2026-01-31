import * as fs from "fs/promises";
import * as path from "path";
import {
  IIntentStore,
  IntentQuery,
  DriftQuery,
} from "../core/store";
import { IntentNode, IntentLink } from "../models/intent";
import { DriftEvent } from "../models/drift";

interface StorageData {
  version: number;
  intents: IntentNode[];
  links: IntentLink[];
  driftEvents: DriftEvent[];
}

const STORAGE_VERSION = 1;

export class JsonFileStore implements IIntentStore {
  private storagePath: string;
  private data: StorageData = {
    version: STORAGE_VERSION,
    intents: [],
    links: [],
    driftEvents: [],
  };
  private loaded = false;

  constructor(workspaceRoot: string) {
    this.storagePath = path.join(workspaceRoot, ".intentmesh");
  }

  private get intentsFile(): string {
    return path.join(this.storagePath, "intent-graph.json");
  }

  private get linksFile(): string {
    return path.join(this.storagePath, "links.json");
  }

  private get driftFile(): string {
    return path.join(this.storagePath, "drift-events.json");
  }

  async load(): Promise<void> {
    try {
      await fs.mkdir(this.storagePath, { recursive: true });

      // Load intents
      try {
        const intentsContent = await fs.readFile(this.intentsFile, "utf-8");
        const intentsData = JSON.parse(intentsContent);
        this.data.intents = intentsData.intents ?? [];
      } catch {
        this.data.intents = [];
      }

      // Load links
      try {
        const linksContent = await fs.readFile(this.linksFile, "utf-8");
        const linksData = JSON.parse(linksContent);
        this.data.links = linksData.links ?? [];
      } catch {
        this.data.links = [];
      }

      // Load drift events
      try {
        const driftContent = await fs.readFile(this.driftFile, "utf-8");
        const driftData = JSON.parse(driftContent);
        this.data.driftEvents = driftData.driftEvents ?? [];
      } catch {
        this.data.driftEvents = [];
      }

      this.loaded = true;
    } catch (error) {
      console.error("Failed to load storage:", error);
      throw error;
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(this.storagePath, { recursive: true });

    // Save intents
    await fs.writeFile(
      this.intentsFile,
      JSON.stringify({ version: STORAGE_VERSION, intents: this.data.intents }, null, 2)
    );

    // Save links
    await fs.writeFile(
      this.linksFile,
      JSON.stringify({ version: STORAGE_VERSION, links: this.data.links }, null, 2)
    );

    // Save drift events
    await fs.writeFile(
      this.driftFile,
      JSON.stringify({ version: STORAGE_VERSION, driftEvents: this.data.driftEvents }, null, 2)
    );
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  // Intent operations
  async getIntent(id: string): Promise<IntentNode | null> {
    await this.ensureLoaded();
    return this.data.intents.find((i) => i.id === id) ?? null;
  }

  async getAllIntents(): Promise<IntentNode[]> {
    await this.ensureLoaded();
    return [...this.data.intents];
  }

  async findIntents(query: IntentQuery): Promise<IntentNode[]> {
    await this.ensureLoaded();
    
    return this.data.intents.filter((intent) => {
      if (query.status && intent.status !== query.status) return false;
      if (query.tags && query.tags.length > 0) {
        if (!query.tags.some((tag) => intent.tags.includes(tag))) return false;
      }
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        if (
          !intent.title.toLowerCase().includes(searchLower) &&
          !intent.statement.toLowerCase().includes(searchLower)
        ) {
          return false;
        }
      }
      return true;
    });
  }

  async saveIntent(intent: IntentNode): Promise<void> {
    await this.ensureLoaded();
    
    const index = this.data.intents.findIndex((i) => i.id === intent.id);
    if (index >= 0) {
      this.data.intents[index] = { ...intent, updatedAt: new Date() };
    } else {
      this.data.intents.push(intent);
    }
    
    await this.save();
  }

  async deleteIntent(id: string): Promise<void> {
    await this.ensureLoaded();
    this.data.intents = this.data.intents.filter((i) => i.id !== id);
    // Also delete related links
    this.data.links = this.data.links.filter((l) => l.intentId !== id);
    await this.save();
  }

  // Link operations
  async getLinksForIntent(intentId: string): Promise<IntentLink[]> {
    await this.ensureLoaded();
    return this.data.links.filter((l) => l.intentId === intentId);
  }

  async getLinksForFile(fileUri: string): Promise<IntentLink[]> {
    await this.ensureLoaded();
    const normalized = this.normalizeUri(fileUri);
    return this.data.links.filter((l) => {
      const linkPath = this.normalizeUri(l.fileUri);
      // Match if exact match OR if the file path ends with the link path
      // This allows links.json to use relative paths like "refund-controller.ts"
      return normalized === linkPath || normalized.endsWith("/" + linkPath) || normalized.endsWith(linkPath);
    });
  }

  async saveLink(link: IntentLink): Promise<void> {
    await this.ensureLoaded();
    
    const index = this.data.links.findIndex((l) => l.id === link.id);
    if (index >= 0) {
      this.data.links[index] = link;
    } else {
      this.data.links.push(link);
    }
    
    await this.save();
  }

  async deleteLink(id: string): Promise<void> {
    await this.ensureLoaded();
    this.data.links = this.data.links.filter((l) => l.id !== id);
    await this.save();
  }

  // Drift event operations
  async getDriftEvents(query: DriftQuery): Promise<DriftEvent[]> {
    await this.ensureLoaded();
    
    return this.data.driftEvents.filter((event) => {
      if (query.fileUri && this.normalizeUri(event.fileUri) !== this.normalizeUri(query.fileUri)) {
        return false;
      }
      if (query.intentId && !event.intentIds.includes(query.intentId)) {
        return false;
      }
      if (query.status && event.status !== query.status) {
        return false;
      }
      if (query.severity && event.severity !== query.severity) {
        return false;
      }
      return true;
    });
  }

  async saveDriftEvent(event: DriftEvent): Promise<void> {
    await this.ensureLoaded();
    
    const index = this.data.driftEvents.findIndex((e) => e.id === event.id);
    if (index >= 0) {
      this.data.driftEvents[index] = event;
    } else {
      this.data.driftEvents.push(event);
    }
    
    await this.save();
  }

  async clearDriftEvents(fileUri?: string): Promise<void> {
    await this.ensureLoaded();
    
    if (fileUri) {
      const normalized = this.normalizeUri(fileUri);
      this.data.driftEvents = this.data.driftEvents.filter(
        (e) => this.normalizeUri(e.fileUri) !== normalized
      );
    } else {
      this.data.driftEvents = [];
    }
    
    await this.save();
  }

  private normalizeUri(uri: string): string {
    return uri.replace(/^file:\/\//, "").replace(/\\/g, "/");
  }
}
