import {
	App,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	normalizePath,
} from "obsidian";
import { DEFAULT_SETTINGS, SymphonySettings } from "./settings";
import {
	SYMPHONY_DASHBOARD_VIEW_TYPE,
	SymphonyDashboardView,
} from "./ui/symphony-dashboard-view";

export default class SymphonyPlugin extends Plugin {
	settings: SymphonySettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(
			SYMPHONY_DASHBOARD_VIEW_TYPE,
			(leaf) => new SymphonyDashboardView(leaf, () => this.settings),
		);

		this.addSettingTab(new SymphonySettingTab(this.app, this));
		this.registerCommands();

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.dashboardOpenOnStart) {
				void this.activateDashboardView();
			}

			if (this.settings.autoStart) {
				new Notice("Symphony scaffold loaded. Auto start is configured, but orchestration is not implemented yet.", 7000);
			}
		});
	}

	async onunload(): Promise<void> {
		await this.app.workspace.detachLeavesOfType(SYMPHONY_DASHBOARD_VIEW_TYPE);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.settings.workflowFilePath = normalizePath(this.settings.workflowFilePath);
	}

	async saveSettings(): Promise<void> {
		this.settings.workflowFilePath = normalizePath(this.settings.workflowFilePath);
		await this.saveData(this.settings);

		for (const leaf of this.app.workspace.getLeavesOfType(SYMPHONY_DASHBOARD_VIEW_TYPE)) {
			if (leaf.view instanceof SymphonyDashboardView) {
				leaf.view.render();
			}
		}
	}

	private registerCommands(): void {
		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
			callback: async () => {
				await this.activateDashboardView();
			},
		});

		this.addCommand({
			id: "refresh-now",
			name: "Refresh now",
			callback: () => {
				new Notice("Refresh is not implemented in the scaffold yet.");
			},
		});

		this.addCommand({
			id: "run-current-issue",
			name: "Run current issue",
			editorCheckCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					return false;
				}

				if (!checking) {
					new Notice(`Run current issue is not implemented yet for ${view.file.path}.`);
				}

				return true;
			},
		});

		this.addCommand({
			id: "stop-current-issue",
			name: "Stop current issue",
			editorCheckCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view?.file) {
					return false;
				}

				if (!checking) {
					new Notice(`Stop current issue is not implemented yet for ${view.file.path}.`);
				}

				return true;
			},
		});
	}

	private async activateDashboardView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(SYMPHONY_DASHBOARD_VIEW_TYPE)[0] ?? null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) {
				new Notice("Unable to create a Symphony dashboard leaf.");
				return;
			}
			await leaf.setViewState({
				type: SYMPHONY_DASHBOARD_VIEW_TYPE,
				active: true,
			});
		}

		await workspace.revealLeaf(leaf);

		if (leaf.view instanceof SymphonyDashboardView) {
			leaf.view.render();
		}
	}
}

class SymphonySettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SymphonyPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Symphony" });
		containerEl.createEl("p", {
			text: "This settings tab configures the scaffold. Runtime orchestration is not implemented yet.",
		});

		new Setting(containerEl)
			.setName("Workflow file path")
			.setDesc("Vault-relative path to the workflow definition.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.workflowFilePath)
					.setValue(this.plugin.settings.workflowFilePath)
					.onChange(async (value) => {
						this.plugin.settings.workflowFilePath = value.trim() || DEFAULT_SETTINGS.workflowFilePath;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Desktop workspace root")
			.setDesc("Absolute desktop path for per-issue workspaces.")
			.addText((text) =>
				text
					.setPlaceholder("C:\\work\\symphony")
					.setValue(this.plugin.settings.desktopWorkspaceRoot)
					.onChange(async (value) => {
						this.plugin.settings.desktopWorkspaceRoot = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Desktop log root")
			.setDesc("Absolute desktop path for log files.")
			.addText((text) =>
				text
					.setPlaceholder("C:\\work\\symphony-logs")
					.setValue(this.plugin.settings.desktopLogRoot)
					.onChange(async (value) => {
						this.plugin.settings.desktopLogRoot = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto start")
			.setDesc("Open the runtime automatically after layout is ready once orchestration exists.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStart)
					.onChange(async (value) => {
						this.plugin.settings.autoStart = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Open dashboard on start")
			.setDesc("Reveal the Symphony dashboard after the workspace layout is ready.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.dashboardOpenOnStart)
					.onChange(async (value) => {
						this.plugin.settings.dashboardOpenOnStart = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("HTTP port override")
			.setDesc("Optional loopback port for a future local HTTP API.")
			.addText((text) =>
				text
					.setPlaceholder("3000")
					.setValue(this.plugin.settings.httpPortOverride === null ? "" : String(this.plugin.settings.httpPortOverride))
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.plugin.settings.httpPortOverride = trimmed ? Number.parseInt(trimmed, 10) || null : null;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Allow workspace inside vault")
			.setDesc("Unsafe by default. Leave disabled unless the runtime explicitly supports it.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.allowWorkspaceInsideVault)
					.onChange(async (value) => {
						this.plugin.settings.allowWorkspaceInsideVault = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
