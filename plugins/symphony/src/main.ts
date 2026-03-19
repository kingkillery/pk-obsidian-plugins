import {
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	WorkspaceLeaf,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	coerceStoredData,
	normalizeSettings,
	SymphonySettingTab,
	type SymphonySettings,
	type SymphonyStoredData,
} from "./settings";
import { SymphonyOrchestrator } from "./orchestrator";
import type { PersistedRuntimeState, RuntimeSnapshot } from "./types";
import {
	SYMPHONY_DASHBOARD_VIEW_TYPE,
	SymphonyDashboardView,
} from "./ui/symphony-dashboard-view";

export default class SymphonyPlugin extends Plugin {
	settings: SymphonySettings = DEFAULT_SETTINGS;
	private persistedState!: PersistedRuntimeState;
	private orchestrator!: SymphonyOrchestrator;
	private statusBarEl!: HTMLElement;
	private uiRefreshHandle: number | null = null;

	async onload(): Promise<void> {
		await this.loadPluginData();

		this.orchestrator = new SymphonyOrchestrator({
			app: this.app,
			getSettings: () => this.settings,
			persistedState: this.persistedState,
			onRequestUiRefresh: () => this.requestUiRefresh(),
			onNotice: (message, timeout) => new Notice(message, timeout),
			onPersistRequested: () => this.savePluginData(),
		});

		this.registerView(
			SYMPHONY_DASHBOARD_VIEW_TYPE,
			(leaf) => new SymphonyDashboardView(leaf, this),
		);

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("symphony-status");
		this.statusBarEl.onClickEvent(() => {
			void this.openDashboard();
		});

		this.addRibbonIcon("kanban-square", "Open dashboard", () => {
			void this.openDashboard();
		});

		this.addSettingTab(new SymphonySettingTab(this.app, this));
		this.registerCommands();

		this.app.workspace.onLayoutReady(() => {
			void this.handleLayoutReady();
		});
	}

	async onunload(): Promise<void> {
		if (this.uiRefreshHandle !== null) {
			window.clearTimeout(this.uiRefreshHandle);
			this.uiRefreshHandle = null;
		}

		if (this.orchestrator) {
			await this.orchestrator.destroy();
		}

		this.app.workspace.detachLeavesOfType(SYMPHONY_DASHBOARD_VIEW_TYPE);
	}

	async saveSettings(): Promise<void> {
		this.settings = normalizeSettings(this.settings);
		await this.savePluginData();
		if (this.orchestrator) {
			await this.orchestrator.handleSettingsChanged();
		}
	}

	isRuntimeEnabled(): boolean {
		return this.orchestrator?.isRuntimeEnabled() ?? false;
	}

	getSnapshot(): RuntimeSnapshot {
		return this.orchestrator.getSnapshot();
	}

	async startRuntime(): Promise<void> {
		await this.orchestrator.startRuntime();
	}

	async stopRuntime(): Promise<void> {
		await this.orchestrator.stopRuntime();
	}

	async refreshNow(): Promise<void> {
		await this.orchestrator.refreshNow("manual-refresh");
	}

	async runIssueByPath(notePath: string): Promise<void> {
		await this.orchestrator.runIssueByPath(notePath);
	}

	async stopIssueByPath(notePath: string): Promise<void> {
		await this.orchestrator.stopIssueByPath(notePath);
	}

	async openIssueNote(notePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(notePath);
		if (!(file instanceof TFile)) {
			new Notice(`Unable to open ${notePath}.`, 5000);
			return;
		}

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	async openDashboard(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(SYMPHONY_DASHBOARD_VIEW_TYPE)[0] ?? null;

		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) {
				new Notice("Unable to open the Symphony dashboard.", 5000);
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

	private async handleLayoutReady(): Promise<void> {
		this.registerVaultEvents();
		await this.orchestrator.initialize();

		if (this.settings.dashboardOpenOnStart) {
			await this.openDashboard();
		}

		if (this.settings.autoStart) {
			await this.orchestrator.startRuntime();
		} else {
			this.requestUiRefresh();
		}
	}

	private async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as SymphonyStoredData | unknown;
		const stored = coerceStoredData(raw);
		this.settings = stored.settings;
		this.persistedState = stored.state;
	}

	private async savePluginData(): Promise<void> {
		await this.saveData({
			settings: this.settings,
			state: this.persistedState,
		});
	}

	private registerCommands(): void {
		this.addCommand({
			id: "open-dashboard",
			name: "Open dashboard",
			callback: () => {
				void this.openDashboard();
			},
		});

		this.addCommand({
			id: "refresh-now",
			name: "Refresh now",
			callback: () => {
				void this.refreshNow();
			},
		});

		this.addCommand({
			id: "run-current-issue",
			name: "Run current issue",
			editorCheckCallback: (checking, _editor, view) => {
				const file = view.file;
				if (!file) {
					return false;
				}

				if (!checking) {
					void this.runIssueByPath(file.path);
				}

				return true;
			},
		});

		this.addCommand({
			id: "stop-current-issue",
			name: "Stop current issue",
			editorCheckCallback: (checking, _editor, view) => {
				const file = view.file;
				if (!file) {
					return false;
				}

				if (!checking) {
					void this.stopIssueByPath(file.path);
				}

				return true;
			},
		});
	}

	private registerVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				this.orchestrator.handleVaultEvent(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				this.orchestrator.handleVaultEvent(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.orchestrator.handleVaultEvent(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.orchestrator.handleVaultEvent(oldPath);
				this.orchestrator.handleVaultEvent(file.path);
			}),
		);
		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				this.requestUiRefresh();
			}),
		);
	}

	private requestUiRefresh(): void {
		if (this.uiRefreshHandle !== null) {
			return;
		}

		this.uiRefreshHandle = window.setTimeout(() => {
			this.uiRefreshHandle = null;
			this.refreshUi();
		}, 100);
	}

	private refreshUi(): void {
		const snapshot = this.orchestrator.getSnapshot();
		this.refreshStatusBar(snapshot);

		for (const leaf of this.app.workspace.getLeavesOfType(SYMPHONY_DASHBOARD_VIEW_TYPE)) {
			if (leaf.view instanceof SymphonyDashboardView) {
				leaf.view.render();
			}
		}
	}

	private refreshStatusBar(snapshot: RuntimeSnapshot): void {
		const parts: string[] = [];
		parts.push(snapshot.runtimeEnabled ? "Symphony: running" : "Symphony: paused");
		parts.push(`${snapshot.totals.running} active`);
		if (snapshot.totals.retrying > 0) {
			parts.push(`${snapshot.totals.retrying} retrying`);
		}
		if (snapshot.workflowError) {
			parts.push("workflow error");
		}

		this.statusBarEl.setText(parts.join(" • "));
		this.statusBarEl.setAttr("aria-label", parts.join(" • "));
	}
}
