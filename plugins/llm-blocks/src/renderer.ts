import { App, MarkdownRenderChild, MarkdownRenderer, Component } from "obsidian";
import { ResponseCache } from "./cache";
import { CodexWebSocketClient } from "./websocket-client";
import type { QueryResult } from "./types";

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

	constructor(
		app: App,
		containerEl: HTMLElement,
		prompt: string,
		cache: ResponseCache,
		client: CodexWebSocketClient,
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

		// Header bar with prompt label + button
		const header = el.createDiv({ cls: "llm-block-header" });
		header.createSpan({ cls: "llm-block-label", text: "LLM Prompt" });

		const cached = await this.cache.get(this.prompt);

		const btn = header.createEl("button", {
			cls: "llm-block-run-btn",
			text: cached ? "Refresh" : "Run",
		});
		btn.addEventListener("click", () => this.runPrimaryPrompt());

		// Prompt display
		const promptEl = el.createDiv({ cls: "llm-block-prompt" });
		promptEl.createEl("pre", { text: this.prompt });

		// Response area
		if (cached) {
			this.hasRun = true;
			this.transcriptMarkdown = cached.markdown;
			this.renderResponse(el, this.transcriptMarkdown);
		}
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

		// Update button state
		const btn = el.querySelector(".llm-block-run-btn") as HTMLButtonElement | null;
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
		if (input) input.disabled = true;

		if (!append) {
			const oldResponse = el.querySelector(".llm-block-response");
			if (oldResponse) oldResponse.remove();
			this.transcriptMarkdown = "";
		}

		// Show spinner
		const spinner = el.createDiv({ cls: "llm-block-spinner" });
		spinner.createSpan({ text: "Querying..." });

		try {
			if (!this.threadId) {
				const sharedThread = LLMBlockRenderer.sharedThreadBySourcePath.get(this.sourcePath);
				if (sharedThread) this.threadId = sharedThread;
			}

			const result = await this.client.query(trimmedPrompt, this.threadId ? { threadId: this.threadId } : undefined);
			const resolvedThreadId = (result.threadId ?? this.threadId ?? "").trim();
			if (resolvedThreadId) {
				this.threadId = resolvedThreadId;
				LLMBlockRenderer.sharedThreadBySourcePath.set(this.sourcePath, resolvedThreadId);
			}

			const turnMarkdown = this.formatTurn(trimmedPrompt, result);
			this.transcriptMarkdown =
				append && this.transcriptMarkdown
					? `${this.transcriptMarkdown}\n\n---\n\n${turnMarkdown}`
					: turnMarkdown;
			await this.cache.set(this.prompt, this.transcriptMarkdown);

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
			const errDiv = el.createDiv({ cls: "llm-block-error" });
			errDiv.createSpan({ text: `Error: ${(e as Error).message}` });

			if (btn) {
				btn.disabled = false;
				btn.setText(this.hasRun ? "Refresh" : "Run");
			}
		} finally {
			if (addBtn) addBtn.disabled = false;
			if (sendBtn) sendBtn.disabled = false;
			if (cancelBtn) cancelBtn.disabled = false;
			if (input) input.disabled = false;
			this.running = false;
		}
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

		// Use Obsidian's markdown renderer for full rendering (wikilinks, callouts, etc.)
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
