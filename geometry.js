'use strict';
/*
 * Shared viewfinder geometry. The preview canvas and the exported file both go
 * through frame(), so what you see inside the bright crop box is exactly what
 * gets written to disk.
 *
 * Model
 *   - The camera screen is always SCREEN_RATIO (3:2), whatever the photo is.
 *   - The photo covers that screen (never letterboxed, never stretched);
 *     zoom 1 is the cover scale, so zoom >= 1 can never expose an empty edge.
 *   - The output crop box is the largest rectangle of the chosen ratio that
 *     fits inside the screen, centred — fit-height when the ratio is wider
 *     than 3:2 is impossible, so it is always fit-width or fit-height.
 */
(function (global) {
  const SCREEN_RATIO = 3 / 2;
  const EPSILON = 1e-9;

  const RATIOS = [
    {id: '3:2', value: 3 / 2, label: '3:2 · 標準'},
    {id: '4:3', value: 4 / 3, label: '4:3 · 經典'},
    {id: '16:9', value: 16 / 9, label: '16:9 · 寬景'},
    {id: '1:1', value: 1, label: '1:1 · 方形'},
    {id: '3:4', value: 3 / 4, label: '3:4 · 直式'},
    {id: '4:5', value: 4 / 5, label: '4:5 · 社群'},
    {id: '9:16', value: 9 / 16, label: '9:16 · 直幅'}
  ];

  /* Largest rect of `ratio` centred inside a screenW × screenH box. */
  function cropBox(screenW, screenH, ratio) {
    const width = Math.min(screenW, screenH * ratio);
    const height = width / ratio;
    return {x: (screenW - width) / 2, y: (screenH - height) / 2, width, height};
  }

  /* Fraction of the photo's width/height that the 3:2 screen can see. */
  function coverFraction(imageWidth, imageHeight, zoom) {
    const aspect = imageWidth / imageHeight, scale = Math.max(1, zoom || 1);
    const wide = aspect >= SCREEN_RATIO;
    return {fx: (wide ? SCREEN_RATIO / aspect : 1) / scale, fy: (wide ? 1 : aspect / SCREEN_RATIO) / scale};
  }

  /* Keep the visible window inside the photo so no blank edge can appear. */
  function clampCenter(center, fraction) {
    if (!(fraction < 1 - EPSILON)) return .5;
    const half = fraction / 2;
    return Math.min(1 - half, Math.max(half, Number.isFinite(center) ? center : .5));
  }

  function clampRect(rect, imageWidth, imageHeight) {
    rect.x = Math.min(Math.max(0, rect.x), Math.max(0, imageWidth - rect.width));
    rect.y = Math.min(Math.max(0, rect.y), Math.max(0, imageHeight - rect.height));
    return rect;
  }

  /*
   * options: {imageWidth, imageHeight, zoom, centerX, centerY, ratio}
   * returns  screen — source rect feeding the whole 3:2 screen
   *          crop   — source rect feeding the export (always exactly `ratio`)
   *          box    — crop box as percentages of the screen, for CSS overlays
   */
  function frame(options) {
    const imageWidth = options.imageWidth, imageHeight = options.imageHeight;
    const ratio = options.ratio || SCREEN_RATIO;
    const cover = coverFraction(imageWidth, imageHeight, options.zoom);
    const centerX = clampCenter(options.centerX, cover.fx);
    const centerY = clampCenter(options.centerY, cover.fy);

    const screen = clampRect({
      x: (centerX - cover.fx / 2) * imageWidth,
      y: (centerY - cover.fy / 2) * imageHeight,
      width: cover.fx * imageWidth,
      height: cover.fy * imageHeight
    }, imageWidth, imageHeight);

    // Crop box expressed as fractions of the screen, then mapped onto the source.
    const box = cropBox(1, 1 / SCREEN_RATIO, ratio);
    const left = box.x, top = box.y * SCREEN_RATIO;
    const width = box.width, height = box.height * SCREEN_RATIO;

    const crop = clampRect({
      x: screen.x + left * screen.width,
      y: screen.y + top * screen.height,
      width: width * screen.width,
      height: height * screen.height
    }, imageWidth, imageHeight);

    return {
      centerX, centerY, fx: cover.fx, fy: cover.fy, screen, crop,
      box: {left: left * 100, top: top * 100, width: width * 100, height: height * 100},
      pannable: cover.fx < 1 - EPSILON || cover.fy < 1 - EPSILON
    };
  }

  /* Native-resolution export, capped on the long edge, never upscaled. */
  function exportSize(crop, ratio, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(crop.width, crop.height));
    let width = Math.max(1, Math.round(crop.width * scale));
    let height = Math.max(1, Math.round(width / ratio));
    if (height > maxEdge) {
      height = maxEdge;
      width = Math.max(1, Math.round(height * ratio));
    }
    return {width, height};
  }

  global.EZGeometry = {SCREEN_RATIO, RATIOS, cropBox, coverFraction, clampCenter, frame, exportSize};
})(typeof globalThis !== 'undefined' ? globalThis : this);
