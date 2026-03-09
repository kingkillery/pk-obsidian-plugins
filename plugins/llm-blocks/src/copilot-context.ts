import { App, MarkdownView } from "obsidian";
import type { LLMBlocksSettings } from "./types";

interface ActiveNoteSnapshot {
	noteTitle: string;
	notePath: string;
	content: string;
}

export interface SelectionSnapshot {
	noteTitle: string;
	notePath: string;
	content: string;
	startLine: number;
	endLine: number;
	capturedAt: number;
}

type ContextSettings = Pick<
	LLMBlocksSettings,
	"autoAttachSelectionContext" | "attachActiveNoteContext" | "maxContextChars"
>;

export class CopilotContextManager {
	private selectionSnapshot: SelectionSnapshot | null = null;
	private selectionDebounceTimer: number | null = null;
	private readonly selectionHandler: () => void;

	constructor(
		private readonly app: App,
		private readonly getSettings: () => ContextSettings,
	) {
		this.selectionHandler = () => {
			if (this.selectionDebounceTimer !== null) {
				window.clearTimeout(this.selectionDebounceTimer);
			}
			this.selectionDebounceTimer = window.setTimeout(() => {
				this.captureSelectionSnapshot();
			}, 250);
		};
	}

	initialize(): void {
		document.addEventListener("selectionchange", this.selectionHandler);
		this.captureSelectionSnapshot();
	}

	cleanup(): void {
		if (this.selectionDebounceTimer !== null) {
			window.clearTimeout(this.selectionDebounceTimer);
			this.selectionDebounceTimer = null;
		}
		document.removeEventListener("selectionchange", this.selectionHandler);
		this.selectionSnapshot = null;
	}

	getAttachedContextSummary(): string {
		const settings = this.getSettings();
		const parts: string[] = [];
		if (settings.autoAttachSelectionContext && this.selectionSnapshot) {
			parts.push(
				`Selection: ${this.selectionSnapshot.noteTitle} (${this.selectionSnapshot.startLine}-${this.selectionSnapshot.endLine})`,
			);
		}
		if (settings.attachActiveNoteContext) {
			const active = this.getActiveNoteSnapshot();
			if (active) parts.push(`Note: ${active.noteTitle}`);
		}
		return parts.join(" | ");
	}

	getCacheVariant(): string {
		const settings = this.getSettings();
		const selectionPart =
			settings.autoAttachSelectionContext && this.selectionSnapshot
				? JSON.stringify({
					notePath: this.selectionSnapshot.notePath,
					startLine: this.selectionSnapshot.startLine,
					endLine: this.selectionSnapshot.endLine,
					content: this.selectionSnapshot.content,
				})
				: "";
		const activePart =
			settings.attachActiveNoteContext
				? JSON.stringify(this.getActiveNoteSnapshot() ?? null)
				: "";
		return JSON.stringify({
			autoAttachSelectionContext: settings.autoAttachSelectionContext,
			attachActiveNoteContext: settings.attachActiveNoteContext,
			maxContextChars: settings.maxContextChars,
			selectionPart,
			activePart,
		});
	}

	buildPromptWithContext(userPrompt: string): string {
		const trimmedPrompt = userPrompt.trim();
		if (!trimmedPrompt) return "";

		const settings = this.getSettings();
		const sections: string[] = [];

		if (settings.autoAttachSelectionContext && this.selectionSnapshot) {
			sections.push(
				[
					"Attached Obsidian selection context:",
					`- Note: ${this.selectionSnapshot.noteTitle}`,
					`- Path: ${this.selectionSnapshot.notePath}`,
					`- Lines: ${this.selectionSnapshot.startLine}-${this.selectionSnapshot.endLine}`,
					"",
					"```md",
					this.clipToBudget(this.selectionSnapshot.content),
					"```",
				].join("\n"),
			);
		}

		if (settings.attachActiveNoteContext) {
			const active = this.getActiveNoteSnapshot();
			if (active) {
				sections.push(
					[
						"Attached active note snapshot:",
						`- Note: ${active.noteTitle}`,
						`- Path: ${active.notePath}`,
						"",
						"```md",
						this.clipToBudget(active.content),
						"```",
					].join("\n"),
				);
			}
		}

		if (sections.length === 0) {
			return trimmedPrompt;
		}

		return [
			"Use the attached Obsidian context only as reference. If it conflicts with the direct instruction, prioritize the instruction.",
			"",
			...sections,
			"",
			"User request:",
			trimmedPrompt,
		].join("\n");
	}

	private captureSelectionSnapshot(): void {
		const settings = this.getSettings();
		if (!settings.autoAttachSelectionContext) {
			this.selectionSnapshot = null;
			return;
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file || !view.editor) {
			this.selectionSnapshot = null;
			return;
		}

		const editor = view.editor;
		const selection = editor.getSelection().trim();
		const range = editor.listSelections()[0];
		if (!selection || !range) {
			this.selectionSnapshot = null;
			return;
		}

		const anchorLine = range.anchor.line + 1;
		const headLine = range.head.line + 1;
		this.selectionSnapshot = {
			noteTitle: view.file.basename,
			notePath: view.file.path,
			content: selection,
			startLine: Math.min(anchorLine, headLine),
			endLine: Math.max(anchorLine, headLine),
			capturedAt: Date.now(),
		};
	}

	private getActiveNoteSnapshot(): ActiveNoteSnapshot | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file || !view.editor) return null;
		const content = view.editor.getValue().trim();
		if (!content) return null;
		return {
			noteTitle: view.file.basename,
			notePath: view.file.path,
			content,
		};
	}

	private clipToBudget(text: string): string {
		const budget = Math.max(500, this.getSettings().maxContextChars || 6000);
		if (text.length <= budget) return text;
		return `${text.slice(0, budget).trimEnd()}\n\n[Context truncated at ${budget} chars]`;
	}
}
