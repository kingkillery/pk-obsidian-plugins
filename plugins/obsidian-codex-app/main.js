"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => CodexMounterPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/backend-manager.ts
var import_obsidian = require("obsidian");
var import_node_child_process = require("node:child_process");
var import_node_path = require("node:path");
var START_TIMEOUT_MS = 15e3;
var STOP_TIMEOUT_MS = 3e3;
var MAX_LOG_LINES = 250;
var BackendManager = class {
  constructor(options) {
    this.options = options;
    this.child = null;
    this.state = "idle";
    this.port = null;
    this.version = null;
    this.pid = null;
    this.mounted = false;
    this.lastError = null;
    this.logs = [];
    this.listeners = /* @__PURE__ */ new Set();
    this.startPromise = null;
    this.stdoutBuffer = "";
    this.readyResolve = null;
    this.readyReject = null;
    this.readyTimer = null;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }
  getSnapshot() {
    return {
      state: this.state,
      port: this.port,
      baseUrl: this.getBaseUrl(),
      version: this.version,
      pid: this.pid,
      mounted: this.mounted,
      lastError: this.lastError,
      logs: [...this.logs]
    };
  }
  getLogs() {
    return [...this.logs];
  }
  getBaseUrl() {
    return this.port ? `http://127.0.0.1:${this.port}` : null;
  }
  async start() {
    if (this.child && (this.state === "ready" || this.state === "mounted")) {
      return this.getSnapshot();
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }
  async mount(bounds) {
    const settings = this.options.getSettings();
    const executablePath = settings.codexExecutablePath.trim();
    if (!executablePath) {
      throw new Error("Set the Codex executable path in the plugin settings.");
    }
    await this.start();
    this.setState("mounting", null);
    const response = await this.requestJson("/mount", {
      executablePath,
      launchArgs: splitLaunchArguments(settings.launchArguments),
      bounds,
      attachTimeoutMs: settings.attachTimeoutMs
    });
    this.pid = response.pid;
    this.mounted = response.mounted;
    this.setState("mounted", null);
    return this.refreshStatus();
  }
  async updateBounds(bounds) {
    if (!this.child || !this.mounted) {
      return;
    }
    await this.requestJson("/bounds", { bounds });
  }
  async unmount() {
    if (!this.child || !this.port) {
      this.mounted = false;
      this.pid = null;
      this.setState("stopped", null);
      return this.getSnapshot();
    }
    try {
      await this.requestJson("/unmount", {});
    } catch (error) {
      this.appendLog("system", `Unmount request failed: ${error instanceof Error ? error.message : String(error)}.`);
      this.resetRuntime();
      this.setState("stopped", null);
      return this.getSnapshot();
    }
    this.mounted = false;
    this.pid = null;
    this.setState("ready", null);
    return this.refreshStatus();
  }
  async stop() {
    if (!this.child) {
      this.resetRuntime();
      this.setState("stopped", null);
      return;
    }
    this.clearReadyWaiter();
    try {
      if (this.port) {
        await this.requestJson("/shutdown", {});
      }
    } catch {
    }
    const child = this.child;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        child.removeListener("exit", onExit);
        resolve();
      };
      const onExit = () => finish();
      const timer = window.setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
        finish();
      }, STOP_TIMEOUT_MS);
      child.once("exit", onExit);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
    });
    this.child = null;
    this.resetRuntime();
    this.setState("stopped", null);
  }
  async refreshStatus() {
    if (!this.child || !this.port) {
      return this.getSnapshot();
    }
    const response = await this.requestJson("/status", void 0, "GET");
    this.pid = response.pid > 0 ? response.pid : null;
    this.mounted = response.mounted;
    this.lastError = response.lastError ?? null;
    if (!this.mounted && this.state === "mounted") {
      this.setState("ready", this.lastError);
    } else {
      this.notify();
    }
    return this.getSnapshot();
  }
  async startInternal() {
    const executablePath = this.resolveHelperExecutablePath();
    this.appendLog("system", `Starting helper: ${executablePath}`);
    this.resetRuntime();
    this.setState("starting", null);
    const child = (0, import_node_child_process.spawn)(executablePath, [], {
      cwd: this.options.pluginDir,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.child = child;
    child.stdout.on("data", (chunk) => {
      this.handleStdoutChunk(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      this.appendLog("stderr", chunk.toString());
    });
    child.once("error", (error) => {
      this.fail(error.message);
    });
    child.once("exit", (code, signal) => {
      this.appendLog("system", `Helper exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`);
      this.child = null;
      this.resetRuntime();
      if (this.readyReject) {
        this.readyReject(new Error("Helper exited before ready."));
      } else {
        this.setState("stopped", this.lastError);
      }
    });
    const ready = await this.waitForReady();
    this.port = ready.port;
    this.version = ready.version ?? null;
    this.setState("ready", null);
    return this.refreshStatus();
  }
  resolveHelperExecutablePath() {
    const executableName = process.platform === "win32" ? "codex-mounter.exe" : "codex-mounter";
    return (0, import_node_path.join)(this.options.pluginDir, "bin", executableName);
  }
  waitForReady() {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = window.setTimeout(() => {
        reject(new Error(`Timed out waiting for helper after ${START_TIMEOUT_MS}ms.`));
      }, START_TIMEOUT_MS);
    }).then((message) => {
      this.clearReadyWaiter();
      return message;
    }).catch((error) => {
      this.clearReadyWaiter();
      this.fail(error instanceof Error ? error.message : String(error));
      throw error;
    });
  }
  handleStdoutChunk(chunk) {
    this.stdoutBuffer += chunk;
    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        this.appendLog("stdout", line);
        this.maybeResolveReady(line);
      }
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }
  maybeResolveReady(line) {
    if (!this.readyResolve) {
      return;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed.ready === true && typeof parsed.port === "number") {
        this.readyResolve({
          ready: true,
          port: parsed.port,
          version: typeof parsed.version === "string" ? parsed.version : void 0
        });
      }
    } catch {
    }
  }
  clearReadyWaiter() {
    if (this.readyTimer !== null) {
      window.clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.readyResolve = null;
    this.readyReject = null;
  }
  async requestJson(path, body, method = "POST") {
    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      throw new Error("Helper is not running.");
    }
    const response = await (0, import_obsidian.requestUrl)({
      url: `${baseUrl}${path}`,
      method,
      body: body ? JSON.stringify(body) : void 0,
      contentType: "application/json",
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      const text = response.text || `Request failed with status ${response.status}.`;
      this.fail(text);
      throw new Error(text);
    }
    if (!response.text) {
      return {};
    }
    return JSON.parse(response.text);
  }
  resetRuntime() {
    this.port = null;
    this.version = null;
    this.pid = null;
    this.mounted = false;
  }
  fail(message) {
    this.resetRuntime();
    this.setState("error", message);
  }
  setState(state, lastError) {
    this.state = state;
    this.lastError = lastError;
    this.notify();
  }
  appendLog(channel, value) {
    const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => `[${channel}] ${line}`);
    if (!lines.length) {
      return;
    }
    this.logs.push(...lines);
    if (this.logs.length > MAX_LOG_LINES) {
      this.logs = this.logs.slice(this.logs.length - MAX_LOG_LINES);
    }
    this.notify();
  }
  notify() {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
};
function splitLaunchArguments(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const matches = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((part) => part.replace(/^"(.*)"$/, "$1"));
}

