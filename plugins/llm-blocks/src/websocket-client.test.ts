import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The CodexWebSocketClient class is tightly coupled to WebSocket and Obsidian Events.
 * We test the pure-logic private methods by extracting them into testable scenarios
 * through the public API, and we test state machine transitions with a mock WebSocket.
 */

// Mock the obsidian module
vi.mock("obsidian", () => ({
	Events: class {
		private _h = new Map<string, Array<(...a: unknown[]) => void>>();
		on(e: string, cb: (...a: unknown[]) => void) {
			if (!this._h.has(e)) this._h.set(e, []);
			this._h.get(e)!.push(cb);
		}
		trigger(e: string, ...a: unknown[]) {
			for (const h of this._h.get(e) ?? []) h(...a);
		}
	},
}));

// Mock NodeWebSocket to prevent actual connections
vi.mock("./node-websocket", () => ({
	NodeWebSocket: class MockWebSocket {
		static OPEN = 1;
		static CONNECTING = 0;
		static CLOSING = 2;
		static CLOSED = 3;
		readyState = 0;
		onopen: (() => void) | null = null;
		onclose: ((e: { code: number; reason: string }) => void) | null = null;
		onerror: (() => void) | null = null;
		onmessage: ((e: { data: string }) => void) | null = null;
		url: string;
		sentMessages: string[] = [];
		constructor(url: string) {
			this.url = url;
		}
		send(data: string) {
			this.sentMessages.push(data);
		}
		close() {
			this.readyState = 3;
		}
	},
}));

import { CodexWebSocketClient } from "./websocket-client";
import type { LLMBlocksSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

function makeSettings(overrides?: Partial<LLMBlocksSettings>): LLMBlocksSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

describe("CodexWebSocketClient", () => {
	describe("initial state", () => {
		it("starts disconnected and unchecked", () => {
			const client = new CodexWebSocketClient(makeSettings());
			expect(client.connectionState).toBe("disconnected");
			expect(client.authState).toBe("unchecked");
			expect(client.isReady).toBe(false);
			expect(client.lastErrorMessage).toBe("");
		});
	});

	describe("HTTP transport mode (no WebSocket needed)", () => {
		it("connects immediately in http mode with api key", () => {
			const settings = makeSettings({
				transportMode: "http",
				model: "gpt-4",
				provider: "openai",
				apiKey: "sk-test-key",
			});
			const client = new CodexWebSocketClient(settings);

			const states: string[] = [];
			client.on("state-change", (s: unknown) => states.push(s as string));

			client.connect();

			expect(client.connectionState).toBe("connected");
			expect(client.authState).toBe("authenticated");
			expect(client.isReady).toBe(true);
		});

		it("reports unauthenticated in http mode without api key", () => {
			const settings = makeSettings({
				transportMode: "http",
				model: "gpt-4",
				provider: "openai",
				apiKey: "",
			});
			const client = new CodexWebSocketClient(settings);
			client.connect();
			expect(client.authState).toBe("unauthenticated");
		});
	});

	describe("disconnect", () => {
		it("resets state on disconnect", () => {
			const settings = makeSettings({
				transportMode: "http",
				model: "gpt-4",
				apiKey: "sk-test",
			});
			const client = new CodexWebSocketClient(settings);
			client.connect();
			expect(client.connectionState).toBe("connected");

			client.disconnect();
			expect(client.connectionState).toBe("disconnected");
			expect(client.authState).toBe("unchecked");
			expect(client.isReady).toBe(false);
		});
	});

	describe("getPreferredRuntimeModelOptionId", () => {
		it("returns codex-appserver for websocket transport", () => {
			const client = new CodexWebSocketClient(makeSettings({ transportMode: "websocket" }));
			expect(client.getPreferredRuntimeModelOptionId()).toBe("codex-appserver");
		});

		it("returns minimax-m2.5 for http + minimax", () => {
			const client = new CodexWebSocketClient(
				makeSettings({ transportMode: "http", provider: "minimax" }),
			);
			expect(client.getPreferredRuntimeModelOptionId()).toBe("minimax-m2.5");
		});
	});

	describe("state change events", () => {
		it("emits state-change on connect/disconnect", () => {
			const settings = makeSettings({
				transportMode: "http",
				model: "gpt-4",
				apiKey: "sk-test",
			});
			const client = new CodexWebSocketClient(settings);
			const states: string[] = [];
			client.on("state-change", (s: unknown) => states.push(s as string));

			client.connect();
			client.disconnect();
			expect(states).toEqual(["connected", "disconnected"]);
		});

		it("emits auth-change events", () => {
			const settings = makeSettings({
				transportMode: "http",
				model: "gpt-4",
				apiKey: "sk-test",
			});
			const client = new CodexWebSocketClient(settings);
			const auths: string[] = [];
			client.on("auth-change", (a: unknown) => auths.push(a as string));

			client.connect();
			client.disconnect();
			expect(auths).toEqual(["authenticated", "unchecked"]);
		});
	});

	describe("query error conditions", () => {
		it("throws when not connected in websocket mode", async () => {
			const client = new CodexWebSocketClient(makeSettings({ transportMode: "websocket" }));
			await expect(client.query("hello")).rejects.toThrow();
		});

		it("throws for http mode without configured model", async () => {
			const client = new CodexWebSocketClient(
				makeSettings({ transportMode: "http", model: "", apiKey: "sk-test" }),
			);
			client.connect();
			await expect(client.query("hello")).rejects.toThrow("HTTP mode requires a configured model");
		});
	});

	describe("updateSettings", () => {
		it("disconnects and reconnects with new settings", () => {
			const settings = makeSettings({
				transportMode: "http",
				model: "gpt-4",
				apiKey: "sk-test",
			});
			const client = new CodexWebSocketClient(settings);
			client.connect();
			expect(client.connectionState).toBe("connected");

			const states: string[] = [];
			client.on("state-change", (s: unknown) => states.push(s as string));

			client.updateSettings(
				makeSettings({
					transportMode: "http",
					model: "gpt-4o",
					apiKey: "sk-new",
				}),
			);

			// Should disconnect then reconnect
			expect(states).toContain("disconnected");
			expect(states).toContain("connected");
			expect(client.connectionState).toBe("connected");
		});
	});

	describe("loginChatGPT in HTTP mode", () => {
		it("throws when in HTTP-only mode", async () => {
			const client = new CodexWebSocketClient(
				makeSettings({ transportMode: "http", model: "gpt-4", apiKey: "sk-test" }),
			);
			client.connect();
			await expect(client.loginChatGPT()).rejects.toThrow("HTTP-only mode");
		});
	});
});
