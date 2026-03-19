import { createHash } from "crypto";
import * as os from "os";
import * as path from "path";
import { parseYaml } from "obsidian";
import type {
	BlockerRef,
	RateLimitSnapshot,
	TokenTotals,
} from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function coerceObject(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export function coerceOptionalString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

export function coerceOptionalInteger(value: unknown): number | null {
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}

	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const parsed = Number.parseInt(trimmed, 10);
	return Number.isInteger(parsed) ? parsed : null;
}

export function coercePositiveInteger(value: unknown, fallback: number): number {
	const parsed = coerceOptionalInteger(value);
	return parsed !== null && parsed > 0 ? parsed : fallback;
}

export function coerceNonNegativeInteger(value: unknown, fallback: number): number {
	const parsed = coerceOptionalInteger(value);
	return parsed !== null && parsed >= 0 ? parsed : fallback;
}

export function normalizeState(value: unknown): string {
	return coerceOptionalString(value)?.toLowerCase() ?? "";
}

export function coerceStringArray(value: unknown, fallback: string[] = []): string[] {
	if (Array.isArray(value)) {
		return value
			.map((entry) => (typeof entry === "string" ? entry.trim() : String(entry ?? "").trim()))
			.filter(Boolean);
	}

	if (typeof value === "string") {
		return value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	return [...fallback];
}

export function parseIsoTimestamp(value: unknown): { raw: string | null; millis: number | null } {
	const raw = coerceOptionalString(value);
	if (!raw) {
		return { raw: null, millis: null };
	}

	const millis = Date.parse(raw);
	return {
		raw,
		millis: Number.isFinite(millis) ? millis : null,
	};
}

export function extractFrontmatter(markdown: string): {
	frontmatter: Record<string, unknown>;
	body: string;
	hasFrontmatter: boolean;
} {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) {
		return {
			frontmatter: {},
			body: markdown.trim(),
			hasFrontmatter: false,
		};
	}

	const yamlBlock = match[1];
	const parsed = parseYaml(yamlBlock);
	if (!isRecord(parsed)) {
		throw new Error("Front matter must decode to an object.");
	}

	return {
		frontmatter: parsed,
		body: markdown.slice(match[0].length).trim(),
		hasFrontmatter: true,
	};
}

export function extractFirstHeading(markdownBody: string): string | null {
	const match = markdownBody.match(/^\s*#\s+(.+)$/m);
	return match ? match[1].trim() : null;
}

export function sha1(value: string): string {
	return createHash("sha1").update(value).digest("hex");
}

export function sanitizeWorkspaceKey(identifier: string): string {
	const sanitized = identifier.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
	return sanitized || "issue";
}

export function expandDesktopPath(value: string): string {
	let expanded = value.trim();
	if (expanded.startsWith("$") && expanded.length > 1) {
		expanded = process.env[expanded.slice(1)] ?? "";
	}

	if (expanded === "~") {
		expanded = os.homedir();
	} else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
		expanded = path.join(os.homedir(), expanded.slice(2));
	}

	return expanded;
}

