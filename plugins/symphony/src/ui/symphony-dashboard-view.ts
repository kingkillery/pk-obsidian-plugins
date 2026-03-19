import { ItemView, WorkspaceLeaf } from "obsidian";
import type { IssueDebugSnapshot, RuntimeSnapshot } from "../types";

export const SYMPHONY_DASHBOARD_VIEW_TYPE = "symphony-dashboard";

export interface SymphonyDashboardHost {
	getSnapshot(): RuntimeSnapshot;
	startRuntime(): Promise<void>;
	stopRuntime(): Promise<void>;
	refreshNow(): Promise<void>;
	runIssueByPath(notePath: string): Promise<void>;
	stopIssueByPath(notePath: string): Promise<void>;
	openIssueNote(notePath: string): Promise<void>;
}

export class SymphonyDashboardView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly host: SymphonyDashboardHost,
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
		const snapshot = this.host.getSnapshot();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("symphony-dashboard");

		this.renderHeader(contentEl, snapshot);
		this.renderOverview(contentEl, snapshot);
		this.renderWorkflow(contentEl, snapshot);
		this.renderIssues(contentEl, snapshot);
		this.renderErrors(contentEl, snapshot);
	}

	private renderHeader(container: HTMLElement, snapshot: RuntimeSnapshot): void {
		const header = container.createDiv({ cls: "symphony-dashboard__header" });
		const copy = header.createDiv();
		copy.createEl("h2", { text: "Symphony", cls: "symphony-dashboard__title" });
		copy.createEl("p", {
			text: snapshot.runtimeEnabled
				? "Vault-driven issue orchestration is active."
				: "The runtime is idle. Issues are indexed, but dispatch is paused.",
			cls: "symphony-dashboard__meta",
		});

		const actions = header.createDiv({ cls: "symphony-dashboard__actions" });
		const toggleButton = actions.createEl("button", {
			text: snapshot.runtimeEnabled ? "Stop runtime" : "Start runtime",
			cls: snapshot.runtimeEnabled ? "mod-warning" : "mod-cta",
		});
		toggleButton.addEventListener("click", () => {
			void (snapshot.runtimeEnabled ? this.host.stopRuntime() : this.host.startRuntime());
		});

		const refreshButton = actions.createEl("button", { text: "Refresh now" });
		refreshButton.addEventListener("click", () => {
			void this.host.refreshNow();
		});
	}

	private renderOverview(container: HTMLElement, snapshot: RuntimeSnapshot): void {
		const section = container.createDiv({ cls: "symphony-dashboard__section" });
		section.createEl("h3", { text: "Overview", cls: "symphony-dashboard__section-title" });

		const grid = section.createDiv({ cls: "symphony-dashboard__stat-grid" });
		const entries: Array<[string, string]> = [
			["Indexed", String(snapshot.totals.indexed)],
			["Active", String(snapshot.totals.active)],
			["Handled", String(snapshot.totals.handled)],
			["Running", String(snapshot.totals.running)],
			["Retrying", String(snapshot.totals.retrying)],
			["Successes", String(snapshot.totals.successes)],
			["Failures", String(snapshot.totals.failures)],
			["Refreshes", String(snapshot.totals.refreshes)],
		];

		for (const [label, value] of entries) {
			const card = grid.createDiv({ cls: "symphony-dashboard__stat-card" });
			card.createSpan({ text: label, cls: "symphony-dashboard__stat-label" });
			card.createSpan({ text: value, cls: "symphony-dashboard__stat-value" });
		}

		const tokens = section.createDiv({ cls: "symphony-dashboard__detail-list" });
		this.appendDetail(tokens, "Input tokens", String(snapshot.codexTotals.input));
		this.appendDetail(tokens, "Output tokens", String(snapshot.codexTotals.output));
		this.appendDetail(tokens, "Total tokens", String(snapshot.codexTotals.total));
		this.appendDetail(tokens, "Last refresh", formatTimestamp(snapshot.lastRefreshAt));
	}

	private renderWorkflow(container: HTMLElement, snapshot: RuntimeSnapshot): void {
		const section = container.createDiv({ cls: "symphony-dashboard__section" });
		section.createEl("h3", { text: "Workflow", cls: "symphony-dashboard__section-title" });

		const details = section.createDiv({ cls: "symphony-dashboard__detail-list" });
		this.appendDetail(details, "Workflow file", snapshot.workflowPath);
		this.appendDetail(details, "Issues path", snapshot.issuesPath ?? "Unavailable");
		this.appendDetail(details, "Poll interval", snapshot.configSummary?.pollIntervalMs ? `${snapshot.configSummary.pollIntervalMs} ms` : "Unavailable");
		this.appendDetail(details, "Max concurrency", snapshot.configSummary?.maxConcurrentAgents ? String(snapshot.configSummary.maxConcurrentAgents) : "Unavailable");
		this.appendDetail(details, "Workspace root", snapshot.configSummary?.workspaceRoot ?? "Unavailable");
		this.appendDetail(details, "Log root", snapshot.configSummary?.logRoot ?? "Unavailable");
		this.appendDetail(details, "Agent command", snapshot.configSummary?.codexCommand ?? "Unavailable");

		if (snapshot.workflowError) {
			section.createEl("div", {
				text: snapshot.workflowError.message,
				cls: "symphony-dashboard__callout symphony-dashboard__callout--error",
			});
		} else if (snapshot.latestRateLimit) {
			section.createEl("div", {
				text: `Latest rate limit snapshot: ${snapshot.latestRateLimit.summary}`,
				cls: "symphony-dashboard__callout",
			});
		}
	}

	private renderIssues(container: HTMLElement, snapshot: RuntimeSnapshot): void {
		const section = container.createDiv({ cls: "symphony-dashboard__section" });
		section.createEl("h3", { text: "Issues", cls: "symphony-dashboard__section-title" });

		if (snapshot.issues.length === 0) {
			section.createEl("p", {
				text: "No Symphony issues were found under the configured issues path.",
				cls: "symphony-dashboard__meta",
			});
			return;
		}

		const list = section.createDiv({ cls: "symphony-dashboard__issue-list" });
		for (const issue of snapshot.issues) {
			this.renderIssueCard(list, issue);
		}
	}

	private renderIssueCard(container: HTMLElement, issue: IssueDebugSnapshot): void {
		const card = container.createDiv({ cls: "symphony-dashboard__issue-card" });
		const top = card.createDiv({ cls: "symphony-dashboard__issue-top" });
		const titles = top.createDiv();
		titles.createEl("h4", {
			text: `${issue.issue.identifier}: ${issue.issue.title}`,
			cls: "symphony-dashboard__issue-title",
		});
		titles.createEl("p", {
			text: issue.issue.notePath,
			cls: "symphony-dashboard__issue-path",
		});

		const badges = top.createDiv({ cls: "symphony-dashboard__badge-row" });
		badges.createSpan({
			text: issue.issue.state,
			cls: "symphony-dashboard__badge",
		});
		badges.createSpan({
			text: issue.runtimeStatus,
			cls: `symphony-dashboard__badge ${issue.running ? "symphony-dashboard__badge--accent" : ""}`.trim(),
		});

		if (issue.issue.description) {
			card.createEl("p", {
				text: issue.issue.description,
				cls: "symphony-dashboard__issue-description",
			});
		}

		const details = card.createDiv({ cls: "symphony-dashboard__detail-list" });
		this.appendDetail(details, "Priority", issue.issue.priority === null ? "None" : String(issue.issue.priority));
		this.appendDetail(details, "Labels", issue.issue.labels.length ? issue.issue.labels.join(", ") : "None");
		this.appendDetail(details, "Last success", formatTimestamp(issue.lastSuccessAt));
		this.appendDetail(details, "Last failure", formatTimestamp(issue.lastFailureAt));
		if (issue.retry) {
			this.appendDetail(details, "Retry due", formatTimestamp(issue.retry.dueAt));
		}
		if (issue.running) {
			this.appendDetail(details, "Workspace", issue.running.workspacePath);
			this.appendDetail(details, "Log", issue.running.logPath);
			this.appendDetail(details, "Last event", issue.running.lastEvent);
		}
		if (issue.lastError) {
			this.appendDetail(details, "Last error", issue.lastError);
		}

		const actions = card.createDiv({ cls: "symphony-dashboard__actions" });
		const openButton = actions.createEl("button", { text: "Open note" });
		openButton.addEventListener("click", () => {
			void this.host.openIssueNote(issue.issue.notePath);
		});

		const runButton = actions.createEl("button", {
			text: "Run now",
			cls: !issue.running ? "mod-cta" : "",
		});
		runButton.disabled = Boolean(issue.running);
		runButton.addEventListener("click", () => {
			void this.host.runIssueByPath(issue.issue.notePath);
		});

		const stopButton = actions.createEl("button", {
			text: issue.retry ? "Clear retry" : "Stop",
			cls: issue.running || issue.retry ? "mod-warning" : "",
		});
		stopButton.disabled = !issue.running && !issue.retry;
		stopButton.addEventListener("click", () => {
			void this.host.stopIssueByPath(issue.issue.notePath);
		});
	}

	private renderErrors(container: HTMLElement, snapshot: RuntimeSnapshot): void {
		if (snapshot.recentErrors.length === 0) {
			return;
		}

		const section = container.createDiv({ cls: "symphony-dashboard__section" });
		section.createEl("h3", { text: "Recent errors", cls: "symphony-dashboard__section-title" });
		const list = section.createDiv({ cls: "symphony-dashboard__error-list" });

		for (const error of snapshot.recentErrors) {
			const row = list.createDiv({ cls: "symphony-dashboard__error-row" });
			row.createSpan({
				text: formatTimestamp(error.timestamp),
				cls: "symphony-dashboard__error-time",
			});
			row.createSpan({
				text: error.message,
				cls: "symphony-dashboard__error-message",
			});
		}
	}

	private appendDetail(container: HTMLElement, label: string, value: string): void {
		const row = container.createDiv({ cls: "symphony-dashboard__detail-row" });
		row.createSpan({ text: label, cls: "symphony-dashboard__detail-label" });
		row.createSpan({ text: value, cls: "symphony-dashboard__detail-value" });
	}
}

function formatTimestamp(timestamp: number | null): string {
	if (!timestamp) {
		return "Never";
	}

	return new Date(timestamp).toLocaleString();
}
