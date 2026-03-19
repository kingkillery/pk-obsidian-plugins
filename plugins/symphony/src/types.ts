export interface BlockerRef {
	id: string | null;
	identifier: string | null;
	state: string | null;
	normalizedState: string | null;
}

export interface SymphonyIssue {
	id: string;
	identifier: string;
	title: string;
	description: string | null;
	priority: number | null;
	state: string;
	normalizedState: string;
	branchName: string | null;
	url: string | null;
	labels: string[];
	blockedBy: BlockerRef[];
	createdAt: string | null;
	updatedAt: string | null;
	createdAtMs: number | null;
	updatedAtMs: number | null;
	notePath: string;
	noteBasename: string;
	versionToken: string;
}

export interface WorkflowDefinition {
	path: string;
	raw: string;
	promptTemplate: string;
	config: Record<string, unknown>;
	digest: string;
	loadedAt: number;
}

export interface HookConfig {
	afterCreate: string | null;
	beforeRun: string | null;
	afterRun: string | null;
	beforeRemove: string | null;
	timeoutMs: number;
}

export interface EffectiveConfig {
	workflowPath: string;
	issuesPath: string;
	activeStates: string[];
	activeStateSet: Set<string>;
	terminalStates: string[];
	terminalStateSet: Set<string>;
	handoffStates: string[];
	handoffStateSet: Set<string>;
	pollIntervalMs: number;
	maxConcurrentAgents: number;
	maxConcurrentAgentsByState: Record<string, number>;
	maxTurns: number;
	maxRetryBackoffMs: number;
	projectRoot: string | null;
	workspaceRoot: string;
	logRoot: string;
	allowWorkspaceInsideVault: boolean;
	hooks: HookConfig;
	codexCommand: string;
	approvalPolicy: string | null;
	sandbox: string | null;
	turnTimeoutMs: number;
	readTimeoutMs: number;
	stallTimeoutMs: number;
	httpPort: number | null;
}

export interface OperatorError {
	timestamp: number;
	code: string;
	message: string;
	issueId?: string;
	issueIdentifier?: string;
	notePath?: string;
}

export interface RetryEntry {
	issueId: string;
	identifier: string;
	attempt: number;
	dueAt: number;
	error: string;
	reason: "failure" | "continuation";
}

export interface TokenTotals {
	input: number;
	output: number;
	total: number;
	reasoning: number;
	cachedInput: number;
}

export interface RateLimitSnapshot {
	raw: Record<string, unknown>;
	summary: string;
	updatedAt: number;
}

export interface RunSnapshot {
	issueId: string;
	issueIdentifier: string;
	notePath: string;
	state: string;
	attempt: number;
	startedAt: number;
	status: string;
	workspacePath: string;
	logPath: string;
	outputFile: string;
	pid: number | null;
	sessionId: string | null;
	threadId: string | null;
	turnId: string | null;
	lastEvent: string;
	lastMessage: string;
	lastUpdatedAt: number;
	inputVersionToken: string;
	stopReason: string | null;
}

export interface IssueDebugSnapshot {
	issue: SymphonyIssue;
	runtimeStatus: string;
	blocked: boolean;
	handled: boolean;
	running: RunSnapshot | null;
	retry: RetryEntry | null;
	lastAttempt: number | null;
	lastSuccessAt: number | null;
	lastFailureAt: number | null;
	lastError: string | null;
}

export interface RuntimeSnapshot {
	runtimeEnabled: boolean;
	workflowPath: string;
	workflowLoaded: boolean;
	workflowDigest: string | null;
	workflowError: OperatorError | null;
	issuesPath: string | null;
	lastRefreshAt: number | null;
	lastRefreshReason: string | null;
	configSummary: {
		pollIntervalMs: number | null;
		maxConcurrentAgents: number | null;
		projectRoot: string | null;
		workspaceRoot: string | null;
		logRoot: string | null;
		codexCommand: string | null;
	} | null;
	totals: {
		indexed: number;
		active: number;
		terminal: number;
		running: number;
		retrying: number;
		handled: number;
		successes: number;
		failures: number;
		refreshes: number;
	};
	codexTotals: TokenTotals;
	latestRateLimit: RateLimitSnapshot | null;
	recentErrors: OperatorError[];
	issues: IssueDebugSnapshot[];
}

export interface PersistedRuntimeState {
	workspaceKeys: Record<string, string>;
	handledIssueVersions: Record<string, string>;
	lastKnownGoodWorkflowDigest: string | null;
	recentErrors: OperatorError[];
}
