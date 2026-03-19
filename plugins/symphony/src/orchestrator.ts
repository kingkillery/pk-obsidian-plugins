import { spawn } from "child_process";
import { createWriteStream, promises as fs } from "fs";
import * as path from "path";
import { FileSystemAdapter, TFile, normalizePath } from "obsidian";
import type { SymphonySettings } from "./settings";
import type {
	EffectiveConfig,
	IssueDebugSnapshot,
	OperatorError,
	PersistedRuntimeState,
	RateLimitSnapshot,
	RetryEntry,
	RunSnapshot,
	RuntimeSnapshot,
	SymphonyIssue,
	TokenTotals,
	WorkflowDefinition,
} from "./types";
import { loadIssueByPath, scanVaultIssues } from "./issues";
import {
	buildEffectiveConfig,
	loadFilesystemWorkflowDefinition,
	loadWorkflowDefinition,
	renderPrompt,
} from "./workflow";
import {
	describeDueIn,
	emptyTokenTotals,
	inferEventName,
	inferEventText,
	inferRateLimitSnapshot,
	inferStringId,
	inferTokenTotals,
	isPathInside,
	mergeTokenTotals,
	normalizeFsPath,
	normalizeState,
	sanitizeWorkspaceKey,
	splitCommandLine,
	truncateText,
} from "./utils";

interface RunningSessionInternal extends RunSnapshot {
	process: ReturnType<typeof spawn>;
	logStream: ReturnType<typeof createWriteStream>;
	stdoutBuffer: string;
	stderrBuffer: string;
	finalized: boolean;
}

interface OrchestratorOptions {
	app: {
		vault: {
			getName(): string;
			getAbstractFileByPath(path: string): unknown;
			getMarkdownFiles(): TFile[];
			cachedRead(file: TFile): Promise<string>;
			configDir: string;
			adapter: unknown;
		};
		fileManager: {
			processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
		};
		workspace: {
			layoutReady: boolean;
		};
	};
	getSettings: () => SymphonySettings;
	persistedState: PersistedRuntimeState;
	onRequestUiRefresh: () => void;
	onNotice: (message: string, timeout?: number) => void;
	onPersistRequested: () => Promise<void>;
}

type StructuredLogValue = string | number | boolean | null;

export class SymphonyOrchestrator {
	private readonly app: OrchestratorOptions["app"];
	private readonly getSettings: OrchestratorOptions["getSettings"];
	private readonly persistedState: PersistedRuntimeState;
	private readonly onRequestUiRefresh: OrchestratorOptions["onRequestUiRefresh"];
	private readonly onNotice: OrchestratorOptions["onNotice"];
	private readonly onPersistRequested: OrchestratorOptions["onPersistRequested"];

	private workflow: WorkflowDefinition | null = null;
	private workflowError: OperatorError | null = null;
	private effectiveConfig: EffectiveConfig | null = null;
	private runtimeEnabled = false;
	private refreshInFlight = false;
	private pendingRefreshReason: string | null = null;
	private pollHandle: number | null = null;
	private refreshHandle: number | null = null;
	private lastRefreshAt: number | null = null;
	private lastRefreshReason: string | null = null;
	private issues: SymphonyIssue[] = [];
	private issueById = new Map<string, SymphonyIssue>();
	private retries = new Map<string, RetryEntry>();
	private running = new Map<string, RunningSessionInternal>();
	private lastAttempts = new Map<string, number>();
	private lastSuccessAt = new Map<string, number>();
	private lastFailureAt = new Map<string, number>();
	private lastErrorByIssue = new Map<string, string>();
	private successCount = 0;
	private failureCount = 0;
	private refreshCount = 0;
	private codexTotals: TokenTotals = emptyTokenTotals();
	private latestRateLimit: RateLimitSnapshot | null = null;
	private recentErrors: OperatorError[];
	private startupCleanupComplete = false;
	private destroyed = false;

	constructor(options: OrchestratorOptions) {
		this.app = options.app;
		this.getSettings = options.getSettings;
		this.persistedState = options.persistedState;
		this.onRequestUiRefresh = options.onRequestUiRefresh;
		this.onNotice = options.onNotice;
		this.onPersistRequested = options.onPersistRequested;
		this.recentErrors = [...this.persistedState.recentErrors];
	}

	async initialize(): Promise<void> {
		await this.refreshNow("initialize");
	}

	async destroy(): Promise<void> {
		this.destroyed = true;
		this.stopPoller();
		if (this.refreshHandle !== null) {
			window.clearTimeout(this.refreshHandle);
			this.refreshHandle = null;
		}

		const runningSessions = Array.from(this.running.values());
		await Promise.all(runningSessions.map((session) => this.stopSession(session, "Plugin unloaded", false)));
		await this.persistState();
	}

	isRuntimeEnabled(): boolean {
		return this.runtimeEnabled;
	}

	getSnapshot(): RuntimeSnapshot {
		const issues = this.issues.map((issue) => this.buildIssueDebugSnapshot(issue));
		const activeCount = this.issues.filter((issue) => this.isActiveIssue(issue)).length;
		const terminalCount = this.issues.filter((issue) => this.isTerminalIssue(issue)).length;
		const handledCount = this.issues.filter((issue) => this.isIssueHandled(issue)).length;
		const config = this.effectiveConfig;

		return {
			runtimeEnabled: this.runtimeEnabled,
			workflowPath: normalizePath(this.getSettings().workflowFilePath),
			workflowLoaded: this.workflow !== null,
			workflowDigest: this.workflow?.digest ?? this.persistedState.lastKnownGoodWorkflowDigest,
			workflowError: this.workflowError,
			issuesPath: config?.issuesPath ?? null,
			lastRefreshAt: this.lastRefreshAt,
			lastRefreshReason: this.lastRefreshReason,
			configSummary: config
				? {
						pollIntervalMs: config.pollIntervalMs,
						maxConcurrentAgents: config.maxConcurrentAgents,
						projectRoot: config.projectRoot,
						workspaceRoot: config.workspaceRoot,
						logRoot: config.logRoot,
						codexCommand: config.codexCommand,
				  }
				: null,
			totals: {
				indexed: this.issues.length,
				active: activeCount,
				terminal: terminalCount,
				running: this.running.size,
				retrying: this.retries.size,
				handled: handledCount,
				successes: this.successCount,
				failures: this.failureCount,
				refreshes: this.refreshCount,
			},
			codexTotals: this.codexTotals,
			latestRateLimit: this.latestRateLimit,
			recentErrors: [...this.recentErrors],
			issues,
		};
	}

