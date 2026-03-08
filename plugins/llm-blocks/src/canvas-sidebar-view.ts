import { ItemView, MarkdownRenderer, MarkdownView, Notice, WorkspaceLeaf } from "obsidian";
import { CodexWebSocketClient } from "./websocket-client";
import {
	buildQueryOptionsFromRuntimeOption,
	DIRECT_RUNTIME_OPTIONS,
	getRuntimeHintText,
	RUNTIME_MODE_OPTIONS,
	resolveRuntimeFromMode,
	type RuntimeModelOption,
} from "./model-options";

export const CANVAS_VIEW_TYPE = "llm-canvas-view";
const INLINE_REPLACEMENT_MODEL = "gemini-3.1-flash-lite-preview";

type ReplaceScope = "selection" | "note";

export class LLMCanvasSidebarView extends ItemView {
	private promptInput!: HTMLInputElement;
	private runBtn!: HTMLButtonElement;
	private applyBtn!: HTMLButtonElement;
	private runtimeModeSelect!: HTMLSelectElement;
	private directModelSelect!: HTMLSelectElement;
	private outputPreview!: HTMLElement;
	private beforePreview!: HTMLElement;
	private fileBadge!: HTMLElement;
	private bindingStateBadge!: HTMLElement;
	private scopeBadge!: HTMLElement;
	private runtimeHint!: HTMLElement;
	private contextHint!: HTMLElement;
	private boundFileName = "";

	private boundFilePath = "";
	private scope: ReplaceScope = "selection";
	private targetStartOffset = 0;
	private targetEndOffset = 0;
	private output = "";
	private running = false;
	private readonly availableModels: RuntimeModelOption[] = DIRECT_RUNTIME_OPTIONS;

	constructor(leaf: WorkspaceLeaf, private client: CodexWebSocketClient) {
		super(leaf);
	}

	getViewType(): string {
		return CANVAS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "LLM Canvas";
	}

	getIcon(): string {
		return "bot";
	}

	getViewData(): string {
		return "";
	}