export function isPathInside(rootPath: string, targetPath: string): boolean {
	const root = normalizeFsPath(rootPath);
	const target = normalizeFsPath(targetPath);
	const relative = path.relative(root, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeFsPath(fsPath: string): string {
	const resolved = path.resolve(fsPath);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function splitCommandLine(commandLine: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaping = false;

	for (const char of commandLine) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === "\\") {
			escaping = true;
			continue;
		}

		if ((char === "'" || char === "\"") && quote === null) {
			quote = char;
			continue;
		}

		if (char === quote) {
			quote = null;
			continue;
		}

		if (/\s/.test(char) && quote === null) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (escaping) {
		current += "\\";
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

export function truncateText(value: string, maxLength = 240): string {
	if (value.length <= maxLength) {
		return value;
	}

	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function emptyTokenTotals(): TokenTotals {
	return {
		input: 0,
		output: 0,
		total: 0,
		reasoning: 0,
		cachedInput: 0,
	};
}

export function mergeTokenTotals(base: TokenTotals, delta: Partial<TokenTotals>): TokenTotals {
	return {
		input: base.input + (delta.input ?? 0),
		output: base.output + (delta.output ?? 0),
		total: base.total + (delta.total ?? 0),
		reasoning: base.reasoning + (delta.reasoning ?? 0),
		cachedInput: base.cachedInput + (delta.cachedInput ?? 0),
	};
}

export function describeDueIn(dueAt: number, now = Date.now()): string {
	const delta = dueAt - now;
	if (delta <= 0) {
		return "due now";
	}

	if (delta < 1000) {
		return "in <1s";
	}

	if (delta < 60_000) {
		return `in ${Math.ceil(delta / 1000)}s`;
	}

	return `in ${Math.ceil(delta / 60_000)}m`;
}

export function inferBlockerRefs(value: unknown): BlockerRef[] {
	const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
	const refs: BlockerRef[] = [];

	for (const item of items) {
		if (typeof item === "string") {
			const trimmed = item.trim();
			if (trimmed) {
				refs.push({
					id: null,
					identifier: trimmed,
					state: null,
					normalizedState: null,
				});
			}
			continue;
		}

		if (!isRecord(item)) {
			continue;
		}

		const state = coerceOptionalString(item.state);
		refs.push({
			id: coerceOptionalString(item.id),
			identifier: coerceOptionalString(item.identifier),
			state,
			normalizedState: normalizeState(state),
		});
	}

	return refs;
}

export function renderStrictTemplate(
	template: string,
	context: Record<string, unknown>,
	fallbackPrompt: string,
): string {
	if (!template.trim()) {
		return fallbackPrompt;
	}

	return renderTemplateFragment(template, context);
}

export function buildFallbackPrompt(
	issueSummary: Record<string, unknown>,
	attempt: number,
	workspacePath: string,
): string {
	return [
		"You are working on an issue staged from Obsidian.",
		"Operate only inside the current external workspace.",
		"Do not modify the Obsidian vault directly.",
		"",
		`Attempt: ${attempt}`,
		`Workspace: ${workspacePath}`,
		"",
		"Issue summary:",
		JSON.stringify(issueSummary, null, 2),
		"",
		"Workspace context files:",
		"- .symphony/issue.json",
		"- .symphony/issue.md",
		"- .symphony/prompt.txt",
	].join("\n");
}

export function inferRateLimitSnapshot(payload: unknown): RateLimitSnapshot | null {
	if (!isRecord(payload)) {
		return null;
	}

	const direct = findNestedObject(payload, new Set(["rate_limits", "ratelimits", "rate_limits_updated", "ratelimit"]));
	if (direct) {
		return {
			raw: direct,
			summary: truncateText(JSON.stringify(direct)),
			updatedAt: Date.now(),
		};
	}

	return null;
}

export function inferTokenTotals(payload: unknown): Partial<TokenTotals> {
	if (!isRecord(payload)) {
		return {};
	}

	const values = collectNumberFields(payload);
	return {
		input: pickFirstNumber(values, ["input_tokens", "inputtokens", "aggregatedinputtokens"]),
		output: pickFirstNumber(values, ["output_tokens", "outputtokens", "aggregatedoutputtokens"]),
		total: pickFirstNumber(values, ["total_tokens", "totaltokens"]),
		reasoning: pickFirstNumber(values, ["reasoning_tokens", "reasoningoutputtokens"]),
		cachedInput: pickFirstNumber(values, ["cached_input_tokens", "cachedinputtokens"]),
	};
}

export function inferEventName(payload: unknown): string {
	if (!isRecord(payload)) {
		return "message";
	}

	if (typeof payload.type === "string" && payload.type.trim()) {
		return payload.type;
	}

	const keys = Object.keys(payload);
	if (keys.length === 1 && isRecord(payload[keys[0]])) {
		return keys[0];
	}

	const nestedType = findNestedString(payload, new Set(["event", "event_name", "name", "kind", "status"]));
	return nestedType ?? "message";
}

export function inferEventText(payload: unknown): string {
	if (typeof payload === "string") {
		return truncateText(payload);
	}

	if (!isRecord(payload)) {
		return "";
	}

	const nestedText = findNestedString(
		payload,
		new Set([
			"text",
			"message",
			"delta",
			"summary",
			"summarytext",
			"content",
			"stdout",
			"stderr",
		]),
	);

	if (nestedText) {
		return truncateText(nestedText.replace(/\s+/g, " "));
	}

	return truncateText(JSON.stringify(payload));
}

export function inferStringId(payload: unknown, keys: string[]): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	return findNestedString(payload, new Set(keys.map((key) => key.toLowerCase())));
}

function findNestedObject(
	value: unknown,
	keys: Set<string>,
	seen = new Set<unknown>(),
): Record<string, unknown> | null {
	if (!isRecord(value) || seen.has(value)) {
		return null;
	}
	seen.add(value);

	for (const [key, nested] of Object.entries(value)) {
		if (keys.has(key.toLowerCase()) && isRecord(nested)) {
			return nested;
		}

		const found = findNestedObject(nested, keys, seen);
		if (found) {
			return found;
		}
	}

	return null;
}

function findNestedString(
	value: unknown,
	keys: Set<string>,
	seen = new Set<unknown>(),
): string | null {
	if (typeof value === "string") {
		return value.trim() || null;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findNestedString(item, keys, seen);
			if (found) {
				return found;
			}
		}
		return null;
	}

	if (!isRecord(value) || seen.has(value)) {
		return null;
	}
	seen.add(value);

	for (const [key, nested] of Object.entries(value)) {
		if (keys.has(key.toLowerCase()) && typeof nested === "string" && nested.trim()) {
			return nested.trim();
		}

		const found = findNestedString(nested, keys, seen);
		if (found) {
			return found;
		}
	}

	return null;
}

function collectNumberFields(
	value: unknown,
	pathPrefix = "",
	seen = new Set<unknown>(),
	result: Record<string, number> = {},
): Record<string, number> {
	if (typeof value === "number" && Number.isFinite(value)) {
		result[pathPrefix.toLowerCase()] = value;
		return result;
	}

	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			collectNumberFields(item, `${pathPrefix}[${index}]`, seen, result);
		});
		return result;
	}

	if (!isRecord(value) || seen.has(value)) {
		return result;
	}
	seen.add(value);

	for (const [key, nested] of Object.entries(value)) {
		collectNumberFields(nested, `${pathPrefix}.${key}`.replace(/^\./, ""), seen, result);
	}

	return result;
}

