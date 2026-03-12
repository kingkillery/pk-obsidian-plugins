import { describe, it, expect } from "vitest";
import {
	RUNTIME_MODEL_OPTIONS,
	DIRECT_RUNTIME_OPTIONS,
	isDirectRuntimeId,
	resolveRuntimeFromMode,
	buildQueryOptionsFromRuntimeOption,
	getRuntimeHintText,
	resolveRuntimeModelIdFromSettings,
} from "./model-options";

describe("RUNTIME_MODEL_OPTIONS constants", () => {
	it("has codex-appserver as first entry with websocket transport", () => {
		const first = RUNTIME_MODEL_OPTIONS[0];
		expect(first.id).toBe("codex-appserver");
		expect(first.transportMode).toBe("websocket");
	});

	it("DIRECT_RUNTIME_OPTIONS excludes websocket entries", () => {
		for (const option of DIRECT_RUNTIME_OPTIONS) {
			expect(option.transportMode).toBe("http");
		}
		expect(DIRECT_RUNTIME_OPTIONS.length).toBe(
			RUNTIME_MODEL_OPTIONS.filter((o) => o.transportMode === "http").length,
		);
	});
});

describe("isDirectRuntimeId", () => {
	it("returns false for codex-appserver", () => {
		expect(isDirectRuntimeId("codex-appserver")).toBe(false);
	});

	it("returns true for direct runtime ids", () => {
		expect(isDirectRuntimeId("minimax-m2.5")).toBe(true);
		expect(isDirectRuntimeId("zai-glm-5")).toBe(true);
		expect(isDirectRuntimeId("openrouter-mercury-2")).toBe(true);
	});
});

describe("resolveRuntimeFromMode", () => {
	it("returns codex-appserver for codex-appserver mode", () => {
		const result = resolveRuntimeFromMode("codex-appserver");
		expect(result.id).toBe("codex-appserver");
		expect(result.transportMode).toBe("websocket");
	});

	it("returns specified direct runtime for direct-model mode", () => {
		const result = resolveRuntimeFromMode("direct-model", "zai-glm-5");
		expect(result.id).toBe("zai-glm-5");
		expect(result.provider).toBe("zai");
	});

	it("falls back to first direct option when directRuntimeId is missing", () => {
		const result = resolveRuntimeFromMode("direct-model");
		expect(result.id).toBe(DIRECT_RUNTIME_OPTIONS[0].id);
	});

	it("falls back to first direct option when directRuntimeId is unknown", () => {
		const result = resolveRuntimeFromMode("direct-model", "nonexistent-id");
		expect(result.id).toBe(DIRECT_RUNTIME_OPTIONS[0].id);
	});
});

describe("buildQueryOptionsFromRuntimeOption", () => {
	it("returns websocket override for websocket runtime", () => {
		const ws = RUNTIME_MODEL_OPTIONS[0];
		const opts = buildQueryOptionsFromRuntimeOption(ws);
		expect(opts.transportModeOverride).toBe("websocket");
		expect(opts.model).toBeUndefined();
		expect(opts.providerOverride).toBeUndefined();
	});

	it("returns full config for http runtime", () => {
		const http = DIRECT_RUNTIME_OPTIONS.find((o) => o.id === "minimax-m2.5")!;
		const opts = buildQueryOptionsFromRuntimeOption(http);
		expect(opts.transportModeOverride).toBe("http");
		expect(opts.model).toBe("MiniMax-M2.5");
		expect(opts.providerOverride).toBe("minimax");
		expect(opts.baseUrlOverride).toBe("https://api.minimax.io/v1");
	});
});

describe("getRuntimeHintText", () => {
	it("returns Codex Server hint for websocket runtime", () => {
		const ws = RUNTIME_MODEL_OPTIONS[0];
		expect(getRuntimeHintText(ws)).toBe("Runtime: Codex Server");
	});

	it("returns Direct Model hint with provider and model for http runtime", () => {
		const http = DIRECT_RUNTIME_OPTIONS.find((o) => o.id === "zai-glm-5")!;
		const text = getRuntimeHintText(http);
		expect(text).toContain("Direct Model");
		expect(text).toContain("zai");
		expect(text).toContain("glm-5");
	});
});

describe("resolveRuntimeModelIdFromSettings", () => {
	it("returns codex-appserver for websocket transport", () => {
		expect(
			resolveRuntimeModelIdFromSettings({
				transportMode: "websocket",
				provider: "openai",
				model: "",
			}),
		).toBe("codex-appserver");
	});

	it("returns codex-appserver for auto transport", () => {
		expect(
			resolveRuntimeModelIdFromSettings({
				transportMode: "auto",
				provider: "openai",
				model: "",
			}),
		).toBe("codex-appserver");
	});

	it("returns minimax-m2.5 for http + minimax provider", () => {
		expect(
			resolveRuntimeModelIdFromSettings({
				transportMode: "http",
				provider: "minimax",
				model: "MiniMax-M2.5",
			}),
		).toBe("minimax-m2.5");
	});

	it("returns zai-glm-5 for http + zai provider", () => {
		expect(
			resolveRuntimeModelIdFromSettings({
				transportMode: "http",
				provider: "zai",
				model: "glm-5",
			}),
		).toBe("zai-glm-5");
	});

	it("returns openrouter-mercury-2 for http + openrouter provider", () => {
		expect(
			resolveRuntimeModelIdFromSettings({
				transportMode: "http",
				provider: "openrouter",
				model: "inception/mercury-2",
			}),
		).toBe("openrouter-mercury-2");
	});

	it("falls back to model-based detection for zai glm-5 model", () => {
		expect(
			resolveRuntimeModelIdFromSettings({
				transportMode: "http",
				provider: "openai",
				model: "glm-5",
			}),
		).toBe("zai-glm-5");
	});

	it("falls back to model-based detection for MiniMax-M2.5 model", () => {
		expect(
			resolveRuntimeModelIdFromSettings({
				transportMode: "http",
				provider: "openai",
				model: "MiniMax-M2.5",
			}),
		).toBe("minimax-m2.5");
	});

	it("falls back to codex-appserver for unknown http provider/model", () => {
		expect(
			resolveRuntimeModelIdFromSettings({
				transportMode: "http",
				provider: "openai",
				model: "gpt-4",
			}),
		).toBe("codex-appserver");
	});
});
