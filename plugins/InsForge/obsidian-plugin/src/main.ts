import {
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  normalizePath,
  type Editor,
  type RequestUrlResponse,
  type WorkspaceLeaf
} from "obsidian";

import { InsForgeApiClient } from "./api";
import { InsForgeSettingTab } from "./settings";
import type { DocContent, FunctionRecord, InsForgeContext, InsForgeSettings, LogEntry } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { InsForgeToolsView, VIEW_TYPE_INSFORGE } from "./view";

export default class InsForgePlugin extends Plugin {
  settings: InsForgeSettings = { ...DEFAULT_SETTINGS };
  client: InsForgeApiClient = new InsForgeApiClient(DEFAULT_SETTINGS);
  private currentContext: InsForgeContext | null = null;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.client = new InsForgeApiClient({
      apiBaseUrl: this.settings.apiBaseUrl,
      apiToken: this.settings.apiToken
    });

    this.registerView(VIEW_TYPE_INSFORGE, (leaf) => new InsForgeToolsView(leaf, this));

    this.addRibbonIcon("database", "Open InsForge tools", () => {
      void this.activateToolsView();
    });

    this.addCommand({
      id: "open-tools-view",
      name: "Open InsForge tools",
      callback: () => {
        void this.activateToolsView();
      }
    });

    this.addCommand({
      id: "test-connection",
      name: "Test InsForge connection",
      callback: async () => {
        await this.testConnection();
      }
    });

    this.addCommand({
      id: "capture-current-note",
      name: "Capture current note into InsForge tools",
      callback: async () => {
        await this.captureCurrentNoteToTools();
      }
    });

    this.addCommand({
      id: "capture-selection",
      name: "Capture current selection into InsForge tools",
      editorCallback: async (editor) => {
        await this.captureSelectionToTools(editor);
      }
    });

    this.addCommand({
      id: "save-current-note-to-knowledge-base",
      name: "Save current note to InsForge knowledge base",
      callback: async () => {
        const context = await this.captureCurrentNote();
        await this.saveContextToKnowledgeBase(context);
      }
    });

    this.addCommand({
      id: "save-selection-to-knowledge-base",
      name: "Save current selection to InsForge knowledge base",
      editorCallback: async (editor) => {
        const context = await this.captureSelection(editor);
        await this.saveContextToKnowledgeBase(context);
      }
    });

    this.addCommand({
      id: "sync-docs-to-vault",
      name: "Sync InsForge docs to knowledge base",
      callback: async () => {
        await this.syncDocsToVault();
      }
    });

    this.addCommand({
      id: "copy-mcp-config",
      name: "Copy InsForge MCP config JSON",
      callback: async () => {
        await this.copyMcpConfig();
      }
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open InsForge dashboard",
      callback: () => {
        window.open(this.settings.dashboardUrl, "_blank", "noopener,noreferrer");
      }
    });

