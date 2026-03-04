import { ItemView, MarkdownRenderer, MarkdownView, Notice, WorkspaceLeaf } from "obsidian";
import { CodexWebSocketClient } from "./websocket-client";

export const CANVAS_VIEW_TYPE = "llm-canvas-view";
const INLINE_REPLACEMENT_MODEL = "gemini-3.1-flash-lite-preview";

type ReplaceScope = "selection" | "note";

export class LLMCanvasSidebarView extends ItemView {
	private promptInput!: HTMLInputElement;
	private runBtn!: HTMLButtonElement;
	private applyBtn!: HTMLButtonElement;
	private outputPreview!: HTMLElement;
	private beforePreview!: HTMLElement;
	private fileBadge!: HTMLElement;
	private scopeBadge!: HTMLElement;

	private boundFilePath = "";
	private scope: ReplaceScope = "selection";
	private targetStartOffset = 0;
	private targetEndOffset = 0;
	private output = "";
	private running = false;
	private activeDeltaHandler: ((delta: string) => void) | null = null;

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

	async onOpen(): Promise<void> {
		this.buildUi();
		this.bindToActiveNote();
	}

	async onClose(): Promise<void> {
		if (this.activeDeltaHandler) {
			this.client.off("delta", this.activeDeltaHandler);
			this.activeDeltaHandler = null;
		}
	}

	private buildUi(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("llm-canvas", "llm-canvas-inline", "llm-canvas-docked");

		const top = contentEl.createDiv({ cls: "llm-canvas-inline-top" });
		top.createEl("h2", { text: "Canvas" }).addClass("llm-canvas-inline-title");
		const bindBtn = top.createEl("button", { text: "Bind Current Note" });
		bindBtn.addEventListener("click", () => this.bindToActiveNote());

		const meta = contentEl.createDiv({ cls: "llm-canvas-inline-meta" });
		this.fileBadge = meta.createSpan({ text: "No note bound" });
		this.scopeBadge = meta.createSpan({ text: "Scope: selection" });

		const quickRow = contentEl.createDiv({ cls: "llm-canvas-quick-actions" });
		this.addQuickAction(quickRow, "Fix", "Fix bugs and improve correctness in this selection.");
		this.addQuickAction(quickRow, "Rewrite", "Rewrite this content for clarity while preserving meaning.");
		this.addQuickAction(quickRow, "Explain", "Explain this content simply and clearly.");

		const diff = contentEl.createDiv({ cls: "llm-canvas-inline-diff" });
		const before = diff.createDiv({ cls: "llm-canvas-inline-panel" });
		before.createDiv({ cls: "llm-canvas-label", text: "Before" });
		this.beforePreview = before.createEl("pre", { cls: "llm-canvas-inline-editor" });

		const after = diff.createDiv({ cls: "llm-canvas-inline-panel" });
		after.createDiv({ cls: "llm-canvas-label", text: "After" });
		this.outputPreview = after.createDiv({ cls: "llm-canvas-preview markdown-rendered" });

		const bar = contentEl.createDiv({ cls: "llm-canvas-inline-bar" });
		const addBtn = bar.createEl("button", { cls: "llm-canvas-inline-icon", text: "+" });
		addBtn.addEventListener("click", () => this.promptInput.focus());
		this.promptInput = bar.createEl("input", {
			cls: "llm-canvas-inline-input",
			type: "text",
			placeholder: "Ask anything about this selection...",
		});
		this.runBtn = bar.createEl("button", { cls: "llm-canvas-inline-send", text: "Send" });
		this.applyBtn = bar.createEl("button", { cls: "llm-canvas-inline-send llm-canvas-inline-apply", text: "Apply" });

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

	private bindToActiveNote(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) {
			new Notice("Open a markdown note first.");
			return;
		}
		this.boundFilePath = view.file.path;
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
		this.fileBadge.setText(view.file.basename);
		this.scopeBadge.setText(`Scope: ${this.scope}`);
		this.refreshBeforePreview();
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
		if (!this.boundFilePath) {
			this.bindToActiveNote();
		}
		const editor = this.getBoundEditor();
		if (!editor) {
			new Notice("Open the bound note in an editor pane.");
			return;
		}

		this.refreshBeforePreview();
		const current = editor.getValue().slice(this.targetStartOffset, this.targetEndOffset);
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
		this.runBtn.setText("Sending...");
		this.output = "";
		this.outputPreview.empty();

		const onDelta = (delta: string) => {
			this.output += delta;
			void this.renderPreview();
			this.applyOutputToEditor(); // real-time apply in canvas mode
		};

		try {
			this.activeDeltaHandler = onDelta;
			this.client.on("delta", onDelta);
			const result = await this.client.query(prompt, {
				model: this.scope === "selection" ? INLINE_REPLACEMENT_MODEL : undefined,
			});
			if (!this.output.trim()) {
				this.output = result.text ?? "";
				await this.renderPreview();
				this.applyOutputToEditor();
			}
		} catch (e) {
			new Notice(`Canvas generation failed: ${(e as Error).message}`);
		} finally {
			if (this.activeDeltaHandler) {
				this.client.off("delta", this.activeDeltaHandler);
				this.activeDeltaHandler = null;
			}
			this.running = false;
			this.runBtn.disabled = false;
			this.runBtn.setText("Send");
			this.refreshBeforePreview();
		}
	}

	private applyOutputToEditor(): boolean {
		const editor = this.getBoundEditor();
		if (!editor) return false;
		const startPos = editor.offsetToPos(this.targetStartOffset);
		const endPos = editor.offsetToPos(this.targetEndOffset);
		editor.replaceRange(this.output, startPos, endPos);
		this.targetEndOffset = this.targetStartOffset + this.output.length;
		return true;
	}

	private async renderPreview(): Promise<void> {
		this.outputPreview.empty();
		await MarkdownRenderer.render(this.app, this.output, this.outputPreview, this.boundFilePath, this);
	}
}

