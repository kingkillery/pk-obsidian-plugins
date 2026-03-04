import { App, EditorPosition, MarkdownRenderer, MarkdownView, Modal, Notice } from "obsidian";
import { CodexWebSocketClient } from "./websocket-client";

type ReplaceScope = "selection" | "note";
const INLINE_REPLACEMENT_MODEL = "gemini-3.1-flash-lite-preview";
interface LLMCanvasModalOptions {
	initialScope?: ReplaceScope;
	inlineMode?: boolean;
}

export class LLMCanvasModal extends Modal {
	private promptInput!: HTMLTextAreaElement | HTMLInputElement;
	private outputPreview!: HTMLElement;
	private outputRaw!: HTMLTextAreaElement;
	private runBtn!: HTMLButtonElement;
	private applyBtn!: HTMLButtonElement;
	private liveApplyToggle!: HTMLInputElement;
	private scopeSelect!: HTMLSelectElement;
	private running = false;
	private output = "";
	private targetStartOffset = 0;
	private targetEndOffset = 0;
	private sourcePath = "";
	private readonly options: LLMCanvasModalOptions;

	constructor(app: App, private client: CodexWebSocketClient, options?: LLMCanvasModalOptions) {
		super(app);
		this.options = options ?? {};
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("llm-canvas");
		if (this.options.inlineMode) return this.renderInlineMode(contentEl);
		this.renderStandardMode(contentEl);
	}

	private renderStandardMode(contentEl: HTMLElement): void {
		contentEl.createEl("h2", { text: "LLM Canvas" });

		const controls = contentEl.createDiv({ cls: "llm-canvas-controls" });

		const promptLabel = controls.createEl("label", { text: "Instruction" });
		promptLabel.addClass("llm-canvas-label");
		this.promptInput = controls.createEl("textarea", {
			cls: "llm-canvas-prompt",
			placeholder: "Describe how to rewrite the selected markdown/code...",
		});
		this.promptInput.rows = 5;

		const optionsRow = controls.createDiv({ cls: "llm-canvas-options" });

		const scopeWrap = optionsRow.createDiv({ cls: "llm-canvas-option" });
		scopeWrap.createSpan({ text: "Replace scope" });
		this.scopeSelect = scopeWrap.createEl("select");
		this.scopeSelect.createEl("option", { value: "selection", text: "Selection" });
		this.scopeSelect.createEl("option", { value: "note", text: "Whole note" });
		this.scopeSelect.value = this.options.initialScope ?? "selection";

		const liveWrap = optionsRow.createDiv({ cls: "llm-canvas-option" });
		this.liveApplyToggle = liveWrap.createEl("input", { type: "checkbox" });
		liveWrap.createSpan({ text: "Live apply while generating" });

		const buttonRow = controls.createDiv({ cls: "llm-canvas-actions" });
		this.runBtn = buttonRow.createEl("button", { text: "Generate" });
		this.runBtn.addClass("mod-cta");
		this.applyBtn = buttonRow.createEl("button", { text: "Apply output" });
		const closeBtn = buttonRow.createEl("button", { text: "Close" });
		closeBtn.addEventListener("click", () => this.close());

		const outputWrap = contentEl.createDiv({ cls: "llm-canvas-output-wrap" });
		const outputTitle = outputWrap.createEl("div", { text: "Output (Markdown Preview)" });
		outputTitle.addClass("llm-canvas-label");
		this.outputPreview = outputWrap.createDiv({ cls: "llm-canvas-preview markdown-rendered" });

		const rawWrap = contentEl.createDiv({ cls: "llm-canvas-output-wrap" });
		const rawTitle = rawWrap.createEl("div", { text: "Output (Raw Markdown)" });
		rawTitle.addClass("llm-canvas-label");
		this.outputRaw = rawWrap.createEl("textarea", { cls: "llm-canvas-raw" });
		this.outputRaw.rows = 10;
		this.outputRaw.addEventListener("input", () => {
			this.output = this.outputRaw.value;
			void this.renderPreview();
		});

		this.runBtn.addEventListener("click", () => {
			void this.runCanvas();
		});

		this.applyBtn.addEventListener("click", () => {
			if (!this.output.trim()) return;
			if (!this.applyOutputToEditor()) {
				new Notice("No active markdown editor to apply output.");
				return;
			}
			new Notice("Canvas output applied.");
		});
	}

