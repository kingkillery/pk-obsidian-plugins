import { execFile } from "child_process";
import { promisify } from "util";
import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath,
} from "obsidian";
import {
	DEFAULT_SETTINGS,
	OptimizedLearningSettings,
} from "./settings";

const execFileAsync = promisify(execFile);

const RESOURCE_FILES = [
	"how-to-learn-with-notebooklm.md",
	"notebook-blueprint.md",
	"source-triage-checklist.md",
	"study-session-template.md",
	"retrieval-practice-template.md",
	"memory-consolidation-workflow.md",
	"nlm-cli-cheatsheet.md",
	"notebooklm-cli-resource-hub.md",
	"shared-notebook-intake.md",
] as const;

const SHARED_NOTEBOOK_URL =
	"https://notebooklm.google.com/notebook/98b3a4e9-b830-4631-88a7-22018ba0aaad";

export default class OptimizedLearningPlugin extends Plugin {
	settings: OptimizedLearningSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new OptimizedLearningSettingTab(this.app, this));

		this.addCommand({
			id: "seed-learning-resource-pack",
			name: "Seed learning resource pack",
			callback: async () => {
				await this.seedLearningResources();
			},
		});

		this.addCommand({
			id: "create-study-session-note",
			name: "Create study session note",
			callback: async () => {
				await this.createStudySessionNote();
			},
		});

		this.addCommand({
			id: "check-notebooklm-cli",
			name: "Check NotebookLM CLI",
			callback: async () => {
				await this.checkNotebookLmCli();
			},
		});

		this.addCommand({
			id: "capture-notebooklm-ai-reference",
			name: "Capture NotebookLM AI reference",
			callback: async () => {
				await this.captureAiReference();
			},
		});

		this.addCommand({
			id: "create-shared-notebook-intake-note",
			name: "Create shared NotebookLM intake note",
			callback: async () => {
				await this.createSharedNotebookIntakeNote();
			},
		});
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async seedLearningResources(): Promise<void> {
		const folderPath = normalizePath(this.settings.resourceFolder);
		await this.ensureFolder(folderPath);

		let created = 0;
		let skipped = 0;

		for (const fileName of RESOURCE_FILES) {
			const targetPath = normalizePath(`${folderPath}/${fileName}`);
			const existing = this.app.vault.getAbstractFileByPath(targetPath);

			if (existing instanceof TFile) {
				skipped += 1;
				continue;
			}

			const template = await this.readBundledResource(fileName);
			await this.app.vault.create(targetPath, template);
			created += 1;
		}

		new Notice(`Optimized Learning seeded ${created} resource(s); skipped ${skipped}.`, 6000);
	}

	private async createStudySessionNote(): Promise<void> {
		const folderPath = normalizePath(this.settings.resourceFolder);
		await this.ensureFolder(folderPath);

		const template = await this.readBundledResource("study-session-template.md");
		const stamp = this.buildDateStamp();
		const fileName = `Study Session ${stamp}.md`;
		const targetPath = this.makeUniqueMarkdownPath(normalizePath(`${folderPath}/${fileName}`));
		const notebookTitle = `${this.settings.notebookPrefix}: ${stamp}`;
		const content = template
			.replace(/{{DATE}}/g, stamp)
			.replace(/{{NOTEBOOK_TITLE}}/g, notebookTitle);

		const file = await this.app.vault.create(targetPath, content);
		await this.app.workspace.getLeaf(true).openFile(file);
		new Notice(`Created study session note: ${file.path}`, 6000);
	}

	private async checkNotebookLmCli(): Promise<void> {
		try {
			const cliPath = this.requireCliPath();
			const result = await execFileAsync(cliPath, ["--version"], {
				timeout: 30_000,
				maxBuffer: 2 * 1024 * 1024,
			});
			const version = `${result.stdout || result.stderr}`.trim() || "NotebookLM CLI responded without version text.";
			new Notice(`NotebookLM CLI OK: ${version}`, 7000);
		} catch (error) {
			new Notice(this.formatCliError("NotebookLM CLI check failed", error), 10000);
		}
	}

	private async captureAiReference(): Promise<void> {
		try {
			const cliPath = this.requireCliPath();
			const result = await execFileAsync(cliPath, ["--ai"], {
				timeout: 60_000,
				maxBuffer: 8 * 1024 * 1024,
			});
			const folderPath = normalizePath(this.settings.resourceFolder);
			await this.ensureFolder(folderPath);

			const referencePath = normalizePath(`${folderPath}/NotebookLM CLI AI Reference.md`);
			const body = [
				"# NotebookLM CLI AI Reference",
				"",
				"Generated from `nlm --ai`.",
				"",
				"```text",
				(result.stdout || "").trim(),
				"```",
				"",
			].join("\n");

			const existing = this.app.vault.getAbstractFileByPath(referencePath);
			if (existing instanceof TFile) {
				await this.app.vault.modify(existing, body);
				await this.app.workspace.getLeaf(true).openFile(existing);
				new Notice("Updated NotebookLM CLI AI reference note.", 6000);
				return;
			}

			const file = await this.app.vault.create(referencePath, body);
			await this.app.workspace.getLeaf(true).openFile(file);
			new Notice("Captured NotebookLM CLI AI reference note.", 6000);
		} catch (error) {
			new Notice(this.formatCliError("NotebookLM AI reference capture failed", error), 10000);
		}
	}

	private async createSharedNotebookIntakeNote(): Promise<void> {
		const folderPath = normalizePath(this.settings.resourceFolder);
		await this.ensureFolder(folderPath);
		const targetPath = normalizePath(`${folderPath}/Shared NotebookLM Intake.md`);
		const template = await this.readBundledResource("shared-notebook-intake.md");
		const body = template.replace(/{{SHARED_NOTEBOOK_URL}}/g, SHARED_NOTEBOOK_URL);

		const existing = this.app.vault.getAbstractFileByPath(targetPath);
		if (existing instanceof TFile) {
			await this.app.vault.modify(existing, body);
			await this.app.workspace.getLeaf(true).openFile(existing);
			new Notice("Updated shared NotebookLM intake note.", 6000);
			return;
		}

		const file = await this.app.vault.create(targetPath, body);
		await this.app.workspace.getLeaf(true).openFile(file);
		new Notice("Created shared NotebookLM intake note.", 6000);
	}

	private async readBundledResource(fileName: typeof RESOURCE_FILES[number]): Promise<string> {
		const pluginResourcePath = normalizePath(
			`${this.app.vault.configDir}/plugins/${this.manifest.id}/resources/${fileName}`,
		);
		return this.app.vault.adapter.read(pluginResourcePath);
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		const segments = folderPath.split("/").filter(Boolean);
		let current = "";

		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			const normalized = normalizePath(current);
			const existing = this.app.vault.getAbstractFileByPath(normalized);
			if (!existing) {
				await this.app.vault.createFolder(normalized);
			}
		}
	}

	private makeUniqueMarkdownPath(basePath: string): string {
		const existing = this.app.vault.getAbstractFileByPath(basePath);
		if (!existing) {
			return basePath;
		}

		const suffixless = basePath.replace(/\.md$/i, "");
		let counter = 2;

		while (true) {
			const candidate = `${suffixless} ${counter}.md`;
			if (!this.app.vault.getAbstractFileByPath(candidate)) {
				return candidate;
			}
			counter += 1;
		}
	}

	private requireCliPath(): string {
		const cliPath = this.settings.cliPath.trim();
		if (!cliPath) {
			throw new Error("Set a NotebookLM CLI path in the plugin settings first.");
		}

		return cliPath;
	}

	private buildDateStamp(): string {
		return new Date().toISOString().slice(0, 10);
	}

	private formatCliError(prefix: string, error: unknown): string {
		if (error instanceof Error) {
			return `${prefix}: ${error.message}`;
		}

		return `${prefix}: ${String(error)}`;
	}
}

class OptimizedLearningSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: OptimizedLearningPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Resource folder")
			.setDesc("Vault folder where learning notes and generated references are stored.")
			.addText((text) =>
				text
					.setPlaceholder("Optimized Learning")
					.setValue(this.plugin.settings.resourceFolder)
					.onChange(async (value) => {
						this.plugin.settings.resourceFolder = value.trim() || DEFAULT_SETTINGS.resourceFolder;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("NotebookLM CLI path")
			.setDesc("Path to nlm.exe or the local NotebookLM CLI launcher.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.cliPath)
					.setValue(this.plugin.settings.cliPath)
					.onChange(async (value) => {
						this.plugin.settings.cliPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Notebook title prefix")
			.setDesc("Used when creating study-session notes and suggested NotebookLM notebook names.")
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.notebookPrefix)
					.setValue(this.plugin.settings.notebookPrefix)
					.onChange(async (value) => {
						this.plugin.settings.notebookPrefix = value.trim() || DEFAULT_SETTINGS.notebookPrefix;
						await this.plugin.saveSettings();
					}),
			);
	}
}
