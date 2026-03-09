import { ItemView, WorkspaceLeaf } from "obsidian";
import type { SymphonySettings } from "../settings";

export const SYMPHONY_DASHBOARD_VIEW_TYPE = "symphony-dashboard";

export class SymphonyDashboardView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly getSettings: () => SymphonySettings,
	) {
		super(leaf);
	}

	getViewType(): string {
		return SYMPHONY_DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Symphony dashboard";
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	render(): void {
		const settings = this.getSettings();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("symphony-dashboard");

		const intro = contentEl.createDiv({ cls: "symphony-dashboard__section" });
		intro.createEl("h2", {
			text: "Symphony scaffold",
			cls: "symphony-dashboard__title",
		});
		intro.createEl("p", {
			text: "This dashboard is a scaffold only. Orchestration, retries, and issue execution are not implemented yet.",
			cls: "symphony-dashboard__meta",
		});

		const settingsSection = contentEl.createDiv({ cls: "symphony-dashboard__section" });
		settingsSection.createEl("h3", {
			text: "Current settings",
			cls: "symphony-dashboard__title",
		});

		const settingsList = settingsSection.createEl("ul", {
			cls: "symphony-dashboard__list",
		});
		const rows: Array<[string, string]> = [
			["Workflow file", settings.workflowFilePath],
			["Workspace root", settings.desktopWorkspaceRoot || "Not set"],
			["Log root", settings.desktopLogRoot || "Not set"],
			["Auto start", settings.autoStart ? "Enabled" : "Disabled"],
			["Open dashboard on start", settings.dashboardOpenOnStart ? "Enabled" : "Disabled"],
			["HTTP port override", settings.httpPortOverride === null ? "Not set" : String(settings.httpPortOverride)],
			["Allow workspace inside vault", settings.allowWorkspaceInsideVault ? "Enabled" : "Disabled"],
		];

		for (const [label, value] of rows) {
			settingsList.createEl("li", {
				text: `${label}: ${value}`,
			});
		}

		const roadmap = contentEl.createDiv({ cls: "symphony-dashboard__section" });
		roadmap.createEl("h3", {
			text: "Next implementation targets",
			cls: "symphony-dashboard__title",
		});
		const roadmapList = roadmap.createEl("ul", {
			cls: "symphony-dashboard__list",
		});
		for (const item of [
			"Workflow loader and validation",
			"Vault issue provider",
			"Runtime orchestrator and reconciliation",
			"Workspace manager and agent runner",
			"Safe vault mutation tools",
		]) {
			roadmapList.createEl("li", { text: item });
		}
	}
}
