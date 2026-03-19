"use strict";

const {
  ItemView,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl
} = require("obsidian");

const VIEW_TYPE_PK_QMD = "pk-qmd-retrieval-view";

const DEFAULT_SETTINGS = {
  defaultTopK: 8,
  defaultVaultPath: "",
  serviceUrl: "http://127.0.0.1:4317"
};

function normalizeBaseUrl(url) {
  const value = String(url || "").trim();
  return value.replace(/\/+$/, "") || DEFAULT_SETTINGS.serviceUrl;
}

class SidecarClient {
  constructor(getSettings) {
    this.getSettings = getSettings;
  }

  async get(pathname) {
    return this.request("GET", pathname);
  }

  async post(pathname, body) {
    return this.request("POST", pathname, body);
  }

  async request(method, pathname, body) {
    const settings = this.getSettings();
    const url = `${normalizeBaseUrl(settings.serviceUrl)}${pathname}`;
    const response = await requestUrl({
      body: body ? JSON.stringify(body) : undefined,
      contentType: "application/json",
      headers: { Accept: "application/json" },
      method,
      throw: false,
      url
    });

    let json;
    try {
      json = response.json;
    } catch {
      json = null;
    }

    if (response.status >= 400) {
      const message = json && typeof json.error === "string" ? json.error : `${response.status} ${response.text}`;
      throw new Error(message);
    }

    return json ?? {};
  }
}

