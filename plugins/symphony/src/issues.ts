import { TFile, normalizePath } from "obsidian";
import type { OperatorError, SymphonyIssue } from "./types";
import {
	coerceOptionalInteger,
	coerceOptionalString,
	coerceStringArray,
	extractFirstHeading,
	extractFrontmatter,
	inferBlockerRefs,
	parseIsoTimestamp,
	sha1,
} from "./utils";

export interface IssueScanResult {
	issues: SymphonyIssue[];
	errors: OperatorError[];
}

export async function scanVaultIssues(
	app: { vault: { getMarkdownFiles(): TFile[]; cachedRead(file: TFile): Promise<string> } },
	issuesPath: string,
): Promise<IssueScanResult> {
	const normalizedIssuesPath = normalizePath(issuesPath);
	const prefix = `${normalizedIssuesPath}/`;
	const issueFiles = app.vault
		.getMarkdownFiles()
		.filter((file) => file.path.startsWith(prefix));

	const issues: SymphonyIssue[] = [];
	const errors: OperatorError[] = [];

	for (const file of issueFiles) {
		try {
			const parsed = await parseIssueFile(app, file);
			if (parsed) {
				issues.push(parsed);
			}
		} catch (error) {
			errors.push({
				timestamp: Date.now(),
				code: "issue_parse_error",
				message: error instanceof Error ? error.message : `Unable to parse ${file.path}.`,
				notePath: file.path,
			});
		}
	}

	return { issues, errors };
}

export async function loadIssueByPath(
	app: { vault: { getAbstractFileByPath(path: string): unknown; cachedRead(file: TFile): Promise<string> } },
	notePath: string,
): Promise<SymphonyIssue | null> {
	const file = app.vault.getAbstractFileByPath(normalizePath(notePath));
	if (!(file instanceof TFile)) {
		return null;
	}

	return parseIssueFile(app, file);
}

async function parseIssueFile(
	app: { vault: { cachedRead(file: TFile): Promise<string> } },
	file: TFile,
): Promise<SymphonyIssue | null> {
	const raw = await app.vault.cachedRead(file);
	const { frontmatter, body } = extractFrontmatter(raw);

	const id = coerceOptionalString(frontmatter.id);
	const identifier = coerceOptionalString(frontmatter.identifier);
	const state = coerceOptionalString(frontmatter.state);
	const title =
		coerceOptionalString(frontmatter.title) ??
		extractFirstHeading(body) ??
		file.basename;

	if (!id || !identifier || !state || !title) {
		return null;
	}

	const createdAt = parseIsoTimestamp(frontmatter.created_at);
	const updatedAt = parseIsoTimestamp(frontmatter.updated_at);
	const labels = coerceStringArray(frontmatter.labels).map((label) => label.toLowerCase());

	return {
		id,
		identifier,
		title,
		description: body || null,
		priority: coerceOptionalInteger(frontmatter.priority),
		state,
		normalizedState: state.trim().toLowerCase(),
		branchName: coerceOptionalString(frontmatter.branch_name),
		url: coerceOptionalString(frontmatter.url),
		labels,
		blockedBy: inferBlockerRefs(frontmatter.blocked_by),
		createdAt: createdAt.raw,
		createdAtMs: createdAt.millis,
		updatedAt: updatedAt.raw,
		updatedAtMs: updatedAt.millis,
		notePath: normalizePath(file.path),
		noteBasename: file.basename,
		versionToken: buildIssueVersionToken(file, state, updatedAt.raw, raw),
	};
}

function buildIssueVersionToken(
	file: TFile,
	state: string,
	updatedAt: string | null,
	raw: string,
): string {
	return `${file.stat.mtime}:${state}:${updatedAt ?? ""}:${sha1(raw)}`;
}
