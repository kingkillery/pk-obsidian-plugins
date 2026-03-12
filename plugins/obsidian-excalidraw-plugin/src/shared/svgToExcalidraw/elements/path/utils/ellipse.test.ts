import { describe, it, expect } from "vitest";
import { getEllipsesCenter, getEllipsePoints, findArc } from "./ellipse";

describe("getEllipsesCenter", () => {
	it("returns two possible centers", () => {
		const centers = getEllipsesCenter(0, 50, 100, 50, 50, 50);
		expect(centers).toHaveLength(2);
		expect(centers[0]).toHaveLength(2);
		expect(centers[1]).toHaveLength(2);
	});

	it("returns symmetric centers for a circle", () => {
		// Points at (0, 50) and (100, 50) on a circle of radius 50
		const centers = getEllipsesCenter(0, 50, 100, 50, 50, 50);
		// The two centers should be at (50, y1) and (50, y2) symmetric around y=50
		expect(centers[0][0]).toBeCloseTo(50, 0);
		expect(centers[1][0]).toBeCloseTo(50, 0);
	});

	it("computes valid centers that are equidistant from both input points (circle case)", () => {
		const [cx, cy] = [0, 0];
		const [dx, dy] = [100, 0];
		const r = 50;
		const centers = getEllipsesCenter(cx, cy, dx, dy, r, r);

		for (const [centerX, centerY] of centers) {
			const dist1 = Math.sqrt((centerX - cx) ** 2 + (centerY - cy) ** 2);
			const dist2 = Math.sqrt((centerX - dx) ** 2 + (centerY - dy) ** 2);
			expect(dist1).toBeCloseTo(dist2, 0);
		}
	});
});

describe("getEllipsePoints", () => {
	it("returns points on a circle", () => {
		const points = getEllipsePoints(0, 0, 100, 100);
		// Should have ~360 unique points for a large circle
		expect(points.length).toBeGreaterThan(100);
		expect(points.length).toBeLessThanOrEqual(360);
	});

	it("deduplicates points for small radius", () => {
		// With radius 1, many degree steps produce the same rounded point
		const points = getEllipsePoints(0, 0, 1, 1);
		expect(points.length).toBeLessThan(360);
	});

	it("generates points within the ellipse bounds", () => {
		const cx = 50;
		const cy = 50;
		const rx = 30;
		const ry = 20;
		const points = getEllipsePoints(cx, cy, rx, ry);

		for (const [x, y] of points) {
			expect(x).toBeGreaterThanOrEqual(cx - rx - 1);
			expect(x).toBeLessThanOrEqual(cx + rx + 1);
			expect(y).toBeGreaterThanOrEqual(cy - ry - 1);
			expect(y).toBeLessThanOrEqual(cy + ry + 1);
		}
	});

	it("includes points at cardinal positions for a large circle", () => {
		const points = getEllipsePoints(0, 0, 100, 100);
		// Should contain point near (100, 0) — 0 degrees
		const hasRight = points.some(([x, y]) => x === 100 && y === 0);
		expect(hasRight).toBe(true);
	});
});

describe("findArc", () => {
	it("extracts a forward arc segment", () => {
		const points = getEllipsePoints(0, 0, 100, 100);
		const startPoint = points[0]; // ~(100, 0)
		const endIdx = Math.min(45, points.length - 1);
		const endPoint = points[endIdx];

		const arc = findArc(
			points,
			false,
			startPoint[0],
			startPoint[1],
			endPoint[0],
			endPoint[1],
		);

		expect(arc.length).toBeGreaterThan(0);
		// Arc should start at startPoint and end at endPoint
		expect(arc[0][0]).toBe(startPoint[0]);
		expect(arc[0][1]).toBe(startPoint[1]);
		expect(arc[arc.length - 1][0]).toBe(endPoint[0]);
		expect(arc[arc.length - 1][1]).toBe(endPoint[1]);
	});

	it("extracts a sweep (reverse) arc segment", () => {
		const points = getEllipsePoints(0, 0, 100, 100);
		const startIdx = 10;
		const endIdx = 45;
		const startPoint = points[startIdx];
		const endPoint = points[endIdx];

		const arc = findArc(
			points,
			true,
			startPoint[0],
			startPoint[1],
			endPoint[0],
			endPoint[1],
		);

		expect(arc.length).toBeGreaterThan(0);
		expect(arc[0][0]).toBe(startPoint[0]);
		expect(arc[0][1]).toBe(startPoint[1]);
	});
});