	async startRuntime(): Promise<void> {
		if (this.runtimeEnabled) {
			return;
		}

		this.runtimeEnabled = true;
		this.restartPoller();
		this.onNotice("Symphony runtime started.", 3000);
		await this.refreshNow("runtime-started");
	}

	async stopRuntime(): Promise<void> {
		if (!this.runtimeEnabled && this.running.size === 0) {
			return;
		}

		this.runtimeEnabled = false;
		this.stopPoller();

		const sessions = Array.from(this.running.values());
		await Promise.all(sessions.map((session) => this.stopSession(session, "Stopped by operator", false)));
		this.onNotice("Symphony runtime stopped.", 3000);
		this.requestUiRefresh();
	}

	async handleSettingsChanged(): Promise<void> {
		this.restartPoller();
		await this.refreshNow("settings-changed");
	}

	handleVaultEvent(filePath: string): void {
		if (!this.shouldRefreshForPath(filePath)) {
			return;
		}
		void this.scheduleRefresh("vault-event");
	}

	async refreshNow(reason: string): Promise<void> {
		await this.performRefresh(reason);
	}

	async runIssueByPath(notePath: string): Promise<void> {
		const config = await this.ensureReadyForDispatch("manual-run");
		if (!config) {
			return;
		}

		const issue = await loadIssueByPath(this.app, notePath);
		if (!issue) {
			this.onNotice("The active note is not a valid Symphony issue.", 5000);
			return;
		}

		if (!issue.notePath.startsWith(`${config.issuesPath}/`)) {
			this.onNotice("The active note is outside the configured Symphony issues folder.", 5000);
			return;
		}

		if (this.running.has(issue.id)) {
			this.onNotice(`Issue ${issue.identifier} is already running.`, 4000);
			return;
		}

		this.retries.delete(issue.id);
		await this.launchIssue(issue, (this.lastAttempts.get(issue.id) ?? 0) + 1, "manual");
	}

	async stopIssueByPath(notePath: string): Promise<void> {
		const issue = await loadIssueByPath(this.app, notePath);
		if (!issue) {
			this.onNotice("The active note is not a valid Symphony issue.", 5000);
			return;
		}

		const running = this.running.get(issue.id);
		if (running) {
			await this.stopSession(running, "Stopped by operator", false);
			this.onNotice(`Stopped ${issue.identifier}.`, 3000);
			return;
		}

		if (this.retries.delete(issue.id)) {
			this.requestUiRefresh();
			this.onNotice(`Cleared retry for ${issue.identifier}.`, 3000);
			return;
		}

		this.onNotice(`Issue ${issue.identifier} is not running.`, 3000);
	}

	private async scheduleRefresh(reason: string): Promise<void> {
		if (this.destroyed) {
			return;
		}

		this.pendingRefreshReason = reason;
		if (this.refreshHandle !== null) {
			return;
		}

		this.refreshHandle = window.setTimeout(() => {
			const nextReason = this.pendingRefreshReason ?? "scheduled";
			this.pendingRefreshReason = null;
			this.refreshHandle = null;
			void this.performRefresh(nextReason);
		}, 150);
	}

	private async performRefresh(reason: string): Promise<void> {
		if (this.destroyed) {
			return;
		}

		if (this.refreshInFlight) {
			this.pendingRefreshReason = reason;
			return;
		}

		this.refreshInFlight = true;
		try {
			await this.reloadWorkflow();

			const config = this.getConfigForIndexing();
			const issueScan = await scanVaultIssues(this.app, config.issuesPath);
			this.issues = issueScan.issues.sort(compareIssues);
			this.issueById = new Map(this.issues.map((issue) => [issue.id, issue]));
			issueScan.errors.forEach((error) => this.recordError(error, false));

			if (!this.startupCleanupComplete) {
				await this.cleanupTerminalIssueWorkspaces();
				this.startupCleanupComplete = true;
			}

			if (this.effectiveConfig) {
				await this.reconcileRunningSessions(this.effectiveConfig);
			}

			if (this.runtimeEnabled) {
				const dispatchConfig = await this.ensureReadyForDispatch(reason, false);
				if (dispatchConfig) {
					await this.dispatchDueRetries(dispatchConfig);
					await this.dispatchEligibleIssues(dispatchConfig);
				}
			}

			this.lastRefreshAt = Date.now();
			this.lastRefreshReason = reason;
			this.refreshCount += 1;
			this.requestUiRefresh();
		} finally {
			this.refreshInFlight = false;
			if (this.pendingRefreshReason) {
				const next = this.pendingRefreshReason;
				this.pendingRefreshReason = null;
				await this.performRefresh(next);
			}
		}
	}