function pickFirstNumber(fields: Record<string, number>, candidates: string[]): number | undefined {
	const normalizedCandidates = candidates.map((candidate) => candidate.toLowerCase());
	for (const [key, value] of Object.entries(fields)) {
		const normalized = key.replace(/[^a-z]/g, "");
		if (normalizedCandidates.includes(normalized)) {
			return value;
		}
	}

	return undefined;
}

function renderTemplateFragment(template: string, context: Record<string, unknown>): string {
	let cursor = 0;
	let output = "";

	while (cursor < template.length) {
		const nextVariableIndex = template.indexOf("{{", cursor);
		const nextDirectiveIndex = template.indexOf("{%", cursor);

		let nextIndex = -1;
		let nextType: "variable" | "directive" | null = null;

		if (nextVariableIndex >= 0 && (nextDirectiveIndex === -1 || nextVariableIndex < nextDirectiveIndex)) {
			nextIndex = nextVariableIndex;
			nextType = "variable";
		} else if (nextDirectiveIndex >= 0) {
			nextIndex = nextDirectiveIndex;
			nextType = "directive";
		}

		if (nextIndex === -1 || nextType === null) {
			output += template.slice(cursor);
			break;
		}

		output += template.slice(cursor, nextIndex);

		if (nextType === "variable") {
			const closeIndex = template.indexOf("}}", nextIndex + 2);
			if (closeIndex === -1) {
				throw new Error("Unterminated template variable.");
			}

			const expression = template.slice(nextIndex + 2, closeIndex).trim();
			output += stringifyTemplateValue(resolveTemplateValue(context, expression), expression);
			cursor = closeIndex + 2;
			continue;
		}

		const closeIndex = template.indexOf("%}", nextIndex + 2);
		if (closeIndex === -1) {
			throw new Error("Unterminated template directive.");
		}

		const directive = template.slice(nextIndex + 2, closeIndex).trim();
		if (directive.startsWith("if ")) {
			const conditionExpression = directive.slice(3).trim();
			const block = extractIfBlock(template, nextIndex);
			const conditionValue = resolveTemplateValue(context, conditionExpression);
			const branch = isTruthyTemplateValue(conditionValue) ? block.truthy : block.falsy;
			output += renderTemplateFragment(branch, context);
			cursor = block.nextIndex;
			continue;
		}

		if (directive === "else" || directive === "endif") {
			throw new Error(`Unexpected template directive "${directive}".`);
		}

		throw new Error(`Unsupported template directive "${directive}".`);
	}

	return output;
}