// src/settings.ts
var import_obsidian2 = require("obsidian");
var CodexMounterSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian2.Setting(containerEl).setName("Codex executable path").setDesc("Absolute path to the Windows Codex app executable that should be mounted.").addText(
      (text) => text.setPlaceholder("C:\\Program Files\\Codex\\Codex.exe").setValue(this.plugin.settings.codexExecutablePath).onChange(async (value) => {
        this.plugin.settings.codexExecutablePath = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Launch arguments").setDesc("Optional raw command-line arguments passed to Codex when mounting.").addText(
      (text) => text.setPlaceholder("--profile work").setValue(this.plugin.settings.launchArguments).onChange(async (value) => {
        this.plugin.settings.launchArguments = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Attach timeout (ms)").setDesc("How long to wait for the Codex window to appear before failing the mount.").addText(
      (text) => text.setPlaceholder("15000").setValue(String(this.plugin.settings.attachTimeoutMs)).onChange(async (value) => {
        const parsed = Number.parseInt(value, 10);
        this.plugin.settings.attachTimeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 15e3;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Reuse existing tab").setDesc("Reveal the existing Codex tab instead of opening a second mount container.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.reuseExistingTab).onChange(async (value) => {
        this.plugin.settings.reuseExistingTab = value;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/types.ts
var VIEW_TYPE_CODEX_MOUNTER = "codex-mounter-view";
var DEFAULT_SETTINGS = {
  codexExecutablePath: "",
  launchArguments: "",
  attachTimeoutMs: 15e3,
  reuseExistingTab: true
};

// src/view.ts
var import_obsidian3 = require("obsidian");
var BOUNDS_SYNC_DEBOUNCE_MS = 100;
var CodexMounterView = class extends import_obsidian3.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.unsubscribe = null;
    this.resizeObserver = null;
    this.boundsTimer = null;
    this.queueBoundsSync = () => {
      if (this.boundsTimer !== null) {
        window.clearTimeout(this.boundsTimer);
      }
      this.boundsTimer = window.setTimeout(async () => {
        this.boundsTimer = null;
        try {
          await this.plugin.backendManager.updateBounds(this.getStageBounds());
        } catch {
        }
      }, BOUNDS_SYNC_DEBOUNCE_MS);
    };
    this.onWindowResize = () => {
      this.queueBoundsSync();
    };
  }
  getViewType() {
    return VIEW_TYPE_CODEX_MOUNTER;
  }
  getDisplayText() {
    return "Codex";
  }
  async onOpen() {
    this.renderShell();
    this.unsubscribe = this.plugin.backendManager.subscribe((snapshot) => {
      this.applySnapshot(snapshot);
    });
    this.resizeObserver = new ResizeObserver(() => {
      this.queueBoundsSync();
    });
    this.resizeObserver.observe(this.contentEl);
    window.addEventListener("resize", this.onWindowResize);
    this.registerEvent(this.app.workspace.on("layout-change", this.queueBoundsSync));
  }
  async onClose() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.onWindowResize);
    if (this.boundsTimer !== null) {
      window.clearTimeout(this.boundsTimer);
      this.boundsTimer = null;
    }
    try {
      await this.plugin.backendManager.unmount();
    } catch {
    }
  }
  async mountCodex() {
    const bounds = this.getStageBounds();
    await this.plugin.backendManager.mount(bounds);
    this.queueBoundsSync();
  }
  async unmountCodex() {
    await this.plugin.backendManager.unmount();
  }
  renderShell() {
    this.contentEl.empty();
    this.contentEl.addClass("codex-mounter-root");
    const toolbarEl = this.contentEl.createDiv({ cls: "codex-mounter-toolbar" });
    this.statusEl = toolbarEl.createDiv({ cls: "codex-mounter-status", text: "Idle" });
    const actionsEl = toolbarEl.createDiv({ cls: "codex-mounter-actions" });
    this.mountButtonEl = actionsEl.createEl("button", { text: "Mount" });
    this.mountButtonEl.onclick = async () => {
      try {
        await this.mountCodex();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? error.message : String(error));
      }
    };
    this.unmountButtonEl = actionsEl.createEl("button", { text: "Close Codex" });
    this.unmountButtonEl.onclick = async () => {
      try {
        await this.unmountCodex();
      } catch (error) {
        new import_obsidian3.Notice(error instanceof Error ? error.message : String(error));
      }
    };
    const copyLogsButton = actionsEl.createEl("button", { text: "Copy logs" });
    copyLogsButton.onclick = async () => {
      await navigator.clipboard.writeText(this.plugin.backendManager.getLogs().join("\n"));
      new import_obsidian3.Notice("Copied Codex helper logs.");
    };
    this.shellEl = this.contentEl.createDiv({ cls: "codex-mounter-shell" });
    this.stageEl = this.shellEl.createDiv({ cls: "codex-mounter-stage" });
    const overlayEl = this.shellEl.createDiv({ cls: "codex-mounter-overlay" });
    this.overlayTitleEl = overlayEl.createEl("h3", { text: "Codex is not mounted" });
    this.overlayBodyEl = overlayEl.createEl("p", {
      text: "Set the Codex executable path, then mount a dedicated Codex window into this tab."
    });
  }
  applySnapshot(snapshot) {
    this.statusEl.setText(this.getStatusLabel(snapshot));
    this.shellEl.toggleClass("is-mounted", snapshot.mounted);
    this.mountButtonEl.disabled = snapshot.state === "mounting" || snapshot.mounted;
    this.unmountButtonEl.disabled = !snapshot.mounted;
    if (snapshot.mounted) {
      this.overlayTitleEl.setText("Codex mounted");
      this.overlayBodyEl.setText(
        `Codex is running inside this tab${snapshot.pid ? ` (pid ${snapshot.pid})` : ""}. Closing this view will close that Codex process.`
      );
      return;
    }
    switch (snapshot.state) {
      case "mounting":
        this.overlayTitleEl.setText("Mounting Codex");
        this.overlayBodyEl.setText("Launching Codex and attaching its window to this tab.");
        break;
      case "error":
        this.overlayTitleEl.setText("Mount failed");
        this.overlayBodyEl.setText(snapshot.lastError ?? "The Codex helper reported an error.");
        break;
      case "ready":
        this.overlayTitleEl.setText("Ready to mount");
        this.overlayBodyEl.setText("The helper is ready. Press Mount to launch Codex into this tab.");
        break;
      default:
        this.overlayTitleEl.setText("Codex is not mounted");
        this.overlayBodyEl.setText(
          "This tab is just the container. Mount starts a dedicated Codex app process and places it here."
        );
        break;
    }
  }
  getStatusLabel(snapshot) {
    switch (snapshot.state) {
      case "starting":
        return "Starting helper";
      case "ready":
        return "Ready";
      case "mounting":
        return "Mounting";
      case "mounted":
        return `Mounted${snapshot.pid ? ` \xB7 ${snapshot.pid}` : ""}`;
      case "error":
        return "Error";
      case "stopped":
        return "Stopped";
      default:
        return "Idle";
    }
  }
  getStageBounds() {
    const rect = this.stageEl.getBoundingClientRect();
    const frameX = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
    const frameY = Math.max(0, window.outerHeight - window.innerHeight - frameX);
    return {
      x: Math.round(window.screenX + frameX + rect.left),
      y: Math.round(window.screenY + frameY + rect.top),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    };
  }
};

// src/main.ts
var CodexMounterPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
  }
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    const pluginDir = this.getPluginDir();
    this.backendManager = new BackendManager({
      pluginDir,
      getSettings: () => this.settings
    });
    this.registerView(VIEW_TYPE_CODEX_MOUNTER, (leaf) => new CodexMounterView(leaf, this));
    this.addCommand({
      id: "open-codex-pane",
      name: "Open Codex pane",
      callback: () => {
        void this.activateView(false);
      }
    });
    this.addCommand({
      id: "mount-codex",
      name: "Mount Codex",
      callback: () => {
        void this.activateView(true);
      }
    });
    this.addCommand({
      id: "close-codex",
      name: "Close mounted Codex",
      callback: async () => {
        await this.backendManager.unmount();
      }
    });
    this.addCommand({
      id: "copy-codex-logs",
      name: "Copy Codex helper logs",
      callback: async () => {
        await navigator.clipboard.writeText(this.backendManager.getLogs().join("\n"));
        new import_obsidian4.Notice("Copied Codex helper logs.");
      }
    });
    this.addSettingTab(new CodexMounterSettingTab(this.app, this));
    this.register(() => {
      void this.backendManager.stop();
    });
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CODEX_MOUNTER);
    void this.backendManager.stop();
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async activateView(shouldMount) {
    const leaf = await this.getOrCreateLeaf();
    await leaf.setViewState({ type: VIEW_TYPE_CODEX_MOUNTER, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (!shouldMount) {
      return;
    }
    const view = leaf.view;
    if (view instanceof CodexMounterView) {
      try {
        await view.mountCodex();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        new import_obsidian4.Notice(`Codex mount failed: ${message}`);
      }
    }
  }
  async getOrCreateLeaf() {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_MOUNTER);
    if (this.settings.reuseExistingTab && existingLeaves.length > 0) {
      return existingLeaves[0];
    }
    return this.app.workspace.getLeaf(true);
  }
  getPluginDir() {
    const configRelativePath = (0, import_obsidian4.normalizePath)(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    const adapter = this.app.vault.adapter;
    if (adapter instanceof import_obsidian4.FileSystemAdapter) {
      return (0, import_obsidian4.normalizePath)(`${adapter.getBasePath()}/${configRelativePath}`);
    }
    return configRelativePath;
  }
};