	private async reloadWorkflow(): Promise<void> {
		const workflowPath = normalizePath(this.getSettings().workflowFilePath);
		try {
			const workflow = await loadWorkflowDefinition(this.app, workflowPath);
			this.workflow = workflow;
			this.workflowError = null;
			this.effectiveConfig = buildEffectiveConfig(this.app, this.getSettings(), workflow);
			this.persistedState.lastKnownGoodWorkflowDigest = workflow.digest;
			this.restartPoller();
		} catch (error) {
			const fallbackWorkflowPath = this.resolveProjectWorkflowPath();
			if (fallbackWorkflowPath) {
				try {
					const workflow = await loadFilesystemWorkflowDefinition(fallbackWorkflowPath);
					this.workflow = workflow;
					this.workflowError = null;
					this.effectiveConfig = buildEffectiveConfig(this.app, this.getSettings(), workflow);
					this.persistedState.lastKnownGoodWorkflowDigest = workflow.digest;
					this.restartPoller();
					return;
				} catch {
					// fall through to the original workflow error
				}
			}

			const operatorError = {
				timestamp: Date.now(),
				code: "workflow_load_error",
				message:
					error instanceof Error
						? fallbackWorkflowPath
							? `${error.message} Fallback project workflow was also unavailable at ${fallbackWorkflowPath}.`
							: error.message
						: `Unable to load ${workflowPath}.`,
			} satisfies OperatorError;

			this.workflowError = operatorError;
			this.recordError(operatorError, this.workflow === null);

			if (this.workflow !== null) {
				this.effectiveConfig = buildEffectiveConfig(this.app, this.getSettings(), this.workflow);
			} else {
				const fallbackWorkflow: WorkflowDefinition = {
					path: workflowPath,
					raw: "",
					promptTemplate: "",
					config: {},
					digest: "",
					loadedAt: Date.now(),
				};
				this.effectiveConfig = buildEffectiveConfig(this.app, this.getSettings(), fallbackWorkflow);
			}
		}
	}

	private getConfigForIndexing(): EffectiveConfig {
		if (this.effectiveConfig) {
			return this.effectiveConfig;
		}

		const fallbackWorkflow: WorkflowDefinition = {
			path: normalizePath(this.getSettings().workflowFilePath),
			raw: "",
			promptTemplate: "",
			config: {},
			digest: "",
			loadedAt: Date.now(),
		};
		return buildEffectiveConfig(this.app, this.getSettings(), fallbackWorkflow);
	}

	private resolveProjectWorkflowPath(): string | null {
		const projectRoot = this.getSettings().desktopProjectRoot.trim();
		if (!projectRoot) {
			return null;
		}

		return path.join(projectRoot, "elixir", "WORKFLOW.md");
	}

	private async ensureReadyForDispatch(reason: string, notify = true): Promise<EffectiveConfig | null> {
		if (!this.effectiveConfig) {
			await this.reloadWorkflow();
		}

		const config = this.effectiveConfig;
		if (!config) {
			return null;
		}

		const errors = this.validatePreflight(config);
		if (this.workflowError) {
			errors.unshift(this.workflowError);
		}

		if (errors.length > 0) {
			errors.forEach((error) => this.recordError(error, notify));
			if (notify) {
				this.onNotice(`Symphony dispatch blocked: ${errors[0].message}`, 7000);
			}
			this.lastRefreshReason = `${reason}:blocked`;
			this.requestUiRefresh();
			return null;
		}

		return config;
	}

	private validatePreflight(config: EffectiveConfig): OperatorError[] {
		const errors: OperatorError[] = [];
		const commandTokens = splitCommandLine(config.codexCommand);

		if (!commandTokens.length || !commandTokens[0].toLowerCase().includes("codex")) {
			errors.push({
				timestamp: Date.now(),
				code: "invalid_codex_command",
				message: "The workflow codex.command must launch the Codex CLI.",
			});
		}

		if (!config.issuesPath.trim()) {
			errors.push({
				timestamp: Date.now(),
				code: "invalid_issue_path",
				message: "The configured Symphony issues path is empty.",
			});
		}

		if (!path.isAbsolute(config.workspaceRoot)) {
			errors.push({
				timestamp: Date.now(),
				code: "invalid_workspace_root",
				message: "The workspace root must be an absolute desktop path.",
			});
		}

		if (!path.isAbsolute(config.logRoot)) {
			errors.push({
				timestamp: Date.now(),
				code: "invalid_log_root",
				message: "The log root must be an absolute desktop path.",
			});
		}

		if (config.projectRoot && !path.isAbsolute(config.projectRoot)) {
			errors.push({
				timestamp: Date.now(),
				code: "invalid_project_root",
				message: "The Symphony project root must be an absolute path.",
			});
		}

		const vaultRoot = this.getVaultBasePath();
		if (vaultRoot) {
			if (!config.allowWorkspaceInsideVault && isPathInside(vaultRoot, config.workspaceRoot)) {
				errors.push({
					timestamp: Date.now(),
					code: "workspace_inside_vault",
					message: "The workspace root must stay outside the vault unless explicitly allowed.",
				});
			}

			if (isPathInside(vaultRoot, config.logRoot)) {
				errors.push({
					timestamp: Date.now(),
					code: "log_root_inside_vault",
					message: "The log root must stay outside the vault.",
				});
			}
		}

		return errors;
	}

	private async dispatchDueRetries(config: EffectiveConfig): Promise<void> {
		const now = Date.now();
		const dueRetries = Array.from(this.retries.values())
			.filter((entry) => entry.dueAt <= now)
			.sort((left, right) => left.dueAt - right.dueAt);

		for (const entry of dueRetries) {
			if (!this.hasGlobalSlot(config)) {
				return;
			}

			const issue = this.issueById.get(entry.issueId);
			if (!issue) {
				this.retries.delete(entry.issueId);
				continue;
			}

			if (!this.isIssueEligible(issue, config, true)) {
				if (!this.isActiveIssue(issue)) {
					this.retries.delete(entry.issueId);
				}
				continue;
			}

			if (!this.hasStateSlot(config, issue.normalizedState)) {
				continue;
			}

			this.retries.delete(entry.issueId);
			await this.launchIssue(issue, entry.attempt, "retry");
		}
	}