	async onOpen(): Promise<void> {
		this.buildUi();
		this.bindToActiveNote();
		this.refreshBindingState();
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshBindingState()));
	}

	async onClose(): Promise<void> {
		return;
	}

	private buildUi(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("llm-canvas", "llm-canvas-inline", "llm-canvas-docked");

		const top = contentEl.createDiv({ cls: "llm-canvas-inline-top" });
		top.createEl("h2", { text: "Canvas" }).addClass("llm-canvas-inline-title");
		const bindBtn = top.createEl("button", { text: "Use Current Note" });
		bindBtn.addEventListener("click", () => this.bindToActiveNote());

		const meta = contentEl.createDiv({ cls: "llm-canvas-inline-meta" });
		this.fileBadge = meta.createSpan({ text: "Editing: No note bound" });
		this.bindingStateBadge = meta.createSpan({ text: "Binding: not bound" });
		this.scopeBadge = meta.createSpan({ text: "Target: none" });
		this.runtimeHint = meta.createSpan({ cls: "llm-canvas-runtime-hint", text: "Execution path: not set" });
		this.contextHint = contentEl.createDiv({
			cls: "llm-canvas-inline-hint",
			text: "Changes apply to the current bound target.",
		});

		const quickRow = contentEl.createDiv({ cls: "llm-canvas-quick-actions" });
		this.addQuickAction(quickRow, "Fix", "Fix bugs and improve correctness in this selection.");
		this.addQuickAction(quickRow, "Rewrite", "Rewrite this content for clarity while preserving meaning.");
		this.addQuickAction(quickRow, "Explain", "Explain this content simply and clearly.");

		const diff = contentEl.createDiv({ cls: "llm-canvas-inline-diff" });
		const before = diff.createDiv({ cls: "llm-canvas-inline-panel" });
		before.createEl("div", { cls: "llm-canvas-diff-label", text: "Before" });
		this.beforePreview = before.createEl("pre", { cls: "llm-canvas-inline-editor" });

		const after = diff.createDiv({ cls: "llm-canvas-inline-panel" });
		after.createDiv({ cls: "llm-canvas-diff-label", text: "After" });
		this.outputPreview = after.createDiv({ cls: "llm-canvas-preview markdown-rendered" });

		const bar = contentEl.createDiv({ cls: "llm-canvas-inline-bar" });
		const modeWrap = bar.createDiv({ cls: "llm-canvas-option" });
		modeWrap.createSpan({ cls: "llm-control-label", text: "Runtime" });
		this.runtimeModeSelect = modeWrap.createEl("select", { cls: "llm-runtime-mode-select" });
		for (const option of RUNTIME_MODE_OPTIONS) {
			this.runtimeModeSelect.createEl("option", { value: option.value, text: option.label });
		}

		const directWrap = bar.createDiv({ cls: "llm-canvas-option llm-runtime-direct-wrap" });
		directWrap.createSpan({ cls: "llm-control-label", text: "Preset" });
		this.directModelSelect = directWrap.createEl("select", { cls: "llm-block-model-select" });
		for (const option of this.availableModels) {
			this.directModelSelect.createEl("option", { value: option.id, text: option.label });
		}

		const preferredId = this.client.getPreferredRuntimeModelOptionId();
		if (preferredId === "codex-appserver") {
			this.runtimeModeSelect.value = "codex-appserver";
		} else {
			this.runtimeModeSelect.value = "direct-model";
			this.directModelSelect.value = preferredId;
		}

		const updateRuntimeSelections = (): void => {
			directWrap.style.display = this.runtimeModeSelect.value === "direct-model" ? "inline-flex" : "none";
			this.refreshRuntimeHint();
		};
		this.runtimeModeSelect.addEventListener("change", updateRuntimeSelections);
		this.directModelSelect.addEventListener("change", () => this.refreshRuntimeHint());
		updateRuntimeSelections();

		this.promptInput = bar.createEl("input", {
			cls: "llm-canvas-inline-input",
			type: "text",
			placeholder: "Rewrite or ask about the bound content...",
		});
		this.runBtn = bar.createEl("button", { cls: "llm-canvas-inline-send", text: "Generate" });
		this.applyBtn = bar.createEl("button", { cls: "llm-canvas-inline-send llm-canvas-inline-apply", text: "Apply" });
		this.applyBtn.disabled = true;

		this.runBtn.addEventListener("click", () => { void this.runCanvas(); });
		this.promptInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void this.runCanvas();
			}
		});
		this.applyBtn.addEventListener("click", () => {
			if (!this.output.trim()) return;
			if (!this.applyOutputToEditor()) {
				new Notice("No open editor for the bound note.");
				return;
			}
			new Notice("Canvas output applied.");
		});
	}

	private addQuickAction(container: HTMLElement, label: string, instruction: string): void {
		const btn = container.createEl("button", { cls: "llm-canvas-chip", text: label });
		btn.addEventListener("click", () => {
			this.promptInput.value = instruction;
			this.promptInput.focus();
		});
	}

	private bindToActiveNote(notifyOnFailure = true): boolean {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) {
			if (notifyOnFailure) {
				new Notice("Open a markdown note first.");
			}
			return false;
		}
		this.boundFilePath = view.file.path;
		this.boundFileName = view.file.basename;
		const editor = view.editor;
		const selection = editor.getSelection();
		if (selection.trim()) {
			const from = editor.getCursor("from");
			const to = editor.getCursor("to");
			this.scope = "selection";
			this.targetStartOffset = editor.posToOffset(from);
			this.targetEndOffset = editor.posToOffset(to);
		} else {
			this.scope = "note";
			this.targetStartOffset = 0;
			this.targetEndOffset = editor.getValue().length;
		}

		this.fileBadge.setText(`Editing: ${view.file.basename}`);
		this.scopeBadge.setText(`Target: ${this.scope}`);
		this.output = "";
		this.outputPreview.empty();
		this.updateApplyButtonState();
		this.refreshBeforePreview();
		this.refreshBindingState();
		return true;
	}

	private refreshBindingState(): void {
		if (!this.boundFilePath) {
			this.bindingStateBadge.setText("Binding: not bound");
			this.bindingStateBadge.classList.remove("llm-binding-active", "llm-binding-stale");
			return;
		}
		const activeFile = this.app.workspace.getActiveFile();
		const activePath = activeFile?.path ?? "";
		if (activePath === this.boundFilePath) {
			this.bindingStateBadge.setText("Binding: active");
			this.bindingStateBadge.classList.add("llm-binding-active");
			this.bindingStateBadge.classList.remove("llm-binding-stale");
			this.contextHint.setText(`Editing: ${this.boundFileName || "Current note"} | ${this.scope}`);
		} else {
			this.bindingStateBadge.setText("Binding: stale (note changed)");
			this.bindingStateBadge.classList.add("llm-binding-stale");
			this.bindingStateBadge.classList.remove("llm-binding-active");
			this.contextHint.setText("Active editor no longer matches bound note. Click Use Current Note to retarget.");
		}
	}

	private refreshBeforePreview(): void {
		const editor = this.getBoundEditor();
		if (!editor) {
			this.beforePreview.setText("(Bound note is not open in an editor)");
			return;
		}
		const value = editor.getValue().slice(this.targetStartOffset, this.targetEndOffset);
		this.beforePreview.setText(value || "(Empty)");
	}

	private getBoundEditor(): MarkdownView["editor"] | null {
		let targetEditor: MarkdownView["editor"] | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === this.boundFilePath) {
				targetEditor = view.editor;
			}
		});
		return targetEditor;
	}

	private async runCanvas(): Promise<void> {
		if (this.running) return;
		const instruction = this.promptInput.value.trim();
		if (!instruction) {
			new Notice("Add an instruction first.");
			return;
		}
		if (!this.boundFilePath && !this.bindToActiveNote()) {
			return;
		}
		const editor = this.getBoundEditor();
		if (!editor) {
			new Notice("Open the bound note in an editor pane.");
			return;
		}

		this.refreshBeforePreview();
		const current = editor.getValue().slice(this.targetStartOffset, this.targetEndOffset);
		const selectedRuntime = this.getSelectedRuntime();
		const prompt = [
			instruction,
			"",
			"Rewrite the markdown below. Return only the replacement markdown with no explanation.",
			"",
			"Current markdown:",
			current,
		].join("\n");

		this.running = true;
		this.runBtn.disabled = true;
		this.runtimeModeSelect.disabled = true;
		this.directModelSelect.disabled = true;
		this.runBtn.setText("Generating...");
		this.output = "";
		this.outputPreview.empty();
		this.updateApplyButtonState();

		const onDelta = (delta: string) => {
			this.output += delta;
			void this.renderPreview();
			this.updateApplyButtonState();
		};

		try {
			const buildOptions = buildQueryOptionsFromRuntimeOption(selectedRuntime);
			const result = await this.client.query(prompt, {
				...buildOptions,
				model: this.scope === "selection" && selectedRuntime.transportMode === "websocket"
					? INLINE_REPLACEMENT_MODEL
					: buildOptions.model,
				onDelta,
			});
			if (!this.output.trim()) {
				this.output = result.text ?? "";
				await this.renderPreview();
				this.updateApplyButtonState();
			}
			this.refreshBindingState();
		} catch (e) {
			this.renderCanvasError((e as Error).message);
		} finally {
			this.running = false;
			this.runBtn.disabled = false;
			this.runtimeModeSelect.disabled = false;
			this.directModelSelect.disabled = false;
			this.runBtn.setText("Generate");
			this.updateApplyButtonState();
			this.refreshBeforePreview();
			this.refreshRuntimeHint();
		}
	}

	private getSelectedRuntime(): RuntimeModelOption {
		const mode = this.runtimeModeSelect?.value === "direct-model" ? "direct-model" : "codex-appserver";
		return resolveRuntimeFromMode(mode, this.directModelSelect?.value);
	}

	private refreshRuntimeHint(): void {
		const selected = this.getSelectedRuntime();
		this.runtimeHint.textContent = getRuntimeHintText(selected);
	}

	private renderCanvasError(message: string): void {
		const errorText = message || "Unknown error";
		this.outputPreview.empty();
		const errWrap = this.outputPreview.createDiv({ cls: "llm-block-error" });
		errWrap.createDiv({ text: `Error: ${errorText}` });
		const actionRow = errWrap.createDiv({ cls: "llm-block-error-actions" });

		const errorLower = errorText.toLowerCase();
		const addAction = (label: string, run: () => void) => {
			const b = actionRow.createEl("button", { text: label, cls: "llm-block-error-btn" });
			b.addEventListener("click", run);
		};

		if (errorLower.includes("not connected") || errorLower.includes("websocket") || errorLower.includes("connection")) {
			addAction("Reconnect", () => {
				this.client.disconnect();
				this.client.connect();
			});
		}

		if (errorLower.includes("unauthenticated") || errorLower.includes("not logged") || errorLower.includes("api key")) {
			addAction("Open settings", async () => {
				await this.app.setting.open();
			});
			addAction("Check API key", () => {
				new Notice("Paste a valid API key in plugin settings and retry.");
			});
		}

		if (errorLower.includes("balance") || errorLower.includes("billing")) {
			addAction("Provider balance issue", () => {
				new Notice("Open your provider billing page and confirm available credits.");
			});
		}

		if (actionRow.childElementCount === 0) {
			addAction("Open settings", async () => {
				await this.app.setting.open();
			});
		}
	}

	private applyOutputToEditor(): boolean {
		const editor = this.getBoundEditor();
		if (!editor) return false;
		const startPos = editor.offsetToPos(this.targetStartOffset);
		const endPos = editor.offsetToPos(this.targetEndOffset);
		editor.replaceRange(this.output, startPos, endPos);
		this.targetEndOffset = this.targetStartOffset + this.output.length;
		this.refreshBeforePreview();
		return true;
	}

	private updateApplyButtonState(): void {
		if (!this.applyBtn) return;
		this.applyBtn.disabled = this.running || !this.output.trim();
	}

	private async renderPreview(): Promise<void> {
		this.outputPreview.empty();
		await MarkdownRenderer.render(this.app, this.output, this.outputPreview, this.boundFilePath, this);
	}
}
