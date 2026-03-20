import { App, MarkdownRenderChild, MarkdownRenderer, Notice, Component } from "obsidian";
import { ResponseCache } from "./cache";
import { CodexWebSocketClient } from "./websocket-client";
import type { QueryOptions, QueryResult } from "./types";
import { CopilotContextManager } from "./copilot-context";
import {
	buildQueryOptionsFromRuntimeOption,
	DIRECT_RUNTIME_OPTIONS,
	getRuntimeHintText,
	RUNTIME_MODE_OPTIONS,
	resolveRuntimeFromMode,
	type RuntimeModelOption,
} from "./model-options";

export class LLMBlockRenderer extends MarkdownRenderChild {
	private static sharedThreadBySourcePath = new Map<string, string>();
	private app: App;
	private prompt: string;
	private cache: ResponseCache;
	private client: CodexWebSocketClient;
	private sourcePath: string;
	private hasRun = false;
	private running = false;
	private threadId: string | null = null;
	private transcriptMarkdown = "";
	private runtimeModeSelect!: HTMLSelectElement;
	private directModelSelect!: HTMLSelectElement;
	private runBtn!: HTMLButtonElement;
	private runtimeHintEl!: HTMLElement;
	private contextHintEl!: HTMLElement;
	private readonly availableModels: RuntimeModelOption[] = DIRECT_RUNTIME_OPTIONS;

	constructor(
		app: App,
		containerEl: HTMLElement,
		prompt: string,
		cache: ResponseCache,
		client: CodexWebSocketClient,
		private readonly contextManager: CopilotContextManager,
		sourcePath: string,
	) {
		super(containerEl);
		this.app = app;
		this.prompt = prompt.trim();
		this.cache = cache;
		this.client = client;
		this.sourcePath = sourcePath;
	}

	async onload(): Promise<void> {
		await this.render();
	}

	private async render(): Promise<void> {
		const el = this.containerEl;
		el.empty();
		el.addClass("llm-block");

		const header = el.createDiv({ cls: "llm-block-header" });
		header.createSpan({ cls: "llm-block-label", text: "Prompt chain" });
		const headerActions = header.createDiv({ cls: "llm-block-header-actions" });

		const modeWrap = headerActions.createDiv({ cls: "llm-canvas-option" });
		modeWrap.createSpan({ cls: "llm-control-label", text: "Runtime" });
		this.runtimeModeSelect = modeWrap.createEl("select", { cls: "llm-runtime-mode-select" });
		for (const option of RUNTIME_MODE_OPTIONS) {
			this.runtimeModeSelect.createEl("option", { value: option.value, text: option.label });
		}

		const directWrap = headerActions.createDiv({ cls: "llm-canvas-option llm-runtime-direct-wrap" });
		directWrap.createSpan({ cls: "llm-control-label", text: "Preset" });
		this.directModelSelect = directWrap.createEl("select", { cls: "llm-block-model-select" });
		for (const option of this.availableModels) {
			this.directModelSelect.createEl("option", { value: option.id, text: option.label });
		}

		this.runtimeHintEl = modeWrap.createDiv({ cls: "llm-canvas-runtime-hint" });
		this.contextHintEl = header.createDiv({ cls: "llm-canvas-runtime-hint" });

		const preferredId = this.client.getPreferredRuntimeModelOptionId();
		if (this.isCodexRuntime(preferredId)) {
			this.runtimeModeSelect.value = "codex-appserver";
		} else {
			this.runtimeModeSelect.value = "direct-model";
			this.directModelSelect.value = preferredId;
		}

		const updateRuntimeSelection = (): void => {
			if (this.runtimeModeSelect.value === "direct-model") {
				directWrap.style.display = "inline-flex";
			} else {
				directWrap.style.display = "none";
			}
			if (!this.running) {
				void this.syncCachedResponse();
			}
			this.syncRuntimeHint();
			this.syncContextHint();
		};
		this.runtimeModeSelect.addEventListener("change", updateRuntimeSelection);
		this.directModelSelect.addEventListener("change", () => {
			if (!this.running) {
				void this.syncCachedResponse();
			}
			this.syncRuntimeHint();
			this.syncContextHint();
		});
		updateRuntimeSelection();

		this.runBtn = headerActions.createEl("button", {
			cls: "llm-block-run-btn",
			text: "Start",
		});
		this.runBtn.addEventListener("click", () => this.runPrimaryPrompt());

		const promptEl = el.createDiv({ cls: "llm-block-prompt" });
		promptEl.createEl("pre", { text: this.prompt });

		this.syncRuntimeHint();
		this.syncContextHint();
		await this.syncCachedResponse();
	}

	private async runPrimaryPrompt(): Promise<void> {
		this.threadId = null;
		LLMBlockRenderer.sharedThreadBySourcePath.delete(this.sourcePath);
		await this.executePrompt(this.prompt, false);
	}

	private async runFollowupPrompt(prompt: string): Promise<void> {
		await this.executePrompt(prompt, true);
	}

