import { Plugin } from "obsidian";
import { AuthState, ConnectionState, DEFAULT_SETTINGS, LLMBlocksSettings } from "./types";
import { ResponseCache } from "./cache";
import { CodexWebSocketClient } from "./websocket-client";
import { LLMBlockRenderer } from "./renderer";
import { LLMBlocksSettingTab } from "./settings";
import { LLMCanvasModal } from "./canvas-modal";
import { MarkdownView, Notice } from "obsidian";
import { CANVAS_VIEW_TYPE, LLMCanvasSidebarView } from "./canvas-sidebar-view";
import { CopilotContextManager } from "./copilot-context";

export default class LLMBlocksPlugin extends Plugin {
	settings: LLMBlocksSettings = DEFAULT_SETTINGS;
	cache = new ResponseCache();
	wsClient!: CodexWebSocketClient;
	contextManager!: CopilotContextManager;
	private statusBarEl: HTMLElement | null = null;
	private settingsTab: LLMBlocksSettingTab | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.wsClient = new CodexWebSocketClient(this.settings);
		this.contextManager = new CopilotContextManager(this.app, () => this.settings);
		this.contextManager.initialize();
		this.registerView(CANVAS_VIEW_TYPE, (leaf) => new LLMCanvasSidebarView(leaf, this.wsClient, this.contextManager));

		// Status bar
		this.statusBarEl = this.addStatusBarItem();
		this.updateStatusBar("disconnected", "unchecked");

		this.wsClient.on("state-change", (state: ConnectionState) => {
			this.updateStatusBar(state, this.wsClient.authState);
		});

		this.wsClient.on("auth-change", (auth: AuthState) => {
			this.updateStatusBar(this.wsClient.connectionState, auth);
			// Refresh settings tab if open so login button appears/disappears
			this.settingsTab?.display();
		});

		this.wsClient.on("login-completed", (success: boolean) => {
			if (success) {
				this.settingsTab?.display();
			}
		});

		// Register the ```llm code block processor
		this.registerMarkdownCodeBlockProcessor("llm", (source, el, ctx) => {
			const renderer = new LLMBlockRenderer(
				this.app,
				el,
				source,
				this.cache,
				this.wsClient,
				this.contextManager,
				ctx.sourcePath,
			);
			ctx.addChild(renderer);
		});

		// Settings tab
		this.settingsTab = new LLMBlocksSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		// Commands
		this.addCommand({
			id: "llm-reconnect",
			name: "Reconnect to Codex server",
			callback: () => {
				this.wsClient.disconnect();
				this.wsClient.connect();
			},
		});

		this.addCommand({
			id: "llm-clear-cache",
			name: "Clear LLM response cache",
			callback: () => { this.cache.clear(); },
		});

		this.addCommand({
			id: "llm-open-canvas",
			name: "Open LLM Canvas",
			callback: () => { void this.openCanvasSidebar(); },
		});

		this.addCommand({
			id: "llm-open-canvas-modal",
			name: "Open LLM Canvas (Modal)",
			callback: () => { new LLMCanvasModal(this.app, this.wsClient, this.contextManager).open(); },
		});

		this.addCommand({
			id: "llm-quick-ask-selection",
			name: "Quick Ask Selection",
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const selection = view?.editor.getSelection().trim() ?? "";
				if (!view || !selection) {
					new Notice("Select markdown or code first, then run Quick Ask Selection.");
					return;
				}
				new LLMCanvasModal(this.app, this.wsClient, this.contextManager, {
					initialScope: "selection",
					inlineMode: true,
				}).open();
			},
		});

		this.addCommand({
			id: "llm-ask-active-note",
			name: "Ask Active Note",
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) {
					new Notice("Open a markdown note first.");
					return;
				}
				new LLMCanvasModal(this.app, this.wsClient, this.contextManager, {
					initialScope: "note",
				}).open();
			},
		});

		this.addCommand({
			id: "llm-inline-replace-selection",
			name: "Inline Replace Selection (Canvas)",
			callback: () => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				const selection = view?.editor.getSelection().trim() ?? "";
				if (!view || !selection) {
					new Notice("Select markdown/code first, then run Inline Replace Selection.");
					return;
				}
				void this.openCanvasSidebar();
			},
		});

		// Connect immediately; onLayoutReady acts as a safe retry hook.
		this.wsClient.connect();

		// Connect on layout ready (deferred)
		this.app.workspace.onLayoutReady(() => {
			this.wsClient.connect();
		});
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(CANVAS_VIEW_TYPE);
		this.contextManager.cleanup();
		this.wsClient.disconnect();
	}

	private async openCanvasSidebar(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(CANVAS_VIEW_TYPE)[0] ?? null;
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("split");
		}
		await leaf.setViewState({
			type: CANVAS_VIEW_TYPE,
			active: true,
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const loaded = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		const normalizedEndpoint = this.normalizeEndpoint(loaded.wsEndpoint);
		this.settings = { ...loaded, wsEndpoint: normalizedEndpoint };
		if (normalizedEndpoint !== loaded.wsEndpoint) {
			await this.saveData(this.settings);
		}
	}

	async saveSettings(): Promise<void> {
		const previous = this.settings;
		await this.saveData(this.settings);
		if (this.shouldRefreshTransport(previous, this.settings)) {
			this.wsClient.updateSettings(this.settings);
		}
	}

	private shouldRefreshTransport(previous: LLMBlocksSettings, next: LLMBlocksSettings): boolean {
		return previous.wsEndpoint !== next.wsEndpoint
			|| previous.transportMode !== next.transportMode
			|| previous.model !== next.model
			|| previous.provider !== next.provider
			|| previous.baseUrl !== next.baseUrl
			|| previous.maxOutputTokens !== next.maxOutputTokens
			|| previous.apiKey !== next.apiKey
			|| previous.activeModelId !== next.activeModelId
			|| previous.customModelsJson !== next.customModelsJson
			|| JSON.stringify(previous.providerApiKeys ?? {}) !== JSON.stringify(next.providerApiKeys ?? {});
	}

	private updateStatusBar(state: ConnectionState, auth: AuthState): void {
		if (!this.statusBarEl) return;
		const icon =
			state !== "connected" ? (state === "connecting" ? "\u{1F7E1}" : state === "error" ? "\u{1F534}" : "\u26AA") :
			auth === "authenticated" ? "\u{1F7E2}" :
			auth === "unauthenticated" ? "\u{1F534}" :
			"\u{1F7E1}";
		const label = state !== "connected" ? state : auth === "authenticated" ? "ready" : "login required";
		this.statusBarEl.setText(`${icon} LLM ${label}`);
		const err = this.wsClient?.lastErrorMessage ? `, err=${this.wsClient.lastErrorMessage}` : "";
		this.statusBarEl.setAttribute("title", `LLM Blocks: ${label} (state=${state}, auth=${auth}${err})`);
	}

	private normalizeEndpoint(endpoint: string): string {
		const trimmed = endpoint.trim();
		if (!trimmed) return DEFAULT_SETTINGS.wsEndpoint;
		if (/^ws:\/\/(127\.0\.0\.1|localhost):9001\/?$/i.test(trimmed)) {
			return "ws://127.0.0.1:4500";
		}
		return trimmed;
	}
}
