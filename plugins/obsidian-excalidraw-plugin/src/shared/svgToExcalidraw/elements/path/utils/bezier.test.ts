import { describe, it, expect } from "vitest";
import { curveToPoints } from "./bezier";

describe("curveToPoints", () => {
	describe("cubic bezier", () => {
		const controlPoints = [
			[0, 0],
			[0, 100],
			[100, 100],
			[100, 0],
		];

		it("returns the requested number of points", () => {
			const points = curveToPoints("cubic", controlPoints, 10);
			expect(points).toHaveLength(10);
		});

		it("ends at the last control point", () => {
			const points = curveToPoints("cubic", controlPoints, 10);
			const lastPoint = points[points.length - 1];
			expect(lastPoint[0]).toBeCloseTo(100, 0);
			expect(lastPoint[1]).toBeCloseTo(0, 0);
		});

		it("produces intermediate points between endpoints", () => {
			const points = curveToPoints("cubic", controlPoints, 10);
			// midpoint of an S-curve should have Y > 0
			const midPoint = points[4];
			expect(midPoint[1]).toBeGreaterThan(0);
		});

		it("returns 2D points", () => {
			const points = curveToPoints("cubic", controlPoints, 5);
			for (const point of points) {
				expect(point).toHaveLength(2);
				expect(typeof point[0]).toBe("number");
				expect(typeof point[1]).toBe("number");
			}
		});

		it("respects the straight line case", () => {
			const straightLine = [
				[0, 0],
				[33, 0],
				[66, 0],
				[100, 0],
			];
			const points = curveToPoints("cubic", straightLine, 5);
			for (const point of points) {
				expect(point[1]).toBeCloseTo(0, 1);
			}
		});
	});

	describe("quadratic bezier", () => {
		const controlPoints = [
			[0, 0],
			[50, 100],
			[100, 0],
		];

		it("returns the requested number of points", () => {
			const points = curveToPoints("quadratic", controlPoints, 8);
			expect(points).toHaveLength(8);
		});

		it("ends at the last control point", () => {
			const points = curveToPoints("quadratic", controlPoints, 10);
			const lastPoint = points[points.length - 1];
			expect(lastPoint[0]).toBeCloseTo(100, 0);
			expect(lastPoint[1]).toBeCloseTo(0, 0);
		});

		it("peaks near the middle for symmetric control points", () => {
			const points = curveToPoints("quadratic", controlPoints, 10);
			const midPoint = points[4];
			expect(midPoint[1]).toBeGreaterThan(0);
		});
	});

	describe("edge cases", () => {
		it("throws for zero points", () => {
			expect(() =>
				curveToPoints("cubic", [[0, 0], [0, 0], [0, 0], [0, 0]], 0),
			).toThrow("positive");
		});

		it("throws for negative points", () => {
			expect(() =>
				curveToPoints("cubic", [[0, 0], [0, 0], [0, 0], [0, 0]], -5),
			).toThrow("positive");
		});

		it("caps at 100 points", () => {
			const points = curveToPoints("cubic", [[0, 0], [0, 100], [100, 100], [100, 0]], 200);
			expect(points).toHaveLength(100);
		});

		it("handles single point request", () => {
			const points = curveToPoints("cubic", [[0, 0], [0, 100], [100, 100], [100, 0]], 1);
			expect(points).toHaveLength(1);
			// single point at t=1 should be the end point
			expect(points[0][0]).toBeCloseTo(100, 0);
			expect(points[0][1]).toBeCloseTo(0, 0);
		});
	});
});