	private async executePrompt(prompt: string, append: boolean): Promise<void> {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) return;
		if (this.running) return;
		this.running = true;

		const el = this.containerEl;
		const oldError = el.querySelector(".llm-block-error");
		if (oldError) oldError.remove();

		const btn = this.runBtn;
		const addBtn = el.querySelector(".llm-followup-add-btn") as HTMLButtonElement | null;
		const sendBtn = el.querySelector(".llm-followup-send-btn") as HTMLButtonElement | null;
		const cancelBtn = el.querySelector(".llm-followup-cancel-btn") as HTMLButtonElement | null;
		const input = el.querySelector(".llm-followup-input") as HTMLTextAreaElement | null;
		if (btn) {
			btn.disabled = true;
			btn.setText("Running...");
		}
		if (addBtn) addBtn.disabled = true;
		if (sendBtn) sendBtn.disabled = true;
		if (cancelBtn) cancelBtn.disabled = true;
		this.runtimeModeSelect.disabled = true;
		this.directModelSelect.disabled = true;
		if (input) input.disabled = true;

		if (!append) {
			const oldResponse = el.querySelector(".llm-block-response");
			if (oldResponse) oldResponse.remove();
			this.transcriptMarkdown = "";
		}

		const spinner = el.createDiv({ cls: "llm-block-spinner" });
		spinner.createSpan({ text: "Querying..." });