function extractIfBlock(
	template: string,
	ifIndex: number,
): { truthy: string; falsy: string; nextIndex: number } {
	const openCloseIndex = template.indexOf("%}", ifIndex + 2);
	if (openCloseIndex === -1) {
		throw new Error("Unterminated template directive.");
	}

	const directivePattern = /{%\s*(if\s+[^%]+|else|endif)\s*%}/g;
	directivePattern.lastIndex = openCloseIndex + 2;

	let depth = 1;
	let elseIndex: number | null = null;

	while (true) {
		const match = directivePattern.exec(template);
		if (!match || match.index === undefined) {
			throw new Error("Missing {% endif %} for template conditional.");
		}

		const directive = match[1].trim();
		if (directive.startsWith("if ")) {
			depth += 1;
			continue;
		}

		if (directive === "endif") {
			depth -= 1;
			if (depth === 0) {
				const truthyEnd = elseIndex ?? match.index;
				const falsyStart = elseIndex === null
					? match.index
					: template.indexOf("%}", elseIndex + 2) + 2;
				return {
					truthy: template.slice(openCloseIndex + 2, truthyEnd),
					falsy: elseIndex === null ? "" : template.slice(falsyStart, match.index),
					nextIndex: directivePattern.lastIndex,
				};
			}
			continue;
		}

		if (directive === "else" && depth === 1) {
			if (elseIndex !== null) {
				throw new Error("Template conditional contains multiple {% else %} blocks.");
			}
			elseIndex = match.index;
		}
	}
}

function resolveTemplateValue(context: Record<string, unknown>, expression: string): unknown {
	const trimmed = expression.trim();
	if (!trimmed) {
		throw new Error("Empty template expression.");
	}

	if (trimmed.includes("|")) {
		throw new Error(`Unsupported template filter in "${trimmed}".`);
	}

	if (!/^[A-Za-z0-9_.]+$/.test(trimmed)) {
		throw new Error(`Unsupported template expression "${trimmed}".`);
	}

	const segments = trimmed.split(".");
	let value: unknown = context;

	for (const segment of segments) {
		if (!isRecord(value) || !(segment in value)) {
			throw new Error(`Unknown template variable "${trimmed}".`);
		}
		value = value[segment];
	}

	return value;
}

function stringifyTemplateValue(value: unknown, expression: string): string {
	if (value === null || value === undefined) {
		return "";
	}

	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		throw new Error(`Unable to render template variable "${expression}".`);
	}
}

function isTruthyTemplateValue(value: unknown): boolean {
	if (value === null || value === undefined) {
		return false;
	}

	if (typeof value === "boolean") {
		return value;
	}

	if (typeof value === "number") {
		return value !== 0;
	}

	if (typeof value === "string") {
		return value.trim().length > 0;
	}

	if (Array.isArray(value)) {
		return value.length > 0;
	}

	if (isRecord(value)) {
		return Object.keys(value).length > 0;
	}

	return Boolean(value);
}