class PkQmdView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.client = plugin.sidecarClient;
    this.discoveredVaults = [];
    this.currentStatus = null;
    this.lastResults = [];
  }

  getViewType() {
    return VIEW_TYPE_PK_QMD;
  }

  getDisplayText() {
    return "PK QMD Retrieval";
  }

  getIcon() {
    return "search";
  }

  async onOpen() {
    this.render();
    await this.refreshAll();
  }

  async onClose() {}

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pk-qmd-view");

    this.statusCard = contentEl.createDiv({ cls: "pk-qmd-card" });
    this.statusCard.createEl("h3", { text: "Index Status" });
    this.statusMeta = this.statusCard.createDiv({ cls: "pk-qmd-meta" });
    this.statusHint = this.statusCard.createDiv({ cls: "pk-qmd-hint" });
    this.statusActions = this.statusCard.createDiv({ cls: "pk-qmd-actions" });
    this.refreshButton = this.statusActions.createEl("button", { text: "Refresh status" });
    this.refreshButton.addEventListener("click", () => this.refreshAll());
    this.indexAllButton = this.statusActions.createEl("button", { cls: "mod-cta", text: "Index all vaults" });
    this.indexAllButton.addEventListener("click", () => this.indexAllVaults());

    this.searchCard = contentEl.createDiv({ cls: "pk-qmd-card" });
    this.searchCard.createEl("h3", { text: "Search" });
    this.searchHint = this.searchCard.createDiv({
      cls: "pk-qmd-hint",
      text: "Search across all indexed vaults, or bind to one vault explicitly."
    });

    this.searchBar = this.searchCard.createDiv({ cls: "pk-qmd-searchbar" });
    this.queryInput = this.searchBar.createEl("input", {
      attr: { placeholder: "Find related notes, screenshots, docs, or tasks..." },
      type: "text"
    });
    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.runSearch();
      }
    });
    this.searchButton = this.searchBar.createEl("button", { cls: "mod-cta", text: "Search" });
    this.searchButton.addEventListener("click", () => this.runSearch());

    this.searchControls = this.searchCard.createDiv({ cls: "pk-qmd-row" });
    this.searchControls.createEl("label", { text: "Vault" });
    this.vaultSelect = this.searchControls.createEl("select");
    this.vaultSelect.addEventListener("change", async () => {
      this.plugin.settings.defaultVaultPath = this.vaultSelect.value;
      await this.plugin.saveSettings();
    });
    this.searchControls.createEl("label", { text: "Top K" });
    this.topKInput = this.searchControls.createEl("input", {
      type: "number"
    });
    this.topKInput.min = "1";
    this.topKInput.max = "25";
    this.topKInput.value = String(this.plugin.settings.defaultTopK);
    this.topKInput.addEventListener("change", async () => {
      const parsed = Number(this.topKInput.value);
      this.plugin.settings.defaultTopK = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.defaultTopK;
      this.topKInput.value = String(this.plugin.settings.defaultTopK);
      await this.plugin.saveSettings();
    });

    this.noteActions = this.searchCard.createDiv({ cls: "pk-qmd-actions" });
    this.relatedButton = this.noteActions.createEl("button", { text: "Search from current note" });
    this.relatedButton.addEventListener("click", () => this.searchCurrentNote());
    this.insertQueryButton = this.noteActions.createEl("button", { text: "Use selection as query" });
    this.insertQueryButton.addEventListener("click", () => this.useSelectionAsQuery());

    this.resultsCard = contentEl.createDiv({ cls: "pk-qmd-card" });
    this.resultsCard.createEl("h3", { text: "Results" });
    this.resultsContainer = this.resultsCard.createDiv({ cls: "pk-qmd-results" });

    this.renderVaultOptions();
    this.renderStatus();
    this.renderResults();
  }

  setBusy(button, busyText, isBusy) {
    if (!button) return;
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent || "";
    }
    button.disabled = isBusy;
    button.textContent = isBusy ? busyText : button.dataset.originalText;
  }

  async refreshAll() {
    await this.refreshVaults();
    await this.refreshStatus();
  }

  async refreshVaults() {
    try {
      const response = await this.client.get("/vaults/discover");
      this.discoveredVaults = Array.isArray(response.vaults) ? response.vaults : [];
    } catch (error) {
      this.discoveredVaults = [];
      new Notice(`PK QMD: ${error.message}`);
    }
    this.renderVaultOptions();
  }

  async refreshStatus() {
    try {
      this.currentStatus = await this.client.get("/index/status");
    } catch (error) {
      this.currentStatus = {
        ok: false,
        error: error.message
      };
    }
    this.renderStatus();
  }

  async indexAllVaults() {
    this.setBusy(this.indexAllButton, "Indexing...", true);
    try {
      const response = await this.client.post("/index/all", {});
      this.currentStatus = response;
      this.renderStatus();
      new Notice("PK QMD: index completed.");
    } catch (error) {
      new Notice(`PK QMD: ${error.message}`);
    } finally {
      this.setBusy(this.indexAllButton, "Indexing...", false);
      await this.refreshAll();
    }
  }

  async runSearch(queryOverride) {
    const query = String(queryOverride || this.queryInput.value || "").trim();
    if (!query) {
      new Notice("PK QMD: enter a search query first.");
      return;
    }

    this.queryInput.value = query;
    this.setBusy(this.searchButton, "Searching...", true);
    try {
      const payload = {
        query,
        topK: Number(this.topKInput.value || this.plugin.settings.defaultTopK)
      };
      if (this.vaultSelect.value) {
        payload.vaultPath = this.vaultSelect.value;
      }
      const response = await this.client.post("/search", payload);
      this.lastResults = Array.isArray(response.results) ? response.results : [];
      this.renderResults();
    } catch (error) {
      this.lastResults = [];
      this.renderResults(error.message);
      new Notice(`PK QMD: ${error.message}`);
    } finally {
      this.setBusy(this.searchButton, "Searching...", false);
    }
  }

  async useSelectionAsQuery() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const selection = view?.editor?.getSelection()?.trim() || "";
    if (!selection) {
      new Notice("PK QMD: select text in the current note first.");
      return;
    }
    this.queryInput.value = selection;
    await this.runSearch(selection);
  }

  async searchCurrentNote() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!view || !file) {
      new Notice("PK QMD: open a note first.");
      return;
    }

    const content = view.editor.getValue().trim();
    const excerpt = content.slice(0, 600);
    const query = `Related context for note ${file.basename}: ${excerpt}`;
    this.queryInput.value = query;
    await this.runSearch(query);
  }

  async insertResult(result) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("PK QMD: open a markdown editor first.");
      return;
    }

    const block = [
      `> [!quote] ${result.relativePath}`,
      `> Vault: ${result.vaultName}`,
      `> Score: ${result.score}`,
      ">",
      ...String(result.snippet || "")
        .split(/\r?\n/)
        .map((line) => `> ${line}`),
      "",
      `Source: ${result.path}`
    ].join("\n");

    view.editor.replaceSelection(block);
    new Notice("PK QMD: inserted result into current note.");
  }

  renderVaultOptions() {
    if (!this.vaultSelect) return;

    this.vaultSelect.innerHTML = "";
    this.vaultSelect.createEl("option", { text: "All indexed vaults", value: "" });
    for (const vault of this.discoveredVaults) {
      this.vaultSelect.createEl("option", {
        text: vault.name,
        value: vault.path
      });
    }
    this.vaultSelect.value = this.plugin.settings.defaultVaultPath || "";
  }

  renderStatus() {
    if (!this.statusMeta || !this.statusHint) return;

    this.statusMeta.empty();
    this.statusHint.empty();

    const status = this.currentStatus;
    if (!status || status.ok === false) {
      const badge = this.statusMeta.createSpan({ cls: "pk-qmd-badge is-warning", text: "Unavailable" });
      badge.setAttribute("title", "The sidecar service could not be reached.");
      this.statusHint.setText(status?.error || "Start the index-service sidecar, then refresh.");
      return;
    }

    const vaultCount = Array.isArray(status.vaults) ? status.vaults.length : 0;
    const latestJob = Array.isArray(status.jobs) && status.jobs.length ? status.jobs[0] : null;
    const summary = latestJob?.summary || {};

    this.statusMeta.createSpan({ cls: "pk-qmd-badge is-active", text: "Connected" });
    this.statusMeta.createSpan({ cls: "pk-qmd-badge", text: `${vaultCount} vault${vaultCount === 1 ? "" : "s"}` });
    this.statusMeta.createSpan({
      cls: "pk-qmd-badge",
      text: `${summary.documentCount || 0} docs`
    });
    this.statusMeta.createSpan({
      cls: "pk-qmd-badge",
      text: `${summary.segmentCount || 0} segments`
    });
    this.statusMeta.createSpan({
      cls: "pk-qmd-badge",
      text: status.embedding?.model || "No embedding model"
    });

    const lines = [];
    if (latestJob?.finishedAt) {
      lines.push(`Last index: ${latestJob.finishedAt}`);
    }
    if (status.storage?.statePath) {
      lines.push(`State: ${status.storage.statePath}`);
    }
    if (this.discoveredVaults.length) {
      lines.push(`Discovered: ${this.discoveredVaults.map((vault) => vault.name).join(", ")}`);
    }
    this.statusHint.setText(lines.join(" | "));
  }

  renderResults(errorText) {
    if (!this.resultsContainer) return;
    this.resultsContainer.empty();

    if (errorText) {
      this.resultsContainer.createDiv({ cls: "pk-qmd-empty", text: errorText });
      return;
    }

    if (!this.lastResults.length) {
      this.resultsContainer.createDiv({
        cls: "pk-qmd-empty",
        text: "No search results yet. Run a query or search from the current note."
      });
      return;
    }

    for (const result of this.lastResults) {
      const card = this.resultsContainer.createDiv({ cls: "pk-qmd-result" });
      const header = card.createDiv({ cls: "pk-qmd-result-header" });
      header.createDiv({ cls: "pk-qmd-result-title", text: result.relativePath || result.path || "Untitled result" });
      header.createDiv({ cls: "pk-qmd-result-score", text: `Score ${result.score}` });
      card.createDiv({ cls: "pk-qmd-result-path", text: `${result.vaultName} | ${result.path}` });
      card.createDiv({ cls: "pk-qmd-result-snippet", text: result.snippet || "" });
      const actions = card.createDiv({ cls: "pk-qmd-result-actions" });
      const copyButton = actions.createEl("button", { text: "Insert into note" });
      copyButton.addEventListener("click", () => this.insertResult(result));
      const queryButton = actions.createEl("button", { text: "Search more like this" });
      queryButton.addEventListener("click", () => this.runSearch(result.snippet || result.relativePath || ""));
    }
  }
}

class PkQmdSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "PK QMD Retrieval" });

    new Setting(containerEl)
      .setName("Index service URL")
      .setDesc("Local sidecar base URL used for vault discovery, indexing, and search.")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:4317")
          .setValue(this.plugin.settings.serviceUrl)
          .onChange(async (value) => {
            this.plugin.settings.serviceUrl = normalizeBaseUrl(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default top K")
      .setDesc("How many search results to request by default.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.defaultTopK)).onChange(async (value) => {
          const parsed = Number(value);
          this.plugin.settings.defaultTopK = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.defaultTopK;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default vault filter")
      .setDesc("Optional absolute vault path. Leave empty to search across all indexed vaults.")
      .addText((text) =>
        text.setPlaceholder("C:\\path\\to\\vault").setValue(this.plugin.settings.defaultVaultPath).onChange(async (value) => {
          this.plugin.settings.defaultVaultPath = value.trim();
          await this.plugin.saveSettings();
        })
      );
  }
}

module.exports = class PkQmdRetrievalPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.sidecarClient = new SidecarClient(() => this.settings);

    this.registerView(VIEW_TYPE_PK_QMD, (leaf) => new PkQmdView(leaf, this));
    this.addRibbonIcon("search", "Open PK QMD Retrieval", () => this.activateView());
    this.addCommand({
      id: "pk-qmd-open-pane",
      name: "Open retrieval pane",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "pk-qmd-index-all-vaults",
      name: "Index all discovered vaults",
      callback: async () => {
        try {
          await this.sidecarClient.post("/index/all", {});
          new Notice("PK QMD: index completed.");
        } catch (error) {
          new Notice(`PK QMD: ${error.message}`);
        }
      }
    });
    this.addCommand({
      id: "pk-qmd-search-current-note",
      name: "Search related content for current note",
      callback: async () => {
        await this.activateView();
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PK_QMD)[0];
        if (leaf && leaf.view instanceof PkQmdView) {
          await leaf.view.searchCurrentNote();
        }
      }
    });

    this.addSettingTab(new PkQmdSettingTab(this.app, this));
  }

  async onunload() {
    await this.app.workspace.detachLeavesOfType(VIEW_TYPE_PK_QMD);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.serviceUrl = normalizeBaseUrl(this.settings.serviceUrl);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PK_QMD)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ active: true, type: VIEW_TYPE_PK_QMD });
    }

    this.app.workspace.revealLeaf(leaf);
  }
};