		try {
			if (!this.threadId) {
				const sharedThread = LLMBlockRenderer.sharedThreadBySourcePath.get(this.sourcePath);
				if (sharedThread) this.threadId = sharedThread;
			}

			const selectedRuntime = this.getSelectedRuntime();
			const promptWithContext = await this.contextManager.buildPromptWithContext(trimmedPrompt);
			const queryOptions: QueryOptions = {
				...buildQueryOptionsFromRuntimeOption(selectedRuntime),
			};
			if (this.threadId) {
				queryOptions.threadId = this.threadId;
			}
			const result = await this.client.query(promptWithContext, queryOptions);
			const resolvedThreadId = (result.threadId ?? this.threadId ?? "").trim();
			if (resolvedThreadId) {
				this.threadId = resolvedThreadId;
				LLMBlockRenderer.sharedThreadBySourcePath.set(this.sourcePath, resolvedThreadId);
			}

			const turnMarkdown = this.formatTurn(trimmedPrompt, result);
			this.transcriptMarkdown = append && this.transcriptMarkdown
				? `${this.transcriptMarkdown}\n\n---\n\n${turnMarkdown}`
				: turnMarkdown;
			await this.cache.set(this.prompt, this.transcriptMarkdown, this.getRuntimeCacheVariant());

			spinner.remove();
			this.hasRun = true;
			const oldResponse = el.querySelector(".llm-block-response");
			if (oldResponse) oldResponse.remove();
			this.renderResponse(el, this.transcriptMarkdown);

			if (btn) {
				btn.disabled = false;
				btn.setText("Refresh");
			}
		} catch (e) {
			spinner.remove();
			this.renderError((e as Error).message, el);
			if (btn) {
				btn.disabled = false;
				btn.setText(this.hasRun ? "Refresh" : "Start");
			}
		} finally {
			if (addBtn) addBtn.disabled = false;
			if (sendBtn) sendBtn.disabled = false;
			if (cancelBtn) cancelBtn.disabled = false;
			this.runtimeModeSelect.disabled = false;
			this.directModelSelect.disabled = false;
			if (input) input.disabled = false;
			this.running = false;
		}
	}

	private getSelectedRuntime(): RuntimeModelOption {
		const mode = this.runtimeModeSelect?.value === "direct-model" ? "direct-model" : "codex-appserver";
		return resolveRuntimeFromMode(mode, this.directModelSelect?.value);
	}

	private syncRuntimeHint(): void {
		if (this.runtimeHintEl) {
			this.runtimeHintEl.textContent = getRuntimeHintText(this.getSelectedRuntime());
		}
	}

	private syncContextHint(): void {
		if (!this.contextHintEl) return;
		const summary = this.contextManager.getAttachedContextSummary();
		const retrieved = this.contextManager.getLastVaultAttachmentSummary();
		const parts = [summary, retrieved].filter((part) => !!part);
		this.contextHintEl.textContent = parts.length > 0 ? `Context: ${parts.join(" | ")}` : "Context: prompt only";
	}

	private getRuntimeCacheVariant(): string {
		const selected = this.getSelectedRuntime();
		return JSON.stringify({
			runtimeId: selected.id,
			transportMode: selected.transportMode,
			provider: selected.provider ?? "",
			baseUrl: selected.baseUrl ?? "",
			model: selected.model ?? "",
			context: this.contextManager.getCacheVariant(),
		});
	}

	private isCodexRuntime(id: string): id is "codex-appserver" {
		return id === "codex-appserver";
	}

	private renderError(rawMessage: string, container: HTMLElement): void {
		const message = rawMessage || "Unknown error";
		const errDiv = container.createDiv({ cls: "llm-block-error" });
		const errSummary = errDiv.createDiv({ cls: "llm-block-error-summary" });
		errSummary.createSpan({ text: `Error: ${message}` });

		const actionWrappers = errDiv.createDiv({ cls: "llm-block-error-actions" });
		for (const action of this.buildErrorActions(message)) {
			const button = actionWrappers.createEl("button", {
				text: action.label,
				cls: "llm-block-error-btn",
			});
			button.addEventListener("click", () => {
				void action.run();
			});
		}
		const details = errDiv.createDiv({ cls: "llm-block-error-detail", text: `Raw: ${message}` });
		if (this.runBtn) {
			this.runBtn.disabled = false;
			this.runBtn.setText(this.hasRun ? "Refresh" : "Start");
		}
	}

	private buildErrorActions(message: string): Array<{ label: string; run: () => Promise<void> | void }> {
		const low = (message || "").toLowerCase();
		const actions: Array<{ label: string; run: () => Promise<void> | void }> = [];

		if (low.includes("not logged in") || low.includes("unauthenticated") || low.includes("api key")) {
			actions.push({
				label: "Open settings",
				run: async () => {
					await this.app.setting.open();
				},
			});
			actions.push({
				label: "Check API key",
				run: () => {
					new Notice("Paste a valid key in plugin settings and retry.");
				},
			});
		}

		if (low.includes("not connected") || low.includes("websocket") || low.includes("connection") || low.includes("ws")) {
			actions.push({
				label: "Reconnect",
				run: () => {
					this.client.disconnect();
					this.client.connect();
				},
			});
		}

		if (low.includes("insufficient") || low.includes("balance") || low.includes("billing")) {
			actions.push({
				label: "Provider balance issue",
				run: () => {
					new Notice("Open provider console and confirm billing status before retrying.");
				},
			});
		}

		if (actions.length === 0) {
			actions.push({
				label: "Open settings",
				run: async () => {
					await this.app.setting.open();
				},
			});
		}

		return actions;
	}

	private async syncCachedResponse(): Promise<void> {
		let cached = undefined;
		try {
			cached = await this.cache.get(this.prompt, this.getRuntimeCacheVariant());
		} catch (error) {
			console.warn("LLM Blocks: failed to read cached response", error);
		}

		const existingResponse = this.containerEl.querySelector(".llm-block-response");
		if (existingResponse) {
			existingResponse.remove();
		}

		if (cached) {
			this.hasRun = true;
			this.transcriptMarkdown = cached.markdown;
			this.runBtn?.setText("Refresh");
			this.renderResponse(this.containerEl, this.transcriptMarkdown);
			return;
		}

		this.hasRun = false;
		this.transcriptMarkdown = "";
		this.runBtn?.setText("Start");
	}

	private formatTurn(userPrompt: string, result: QueryResult): string {
		const model = (result.model || "server default").trim();
		const answer = result.text ?? "";
		return `**User:** ${userPrompt}\n\n**Assistant (${model}):**\n\n${answer}`;
	}

	private renderResponse(container: HTMLElement, markdown: string): void {
		const details = container.createEl("details", { cls: "llm-block-response" });
		details.setAttribute("open", "");

		const summary = details.createEl("summary");
		summary.createSpan({ text: "Response" });

		const content = details.createDiv({ cls: "llm-block-content" });
		MarkdownRenderer.render(
			this.app,
			markdown,
			content,
			this.sourcePath,
			this as Component,
		);

		const followup = details.createDiv({ cls: "llm-followup" });
		const addBtn = followup.createEl("button", {
			cls: "llm-followup-add-btn",
			text: "+ Add prompt",
		});

		const composer = followup.createDiv({ cls: "llm-followup-composer" });
		composer.style.display = "none";

		const input = composer.createEl("textarea", {
			cls: "llm-followup-input",
			placeholder: "Add the next user prompt in this chain...",
		});
		input.rows = 3;

		const actions = composer.createDiv({ cls: "llm-followup-actions" });
		const sendBtn = actions.createEl("button", {
			cls: "llm-followup-send-btn",
			text: "Send",
		});
		const cancelBtn = actions.createEl("button", {
			cls: "llm-followup-cancel-btn",
			text: "Cancel",
		});

		addBtn.addEventListener("click", () => {
			composer.style.display = "block";
			addBtn.style.display = "none";
			input.focus();
		});

		cancelBtn.addEventListener("click", () => {
			input.value = "";
			composer.style.display = "none";
			addBtn.style.display = "inline-flex";
		});

		const submit = async () => {
			const value = input.value.trim();
			if (!value) return;
			composer.style.display = "none";
			addBtn.style.display = "inline-flex";
			input.value = "";
			await this.runFollowupPrompt(value);
		};

		sendBtn.addEventListener("click", () => {
			void submit();
		});
		input.addEventListener("keydown", (evt) => {
			if ((evt.ctrlKey || evt.metaKey) && evt.key === "Enter") {
				evt.preventDefault();
				void submit();
			}
		});
	}
}
