import { describe, it, expect } from "vitest";
import FrontmatterEditor from "./Frontmatter";

describe("FrontmatterEditor", () => {
	const sampleDoc = `---
title: My Note
tags: test
---
# Hello World

Some content here.`;

	describe("constructor parsing", () => {
		it("parses frontmatter from a valid document", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			expect(editor.hasKey("title")).toBe(true);
			expect(editor.hasKey("tags")).toBe(true);
		});

		it("handles document without frontmatter", () => {
			const editor = new FrontmatterEditor("Just some text");
			expect(editor.hasKey("title")).toBe(false);
			expect(editor.data).toBe("Just some text");
		});

		it("handles empty string", () => {
			const editor = new FrontmatterEditor("");
			expect(editor.data).toBe("");
		});

		it("normalizes \\r\\n line endings", () => {
			const doc = "---\r\ntitle: Test\r\n---\r\nContent";
			const editor = new FrontmatterEditor(doc);
			expect(editor.hasKey("title")).toBe(true);
		});
	});

	describe("hasKey", () => {
		it("returns true for existing keys", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			expect(editor.hasKey("title")).toBe(true);
			expect(editor.hasKey("tags")).toBe(true);
		});

		it("returns false for non-existent keys", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			expect(editor.hasKey("nonexistent")).toBe(false);
		});

		it("returns false when frontmatter is absent", () => {
			const editor = new FrontmatterEditor("no frontmatter");
			expect(editor.hasKey("title")).toBe(false);
		});
	});

	describe("setKey", () => {
		it("updates an existing key", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			editor.setKey("title", "Updated Title");
			expect(editor.data).toContain("title: Updated Title");
		});

		it("adds a new key", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			editor.setKey("author", "Alice");
			expect(editor.data).toContain("author: Alice");
		});

		it("sanitizes colons in values by replacing with semicolons", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			editor.setKey("url", "https://example.com");
			expect(editor.data).toContain("url: https;//example.com");
		});

		it("collapses multi-line values into single line", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			editor.setKey("desc", "line one\nline two\nline three");
			expect(editor.data).toContain("desc: line one line two line three");
		});

		it("is a no-op when frontmatter is absent", () => {
			const editor = new FrontmatterEditor("no frontmatter");
			editor.setKey("key", "value");
			expect(editor.data).toBe("no frontmatter");
		});
	});

	describe("data getter", () => {
		it("reconstructs full document with frontmatter delimiters", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			const output = editor.data;
			expect(output).toMatch(/^---\n/);
			expect(output).toContain("---\n# Hello World");
		});

		it("preserves body content after frontmatter", () => {
			const editor = new FrontmatterEditor(sampleDoc);
			expect(editor.data).toContain("Some content here.");
		});

		it("roundtrips without modification when no changes are made", () => {
			const simpleDoc = "---\ntitle: Test\n---\nBody";
			const editor = new FrontmatterEditor(simpleDoc);
			const output = editor.data;
			expect(output).toContain("title: Test");
			expect(output).toContain("Body");
		});
	});
});
