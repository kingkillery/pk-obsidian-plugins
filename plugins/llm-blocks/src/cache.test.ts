import { describe, it, expect } from "vitest";
import { ResponseCache } from "./cache";

describe("ResponseCache", () => {
	it("returns undefined for unknown prompts", async () => {
		const cache = new ResponseCache();
		expect(await cache.get("unknown")).toBeUndefined();
	});

	it("stores and retrieves a response", async () => {
		const cache = new ResponseCache();
		await cache.set("hello", "world");
		const result = await cache.get("hello");
		expect(result).toBeDefined();
		expect(result!.markdown).toBe("world");
		expect(result!.timestamp).toBeGreaterThan(0);
	});

	it("treats trimmed prompts as identical", async () => {
		const cache = new ResponseCache();
		await cache.set("  hello  ", "response");
		const result = await cache.get("hello");
		expect(result).toBeDefined();
		expect(result!.markdown).toBe("response");
	});

	it("uses variant to distinguish cache entries", async () => {
		const cache = new ResponseCache();
		await cache.set("prompt", "response-a", "variant-a");
		await cache.set("prompt", "response-b", "variant-b");

		const a = await cache.get("prompt", "variant-a");
		const b = await cache.get("prompt", "variant-b");
		expect(a!.markdown).toBe("response-a");
		expect(b!.markdown).toBe("response-b");
	});

	it("overwrites existing entry for same prompt+variant", async () => {
		const cache = new ResponseCache();
		await cache.set("prompt", "old");
		await cache.set("prompt", "new");
		const result = await cache.get("prompt");
		expect(result!.markdown).toBe("new");
	});

	it("reports correct size", async () => {
		const cache = new ResponseCache();
		expect(cache.size).toBe(0);
		await cache.set("a", "1");
		await cache.set("b", "2");
		expect(cache.size).toBe(2);
	});

	it("clears all entries", async () => {
		const cache = new ResponseCache();
		await cache.set("a", "1");
		await cache.set("b", "2");
		cache.clear();
		expect(cache.size).toBe(0);
		expect(await cache.get("a")).toBeUndefined();
	});

	it("produces deterministic hashes", async () => {
		const cache = new ResponseCache();
		const h1 = await cache.hashPrompt("test", "v");
		const h2 = await cache.hashPrompt("test", "v");
		expect(h1).toBe(h2);
		expect(h1).toMatch(/^[0-9a-f]{64}$/);
	});

	it("produces different hashes for different inputs", async () => {
		const cache = new ResponseCache();
		const h1 = await cache.hashPrompt("test", "a");
		const h2 = await cache.hashPrompt("test", "b");
		expect(h1).not.toBe(h2);
	});
});
