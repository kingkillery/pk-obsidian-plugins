import { ItemView, Notice, WorkspaceLeaf } from "obsidian";

import type InsForgePlugin from "./main";
import type {
  DocContent,
  DocListItem,
  FunctionDraft,
  FunctionRecord,
  LogEntry,
  LogSource
} from "./types";

export const VIEW_TYPE_INSFORGE = "insforge-tools-view";

const EMPTY_DRAFT: FunctionDraft = {
  name: "",
  slug: "",
  description: "",
  code: "",
  status: "draft"
};

export class InsForgeToolsView extends ItemView {
  private docs: DocListItem[] = [];
  private selectedDocType = "";
  private loadedDoc: DocContent | null = null;
  private logSources: LogSource[] = [];
  private selectedLogSource = "";
  private loadedLogs: LogEntry[] = [];
  private logSearchQuery = "";
  private functions: FunctionRecord[] = [];
  private selectedFunctionSlug = "";
  private selectedFunction: FunctionRecord | null = null;
  private draft: FunctionDraft = { ...EMPTY_DRAFT };

  constructor(leaf: WorkspaceLeaf, private readonly plugin: InsForgePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_INSFORGE;
  }

  getDisplayText(): string {
    return "InsForge";
  }

  getIcon(): string {
    return "database";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  refresh(): void {
    this.render();
  }

  setDraftFromContext(): void {
    const context = this.plugin.getCurrentContext();
    if (!context) {
      new Notice("Capture a note or selection first.");
      return;
    }

    const baseName = context.title || "insforge-function";
    const codeSource = context.selection.trim() || context.noteContent.trim();

    this.draft = {
      name: baseName,
      slug: slugify(baseName),
      description: context.filePath ? `Drafted from ${context.filePath}` : "Drafted from Obsidian",
      code: codeSource,
      status: "draft"
    };

    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("insforge-view");

    this.renderToolbar(contentEl);
    this.renderContextSection(contentEl);
    this.renderDocsSection(contentEl);
    this.renderLogsSection(contentEl);
    this.renderFunctionsSection(contentEl);
  }

  private renderToolbar(containerEl: HTMLElement): void {
    const toolbarEl = containerEl.createDiv({ cls: "insforge-toolbar" });
    createButton(toolbarEl, "Test connection", async () => {
      await this.plugin.testConnection();
    });
    createButton(toolbarEl, "Sync docs to vault", async () => {
      await this.plugin.syncDocsToVault();
    });
    createButton(toolbarEl, "Copy MCP config", async () => {
      await this.plugin.copyMcpConfig();
    });
    createButton(toolbarEl, "Open dashboard", () => {
      window.open(this.plugin.settings.dashboardUrl, "_blank", "noopener,noreferrer");
    });
  }

  private renderContextSection(containerEl: HTMLElement): void {
    const section = this.createSection(containerEl, "Note context");
    const context = this.plugin.getCurrentContext();

    const meta = section.createDiv({ cls: "insforge-meta" });
    meta.createDiv({
      text: context
        ? `Source: ${context.source} | File: ${context.filePath ?? "untitled"}`
        : "No note context captured yet."
    });

    const preview = section.createEl("pre", { cls: "insforge-output" });
    preview.setText(
      context
        ? truncate(context.selection.trim() || context.noteContent.trim() || "(empty note)", 900)
        : "Capture the current note or selection to make docs, logs, and function drafts context-aware."
    );

    const actions = section.createDiv({ cls: "insforge-actions" });
    createButton(actions, "Capture current note", async () => {
      await this.plugin.captureCurrentNoteToTools();
    });
    createButton(actions, "Capture selection", async () => {
      await this.plugin.captureActiveSelectionToTools();
    });
    createButton(actions, "Save context to vault", async () => {
      await this.plugin.saveCurrentContextToKnowledgeBase();
    });
    createButton(actions, "Use as function draft", () => {
      this.setDraftFromContext();
    });
  }

  private renderDocsSection(containerEl: HTMLElement): void {
    const section = this.createSection(containerEl, "Docs");
    const controls = section.createDiv({ cls: "insforge-controls" });

    const selectEl = controls.createEl("select", { cls: "insforge-select" });
    selectEl.createEl("option", {
      value: "",
      text: this.docs.length > 0 ? "Select documentation" : "Load docs list first"
    });
    for (const doc of this.docs) {
      selectEl.createEl("option", {
        value: doc.type,
        text: doc.type
      });
    }
    selectEl.value = this.selectedDocType;
    selectEl.onchange = () => {
      this.selectedDocType = selectEl.value;
    };

    const actions = section.createDiv({ cls: "insforge-actions" });
    createButton(actions, "Refresh docs", async () => {
      this.docs = await this.plugin.client.listDocs();
      if (!this.selectedDocType && this.docs.length > 0) {
        this.selectedDocType = this.docs[0].type;
      }
      this.render();
    });
    createButton(actions, "Load doc", async () => {
      const selected = this.docs.find((doc) => doc.type === this.selectedDocType);
      if (!selected) {
        new Notice("Select a documentation entry first.");
        return;
      }
      this.loadedDoc = await this.plugin.client.getDocByEndpoint(selected.endpoint);
      this.render();
    });
    createButton(actions, "Insert into note", async () => {
      if (!this.loadedDoc) {
        new Notice("Load a document first.");
        return;
      }
      await this.plugin.insertTextIntoActiveNote(formatDocInsert(this.loadedDoc));
    });
    createButton(actions, "Save doc to vault", async () => {
      if (!this.loadedDoc) {
        new Notice("Load a document first.");
        return;
      }
      await this.plugin.saveDocToKnowledgeBase(this.loadedDoc);
    });

    const output = section.createEl("pre", { cls: "insforge-output" });
    output.setText(
      this.loadedDoc
        ? truncate(this.loadedDoc.content, 4000)
        : "Load a documentation entry to preview it here."
    );
  }

  private renderLogsSection(containerEl: HTMLElement): void {
    const section = this.createSection(containerEl, "Logs");
    const controls = section.createDiv({ cls: "insforge-controls" });

    const sourceSelect = controls.createEl("select", { cls: "insforge-select" });
    sourceSelect.createEl("option", {
      value: "",
      text: this.logSources.length > 0 ? "Select log source" : "Load sources first"
    });
    for (const source of this.logSources) {
      sourceSelect.createEl("option", {
        value: source.name,
        text: source.name
      });
    }
    sourceSelect.value = this.selectedLogSource;
    sourceSelect.onchange = () => {
      this.selectedLogSource = sourceSelect.value;
    };

    const searchInput = controls.createEl("input", {
      cls: "insforge-input",
      type: "text",
      placeholder: "Search logs"
    });
    searchInput.value = this.logSearchQuery;
    searchInput.oninput = () => {
      this.logSearchQuery = searchInput.value;
    };

    const actions = section.createDiv({ cls: "insforge-actions" });
    createButton(actions, "Refresh sources", async () => {
      this.logSources = await this.plugin.client.getLogSources();
      if (!this.selectedLogSource && this.logSources.length > 0) {
        this.selectedLogSource = this.logSources[0].name;
      }
      this.render();
    });
    createButton(actions, "Load source logs", async () => {
      if (!this.selectedLogSource) {
        new Notice("Select a log source first.");
        return;
      }
      const response = await this.plugin.client.getLogsBySource(
        this.selectedLogSource,
        this.plugin.settings.defaultLogLimit
      );
      this.loadedLogs = response.logs;
      this.render();
    });
    createButton(actions, "Search", async () => {
      if (!this.logSearchQuery.trim()) {
        new Notice("Enter a search query first.");
        return;
      }
      this.loadedLogs = await this.plugin.client.searchLogs(
        this.logSearchQuery.trim(),
        this.selectedLogSource || null,
        this.plugin.settings.defaultLogLimit
      );
      this.render();
    });
    createButton(actions, "Save logs to vault", async () => {
      if (this.loadedLogs.length === 0) {
        new Notice("Load or search logs first.");
        return;
      }
      await this.plugin.saveLogsToKnowledgeBase(
        this.selectedLogSource || "search-results",
        this.logSearchQuery,
        this.loadedLogs
      );
    });

    const output = section.createEl("pre", { cls: "insforge-output" });
    output.setText(
      this.loadedLogs.length > 0
        ? truncate(formatLogs(this.loadedLogs), 4000)
        : "Load a source or run a search to inspect logs."
    );
  }

  private renderFunctionsSection(containerEl: HTMLElement): void {
    const section = this.createSection(containerEl, "Functions");
    const controls = section.createDiv({ cls: "insforge-controls" });

    const functionSelect = controls.createEl("select", { cls: "insforge-select" });
    functionSelect.createEl("option", {
      value: "",
      text: this.functions.length > 0 ? "Select function" : "Load functions first"
    });
    for (const func of this.functions) {
      functionSelect.createEl("option", {
        value: func.slug,
        text: `${func.name} (${func.status})`
      });
    }
    functionSelect.value = this.selectedFunctionSlug;
    functionSelect.onchange = () => {
      this.selectedFunctionSlug = functionSelect.value;
    };

    const actions = section.createDiv({ cls: "insforge-actions" });
    createButton(actions, "Refresh functions", async () => {
      const response = await this.plugin.client.listFunctions();
      this.functions = response.functions;
      if (!this.selectedFunctionSlug && this.functions.length > 0) {
        this.selectedFunctionSlug = this.functions[0].slug;
      }
      this.render();
    });
    createButton(actions, "Load function", async () => {
      if (!this.selectedFunctionSlug) {
        new Notice("Select a function first.");
        return;
      }
      this.selectedFunction = await this.plugin.client.getFunction(this.selectedFunctionSlug);
      this.draft = {
        name: this.selectedFunction.name,
        slug: this.selectedFunction.slug,
        description: this.selectedFunction.description ?? "",
        code: this.selectedFunction.code,
        status: this.selectedFunction.status === "active" ? "active" : "draft"
      };
      this.render();
    });
    createButton(actions, "Save function to vault", async () => {
      if (!this.selectedFunction) {
        new Notice("Load a function first.");
        return;
      }
      await this.plugin.saveFunctionToKnowledgeBase(this.selectedFunction);
    });

    const details = section.createEl("pre", { cls: "insforge-output" });
    details.setText(
      this.selectedFunction
        ? truncate(formatFunction(this.selectedFunction), 3000)
        : "Load a function to inspect its metadata and code."
    );

    section.createEl("h4", { text: "Draft editor" });
    const draftGrid = section.createDiv({ cls: "insforge-draft-grid" });

    const nameInput = draftGrid.createEl("input", {
      cls: "insforge-input",
      type: "text",
      placeholder: "Function name"
    });
    nameInput.value = this.draft.name;
    nameInput.oninput = () => {
      this.draft.name = nameInput.value;
      if (!this.selectedFunction) {
        this.draft.slug = slugify(this.draft.name);
        this.render();
      }
    };

    const slugInput = draftGrid.createEl("input", {
      cls: "insforge-input",
      type: "text",
      placeholder: "function-slug"
    });
    slugInput.value = this.draft.slug;
    slugInput.oninput = () => {
      this.draft.slug = slugInput.value;
    };

    const statusSelect = draftGrid.createEl("select", { cls: "insforge-select" });
    statusSelect.createEl("option", { value: "draft", text: "draft" });
    statusSelect.createEl("option", { value: "active", text: "active" });
    statusSelect.value = this.draft.status;
    statusSelect.onchange = () => {
      this.draft.status = statusSelect.value === "active" ? "active" : "draft";
    };

    const descriptionInput = section.createEl("textarea", {
      cls: "insforge-textarea",
      attr: { placeholder: "Description" }
    });
    descriptionInput.value = this.draft.description;
    descriptionInput.oninput = () => {
      this.draft.description = descriptionInput.value;
    };

    const codeInput = section.createEl("textarea", {
      cls: "insforge-codearea",
      attr: { placeholder: "Function code" }
    });
    codeInput.value = this.draft.code;
    codeInput.oninput = () => {
      this.draft.code = codeInput.value;
    };

    const draftActions = section.createDiv({ cls: "insforge-actions" });
    createButton(draftActions, "Use current context", () => {
      this.setDraftFromContext();
    });
    createButton(draftActions, "Create function", async () => {
      this.validateDraft(false);
      const result = await this.plugin.client.createFunction(this.draft);
      this.selectedFunction = result.function;
      this.selectedFunctionSlug = result.function.slug;
      new Notice(`Created function ${result.function.slug}.`);
      const response = await this.plugin.client.listFunctions();
      this.functions = response.functions;
      this.render();
    });
    createButton(draftActions, "Update selected function", async () => {
      this.validateDraft(true);
      if (!this.selectedFunctionSlug) {
        throw new Error("Select a function to update first.");
      }
      const result = await this.plugin.client.updateFunction(this.selectedFunctionSlug, this.draft);
      this.selectedFunction = result.function;
      new Notice(`Updated function ${result.function.slug}.`);
      const response = await this.plugin.client.listFunctions();
      this.functions = response.functions;
      this.render();
    });
  }

  private createSection(containerEl: HTMLElement, title: string): HTMLDivElement {
    const section = containerEl.createDiv({ cls: "insforge-section" });
    section.createEl("h3", { text: title });
    return section;
  }

  private validateDraft(requireSelection: boolean): void {
    if (!this.draft.name.trim()) {
      throw new Error("Function name is required.");
    }
    if (!this.draft.slug.trim()) {
      throw new Error("Function slug is required.");
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(this.draft.slug.trim())) {
      throw new Error("Function slug must be alphanumeric with hyphens or underscores.");
    }
    if (!this.draft.code.trim()) {
      throw new Error(
        requireSelection
          ? "Load a function or capture a note context first."
          : "Function code is required."
      );
    }
  }
}

function createButton(containerEl: HTMLElement, text: string, onClick: () => Promise<void> | void): void {
  const button = containerEl.createEl("button", { text });
  button.onclick = async () => {
    try {
      button.disabled = true;
      await onClick();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    } finally {
      button.disabled = false;
    }
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n\n...`;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDocInsert(doc: DocContent): string {
  return `## InsForge doc: ${doc.type}\n\n${doc.content}\n`;
}

function formatLogs(logs: LogEntry[]): string {
  return logs
    .map((log) => {
      const message = log.eventMessage ?? JSON.stringify(log.body ?? {}, null, 2);
      const source = log.source ? ` [${log.source}]` : "";
      return `${log.timestamp}${source}\n${message}`;
    })
    .join("\n\n");
}

function formatFunction(func: FunctionRecord): string {
  return [
    `name: ${func.name}`,
    `slug: ${func.slug}`,
    `status: ${func.status}`,
    `createdAt: ${func.createdAt}`,
    `updatedAt: ${func.updatedAt}`,
    `deployedAt: ${func.deployedAt ?? "not deployed"}`,
    "",
    func.description ?? "",
    "",
    func.code
  ].join("\n");
}