	private async dispatchEligibleIssues(config: EffectiveConfig): Promise<void> {
		const candidates = this.issues.filter((issue) => this.isIssueEligible(issue, config, false));
		for (const issue of candidates) {
			if (!this.hasGlobalSlot(config)) {
				return;
			}

			if (!this.hasStateSlot(config, issue.normalizedState)) {
				continue;
			}

			await this.launchIssue(issue, (this.lastAttempts.get(issue.id) ?? 0) + 1, "scheduled");
		}
	}

	private async launchIssue(
		issue: SymphonyIssue,
		attempt: number,
		source: "manual" | "scheduled" | "retry",
	): Promise<void> {
		const config = this.effectiveConfig;
		const workflow = this.workflow;
		if (!config || !workflow) {
			return;
		}

		try {
			const workspaceKey = this.resolveWorkspaceKey(issue);
			const workspacePath = path.join(config.workspaceRoot, workspaceKey);
			const workspaceInfo = await this.ensureWorkspace(issue, workspacePath, config);
			const prompt = renderPrompt(
				workflow,
				{
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					description: issue.description,
					state: issue.state,
					labels: issue.labels,
					priority: issue.priority,
					note_path: issue.notePath,
					branch_name: issue.branchName,
					url: issue.url,
				},
				attempt,
				workspacePath,
			);

			await this.syncWorkspaceContext(workspacePath, issue, prompt);
			await this.runHook(config.hooks.beforeRun, workspacePath, config.hooks.timeoutMs, true);

			await fs.mkdir(config.logRoot, { recursive: true });
			const runKey = `${workspaceKey}-${new Date().toISOString().replace(/[:.]/g, "-")}-attempt-${attempt}`;
			const logPath = path.join(config.logRoot, `${runKey}.log`);
			const outputFile = path.join(workspacePath, ".symphony", `last-message-attempt-${attempt}.md`);
			const logStream = createWriteStream(logPath, { flags: "a" });

			const { command, args } = this.buildCodexCommand(config, workspacePath, outputFile, prompt);
			const child = spawn(command, args, {
				cwd: workspacePath,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});

			const session: RunningSessionInternal = {
				issueId: issue.id,
				issueIdentifier: issue.identifier,
				notePath: issue.notePath,
				state: issue.state,
				attempt,
				startedAt: Date.now(),
				status: source === "manual" ? "Running (manual)" : "Running",
				workspacePath,
				logPath,
				outputFile,
				pid: child.pid ?? null,
				sessionId: null,
				threadId: null,
				turnId: null,
				lastEvent: workspaceInfo.createdNow ? "workspace-created" : "workspace-reused",
				lastMessage: prompt ? "Prompt rendered." : "Using fallback prompt.",
				lastUpdatedAt: Date.now(),
				inputVersionToken: issue.versionToken,
				stopReason: null,
				process: child,
				logStream,
				stdoutBuffer: "",
				stderrBuffer: "",
				finalized: false,
			};

			this.running.set(issue.id, session);
			this.lastAttempts.set(issue.id, attempt);
			this.persistedState.handledIssueVersions[issue.id] = "";
			this.writeSessionLog(session, "info", "session_spawned", "Spawned Codex process.", {
				workspace_path: session.workspacePath,
				output_file: session.outputFile,
				pid: session.pid,
			});
			this.requestUiRefresh();

			child.stdout.on("data", (chunk: Buffer) => {
				this.handleProcessOutput(session, chunk.toString("utf8"), "stdout");
			});

			child.stderr.on("data", (chunk: Buffer) => {
				this.handleProcessOutput(session, chunk.toString("utf8"), "stderr");
			});

			child.once("error", async (error) => {
				await this.finalizeSession(session, issue, false, error.message, true);
			});

			child.once("close", async (code, signal) => {
				const succeeded = code === 0 && !session.stopReason;
				const closeMessage = succeeded
					? "Run completed."
					: session.stopReason ?? `Process exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
				await this.finalizeSession(session, issue, succeeded, closeMessage, !succeeded);
			});
		} catch (error) {
			const message =
				error instanceof Error
					? `Failed to launch ${issue.identifier}: ${error.message}`
					: `Failed to launch ${issue.identifier}.`;
			this.failureCount += 1;
			this.lastFailureAt.set(issue.id, Date.now());
			this.lastErrorByIssue.set(issue.id, message);
			this.recordError(
				{
					timestamp: Date.now(),
					code: "launch_failed",
					message,
					issueId: issue.id,
					issueIdentifier: issue.identifier,
					notePath: issue.notePath,
				},
				true,
			);
			this.queueRetry(issue, attempt + 1, message, "failure");
		}
	}

	private handleProcessOutput(
		session: RunningSessionInternal,
		chunk: string,
		stream: "stdout" | "stderr",
	): void {
		session.lastUpdatedAt = Date.now();

		const bufferName = stream === "stdout" ? "stdoutBuffer" : "stderrBuffer";
		session[bufferName] += chunk;
		const lines = session[bufferName].split(/\r?\n/);
		session[bufferName] = lines.pop() ?? "";

		for (const line of lines) {
			this.processOutputLine(session, line, stream);
		}

		this.requestUiRefresh();
	}

	private flushProcessBuffers(session: RunningSessionInternal): void {
		this.flushProcessBuffer(session, "stdout");
		this.flushProcessBuffer(session, "stderr");
	}

	private flushProcessBuffer(session: RunningSessionInternal, stream: "stdout" | "stderr"): void {
		const bufferName = stream === "stdout" ? "stdoutBuffer" : "stderrBuffer";
		const remainder = session[bufferName].trim();
		session[bufferName] = "";

		if (!remainder) {
			return;
		}

		this.processOutputLine(session, remainder, stream);
	}

	private processOutputLine(
		session: RunningSessionInternal,
		line: string,
		stream: "stdout" | "stderr",
	): void {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}

		const previousSessionId = this.resolveSessionIdentifier(session);
		if (stream === "stderr") {
			session.lastEvent = "stderr";
			session.lastMessage = truncateText(trimmed);
			this.writeSessionLog(session, "warn", "process_output", session.lastMessage, {
				stream,
				raw: truncateText(trimmed, 1000),
			});
			return;
		}

		try {
			const payload = JSON.parse(trimmed) as unknown;
			const directSessionId = inferStringId(payload, ["session_id", "conversation_id"]);
			session.threadId = inferStringId(payload, ["thread_id"]) ?? session.threadId;
			session.turnId = inferStringId(payload, ["turn_id"]) ?? session.turnId;
			session.sessionId =
				directSessionId ?? this.resolveSessionIdentifierFromParts(session.threadId, session.turnId);
			session.lastEvent = inferEventName(payload);
			session.lastMessage = inferEventText(payload);
			this.codexTotals = mergeTokenTotals(this.codexTotals, inferTokenTotals(payload));
			this.latestRateLimit = inferRateLimitSnapshot(payload) ?? this.latestRateLimit;

			const currentSessionId = this.resolveSessionIdentifier(session);
			if (currentSessionId !== "pending" && currentSessionId !== previousSessionId) {
				this.writeSessionLog(
					session,
					"info",
					"session_identified",
					"Observed Codex session identifier.",
					{
						thread_id: session.threadId,
						turn_id: session.turnId,
					},
				);
			}

			this.writeSessionLog(session, "info", "codex_event", session.lastMessage, {
				stream,
				codex_event: session.lastEvent,
				thread_id: session.threadId,
				turn_id: session.turnId,
				raw: truncateText(trimmed, 1000),
			});
		} catch {
			session.lastEvent = "stdout";
			session.lastMessage = truncateText(trimmed);
			this.writeSessionLog(session, "info", "process_output", session.lastMessage, {
				stream,
				raw: truncateText(trimmed, 1000),
			});
		}
	}

	private async finalizeSession(
		session: RunningSessionInternal,
		issue: SymphonyIssue,
		succeeded: boolean,
		message: string,
		shouldRetry: boolean,
	): Promise<void> {
		if (session.finalized) {
			return;
		}
		session.finalized = true;
		this.running.delete(issue.id);
		this.flushProcessBuffers(session);

		let finalMessage = message;
		try {
			const outputText = await fs.readFile(session.outputFile, "utf8");
			if (outputText.trim()) {
				finalMessage = truncateText(outputText.trim(), 1200);
			}
		} catch {
			// ignore missing output files
		}

		let queuedRetry: RetryEntry | null = null;
		if (succeeded) {
			this.successCount += 1;
			this.lastSuccessAt.set(issue.id, Date.now());
			this.lastErrorByIssue.delete(issue.id);
			const config = this.effectiveConfig;
			const latestIssue = this.issueById.get(issue.id);
			const shouldContinue =
				config !== null &&
				latestIssue !== undefined &&
				this.isActiveIssue(latestIssue) &&
				session.attempt < config.maxTurns;
			if (shouldContinue) {
				queuedRetry = this.queueRetry(
					latestIssue,
					session.attempt + 1,
					"Issue remained active after a successful run.",
					"continuation",
				);
			}

			if (!queuedRetry && latestIssue && latestIssue.versionToken === session.inputVersionToken) {
				this.persistedState.handledIssueVersions[issue.id] = latestIssue.versionToken;
			}
		} else {
			this.failureCount += 1;
			this.lastFailureAt.set(issue.id, Date.now());
			this.lastErrorByIssue.set(issue.id, finalMessage);
			if (shouldRetry && !session.stopReason) {
				queuedRetry = this.queueRetry(issue, session.attempt + 1, finalMessage, "failure");
			}
		}

		if (this.effectiveConfig) {
			await this.runHook(
				this.effectiveConfig.hooks.afterRun,
				session.workspacePath,
				this.effectiveConfig.hooks.timeoutMs,
				false,
			);
		}

		session.lastEvent = succeeded ? "completed" : "failed";
		session.lastMessage = finalMessage;
		this.writeSessionLog(
			session,
			succeeded ? "info" : "error",
			succeeded ? "session_completed" : "session_failed",
			finalMessage,
			{
				status: succeeded ? "completed" : "failed",
				retry_queued: Boolean(queuedRetry),
				stop_reason: session.stopReason,
			},
		);
		if (queuedRetry) {
			this.writeSessionLog(
				session,
				queuedRetry.reason === "continuation" ? "info" : "warn",
				"retry_queued",
				`${queuedRetry.reason === "continuation" ? "Queued continuation" : "Queued retry"} ${describeDueIn(queuedRetry.dueAt)}.`,
				{
					next_attempt: queuedRetry.attempt,
					due_at: new Date(queuedRetry.dueAt).toISOString(),
					retry_reason: queuedRetry.reason,
				},
			);
		}

		try {
			session.logStream.end();
		} catch {
			// ignore log stream shutdown failures
		}

		await this.persistState();
		this.requestUiRefresh();
		void this.scheduleRefresh("session-finalized");
	}

	private queueRetry(
		issue: SymphonyIssue,
		attempt: number,
		error: string,
		reason: "failure" | "continuation",
	): RetryEntry | null {
		if (!this.effectiveConfig) {
			return null;
		}

		if (attempt > this.effectiveConfig.maxTurns) {
			this.recordError(
				{
					timestamp: Date.now(),
					code: "max_turns_reached",
					message: `${issue.identifier} reached the configured max_turns (${this.effectiveConfig.maxTurns}).`,
					issueId: issue.id,
					issueIdentifier: issue.identifier,
					notePath: issue.notePath,
				},
				false,
			);
			return null;
		}

		const dueAt =
			Date.now() +
			(reason === "continuation"
				? 1_000
				: Math.min(10_000 * 2 ** Math.max(0, attempt - 2), this.effectiveConfig.maxRetryBackoffMs));

		const entry: RetryEntry = {
			issueId: issue.id,
			identifier: issue.identifier,
			attempt,
			dueAt,
			error,
			reason,
		};
		this.retries.set(issue.id, entry);

		this.recordError(
			{
				timestamp: Date.now(),
				code: "retry_queued",
				message: `${issue.identifier} queued for retry ${describeDueIn(dueAt)}.`,
				issueId: issue.id,
				issueIdentifier: issue.identifier,
				notePath: issue.notePath,
			},
			false,
		);
		return entry;
	}

	private async stopSession(
		session: RunningSessionInternal,
		reason: string,
		retryAfterStop: boolean,
	): Promise<void> {
		session.stopReason = reason;
		this.writeSessionLog(session, "warn", "session_stopping", reason, {
			retry_after_stop: retryAfterStop,
		});
		if (!session.process.killed) {
			session.process.kill();
		}

		if (retryAfterStop) {
			const issue = this.issueById.get(session.issueId);
			if (issue) {
				this.queueRetry(issue, session.attempt + 1, reason, "failure");
			}
		}

		this.requestUiRefresh();
	}

	private async reconcileRunningSessions(config: EffectiveConfig): Promise<void> {
		const now = Date.now();
		const sessions = Array.from(this.running.values());

		for (const session of sessions) {
			const issue = this.issueById.get(session.issueId);
			if (!issue) {
				await this.stopSession(session, "Issue note is missing.", false);
				continue;
			}

			session.state = issue.state;

			if (this.isTerminalIssue(issue)) {
				await this.stopSession(session, `Issue ${issue.identifier} entered a terminal state.`, false);
				await this.removeWorkspace(issue, session.workspacePath, config);
				continue;
			}

			if (!this.isActiveIssue(issue)) {
				await this.stopSession(session, `Issue ${issue.identifier} is no longer active.`, false);
				continue;
			}

			if (config.stallTimeoutMs > 0 && now - session.lastUpdatedAt > config.stallTimeoutMs) {
				await this.stopSession(session, `Run stalled after ${Math.ceil(config.stallTimeoutMs / 1000)}s.`, true);
				continue;
			}

			if (config.turnTimeoutMs > 0 && now - session.startedAt > config.turnTimeoutMs) {
				await this.stopSession(session, `Run timed out after ${Math.ceil(config.turnTimeoutMs / 1000)}s.`, true);
			}
		}
	}

	private async cleanupTerminalIssueWorkspaces(): Promise<void> {
		const config = this.effectiveConfig;
		if (!config) {
			return;
		}

		const terminalIssues = this.issues.filter((issue) => this.isTerminalIssue(issue));
		for (const issue of terminalIssues) {
			const workspaceKey = this.persistedState.workspaceKeys[issue.id];
			if (!workspaceKey) {
				continue;
			}

			const workspacePath = path.join(config.workspaceRoot, workspaceKey);
			await this.removeWorkspace(issue, workspacePath, config);
		}
	}

	private async ensureWorkspace(
		issue: SymphonyIssue,
		workspacePath: string,
		config: EffectiveConfig,
	): Promise<{ createdNow: boolean }> {
		const normalizedRoot = normalizeFsPath(config.workspaceRoot);
		const normalizedWorkspace = normalizeFsPath(workspacePath);
		if (!isPathInside(normalizedRoot, normalizedWorkspace)) {
			throw new Error(`Workspace path escaped the configured root for ${issue.identifier}.`);
		}

		const existed = await pathExists(workspacePath);
		await fs.mkdir(workspacePath, { recursive: true });
		if (!existed && config.projectRoot) {
			await this.seedWorkspaceFromProject(config.projectRoot, workspacePath);
		}
		await fs.mkdir(path.join(workspacePath, ".symphony"), { recursive: true });

		if (!existed) {
			await this.runHook(
				this.resolveAfterCreateHook(config),
				workspacePath,
				config.hooks.timeoutMs,
				true,
			);
		}

		return { createdNow: !existed };
	}

	private async seedWorkspaceFromProject(projectRoot: string, workspacePath: string): Promise<void> {
		await fs.cp(projectRoot, workspacePath, {
			recursive: true,
			force: true,
			filter: (sourcePath) => {
				const relativePath = path.relative(projectRoot, sourcePath);
				if (!relativePath || relativePath === "") {
					return true;
				}

				const topLevel = relativePath.split(path.sep)[0]?.toLowerCase();
				return !new Set([".git", "node_modules", ".elixir_ls", "_build", "deps"]).has(topLevel);
			},
		});
	}

	private resolveAfterCreateHook(config: EffectiveConfig): string | null {
		const script = config.hooks.afterCreate;
		if (!script) {
			return null;
		}

		if (!config.projectRoot) {
			return script;
		}

		const normalized = script
			.replace(/^\s*git\s+clone[^\r\n]*(?:\r?\n|$)/gim, "")
			.trim();

		return normalized || null;
	}

	private async syncWorkspaceContext(
		workspacePath: string,
		issue: SymphonyIssue,
		prompt: string,
	): Promise<void> {
		const dir = path.join(workspacePath, ".symphony");
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, "issue.json"), JSON.stringify(issue, null, 2), "utf8");
		await fs.writeFile(path.join(dir, "issue.md"), buildIssueMarkdown(issue), "utf8");
		await fs.writeFile(path.join(dir, "prompt.txt"), prompt, "utf8");
	}

	private buildCodexCommand(
		config: EffectiveConfig,
		workspacePath: string,
		outputFile: string,
		prompt: string,
	): { command: string; args: string[] } {
		const tokens = splitCommandLine(config.codexCommand);
		if (!tokens.length) {
			throw new Error("codex.command is empty.");
		}

		const [command, ...baseArgs] = tokens;
		const args = [...baseArgs];
		const appServerIndex = args.indexOf("app-server");
		if (appServerIndex >= 0) {
			args[appServerIndex] = "exec";
		}

		if (command.toLowerCase().includes("codex") && !args.includes("exec") && !args.includes("review")) {
			args.unshift("exec");
		}

		if (!args.includes("--json")) {
			args.push("--json");
		}
		if (!args.includes("--skip-git-repo-check")) {
			args.push("--skip-git-repo-check");
		}
		if (!args.includes("-C") && !args.includes("--cd")) {
			args.push("-C", workspacePath);
		}
		if (!args.includes("-o") && !args.includes("--output-last-message")) {
			args.push("-o", outputFile);
		}
		if (config.approvalPolicy && !args.includes("-a") && !args.includes("--ask-for-approval")) {
			args.push("-a", config.approvalPolicy);
		}
		if (config.sandbox && !args.includes("-s") && !args.includes("--sandbox")) {
			args.push("-s", config.sandbox);
		}

		args.push(prompt);
		return { command, args };
	}

	private writeSessionLog(
		session: RunningSessionInternal,
		level: "info" | "warn" | "error",
		event: string,
		message: string,
		extra: Record<string, StructuredLogValue | undefined> = {},
	): void {
		const record: Record<string, StructuredLogValue | undefined> = {
			timestamp: new Date().toISOString(),
			level,
			event,
			issue_id: session.issueId,
			issue_identifier: session.issueIdentifier,
			session_id: this.resolveSessionIdentifier(session),
			attempt: session.attempt,
			thread_id: session.threadId,
			turn_id: session.turnId,
			...extra,
			message,
		};

		try {
			session.logStream.write(`${this.formatStructuredLogRecord(record)}\n`);
		} catch {
			// ignore logging failures
		}
	}

	private formatStructuredLogRecord(record: Record<string, StructuredLogValue | undefined>): string {
		return Object.entries(record)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => `${key}=${this.formatStructuredLogValue(value ?? null)}`)
			.join(" ");
	}

	private formatStructuredLogValue(value: StructuredLogValue): string {
		if (value === null) {
			return "null";
		}

		if (typeof value === "number" || typeof value === "boolean") {
			return String(value);
		}

		return JSON.stringify(value);
	}

	private resolveSessionIdentifier(session: Pick<RunSnapshot, "sessionId" | "threadId" | "turnId">): string {
		return session.sessionId ?? this.resolveSessionIdentifierFromParts(session.threadId, session.turnId) ?? "pending";
	}

	private resolveSessionIdentifierFromParts(threadId: string | null, turnId: string | null): string | null {
		if (threadId && turnId) {
			return `${threadId}:${turnId}`;
		}

		return threadId ?? turnId ?? null;
	}

	private resolveWorkspaceKey(issue: SymphonyIssue): string {
		const existing = this.persistedState.workspaceKeys[issue.id];
		if (existing) {
			return existing;
		}

		const created = sanitizeWorkspaceKey(issue.identifier);
		this.persistedState.workspaceKeys[issue.id] = created;
		void this.persistState();
		return created;
	}

	private hasGlobalSlot(config: EffectiveConfig): boolean {
		return this.running.size < config.maxConcurrentAgents;
	}

	private hasStateSlot(config: EffectiveConfig, normalizedState: string): boolean {
		const limit = config.maxConcurrentAgentsByState[normalizedState];
		if (!limit) {
			return true;
		}

		let runningInState = 0;
		for (const session of this.running.values()) {
			if (normalizeState(session.state) === normalizedState) {
				runningInState += 1;
			}
		}

		return runningInState < limit;
	}

	private isIssueEligible(
		issue: SymphonyIssue,
		config: EffectiveConfig,
		ignoreHandled: boolean,
	): boolean {
		if (!this.isActiveIssue(issue)) {
			return false;
		}

		if (this.running.has(issue.id)) {
			return false;
		}

		const retry = this.retries.get(issue.id);
		if (retry && retry.dueAt > Date.now()) {
			return false;
		}

		if (!ignoreHandled && this.isIssueHandled(issue)) {
			return false;
		}

		if (issue.normalizedState === "todo" && this.issueHasOpenBlockers(issue, config)) {
			return false;
		}

		return true;
	}

	private issueHasOpenBlockers(issue: SymphonyIssue, config: EffectiveConfig): boolean {
		for (const blocker of issue.blockedBy) {
			const blockerIssue =
				(blocker.id ? this.issueById.get(blocker.id) : null) ??
				this.issues.find((candidate) => candidate.identifier === blocker.identifier);
			const blockerState = blockerIssue?.normalizedState ?? blocker.normalizedState;
			if (blockerState && !config.terminalStateSet.has(blockerState)) {
				return true;
			}
		}

		return false;
	}

	private isActiveIssue(issue: SymphonyIssue): boolean {
		return this.effectiveConfig?.activeStateSet.has(issue.normalizedState) ?? false;
	}

	private isTerminalIssue(issue: SymphonyIssue): boolean {
		return this.effectiveConfig?.terminalStateSet.has(issue.normalizedState) ?? false;
	}

	private isIssueHandled(issue: SymphonyIssue): boolean {
		const handledVersion = this.persistedState.handledIssueVersions[issue.id];
		return Boolean(handledVersion) && handledVersion === issue.versionToken;
	}

	private buildIssueDebugSnapshot(issue: SymphonyIssue): IssueDebugSnapshot {
		const config = this.effectiveConfig ?? this.getConfigForIndexing();
		const retry = this.retries.get(issue.id) ?? null;
		const running = this.running.get(issue.id) ?? null;
		return {
			issue,
			runtimeStatus: running
				? running.status
				: retry
				? `Retry queued (${describeDueIn(retry.dueAt)})`
				: this.isTerminalIssue(issue)
				? "Terminal"
				: this.isIssueHandled(issue)
				? "Handled"
				: this.issueHasOpenBlockers(issue, config)
				? "Blocked"
				: this.isActiveIssue(issue)
				? "Ready"
				: "Inactive",
			blocked: this.issueHasOpenBlockers(issue, config),
			handled: this.isIssueHandled(issue),
			running,
			retry,
			lastAttempt: this.lastAttempts.get(issue.id) ?? null,
			lastSuccessAt: this.lastSuccessAt.get(issue.id) ?? null,
			lastFailureAt: this.lastFailureAt.get(issue.id) ?? null,
			lastError: this.lastErrorByIssue.get(issue.id) ?? null,
		};
	}

	private shouldRefreshForPath(filePath: string): boolean {
		const normalized = normalizePath(filePath);
		const workflowPath = normalizePath(this.getSettings().workflowFilePath);
		if (normalized === workflowPath) {
			return true;
		}

		const issuesPath = this.effectiveConfig?.issuesPath ?? "symphony/issues";
		return normalized.startsWith(`${normalizePath(issuesPath)}/`);
	}

	private async removeWorkspace(
		issue: SymphonyIssue,
		workspacePath: string,
		config: EffectiveConfig,
	): Promise<void> {
		try {
			await this.runHook(config.hooks.beforeRemove, workspacePath, config.hooks.timeoutMs, false);
			await fs.rm(workspacePath, { recursive: true, force: true });
		} catch (error) {
			this.recordError(
				{
					timestamp: Date.now(),
					code: "workspace_remove_failed",
					message:
						error instanceof Error
							? `Failed to remove workspace for ${issue.identifier}: ${error.message}`
							: `Failed to remove workspace for ${issue.identifier}.`,
					issueId: issue.id,
					issueIdentifier: issue.identifier,
					notePath: issue.notePath,
				},
				false,
			);
		}
	}

	private async runHook(
		script: string | null,
		cwd: string,
		timeoutMs: number,
		fatal: boolean,
	): Promise<void> {
		if (!script) {
			return;
		}

		await new Promise<void>((resolve, reject) => {
			const isWindows = process.platform === "win32";
			const command = isWindows ? "powershell.exe" : "sh";
			const args = isWindows ? ["-NoProfile", "-Command", script] : ["-lc", script];

			const child = spawn(command, args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});

			let stderr = "";
			const timeoutHandle = window.setTimeout(() => {
				child.kill();
				if (fatal) {
					reject(new Error(`Hook timed out after ${timeoutMs}ms.`));
				} else {
					resolve();
				}
			}, timeoutMs);

			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf8");
			});

			child.once("error", (error) => {
				window.clearTimeout(timeoutHandle);
				if (fatal) {
					reject(error);
				} else {
					resolve();
				}
			});

			child.once("close", (code) => {
				window.clearTimeout(timeoutHandle);
				if (code === 0 || !fatal) {
					resolve();
					return;
				}
				reject(new Error(stderr.trim() || `Hook exited with code ${code}.`));
			});
		});
	}

	private restartPoller(): void {
		this.stopPoller();
		if (!this.runtimeEnabled || !this.effectiveConfig) {
			return;
		}

		this.pollHandle = window.setInterval(() => {
			void this.scheduleRefresh("poll");
		}, this.effectiveConfig.pollIntervalMs);
	}

	private stopPoller(): void {
		if (this.pollHandle !== null) {
			window.clearInterval(this.pollHandle);
			this.pollHandle = null;
		}
	}

	private recordError(error: OperatorError, notify: boolean): void {
		const last = this.recentErrors[0];
		if (
			last &&
			last.code === error.code &&
			last.message === error.message &&
			last.issueId === error.issueId &&
			error.timestamp - last.timestamp < 5_000
		) {
			return;
		}

		this.recentErrors.unshift(error);
		this.recentErrors = this.recentErrors.slice(0, 12);
		this.persistedState.recentErrors = [...this.recentErrors];
		if (notify) {
			this.onNotice(error.message, 7000);
		}
		this.requestUiRefresh();
	}

	private async persistState(): Promise<void> {
		await this.onPersistRequested();
	}

	private requestUiRefresh(): void {
		this.onRequestUiRefresh();
	}

	private getVaultBasePath(): string | null {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return null;
	}
}

function buildIssueMarkdown(issue: SymphonyIssue): string {
	return [
		`# ${issue.title}`,
		"",
		`- ID: ${issue.id}`,
		`- Identifier: ${issue.identifier}`,
		`- State: ${issue.state}`,
		`- Priority: ${issue.priority ?? "None"}`,
		`- Note: ${issue.notePath}`,
		issue.branchName ? `- Branch: ${issue.branchName}` : null,
		issue.url ? `- URL: ${issue.url}` : null,
		issue.labels.length ? `- Labels: ${issue.labels.join(", ")}` : null,
		"",
		issue.description ?? "",
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

function compareIssues(left: SymphonyIssue, right: SymphonyIssue): number {
	const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
	const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
	if (leftPriority !== rightPriority) {
		return leftPriority - rightPriority;
	}

	const leftCreated = left.createdAtMs ?? Number.MAX_SAFE_INTEGER;
	const rightCreated = right.createdAtMs ?? Number.MAX_SAFE_INTEGER;
	if (leftCreated !== rightCreated) {
		return leftCreated - rightCreated;
	}

	return left.identifier.localeCompare(right.identifier);
}