	private renderInlineMode(contentEl: HTMLElement): void {
		contentEl.addClass("llm-canvas-inline");
		const context = this.getScopeAndSource("selection");
		const selected = context?.source ?? "";

		const top = contentEl.createDiv({ cls: "llm-canvas-inline-top" });
		const topTitle = top.createEl("h2", { text: "Canvas" });
		topTitle.addClass("llm-canvas-inline-title");
		const closeBtn = top.createEl("button", { text: "Close" });
		closeBtn.addEventListener("click", () => this.close());

		const quickRow = contentEl.createDiv({ cls: "llm-canvas-quick-actions" });
		this.addQuickAction(quickRow, "Fix", "Fix bugs and improve correctness in this selection.");
		this.addQuickAction(quickRow, "Rewrite", "Rewrite this content for clarity while preserving meaning.");
		this.addQuickAction(quickRow, "Explain", "Explain this content simply and clearly.");

		const diff = contentEl.createDiv({ cls: "llm-canvas-inline-diff" });
		const before = diff.createDiv({ cls: "llm-canvas-inline-panel" });
		before.createDiv({ cls: "llm-canvas-label", text: "Before" });
		const beforePreview = before.createEl("pre", { cls: "llm-canvas-inline-editor" });
		beforePreview.setText(selected || "(No selection)");

		const after = diff.createDiv({ cls: "llm-canvas-inline-panel" });
		after.createDiv({ cls: "llm-canvas-label", text: "After" });
		this.outputPreview = after.createDiv({ cls: "llm-canvas-preview markdown-rendered" });

		// Hidden raw editor for compatibility with existing generation flow.
		this.outputRaw = contentEl.createEl("textarea");
		this.outputRaw.style.display = "none";

		const bar = contentEl.createDiv({ cls: "llm-canvas-inline-bar" });
		const addBtn = bar.createEl("button", { cls: "llm-canvas-inline-icon", text: "+" });
		addBtn.addEventListener("click", () => {
			this.promptInput.focus();
		});
		this.promptInput = bar.createEl("input", {
			cls: "llm-canvas-inline-input",
			type: "text",
			placeholder: "Ask anything about this selection...",
		});
		this.runBtn = bar.createEl("button", { cls: "llm-canvas-inline-send", text: "Send" });
		this.applyBtn = bar.createEl("button", { cls: "llm-canvas-inline-send llm-canvas-inline-apply", text: "Apply" });

		this.scopeSelect = contentEl.createEl("select");
		this.scopeSelect.style.display = "none";
		this.scopeSelect.createEl("option", { value: "selection", text: "Selection" });
		this.scopeSelect.value = "selection";
		this.liveApplyToggle = contentEl.createEl("input", { type: "checkbox" });
		this.liveApplyToggle.style.display = "none";
		this.liveApplyToggle.checked = true;

		this.runBtn.addEventListener("click", () => {
			void this.runCanvas();
		});
		this.promptInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void this.runCanvas();
			}
		});
		this.applyBtn.addEventListener("click", () => {
			if (!this.output.trim()) return;
			if (!this.applyOutputToEditor()) {
				new Notice("No active markdown editor to apply output.");
				return;
			}
			new Notice("Canvas output applied.");
		});
	}

	private addQuickAction(container: HTMLElement, label: string, instruction: string): void {
		const btn = container.createEl("button", {
			cls: "llm-canvas-chip",
			text: label,
		});
		btn.addEventListener("click", () => {
			this.promptInput.value = instruction;
			this.promptInput.focus();
		});
	}

	private getActiveMarkdownView(): MarkdownView | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView);
	}

	private getScopeAndSource(scopePref: ReplaceScope): { scope: ReplaceScope; source: string } | null {
		const view = this.getActiveMarkdownView();
		if (!view) return null;
		const editor = view.editor;
		const selected = editor.getSelection();
		if (scopePref === "selection" && selected.trim()) {
			return { scope: "selection", source: selected };
		}
		if (scopePref === "selection" && !selected.trim()) {
			return { scope: "note", source: editor.getValue() };
		}
		return { scope: "note", source: editor.getValue() };
	}

	private captureTargetRange(scope: ReplaceScope): boolean {
		const view = this.getActiveMarkdownView();
		if (!view) return false;
		const editor = view.editor;

		if (scope === "selection") {
			const from = editor.getCursor("from");
			const to = editor.getCursor("to");
			this.targetStartOffset = editor.posToOffset(from);
			this.targetEndOffset = editor.posToOffset(to);
			return true;
		}

		this.targetStartOffset = 0;
		this.targetEndOffset = editor.getValue().length;
		return true;
	}

	private buildPrompt(instruction: string, currentMarkdown: string): string {
		return [
			instruction.trim(),
			"",
			"Rewrite the markdown below. Return only the replacement markdown with no explanation.",
			"",
			"Current markdown:",
			currentMarkdown,
		].join("\n");
	}

	private async runCanvas(): Promise<void> {
		if (this.running) return;
		const instruction = this.promptInput.value.trim();
		if (!instruction) {
			new Notice("Add an instruction first.");
			return;
		}

		const scope = (this.scopeSelect.value as ReplaceScope) || "selection";
		const context = this.getScopeAndSource(scope);
		if (!context) {
			new Notice("No active markdown editor.");
			return;
		}
		if (!this.captureTargetRange(context.scope)) {
			new Notice("Could not capture editor range.");
			return;
		}

		this.running = true;
		this.runBtn.disabled = true;
		this.runBtn.setText(this.options.inlineMode ? "Sending..." : "Generating...");
		this.output = "";
		this.outputRaw.value = "";
		this.outputPreview.empty();

		const prompt = this.buildPrompt(instruction, context.source);
		const onDelta = (delta: string) => {
			this.output += delta;
			this.outputRaw.value = this.output;
			void this.renderPreview();
			if (this.liveApplyToggle.checked) {
				this.applyOutputToEditor();
			}
		};

		try {
			this.client.on("delta", onDelta);
			const result = await this.client.query(prompt, {
				model: context.scope === "selection" ? INLINE_REPLACEMENT_MODEL : undefined,
			});
			if (!this.output.trim()) {
				this.output = result.text ?? "";
				this.outputRaw.value = this.output;
			}
			await this.renderPreview();
		} catch (e) {
			new Notice(`Canvas generation failed: ${(e as Error).message}`);
		} finally {
			this.client.off("delta", onDelta);
			this.running = false;
			this.runBtn.disabled = false;
			this.runBtn.setText(this.options.inlineMode ? "Send" : "Generate");
		}
	}

	private applyOutputToEditor(): boolean {
		const view = this.getActiveMarkdownView();
		if (!view) return false;
		const editor = view.editor;
		const startPos: EditorPosition = editor.offsetToPos(this.targetStartOffset);
		const endPos: EditorPosition = editor.offsetToPos(this.targetEndOffset);
		editor.replaceRange(this.output, startPos, endPos);
		this.targetEndOffset = this.targetStartOffset + this.output.length;
		this.sourcePath = view.file?.path ?? "";
		return true;
	}

	private async renderPreview(): Promise<void> {
		this.outputPreview.empty();
		await MarkdownRenderer.render(this.app, this.output, this.outputPreview, this.sourcePath, this);
	}
}
