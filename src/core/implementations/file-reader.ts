/**
 * File reader implementation - no vscode dependencies
 */

import * as fs from "fs/promises";
import { FileReader } from "../types";

export class NodeFileReader implements FileReader {
  async readFile(path: string): Promise<string> {
    const normalizedPath = path.replace(/^file:\/\//, "");
    return fs.readFile(normalizedPath, "utf-8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      const normalizedPath = path.replace(/^file:\/\//, "");
      await fs.access(normalizedPath);
      return true;
    } catch {
      return false;
    }
  }
}
