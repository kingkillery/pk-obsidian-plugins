import { App, PluginSettingTab, Setting } from "obsidian";

import type CodexMounterPlugin from "./main";

export class CodexMounterSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: CodexMounterPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Codex executable path")
      .setDesc("Absolute path to the Windows Codex app executable that should be mounted.")
      .addText((text) =>
        text
          .setPlaceholder("C:\\Program Files\\Codex\\Codex.exe")
          .setValue(this.plugin.settings.codexExecutablePath)
          .onChange(async (value) => {
            this.plugin.settings.codexExecutablePath = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Launch arguments")
      .setDesc("Optional raw command-line arguments passed to Codex when mounting.")
      .addText((text) =>
        text
          .setPlaceholder("--profile work")
          .setValue(this.plugin.settings.launchArguments)
          .onChange(async (value) => {
            this.plugin.settings.launchArguments = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Attach timeout (ms)")
      .setDesc("How long to wait for the Codex window to appear before failing the mount.")
      .addText((text) =>
        text
          .setPlaceholder("15000")
          .setValue(String(this.plugin.settings.attachTimeoutMs))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            this.plugin.settings.attachTimeoutMs =
              Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Reuse existing tab")
      .setDesc("Reveal the existing Codex tab instead of opening a second mount container.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.reuseExistingTab)
          .onChange(async (value) => {
            this.plugin.settings.reuseExistingTab = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
