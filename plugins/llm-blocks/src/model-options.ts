import type { LLMBlocksSettings, LLMProvider, QueryOptions } from "./types";

export type RuntimeModelOptionId =
	| "codex-appserver"
	| "minimax-m2.5"
	| "zai-glm-5"
	| "openrouter-mercury-2";

export interface RuntimeModelOption {
	id: RuntimeModelOptionId;
	label: string;
	model: string;
	transportMode: "websocket" | "http";
	provider?: LLMProvider;
	baseUrl?: string;
}

export const RUNTIME_MODEL_OPTIONS: RuntimeModelOption[] = [
	{
		id: "codex-appserver",
		label: "Codex Appserver (WebSocket)",
		model: "",
		transportMode: "websocket",
	},
	{
		id: "minimax-m2.5",
		label: "MiniMax M2.5",
		model: "MiniMax-M2.5",
		transportMode: "http",
		provider: "minimax",
		baseUrl: "https://api.minimax.io/v1",
	},
	{
		id: "zai-glm-5",
		label: "Z.AI GLM-5",
		model: "glm-5",
		transportMode: "http",
		provider: "zai",
		baseUrl: "https://api.z.ai/api/paas/v4",
	},
	{
		id: "openrouter-mercury-2",
		label: "OpenRouter-mercury-2",
		model: "inception/mercury-2",
		transportMode: "http",
		provider: "openrouter",
		baseUrl: "https://openrouter.ai/api/v1",
	},
];

export const DIRECT_RUNTIME_OPTIONS: RuntimeModelOption[] = RUNTIME_MODEL_OPTIONS.filter((option) => option.transportMode === "http");

export const RUNTIME_MODE_OPTIONS = [
	{ value: "codex-appserver", label: "Codex Server" },
	{ value: "direct-model", label: "Direct Model" },
] as const;

export function isDirectRuntimeId(id: string): id is Exclude<RuntimeModelOptionId, "codex-appserver"> {
	return id !== "codex-appserver";
}

export function resolveRuntimeFromMode(
	mode: "codex-appserver" | "direct-model",
	directRuntimeId?: string,
): RuntimeModelOption {
	if (mode === "codex-appserver") {
		return RUNTIME_MODEL_OPTIONS[0];
	}

	const directId = directRuntimeId ?? DIRECT_RUNTIME_OPTIONS[0]?.id;
	return DIRECT_RUNTIME_OPTIONS.find((option) => option.id === directId) ?? DIRECT_RUNTIME_OPTIONS[0];
}

export function buildQueryOptionsFromRuntimeOption(
	option: RuntimeModelOption,
): Pick<QueryOptions, "model" | "transportModeOverride" | "providerOverride" | "baseUrlOverride"> {
	if (option.transportMode === "websocket") {
		return { transportModeOverride: "websocket" };
	}

	return {
		model: option.model,
		transportModeOverride: "http",
		providerOverride: option.provider,
		baseUrlOverride: option.baseUrl,
	};
}

export function getRuntimeHintText(option: RuntimeModelOption): string {
	return option.transportMode === "websocket"
		? "Runtime: Codex Server"
		: `Runtime: Direct Model via ${option.provider ?? "provider"} (${option.model})`;
}

export function resolveRuntimeModelIdFromSettings(
	settings: Pick<LLMBlocksSettings, "transportMode" | "provider" | "model">,
): RuntimeModelOptionId {
	if (settings.transportMode !== "http") {
		return "codex-appserver";
	}
	if (settings.provider === "minimax") {
		return "minimax-m2.5";
	}
	if (settings.provider === "zai") {
		return "zai-glm-5";
	}
	if (settings.provider === "openrouter") {
		return "openrouter-mercury-2";
	}
	if ((settings.model ?? "").trim().toLowerCase() === "glm-5") {
		return "zai-glm-5";
	}
	if ((settings.model ?? "").trim() === "MiniMax-M2.5") {
		return "minimax-m2.5";
	}
	return "codex-appserver";
}
