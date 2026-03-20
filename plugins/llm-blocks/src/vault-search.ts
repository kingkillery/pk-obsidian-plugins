import { App, TFile } from "obsidian";

export interface VaultSearchResult {
	file: TFile;
	score: number;
	excerpt: string;
}

export class VaultSearchService {
	constructor(private readonly app: App) {}

	async search(query: string, limit: number, maxExcerptChars: number): Promise<VaultSearchResult[]> {
		const terms = this.tokenize(query);
		if (terms.length === 0) return [];

		const scored: VaultSearchResult[] = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			const content = await this.app.vault.cachedRead(file);
			const haystack = `${file.basename}\n${file.path}\n${content}`.toLowerCase();
			let score = 0;
			for (const term of terms) {
				const matches = haystack.split(term).length - 1;
				score += matches;
				if (file.basename.toLowerCase().includes(term)) score += 5;
				if (file.path.toLowerCase().includes(term)) score += 2;
			}
			if (score <= 0) continue;
			scored.push({
				file,
				score,
				excerpt: this.buildExcerpt(content, terms, maxExcerptChars),
			});
		}

		return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
	}

	private tokenize(query: string): string[] {
		return query
			.toLowerCase()
			.split(/[^a-z0-9_/-]+/i)
			.map((part) => part.trim())
			.filter((part) => part.length >= 3);
	}

	private buildExcerpt(content: string, terms: string[], maxChars: number): string {
		const lower = content.toLowerCase();
		const firstIndex = terms
			.map((term) => lower.indexOf(term))
			.filter((index) => index >= 0)
			.sort((a, b) => a - b)[0];

		if (firstIndex === undefined) {
			return this.clip(content, maxChars);
		}

		const radius = Math.max(120, Math.floor(maxChars / 2));
		const start = Math.max(0, firstIndex - radius);
		const end = Math.min(content.length, firstIndex + radius);
		return this.clip(content.slice(start, end).trim(), maxChars);
	}

	private clip(text: string, maxChars: number): string {
		if (text.length <= maxChars) return text;
		return `${text.slice(0, maxChars).trimEnd()}\n[Excerpt truncated]`;
	}
}
