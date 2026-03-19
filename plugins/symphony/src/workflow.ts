import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import { TFile, normalizePath } from "obsidian";
import type { SymphonySettings } from "./settings";
import type { EffectiveConfig, WorkflowDefinition } from "./types";
import {
	buildFallbackPrompt,
	coerceNonNegativeInteger,
	coerceObject,
	coerceOptionalInteger,
	coerceOptionalString,
	coercePositiveInteger,
	coerceStringArray,
	expandDesktopPath,
	extractFrontmatter,
	isRecord,
	normalizeState,
	renderStrictTemplate,
	sanitizeWorkspaceKey,
	sha1,
} from "./utils";

const DEFAULT_ACTIVE_STATES = ["Todo", "In Progress"];
const DEFAULT_TERMINAL_STATES = ["Done", "Closed", "Cancelled", "Canceled", "Duplicate"];

export async function loadWorkflowDefinition(
	app: { vault: { cachedRead(file: TFile): Promise<string>; getAbstractFileByPath(path: string): unknown } },
	workflowPath: string,
): Promise<WorkflowDefinition> {
	if (path.isAbsolute(workflowPath)) {
		return loadFilesystemWorkflowDefinition(workflowPath);
	}

	const normalizedPath = normalizePath(workflowPath);
	const file = app.vault.getAbstractFileByPath(normalizedPath);
	if (!(file instanceof TFile)) {
		throw new Error(`Workflow file not found at ${normalizedPath}.`);
	}

	const raw = await app.vault.cachedRead(file);
	const { frontmatter, body } = extractFrontmatter(raw);

	return {
		path: normalizedPath,
		raw,
		promptTemplate: body.trim(),
		config: isRecord(frontmatter) ? frontmatter : {},
		digest: sha1(raw),
		loadedAt: Date.now(),
	};
}

export async function loadFilesystemWorkflowDefinition(workflowPath: string): Promise<WorkflowDefinition> {
	const absolutePath = path.resolve(workflowPath);
	const raw = await fs.readFile(absolutePath, "utf8");
	const { frontmatter, body } = extractFrontmatter(raw);

	return {
		path: absolutePath,
		raw,
		promptTemplate: body.trim(),
		config: isRecord(frontmatter) ? frontmatter : {},
		digest: sha1(raw),
		loadedAt: Date.now(),
	};
}

