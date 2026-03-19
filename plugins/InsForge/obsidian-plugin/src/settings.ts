import { App, PluginSettingTab, Setting } from "obsidian";

import type InsForgePlugin from "./main";
import { DEFAULT_SETTINGS } from "./types";

export class InsForgeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: InsForgePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "InsForge" });

    new Setting(containerEl)
      .setName("InsForge API base URL")
      .setDesc("Base URL used for docs, logs, and functions API calls.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.apiBaseUrl)
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiBaseUrl = value.trim() || DEFAULT_SETTINGS.apiBaseUrl;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("InsForge dashboard URL")
      .setDesc("Used when opening the InsForge dashboard in the browser.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.dashboardUrl)
          .setValue(this.plugin.settings.dashboardUrl)
          .onChange(async (value) => {
            this.plugin.settings.dashboardUrl = value.trim() || DEFAULT_SETTINGS.dashboardUrl;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Admin token or API key")
      .setDesc("Use an ik_ API key or project admin bearer token for logs and functions.")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("ik_xxx or jwt token")
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Knowledge base").setHeading();

    new Setting(containerEl)
      .setName("Knowledge base folder")
      .setDesc("Vault folder where InsForge docs, logs, functions, and captured context are stored.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.knowledgeBaseFolder)
          .setValue(this.plugin.settings.knowledgeBaseFolder)
          .onChange(async (value) => {
            this.plugin.settings.knowledgeBaseFolder =
              value.trim() || DEFAULT_SETTINGS.knowledgeBaseFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Default log limit")
      .setDesc("How many logs to request when loading a source from the InsForge pane.")
      .addText((text) =>
        text
          .setPlaceholder(String(DEFAULT_SETTINGS.defaultLogLimit))
          .setValue(String(this.plugin.settings.defaultLogLimit))
          .onChange(async (value) => {
            const parsed = Number(value);
            this.plugin.settings.defaultLogLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.defaultLogLimit;
            await this.plugin.saveSettings();
          })
      );

    const note = containerEl.createDiv({ cls: "insforge-setting-note" });
    note.setText(
      "Use the command palette to capture note context, open the InsForge pane, or sync docs into your vault."
    );
  }
}
