import { Plugin } from "obsidian";
import { AuthState, ConnectionState, DEFAULT_SETTINGS, LLMBlocksSettings } from "./types";
import { ResponseCache } from "./cache";
import { CodexWebSocketClient } from "./websocket-client";
import { LLMBlockRenderer } from "./renderer";
import { LLMBlocksSettingTab } from "./settings";

export default class LLMBlocksPlugin extends Plugin {
	settings: LLMBlocksSettings = DEFAULT_SETTINGS;
	cache = new ResponseCache();
	wsClient!: CodexWebSocketClient;
	private statusBarEl: HTMLElement | null = null;
	private settingsTab: LLMBlocksSettingTab | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.wsClient = new CodexWebSocketClient(this.settings);

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

		// Connect immediately; onLayoutReady acts as a safe retry hook.
		this.wsClient.connect();

		// Connect on layout ready (deferred)
		this.app.workspace.onLayoutReady(() => {
			this.wsClient.connect();
		});
	}

	onunload(): void {
		this.wsClient.disconnect();
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
		await this.saveData(this.settings);
		this.wsClient.updateSettings(this.settings);
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
