import { App, PluginSettingTab, Setting } from "obsidian";
import type LLMBlocksPlugin from "./main";
import type { CustomModelConfig, LLMProvider } from "./types";

interface ModelPreset {
	id: string;
	label: string;
	model: string;
	temperature?: number;
}

const MODEL_PRESETS: ModelPreset[] = [
	{
		id: "gemini-3.1-pro",
		label: "Gemini 3.1 Pro (Preview)",
		model: "gemini-3.1-pro-preview",
		temperature: 1.0,
	},
	{
		id: "gemini-3-flash",
		label: "Gemini 3 Flash (Preview)",
		model: "gemini-3-flash-preview",
		temperature: 1.0,
	},
	{
		id: "gemini-3.1-flash-lite",
		label: "Gemini 3.1 Flash-Lite (Preview)",
		model: "gemini-3.1-flash-lite-preview",
		temperature: 1.0,
	},
	{
		id: "gemini-3.1-flash-image",
		label: "Gemini 3.1 Flash Image (Preview)",
		model: "gemini-3.1-flash-image-preview",
		temperature: 1.0,
	},
	{
		id: "gemini-3-pro-image",
		label: "Gemini 3 Pro Image (Preview)",
		model: "gemini-3-pro-image-preview",
		temperature: 1.0,
	},
	{
		id: "gemini-3-pro-deprecated",
		label: "Gemini 3 Pro (Deprecated Preview)",
		model: "gemini-3-pro-preview",
		temperature: 1.0,
	},
];

const DIRECT_PROVIDER_OPTIONS: Array<{ value: LLMProvider; label: string }> = [
	{ value: "openai", label: "OpenAI-compatible" },
	{ value: "anthropic", label: "Anthropic-compatible" },
	{ value: "openrouter", label: "OpenRouter" },
	{ value: "minimax", label: "MiniMax" },
	{ value: "zai", label: "Z.AI" },
];

const PROVIDER_KEY_FIELDS: Array<{ provider: LLMProvider; name: string; placeholder: string }> = [
	{ provider: "anthropic", name: "Anthropic API key", placeholder: "sk-ant-..." },
	{ provider: "openrouter", name: "OpenRouter API key", placeholder: "sk-or-..." },
	{ provider: "minimax", name: "MiniMax API key", placeholder: "sk-..." },
	{ provider: "zai", name: "Z.AI API key", placeholder: "..." },
];

function parseCustomModels(raw: string): CustomModelConfig[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	try {
		const parsed = JSON.parse(trimmed);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is CustomModelConfig => {
			return !!item && typeof item.id === "string" && typeof item.model === "string";
		});
	} catch {
		return [];
	}
}

export class LLMBlocksSettingTab extends PluginSettingTab {
	plugin: LLMBlocksPlugin;

	constructor(app: App, plugin: LLMBlocksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Connection + auth status
		const statusDiv = containerEl.createDiv({ cls: "llm-settings-status" });
		const connState = this.plugin.wsClient.connectionState;
		const authState = this.plugin.wsClient.authState;
		const customModels = parseCustomModels(this.plugin.settings.customModelsJson);
		const activeCustom = customModels.find((m) => m.id === this.plugin.settings.activeModelId) ?? null;
		const usingCustomModel = !!activeCustom;
		const connDot =
			connState === "connected" ? "llm-dot-green" :
			connState === "connecting" ? "llm-dot-yellow" :
			"llm-dot-red";
		statusDiv.createSpan({ cls: `llm-dot ${connDot}` });
		statusDiv.createSpan({ text: ` Connection: ${connState}` });
		if (usingCustomModel) {
			statusDiv.createEl("br");
			statusDiv.createSpan({ text: ` Active custom model: ${activeCustom.displayName ?? activeCustom.id}` });
		}

		if (connState === "connected") {
			const authDot =
				authState === "authenticated" ? "llm-dot-green" :
				authState === "unauthenticated" ? "llm-dot-red" :
				"llm-dot-yellow";
			statusDiv.createEl("br");
			statusDiv.createSpan({ cls: `llm-dot ${authDot}` });
			statusDiv.createSpan({ text: ` Auth: ${authState}` });
		}

		// Connection settings
		containerEl.createEl("h3", { text: "Connection" });

		new Setting(containerEl)
			.setName("Transport mode")
			.setDesc("Auto: prefer WebSocket, fallback to HTTP. WebSocket: server only. HTTP: direct provider API only")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("auto", "Auto (WebSocket preferred)")
					.addOption("websocket", "WebSocket only")
					.addOption("http", "HTTP only")
					.setValue(this.plugin.settings.transportMode)
					.onChange(async (value) => {
						this.plugin.settings.transportMode = value as "auto" | "websocket" | "http";
						await this.plugin.saveSettings();
						this.display();
					})
			);

