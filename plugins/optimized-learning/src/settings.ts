export interface OptimizedLearningSettings {
	resourceFolder: string;
	cliPath: string;
	notebookPrefix: string;
}

export const DEFAULT_CLI_PATH =
	"C:\\Users\\prest\\OneDrive\\Desktop\\Desktop-Projects\\Obsidian Plugins\\tools\\notebooklm-cli\\.venv\\Scripts\\nlm.exe";

export const DEFAULT_SETTINGS: OptimizedLearningSettings = {
	resourceFolder: "Optimized Learning",
	cliPath: DEFAULT_CLI_PATH,
	notebookPrefix: "How To Learn",
};
