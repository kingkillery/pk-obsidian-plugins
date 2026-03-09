export interface SymphonySettings {
	workflowFilePath: string;
	desktopWorkspaceRoot: string;
	desktopLogRoot: string;
	autoStart: boolean;
	dashboardOpenOnStart: boolean;
	httpPortOverride: number | null;
	allowWorkspaceInsideVault: boolean;
}

export const DEFAULT_SETTINGS: SymphonySettings = {
	workflowFilePath: "symphony/WORKFLOW.md",
	desktopWorkspaceRoot: "",
	desktopLogRoot: "",
	autoStart: false,
	dashboardOpenOnStart: false,
	httpPortOverride: null,
	allowWorkspaceInsideVault: false,
};
