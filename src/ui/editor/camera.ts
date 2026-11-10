/**
 * Which part of the endless drawing is on screen. `x` and `y` are the drawing coordinates at the
 * top-left corner of the view, and `scale` is screen pixels per drawing unit (1 means 100%).
 */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Where the drawing starts out: its origin at the top-left corner, at full size. */
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, scale: 1 };

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 3;

/** How much one zoom button press or one mouse wheel notch changes the size. */
export const ZOOM_STEP = 1.25;

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** Zooms while keeping the drawing point under `anchor` (in screen pixels from the view's corner) in place. */
export function zoomAt(camera: Camera, factor: number, anchor: Point): Camera {
  const scale = clampScale(camera.scale * factor);
  const pointX = camera.x + anchor.x / camera.scale;
  const pointY = camera.y + anchor.y / camera.scale;
  return { x: pointX - anchor.x / scale, y: pointY - anchor.y / scale, scale };
}

/** Zooms to an exact size around the middle of the view, as the buttons do. */
export function zoomTo(camera: Camera, scale: number, view: Size): Camera {
  return zoomAt(camera, scale / camera.scale, { x: view.width / 2, y: view.height / 2 });
}

/** Moves the view by a distance on screen. Dragging the drawing right by 10 px moves the view left. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.scale, y: camera.y - dy / camera.scale };
}

/**
 * Shows all of `bounds`, centered. Never enlarges past `maxScale`, so a small circuit isn't blown
 * up, and never shrinks past the smallest zoom.
 */
export function fitCamera(bounds: Bounds, view: Size, maxScale = 1): Camera {
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const scale = Math.max(MIN_SCALE, Math.min(maxScale, view.width / width, view.height / height));
  return {
    x: bounds.left - (view.width / scale - width) / 2,
    y: bounds.top - (view.height / scale - height) / 2,
    scale,
  };
}

/** The drawing area the camera shows, for an SVG viewBox. */
export function visibleArea(camera: Camera, view: Size): { x: number; y: number; width: number; height: number } {
  return { x: camera.x, y: camera.y, width: view.width / camera.scale, height: view.height / camera.scale };
}

/** "%100", as the course notes write percentages. */
export const zoomLabel = (camera: Camera): string => `%${Math.round(camera.scale * 100)}`;
