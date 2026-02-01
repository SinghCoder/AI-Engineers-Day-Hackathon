/**
 * Git operations implementation - no vscode dependencies
 */

import { execSync } from "child_process";
import { GitOperations } from "../types";

export class NodeGitOperations implements GitOperations {
  constructor(private readonly workspaceRoot: string) {}

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  async getChangedFiles(options?: { since?: string; staged?: boolean }): Promise<string[]> {
    try {
      let cmd: string;
      
      if (options?.staged) {
        cmd = "git diff --cached --name-only";
      } else if (options?.since) {
        cmd = `git diff --name-only ${options.since}`;
      } else {
        // Default: changes since last commit (working directory + staged)
        cmd = "git diff --name-only HEAD";
      }

      const result = execSync(cmd, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
      }).trim();

      if (!result) return [];
      
      return result.split("\n").filter(Boolean).map(file => 
        `${this.workspaceRoot}/${file}`
      );
    } catch (error) {
      // If HEAD doesn't exist (new repo), try getting all files
      try {
        const result = execSync("git ls-files", {
          cwd: this.workspaceRoot,
          encoding: "utf-8",
        }).trim();
        
        if (!result) return [];
        return result.split("\n").filter(Boolean).map(file => 
          `${this.workspaceRoot}/${file}`
        );
      } catch {
        return [];
      }
    }
  }

  async getDiff(options?: { since?: string }): Promise<string> {
    try {
      const since = options?.since ?? "HEAD";
      const result = execSync(`git diff ${since}`, {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
      });
      return result;
    } catch {
      return "";
    }
  }

  async getCurrentRevision(): Promise<string> {
    try {
      return execSync("git rev-parse HEAD", {
        cwd: this.workspaceRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      return "";
    }
  }
}
