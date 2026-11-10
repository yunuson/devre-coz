import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAMERA,
  fitCamera,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  visibleArea,
  zoomAt,
  zoomLabel,
  zoomTo,
  type Camera,
  type Point,
} from '../../src/ui/editor/camera';

const view = { width: 800, height: 500 };

/** Where a screen point lands in the drawing. */
const drawingPoint = (camera: Camera, screen: Point): Point => ({
  x: camera.x + screen.x / camera.scale,
  y: camera.y + screen.y / camera.scale,
});

describe('zooming', () => {
  it('keeps the point under the cursor where it was', () => {
    const start: Camera = { x: 120, y: -40, scale: 1 };
    const cursor = { x: 300, y: 210 };
    for (const factor of [2, 0.5, 1.25, 0.8]) {
      const zoomed = zoomAt(start, factor, cursor);
      const before = drawingPoint(start, cursor);
      const after = drawingPoint(zoomed, cursor);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
      expect(zoomed.scale).toBeCloseTo(factor);
    }
  });

  it('stops at the smallest and largest size, still keeping the cursor point', () => {
    const cursor = { x: 100, y: 100 };
    const tiny = zoomAt(DEFAULT_CAMERA, 0.001, cursor);
    expect(tiny.scale).toBe(MIN_SCALE);
    expect(drawingPoint(tiny, cursor).x).toBeCloseTo(drawingPoint(DEFAULT_CAMERA, cursor).x);
    expect(zoomAt(DEFAULT_CAMERA, 1000, cursor).scale).toBe(MAX_SCALE);
  });

  it('zooms the buttons around the middle of the view', () => {
    const start: Camera = { x: 50, y: 60, scale: 0.5 };
    const middle = { x: view.width / 2, y: view.height / 2 };
    const zoomed = zoomTo(start, 1, view);
    expect(zoomed.scale).toBe(1);
    expect(drawingPoint(zoomed, middle).x).toBeCloseTo(drawingPoint(start, middle).x);
    expect(drawingPoint(zoomed, middle).y).toBeCloseTo(drawingPoint(start, middle).y);
  });
});

describe('panning', () => {
  it('moves the drawing with the pointer, the same screen distance at any zoom', () => {
    for (const scale of [0.5, 1, 2]) {
      const start: Camera = { x: 10, y: 20, scale };
      const panned = panBy(start, 40, -30);
      // A drawing point that was at (100, 100) on screen is now at (140, 70).
      const point = drawingPoint(start, { x: 100, y: 100 });
      expect((point.x - panned.x) * scale).toBeCloseTo(140);
      expect((point.y - panned.y) * scale).toBeCloseTo(70);
    }
  });

  it('can go to negative coordinates, so there is room above and to the left', () => {
    const panned = panBy(DEFAULT_CAMERA, 300, 200);
    expect(panned.x).toBe(-300);
    expect(panned.y).toBe(-200);
  });
});

describe('fitting a circuit on screen', () => {
  it('shows all of it, centered', () => {
    const bounds = { left: 100, top: 50, right: 2100, bottom: 650 };
    const camera = fitCamera(bounds, view);
    const area = visibleArea(camera, view);
    expect(area.x).toBeLessThanOrEqual(bounds.left);
    expect(area.y).toBeLessThanOrEqual(bounds.top);
    expect(area.x + area.width).toBeGreaterThanOrEqual(bounds.right - 1e-9);
    expect(area.y + area.height).toBeGreaterThanOrEqual(bounds.bottom - 1e-9);
    // Centered: the same room on both sides of the direction that has room to spare.
    expect(bounds.top - area.y).toBeCloseTo(area.y + area.height - bounds.bottom);
  });

  it('fits a tall circuit by its height, centered sideways', () => {
    const bounds = { left: 0, top: 0, right: 200, bottom: 2000 };
    const camera = fitCamera(bounds, view);
    const area = visibleArea(camera, view);
    expect(area.y).toBeLessThanOrEqual(bounds.top + 1e-9);
    expect(area.y + area.height).toBeGreaterThanOrEqual(bounds.bottom - 1e-9);
    expect(bounds.left - area.x).toBeCloseTo(area.x + area.width - bounds.right);
    expect(bounds.left - area.x).toBeGreaterThan(0);
  });

  it('does not blow up a small circuit past full size', () => {
    const camera = fitCamera({ left: 0, top: 0, right: 100, bottom: 60 }, view);
    expect(camera.scale).toBe(1);
  });

  it('can be allowed to enlarge', () => {
    const camera = fitCamera({ left: 0, top: 0, right: 100, bottom: 60 }, view, MAX_SCALE);
    expect(camera.scale).toBe(MAX_SCALE);
  });

  it('never shrinks past the smallest zoom, even for a huge circuit', () => {
    expect(fitCamera({ left: 0, top: 0, right: 100000, bottom: 10 }, view).scale).toBe(MIN_SCALE);
  });
});

describe('what the view shows', () => {
  it('covers more of the drawing when zoomed out', () => {
    expect(visibleArea({ x: 5, y: 6, scale: 0.5 }, view)).toEqual({ x: 5, y: 6, width: 1600, height: 1000 });
  });

  it('labels the zoom the Turkish way', () => {
    expect(zoomLabel(DEFAULT_CAMERA)).toBe('%100');
    expect(zoomLabel({ ...DEFAULT_CAMERA, scale: 0.8 })).toBe('%80');
    // Three steps out is 1 / 1.25³ = 0.512, shown whole.
    expect(zoomLabel({ ...DEFAULT_CAMERA, scale: 0.512 })).toBe('%51');
  });
});