    this.addSettingTab(new InsForgeSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_INSFORGE);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.client = new InsForgeApiClient({
      apiBaseUrl: this.settings.apiBaseUrl,
      apiToken: this.settings.apiToken
    });
  }

  getCurrentContext(): InsForgeContext | null {
    return this.currentContext;
  }

  async activateToolsView(): Promise<void> {
    const leaf = await this.getOrCreateToolsLeaf();
    await leaf.setViewState({ type: VIEW_TYPE_INSFORGE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    this.refreshToolsViews();
  }

  async testConnection(): Promise<void> {
    try {
      const response = await this.client.healthCheck();
      const details = [
        `status=${response.status ?? "ok"}`,
        `version=${response.version ?? "unknown"}`
      ].join(" ");
      new Notice(`InsForge connected (${details})`, 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`InsForge connection failed: ${message}`, 8000);
    }
  }

  async captureCurrentNoteToTools(): Promise<void> {
    this.currentContext = await this.captureCurrentNote();
    await this.activateToolsView();
    new Notice("Captured current note into InsForge tools.");
  }

  async captureActiveSelectionToTools(): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      throw new Error("Open a markdown note first.");
    }
    await this.captureSelectionToTools(view.editor);
  }

  async captureSelectionToTools(editor: Editor): Promise<void> {
    this.currentContext = await this.captureSelection(editor);
    await this.activateToolsView();
    new Notice("Captured current selection into InsForge tools.");
  }

  async saveCurrentContextToKnowledgeBase(): Promise<void> {
    if (!this.currentContext) {
      throw new Error("Capture a note or selection first.");
    }
    await this.saveContextToKnowledgeBase(this.currentContext);
  }

  async saveContextToKnowledgeBase(context: InsForgeContext): Promise<void> {
    const folder = normalizePath(`${this.settings.knowledgeBaseFolder}/context`);
    await this.ensureFolder(folder);

    const timestamp = new Date(context.capturedAt).toISOString().replace(/[:.]/g, "-");
    const fileName = `${slugify(context.title || "note")}-${timestamp}.md`;
    const path = normalizePath(`${folder}/${fileName}`);
    const body = [
      "---",
      `source: ${context.source}`,
      `capturedAt: ${context.capturedAt}`,
      `filePath: ${context.filePath ?? ""}`,
      "---",
      "",
      `# ${context.title || "Untitled"}`,
      "",
      "## Selection",
      "",
      context.selection || "(no selection)",
      "",
      "## Full note",
      "",
      context.noteContent || "(empty note)"
    ].join("\n");

    await this.writeOrCreateFile(path, body);
    new Notice(`Saved context note to ${path}.`, 6000);
  }

  async saveDocToKnowledgeBase(doc: DocContent): Promise<void> {
    const folder = normalizePath(`${this.settings.knowledgeBaseFolder}/docs`);
    await this.ensureFolder(folder);

    const path = normalizePath(`${folder}/${slugify(doc.type)}.md`);
    const content = [
      "---",
      `docType: ${doc.type}`,
      `syncedAt: ${new Date().toISOString()}`,
      "---",
      "",
      `# ${doc.type}`,
      "",
      doc.content
    ].join("\n");

    await this.writeOrCreateFile(path, content);
    new Notice(`Saved ${doc.type} to ${path}.`, 6000);
  }

  async saveLogsToKnowledgeBase(source: string, query: string, logs: LogEntry[]): Promise<void> {
    const folder = normalizePath(`${this.settings.knowledgeBaseFolder}/logs`);
    await this.ensureFolder(folder);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = query ? `${slugify(source || "search")}-${slugify(query)}` : slugify(source || "logs");
    const path = normalizePath(`${folder}/${name}-${timestamp}.md`);
    const content = [
      "---",
      `source: ${source}`,
      `query: ${query}`,
      `savedAt: ${new Date().toISOString()}`,
      "---",
      "",
      `# Logs: ${source || "search"}`,
      "",
      ...logs.map((log) => {
        const message = log.eventMessage ?? JSON.stringify(log.body ?? {}, null, 2);
        return `## ${log.timestamp}\n\n\`\`\`text\n${message}\n\`\`\``;
      })
    ].join("\n\n");

    await this.writeOrCreateFile(path, content);
    new Notice(`Saved logs to ${path}.`, 6000);
  }

  async saveFunctionToKnowledgeBase(func: FunctionRecord): Promise<void> {
    const folder = normalizePath(`${this.settings.knowledgeBaseFolder}/functions`);
    await this.ensureFolder(folder);

    const path = normalizePath(`${folder}/${slugify(func.slug)}.md`);
    const content = [
      "---",
      `slug: ${func.slug}`,
      `status: ${func.status}`,
      `updatedAt: ${func.updatedAt}`,
      "---",
      "",
      `# ${func.name}`,
      "",
      func.description ?? "",
      "",
      "## Code",
      "",
      "```ts",
      func.code,
      "```"
    ].join("\n");

    await this.writeOrCreateFile(path, content);
    new Notice(`Saved function ${func.slug} to ${path}.`, 6000);
  }

  async syncDocsToVault(): Promise<void> {
    const docs = await this.client.listDocs();
    let syncedCount = 0;

    for (const doc of docs) {
      const content = await this.client.getDocByEndpoint(doc.endpoint);
      await this.saveDocToKnowledgeBase(content);
      syncedCount += 1;
    }

    const indexPath = normalizePath(`${this.settings.knowledgeBaseFolder}/README.md`);
    const indexContent = [
      "# InsForge Knowledge",
      "",
      `Last synced: ${new Date().toISOString()}`,
      "",
      "## Docs",
      "",
      ...docs.map((doc) => `- [[docs/${slugify(doc.type)}|${doc.type}]]`)
    ].join("\n");
    await this.writeOrCreateFile(indexPath, indexContent);

    new Notice(`Synced ${syncedCount} InsForge docs into the vault.`, 6000);
  }

  async copyMcpConfig(): Promise<void> {
    const token = this.settings.apiToken.trim();
    const args = ["-y", "@insforge/mcp", "--base-url", this.settings.apiBaseUrl];

    if (token.length > 0) {
      args.push("--api-key", token);
    }

    const payload = {
      mcpServers: {
        insforge: {
          command: "npx",
          args
        }
      }
    };

    await navigator.clipboard.writeText(`${JSON.stringify(payload, null, 2)}\n`);
    new Notice("InsForge MCP config copied to clipboard.");
  }

  async insertTextIntoActiveNote(text: string): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      throw new Error("Open a markdown note first.");
    }

    view.editor.replaceSelection(text);
    new Notice("Inserted content into the active note.");
  }

  private async captureCurrentNote(): Promise<InsForgeContext> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      throw new Error("Open a markdown note first.");
    }

    const file = view.file;
    return {
      title: file?.basename ?? "Untitled",
      filePath: file?.path ?? null,
      noteContent: view.editor.getValue(),
      selection: "",
      capturedAt: new Date().toISOString(),
      source: "note"
    };
  }

  private async captureSelection(editor: Editor): Promise<InsForgeContext> {
    const selection = editor.getSelection().trim();
    if (!selection) {
      throw new Error("Select some note content first.");
    }

    const file = this.app.workspace.getActiveFile();
    return {
      title: file?.basename ?? "Selection",
      filePath: file?.path ?? null,
      noteContent: editor.getValue(),
      selection,
      capturedAt: new Date().toISOString(),
      source: "selection"
    };
  }

  private async getOrCreateToolsLeaf(): Promise<WorkspaceLeaf> {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_INSFORGE);
    if (existingLeaves.length > 0) {
      return existingLeaves[0];
    }

    const leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
    return leaf;
  }

  private refreshToolsViews(): void {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_INSFORGE).forEach((leaf) => {
      if (leaf.view instanceof InsForgeToolsView) {
        leaf.view.refresh();
      }
    });
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    const parts = normalized.split("/");
    let currentPath = "";

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(currentPath)) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  private async writeOrCreateFile(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);

    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      return;
    }

    const folderPath = path.split("/").slice(0, -1).join("/");
    if (folderPath) {
      await this.ensureFolder(folderPath);
    }

    await this.app.vault.create(path, content);
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