		new Setting(containerEl)
			.setName("WebSocket endpoint")
			.setDesc("Codex app-server WebSocket endpoint")
			.addText((text) =>
				text
					.setPlaceholder("ws://127.0.0.1:4500")
					.setValue(this.plugin.settings.wsEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.wsEndpoint = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-reconnect")
			.setDesc("Automatically reconnect on disconnection")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoReconnect)
					.onChange(async (value) => {
						this.plugin.settings.autoReconnect = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Reconnect now")
			.setDesc("Reconnect websocket mode")
			.addButton((btn) =>
				btn.setButtonText("Reconnect").onClick(() => {
					this.plugin.wsClient.disconnect();
					this.plugin.wsClient.connect();
					setTimeout(() => this.display(), 1500);
				})
			);

		// Custom model profiles
		containerEl.createEl("h3", { text: "Custom Models" });

		new Setting(containerEl)
			.setName("Custom models JSON")
			.setDesc("Paste an array of model configs. Fields: id, displayName, provider, baseUrl, apiKey, model, maxOutputTokens")
			.addTextArea((text) => {
				text
					.setPlaceholder('[{"id":"custom:model-1","provider":"anthropic","baseUrl":"https://api.example.com/anthropic","apiKey":"...","model":"ModelName","maxOutputTokens":64000}]')
					.setValue(this.plugin.settings.customModelsJson)
					.onChange(async (value) => {
						this.plugin.settings.customModelsJson = value;
						await this.plugin.saveSettings();
						this.display();
					});
				text.inputEl.rows = 8;
				text.inputEl.cols = 80;
			});

		if (this.plugin.settings.customModelsJson.trim() && customModels.length === 0) {
			new Setting(containerEl)
				.setName("Custom models JSON status")
				.setDesc("Could not parse JSON. Fix JSON syntax to enable profile switching.");
		}

		new Setting(containerEl)
			.setName("Active custom model")
			.setDesc("If selected, plugin uses this model/provider directly and bypasses websocket")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "(none)");
				for (const model of customModels) {
					dropdown.addOption(model.id, model.displayName ?? model.id);
				}
				dropdown
					.setValue(this.plugin.settings.activeModelId)
					.onChange(async (value) => {
						this.plugin.settings.activeModelId = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		// Auth settings
		containerEl.createEl("h3", { text: "Authentication" });

		new Setting(containerEl)
			.setName("Default API key")
			.setDesc("Used for direct HTTP API mode (and as fallback in Auto) when active custom model has no apiKey")
			.addText((text) => {
				text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		for (const field of PROVIDER_KEY_FIELDS) {
			new Setting(containerEl)
				.setName(field.name)
				.setDesc(`Used when provider/model routing targets ${field.provider}`)
				.addText((text) => {
					text
						.setPlaceholder(field.placeholder)
						.setValue(this.plugin.settings.providerApiKeys?.[field.provider] ?? "")
						.onChange(async (value) => {
							this.plugin.settings.providerApiKeys = {
								...(this.plugin.settings.providerApiKeys ?? {}),
								[field.provider]: value,
							};
							await this.plugin.saveSettings();
						});
					text.inputEl.type = "password";
				});
		}

		if (
			this.plugin.settings.transportMode !== "http" &&
			authState === "unauthenticated" &&
			connState === "connected" &&
			!this.plugin.settings.apiKey.trim() &&
			!usingCustomModel
		) {
			new Setting(containerEl)
				.setName("Login with ChatGPT")
				.setDesc("Opens a browser window to authenticate with your ChatGPT account")
				.addButton((btn) =>
					btn.setButtonText("Login with ChatGPT").setCta().onClick(async () => {
						btn.setDisabled(true);
						btn.setButtonText("Opening browser...");
						try {
							const url = await this.plugin.wsClient.loginChatGPT();
							window.open(url);
							btn.setButtonText("Waiting for login...");
							// Auth change event will refresh settings tab
						} catch (e) {
							btn.setButtonText("Login failed - retry");
							btn.setDisabled(false);
						}
					})
				);
		}

		// Model settings
		containerEl.createEl("h3", { text: "Model" });

		const selectedPresetByModel =
			MODEL_PRESETS.find((preset) => preset.model === this.plugin.settings.model)?.id ?? "";

		new Setting(containerEl)
			.setName("Quick model presets")
			.setDesc("Apply common model IDs to Default model")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "Select a preset...");
				for (const preset of MODEL_PRESETS) {
					dropdown.addOption(preset.id, preset.label);
				}
				dropdown
					.setValue(selectedPresetByModel)
					.onChange(async (value) => {
						const preset = MODEL_PRESETS.find((item) => item.id === value);
						if (!preset) return;
						this.plugin.settings.model = preset.model;
						this.plugin.settings.provider = "openai";
						if (typeof preset.temperature === "number") {
							this.plugin.settings.temperature = preset.temperature;
						}
						await this.plugin.saveSettings();
						this.display();
					});
			});

		new Setting(containerEl)
			.setName("Default provider")
			.setDesc("Direct API provider used when no active custom model is selected")
			.addDropdown((dropdown) =>
				{
					for (const option of DIRECT_PROVIDER_OPTIONS) {
						dropdown.addOption(option.value, option.label);
					}
					return dropdown
						.setValue(this.plugin.settings.provider)
						.onChange(async (value) => {
							this.plugin.settings.provider = value as LLMProvider;
							await this.plugin.saveSettings();
						});
				}
			);

		new Setting(containerEl)
			.setName("Default base URL")
			.setDesc("Examples: https://api.openai.com or https://api.minimax.io/anthropic")
			.addText((text) =>
				text
					.setPlaceholder("https://api.openai.com")
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default model")
			.setDesc("Used for direct mode when no active custom model is selected")
			.addText((text) =>
				text
					.setPlaceholder("gpt-4.1-mini")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Max output tokens")
			.setDesc("Used for direct API calls")
			.addText((text) =>
				text
					.setPlaceholder("4096")
					.setValue(String(this.plugin.settings.maxOutputTokens))
					.onChange(async (value) => {
						const parsed = Number(value);
						if (Number.isFinite(parsed) && parsed > 0) {
							this.plugin.settings.maxOutputTokens = Math.floor(parsed);
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Temperature")
			.setDesc("Sampling temperature (0.0 - 2.0)")
			.addSlider((slider) =>
				slider
					.setLimits(0, 2, 0.1)
					.setValue(this.plugin.settings.temperature)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
			);

		// Cache
		containerEl.createEl("h3", { text: "Cache" });

		new Setting(containerEl)
			.setName("Clear response cache")
			.setDesc(`${this.plugin.cache.size} cached responses`)
			.addButton((btn) =>
				btn.setButtonText("Clear cache").onClick(() => {
					this.plugin.cache.clear();
					this.display();
				})
			);
	}
}
