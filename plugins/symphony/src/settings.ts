import { App, Notice, Plugin, PluginSettingTab, Setting, normalizePath } from "obsidian";
import type { PersistedRuntimeState } from "./types";

export interface SymphonySettings {
	workflowFilePath: string;
	desktopProjectRoot: string;
	desktopWorkspaceRoot: string;
	desktopLogRoot: string;
	autoStart: boolean;
	dashboardOpenOnStart: boolean;
	httpPortOverride: number | null;
	allowWorkspaceInsideVault: boolean;
}

export interface SymphonyStoredData {
	settings?: Partial<SymphonySettings>;
	state?: Partial<PersistedRuntimeState>;
}

export interface SymphonySettingHost {
	settings: SymphonySettings;
	saveSettings(): Promise<void>;
	openDashboard(): Promise<void>;
	refreshNow(): Promise<void>;
	isRuntimeEnabled(): boolean;
	startRuntime(): Promise<void>;
	stopRuntime(): Promise<void>;
}

export const DEFAULT_SETTINGS: SymphonySettings = {
	workflowFilePath: "symphony/WORKFLOW.md",
	desktopProjectRoot: "",
	desktopWorkspaceRoot: "",
	desktopLogRoot: "",
	autoStart: false,
	dashboardOpenOnStart: false,
	httpPortOverride: null,
	allowWorkspaceInsideVault: false,
};

export const DEFAULT_PERSISTED_STATE: PersistedRuntimeState = {
	workspaceKeys: {},
	handledIssueVersions: {},
	lastKnownGoodWorkflowDigest: null,
	recentErrors: [],
};

export function normalizeSettings(settings: SymphonySettings): SymphonySettings {
	return {
		...settings,
		workflowFilePath: normalizePath(settings.workflowFilePath),
		desktopProjectRoot: settings.desktopProjectRoot.trim(),
		desktopWorkspaceRoot: settings.desktopWorkspaceRoot.trim(),
		desktopLogRoot: settings.desktopLogRoot.trim(),
	};
}

export function coerceStoredData(raw: unknown): {
	settings: SymphonySettings;
	state: PersistedRuntimeState;
} {
	if (looksLikeLegacySettings(raw)) {
		return {
			settings: normalizeSettings({
				...DEFAULT_SETTINGS,
				...(raw as Partial<SymphonySettings>),
			}),
			state: { ...DEFAULT_PERSISTED_STATE },
		};
	}

	const record = isRecord(raw) ? raw : {};
	const settingsRecord = isRecord(record.settings) ? record.settings : {};
	const stateRecord = isRecord(record.state) ? record.state : {};

	return {
		settings: normalizeSettings({
			...DEFAULT_SETTINGS,
			...(settingsRecord as Partial<SymphonySettings>),
		}),
		state: {
			workspaceKeys: isRecord(stateRecord.workspaceKeys)
				? coerceStringMap(stateRecord.workspaceKeys)
				: {},
			handledIssueVersions: isRecord(stateRecord.handledIssueVersions)
				? coerceStringMap(stateRecord.handledIssueVersions)
				: {},
			lastKnownGoodWorkflowDigest:
				typeof stateRecord.lastKnownGoodWorkflowDigest === "string"
					? stateRecord.lastKnownGoodWorkflowDigest
					: null,
			recentErrors: Array.isArray(stateRecord.recentErrors) ? stateRecord.recentErrors : [],
		},
	};
}

export class SymphonySettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly host: Plugin & SymphonySettingHost,
	) {
		super(app, host);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Symphony" });
		containerEl.createEl("p", {
			text: "Configure the workflow source, external workspace roots, and runtime behavior.",
		});

		new Setting(containerEl)
			.setName("Workflow file path")
			.setDesc("Vault-relative path to the workflow definition.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.workflowFilePath)
					.setValue(this.host.settings.workflowFilePath)
					.onChange(async (value) => {
						this.host.settings.workflowFilePath = value.trim() || DEFAULT_SETTINGS.workflowFilePath;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Symphony project root")
			.setDesc("Absolute path to the local Symphony repo. Used for workflow fallback and optional workspace seeding.")
			.addText((text) =>
				text
					.setPlaceholder("C:\\code\\Symphony-PM\\symphony")
					.setValue(this.host.settings.desktopProjectRoot)
					.onChange(async (value) => {
						this.host.settings.desktopProjectRoot = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Desktop workspace root")
			.setDesc("Absolute external root for per-issue workspaces. Leave blank to use the temp default.")
			.addText((text) =>
				text
					.setPlaceholder("C:\\work\\symphony")
					.setValue(this.host.settings.desktopWorkspaceRoot)
					.onChange(async (value) => {
						this.host.settings.desktopWorkspaceRoot = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Desktop log root")
			.setDesc("Absolute external root for run logs. Leave blank to use the temp default.")
			.addText((text) =>
				text
					.setPlaceholder("C:\\work\\symphony-logs")
					.setValue(this.host.settings.desktopLogRoot)
					.onChange(async (value) => {
						this.host.settings.desktopLogRoot = value.trim();
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto start runtime")
			.setDesc("Start polling and dispatch automatically after Obsidian finishes loading.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.autoStart)
					.onChange(async (value) => {
						this.host.settings.autoStart = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Open dashboard on start")
			.setDesc("Reveal the Symphony dashboard after the workspace layout is ready.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.dashboardOpenOnStart)
					.onChange(async (value) => {
						this.host.settings.dashboardOpenOnStart = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("HTTP port override")
			.setDesc("Reserved for the optional loopback HTTP surface. Leave blank to disable.")
			.addText((text) =>
				text
					.setPlaceholder("3000")
					.setValue(this.host.settings.httpPortOverride === null ? "" : String(this.host.settings.httpPortOverride))
					.onChange(async (value) => {
						const trimmed = value.trim();
						this.host.settings.httpPortOverride = trimmed ? Number.parseInt(trimmed, 10) || null : null;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Allow workspace inside vault")
			.setDesc("Keep disabled unless you intentionally want agent workspaces inside the vault.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.host.settings.allowWorkspaceInsideVault)
					.onChange(async (value) => {
						this.host.settings.allowWorkspaceInsideVault = value;
						await this.host.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Runtime")
			.setDesc(this.host.isRuntimeEnabled() ? "The runtime is currently active." : "The runtime is currently stopped.")
			.addButton((button) =>
				button.setButtonText("Open dashboard").onClick(async () => {
					await this.host.openDashboard();
				}),
			)
			.addButton((button) =>
				button.setButtonText("Refresh now").onClick(async () => {
					await this.host.refreshNow();
					new Notice("Symphony refresh requested.");
				}),
			)
			.addButton((button) =>
				button
					.setButtonText(this.host.isRuntimeEnabled() ? "Stop runtime" : "Start runtime")
					.onClick(async () => {
						if (this.host.isRuntimeEnabled()) {
							await this.host.stopRuntime();
						} else {
							await this.host.startRuntime();
						}
						this.display();
					}),
			);
	}
}

function looksLikeLegacySettings(raw: unknown): boolean {
	if (!isRecord(raw)) {
		return false;
	}

	return "workflowFilePath" in raw || "desktopProjectRoot" in raw || "desktopWorkspaceRoot" in raw || "autoStart" in raw;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coerceStringMap(value: Record<string, unknown>): Record<string, string> {
	const output: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") {
			output[key] = entry;
		}
	}
	return output;
}
