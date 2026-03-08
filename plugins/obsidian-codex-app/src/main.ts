import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf, normalizePath } from "obsidian";

import { BackendManager } from "./backend-manager";
import { CodexMounterSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type PluginSettings, VIEW_TYPE_CODEX_MOUNTER } from "./types";
import { CodexMounterView } from "./view";

export default class CodexMounterPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  backendManager!: BackendManager;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    const pluginDir = this.getPluginDir();
    this.backendManager = new BackendManager({
      pluginDir,
      getSettings: () => this.settings,
    });

    this.registerView(VIEW_TYPE_CODEX_MOUNTER, (leaf) => new CodexMounterView(leaf, this));

    this.addCommand({
      id: "open-codex-pane",
      name: "Open Codex pane",
      callback: () => {
        void this.activateView(false);
      },
    });

    this.addCommand({
      id: "mount-codex",
      name: "Mount Codex",
      callback: () => {
        void this.activateView(true);
      },
    });

    this.addCommand({
      id: "close-codex",
      name: "Close mounted Codex",
      callback: async () => {
        await this.backendManager.unmount();
      },
    });

    this.addCommand({
      id: "copy-codex-logs",
      name: "Copy Codex helper logs",
      callback: async () => {
        await navigator.clipboard.writeText(this.backendManager.getLogs().join("\n"));
        new Notice("Copied Codex helper logs.");
      },
    });

    this.addSettingTab(new CodexMounterSettingTab(this.app, this));
    this.register(() => {
      void this.backendManager.stop();
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CODEX_MOUNTER);
    void this.backendManager.stop();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async activateView(shouldMount: boolean): Promise<void> {
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
        new Notice(`Codex mount failed: ${message}`);
      }
    }
  }

  private async getOrCreateLeaf(): Promise<WorkspaceLeaf> {
    const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CODEX_MOUNTER);
    if (this.settings.reuseExistingTab && existingLeaves.length > 0) {
      return existingLeaves[0];
    }

    return this.app.workspace.getLeaf(true);
  }

  private getPluginDir(): string {
    const configRelativePath = normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    const adapter = this.app.vault.adapter;

    if (adapter instanceof FileSystemAdapter) {
      return normalizePath(`${adapter.getBasePath()}/${configRelativePath}`);
    }

    return configRelativePath;
  }
}
