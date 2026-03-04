export type LLMProvider = "openai" | "anthropic";
export type TransportMode = "auto" | "websocket" | "http";

export interface CustomModelConfig {
	id: string;
	displayName?: string;
	provider?: LLMProvider;
	baseUrl?: string;
	apiKey?: string;
	model: string;
	maxOutputTokens?: number;
}

export interface LLMBlocksSettings {
	wsEndpoint: string;
	transportMode: TransportMode;
	model: string;
	provider: LLMProvider;
	baseUrl: string;
	temperature: number;
	maxOutputTokens: number;
	autoReconnect: boolean;
	maxReconnectAttempts: number;
	apiKey: string;
	customModelsJson: string;
	activeModelId: string;
}

export const DEFAULT_SETTINGS: LLMBlocksSettings = {
	wsEndpoint: "ws://127.0.0.1:4500",
	transportMode: "auto",
	model: "",
	provider: "openai",
	baseUrl: "https://api.openai.com",
	temperature: 0.7,
	maxOutputTokens: 4096,
	autoReconnect: true,
	maxReconnectAttempts: 0,
	apiKey: "",
	customModelsJson: "",
	activeModelId: "",
};

export type AuthState = "unchecked" | "authenticated" | "unauthenticated";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string;
	method: string;
	params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id?: string;
	method?: string;
	result?: unknown;
	params?: Record<string, unknown>;
	error?: { code: number; message: string; data?: unknown };
}

export interface CachedResponse {
	markdown: string;
	timestamp: number;
}

export interface QueryResult {
	text: string;
	model: string;
	threadId?: string;
}
