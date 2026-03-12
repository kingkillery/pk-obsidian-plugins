import { describe, it, expect } from "vitest";
import { mat4 } from "gl-matrix";
import { transformPoints } from "./transform";

describe("transformPoints", () => {
	it("returns identity-transformed points unchanged", () => {
		const identity = mat4.create();
		const points = [
			[10, 20],
			[30, 40],
		];
		const result = transformPoints(points, identity);
		expect(result).toHaveLength(2);
		expect(result[0][0]).toBeCloseTo(10);
		expect(result[0][1]).toBeCloseTo(20);
		expect(result[1][0]).toBeCloseTo(30);
		expect(result[1][1]).toBeCloseTo(40);
	});

	it("applies a translation matrix", () => {
		const translate = mat4.create();
		mat4.translate(translate, translate, [100, 200, 0]);
		const points = [[0, 0], [10, 10]];
		const result = transformPoints(points, translate);
		expect(result[0][0]).toBeCloseTo(100);
		expect(result[0][1]).toBeCloseTo(200);
		expect(result[1][0]).toBeCloseTo(110);
		expect(result[1][1]).toBeCloseTo(210);
	});

	it("applies a scaling matrix", () => {
		const scale = mat4.create();
		mat4.scale(scale, scale, [2, 3, 1]);
		const points = [[5, 10]];
		const result = transformPoints(points, scale);
		expect(result[0][0]).toBeCloseTo(10);
		expect(result[0][1]).toBeCloseTo(30);
	});

	it("handles empty point array", () => {
		const identity = mat4.create();
		const result = transformPoints([], identity);
		expect(result).toEqual([]);
	});

	it("returns [number, number] tuples", () => {
		const identity = mat4.create();
		const result = transformPoints([[1, 2]], identity);
		expect(result[0]).toHaveLength(2);
	});

	it("composes translation + scale correctly", () => {
		const m = mat4.create();
		mat4.scale(m, m, [2, 2, 1]);
		mat4.translate(m, m, [10, 10, 0]);
		const result = transformPoints([[0, 0]], m);
		// scale then translate: (0+10)*2 = 20, (0+10)*2 = 20
		expect(result[0][0]).toBeCloseTo(20);
		expect(result[0][1]).toBeCloseTo(20);
	});
});