export function buildEffectiveConfig(
	app: { vault: { getName(): string } },
	settings: SymphonySettings,
	workflow: WorkflowDefinition,
): EffectiveConfig {
	const rootConfig = coerceObject(workflow.config);
	const vaultConfig = coerceObject(rootConfig.vault);
	const workspaceConfig = coerceObject(rootConfig.workspace);
	const pollingConfig = coerceObject(rootConfig.polling);
	const hooksConfig = coerceObject(rootConfig.hooks);
	const agentConfig = coerceObject(rootConfig.agent);
	const codexConfig = coerceObject(rootConfig.codex);
	const serverConfig = coerceObject(rootConfig.server);
	const projectConfig = coerceObject(rootConfig.project);

	const issuesPath = normalizePath(coerceOptionalString(vaultConfig.issues_path) ?? "symphony/issues");
	const activeStates = coerceStringArray(vaultConfig.active_states, DEFAULT_ACTIVE_STATES);
	const terminalStates = coerceStringArray(vaultConfig.terminal_states, DEFAULT_TERMINAL_STATES);
	const handoffStates = coerceStringArray(vaultConfig.handoff_states);

	const projectRoot = resolveProjectRoot(settings, projectConfig);
	const workspaceRoot = resolveWorkspaceRoot(app.vault.getName(), settings, workspaceConfig);
	const logRoot = resolveLogRoot(app.vault.getName(), settings);

	const stateConcurrency = parseStateConcurrency(agentConfig.max_concurrent_agents_by_state);

	return {
		workflowPath: normalizePath(settings.workflowFilePath),
		issuesPath,
		activeStates,
		activeStateSet: new Set(activeStates.map(normalizeState).filter(Boolean)),
		terminalStates,
		terminalStateSet: new Set(terminalStates.map(normalizeState).filter(Boolean)),
		handoffStates,
		handoffStateSet: new Set(handoffStates.map(normalizeState).filter(Boolean)),
		pollIntervalMs: coercePositiveInteger(pollingConfig.interval_ms, 30_000),
		maxConcurrentAgents: coercePositiveInteger(agentConfig.max_concurrent_agents, 10),
		maxConcurrentAgentsByState: stateConcurrency,
		maxTurns: coercePositiveInteger(agentConfig.max_turns, 20),
		maxRetryBackoffMs: coercePositiveInteger(agentConfig.max_retry_backoff_ms, 300_000),
		projectRoot,
		workspaceRoot,
		logRoot,
		allowWorkspaceInsideVault:
			settings.allowWorkspaceInsideVault || Boolean(workspaceConfig.allow_inside_vault),
		hooks: {
			afterCreate: coerceOptionalString(hooksConfig.after_create),
			beforeRun: coerceOptionalString(hooksConfig.before_run),
			afterRun: coerceOptionalString(hooksConfig.after_run),
			beforeRemove: coerceOptionalString(hooksConfig.before_remove),
			timeoutMs: coercePositiveInteger(hooksConfig.timeout_ms, 60_000),
		},
		codexCommand: coerceOptionalString(codexConfig.command) ?? "codex exec",
		approvalPolicy: coerceOptionalString(codexConfig.approval_policy),
		sandbox:
			coerceOptionalString(codexConfig.turn_sandbox_policy) ??
			coerceOptionalString(codexConfig.thread_sandbox),
		turnTimeoutMs: coercePositiveInteger(codexConfig.turn_timeout_ms, 3_600_000),
		readTimeoutMs: coercePositiveInteger(codexConfig.read_timeout_ms, 5_000),
		stallTimeoutMs: coerceNonNegativeInteger(codexConfig.stall_timeout_ms, 300_000),
		httpPort:
			settings.httpPortOverride ??
			coerceOptionalInteger(serverConfig.port),
	};
}

export function renderPrompt(
	workflow: WorkflowDefinition,
	issueContext: Record<string, unknown>,
	attempt: number,
	workspacePath: string,
): string {
	const fallback = buildFallbackPrompt(issueContext, attempt, workspacePath);
	const continuationAttempt = attempt > 1 ? attempt - 1 : null;
	return renderStrictTemplate(
		workflow.promptTemplate,
		{
			issue: issueContext,
			attempt: continuationAttempt,
			run_attempt: attempt,
			workspace_path: workspacePath,
		},
		fallback,
	);
}

function resolveWorkspaceRoot(
	vaultName: string,
	settings: SymphonySettings,
	workspaceConfig: Record<string, unknown>,
): string {
	const configured =
		coerceOptionalString(settings.desktopWorkspaceRoot) ??
		coerceOptionalString(workspaceConfig.root);

	if (configured) {
		return expandDesktopPath(configured);
	}

	return path.join(os.tmpdir(), "obsidian-symphony", sanitizeWorkspaceKey(vaultName), "workspaces");
}

function resolveProjectRoot(
	settings: SymphonySettings,
	projectConfig: Record<string, unknown>,
): string | null {
	const configured =
		coerceOptionalString(settings.desktopProjectRoot) ??
		coerceOptionalString(projectConfig.root);

	return configured ? expandDesktopPath(configured) : null;
}

function resolveLogRoot(vaultName: string, settings: SymphonySettings): string {
	const configured = coerceOptionalString(settings.desktopLogRoot);
	if (configured) {
		return expandDesktopPath(configured);
	}

	return path.join(os.tmpdir(), "obsidian-symphony", sanitizeWorkspaceKey(vaultName), "logs");
}

function parseStateConcurrency(value: unknown): Record<string, number> {
	if (!isRecord(value)) {
		return {};
	}

	const output: Record<string, number> = {};
	for (const [rawState, rawLimit] of Object.entries(value)) {
		const normalized = normalizeState(rawState);
		const limit = coerceOptionalInteger(rawLimit);
		if (normalized && limit !== null && limit > 0) {
			output[normalized] = limit;
		}
	}

	return output;
}
