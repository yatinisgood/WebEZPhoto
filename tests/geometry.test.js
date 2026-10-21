'use strict';
/*
 * Dependency-free checks for the shared viewfinder geometry.
 *
 *   node tests/geometry.test.js
 *   jsc geometry.js tests/geometry.test.js      (macOS JavaScriptCore)
 *   <script src="../geometry.js"></script><script src="geometry.test.js"></script>
 */
if (typeof require === 'function' && !globalThis.EZGeometry) require('../geometry.js');
(function () {
  const {SCREEN_RATIO, RATIOS, cropBox, frame, exportSize} = globalThis.EZGeometry;
  const log = typeof print === 'function' ? print : console.log;

  let passed = 0, failed = 0;
  const near = (a, b, tolerance) => Math.abs(a - b) <= (tolerance === undefined ? 1e-6 : tolerance);
  function ok(condition, message) { if (!condition) throw new Error(message); }
  function test(name, run) {
    try { run(); passed++; }
    catch (error) { failed++; log(`FAIL ${name}\n     ${error.message}`); }
  }

  const SOURCES = [[4000, 3000], [3000, 4000], [1920, 1080], [6000, 4000], [1080, 1080]];

  test('screen is 3:2', () => ok(near(SCREEN_RATIO, 1.5), `SCREEN_RATIO ${SCREEN_RATIO}`));

  test('crop box follows fit-width / fit-height on a 900x600 screen', () => {
    const expected = {'3:2': [900, 600], '4:3': [800, 600], '16:9': [900, 506.25], '1:1': [600, 600], '3:4': [450, 600]};
    for (const id of Object.keys(expected)) {
      const [width, height] = expected[id];
      const box = cropBox(900, 600, RATIOS.find(r => r.id === id).value);
      ok(near(box.width, width), `${id} width ${box.width} != ${width}`);
      ok(near(box.height, height), `${id} height ${box.height} != ${height}`);
      ok(near(box.x, (900 - width) / 2) && near(box.y, (600 - height) / 2), `${id} is not centred`);
      ok(box.width <= 900 + 1e-9 && box.height <= 600 + 1e-9, `${id} escapes the screen`);
    }
  });

  test('the screen window always has the 3:2 shape and stays inside the photo', () => {
    for (const [width, height] of SOURCES)
      for (const zoom of [1, 1.4, 2, 3])
        for (const [cx, cy] of [[.5, .5], [0, 0], [1, 1], [.2, .9]]) {
          const geo = frame({imageWidth: width, imageHeight: height, zoom, centerX: cx, centerY: cy, ratio: 1});
          ok(near(geo.screen.width / geo.screen.height, SCREEN_RATIO), `${width}x${height} window shape`);
          ok(geo.screen.x >= -1e-9 && geo.screen.y >= -1e-9, `${width}x${height} window starts outside the photo`);
          ok(geo.screen.x + geo.screen.width <= width + 1e-6, `${width}x${height} window overruns the width`);
          ok(geo.screen.y + geo.screen.height <= height + 1e-6, `${width}x${height} window overruns the height`);
        }
  });

  test('export crop matches the chosen ratio and sits inside the screen window', () => {
    for (const [width, height] of SOURCES)
      for (const ratio of RATIOS)
        for (const zoom of [1, 2, 3]) {
          const geo = frame({imageWidth: width, imageHeight: height, zoom, centerX: .35, centerY: .7, ratio: ratio.value});
          ok(near(geo.crop.width / geo.crop.height, ratio.value), `${ratio.id} crop shape`);
          ok(geo.crop.x >= geo.screen.x - 1e-6 && geo.crop.y >= geo.screen.y - 1e-6, `${ratio.id} crop left/top`);
          ok(geo.crop.x + geo.crop.width <= geo.screen.x + geo.screen.width + 1e-6, `${ratio.id} crop right`);
          ok(geo.crop.y + geo.crop.height <= geo.screen.y + geo.screen.height + 1e-6, `${ratio.id} crop bottom`);
          ok(geo.crop.x >= -1e-9 && geo.crop.x + geo.crop.width <= width + 1e-6, `${ratio.id} crop leaves the photo`);
        }
  });

  test('crop box percentages are centred and use the maximum fit', () => {
    for (const ratio of RATIOS) {
      const geo = frame({imageWidth: 4000, imageHeight: 3000, zoom: 1, centerX: .5, centerY: .5, ratio: ratio.value});
      ok(geo.box.width <= 100 + 1e-9 && geo.box.height <= 100 + 1e-9, `${ratio.id} overflows the screen`);
      ok(near(geo.box.left * 2 + geo.box.width, 100) && near(geo.box.top * 2 + geo.box.height, 100), `${ratio.id} is off-centre`);
      ok(near(geo.box.width, 100) || near(geo.box.height, 100), `${ratio.id} is not the maximum fit`);
    }
  });

  test('switching the output ratio keeps zoom and centre untouched', () => {
    const base = {imageWidth: 3000, imageHeight: 4000, zoom: 2, centerX: .3, centerY: .65};
    const reference = frame(Object.assign({}, base, {ratio: 1.5}));
    for (const ratio of RATIOS) {
      const geo = frame(Object.assign({}, base, {ratio: ratio.value}));
      ok(near(geo.centerX, reference.centerX) && near(geo.centerY, reference.centerY), `${ratio.id} moved the photo`);
      ok(near(geo.screen.x, reference.screen.x) && near(geo.screen.width, reference.screen.width), `${ratio.id} moved the window`);
    }
  });

  test('zoom 1 covers the screen for every source shape, so no blank edge is possible', () => {
    for (const [width, height] of SOURCES.concat([[10000, 500], [500, 10000]])) {
      const geo = frame({imageWidth: width, imageHeight: height, zoom: 1, centerX: .5, centerY: .5, ratio: 9 / 16});
      ok(near(Math.max(geo.fx, geo.fy), 1), `${width}x${height} is not a cover fit`);
      ok(geo.fx <= 1 + 1e-9 && geo.fy <= 1 + 1e-9, `${width}x${height} asks for pixels outside the photo`);
    }
  });

  test('zoom below 1 is refused so the crop can never show an empty edge', () => {
    const low = frame({imageWidth: 4000, imageHeight: 3000, zoom: .4, centerX: .5, centerY: .5, ratio: 1.5});
    const one = frame({imageWidth: 4000, imageHeight: 3000, zoom: 1, centerX: .5, centerY: .5, ratio: 1.5});
    ok(near(low.screen.width, one.screen.width) && near(low.screen.height, one.screen.height), 'zoom < 1 was honoured');
  });

  test('panning is offered exactly when there is room to move', () => {
    ok(frame({imageWidth: 3000, imageHeight: 2000, zoom: 1, centerX: .5, centerY: .5, ratio: 1.5}).pannable === false, '3:2 at 1x should be locked');
    ok(frame({imageWidth: 3000, imageHeight: 2000, zoom: 1.4, centerX: .5, centerY: .5, ratio: 1.5}).pannable === true, '3:2 zoomed should pan');
    ok(frame({imageWidth: 4000, imageHeight: 3000, zoom: 1, centerX: .5, centerY: .5, ratio: 1.5}).pannable === true, '4:3 at 1x should pan sideways');
    ok(frame({imageWidth: 3000, imageHeight: 4000, zoom: 1, centerX: .5, centerY: .5, ratio: 1.5}).pannable === true, '3:4 at 1x should pan vertically');
  });

  // app.js previews from a <=1600 px proxy but exports from the original file;
  // both call frame(), so the two crops must describe the same patch of photo.
  test('preview proxy and full-resolution export agree on the crop', () => {
    for (const [width, height] of SOURCES) {
      const scale = Math.min(1, 1600 / Math.max(width, height));
      const proxy = [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
      for (const ratio of RATIOS)
        for (const zoom of [1, 1.4, 3])
          for (const [cx, cy] of [[.5, .5], [.18, .82]]) {
            const options = {zoom, centerX: cx, centerY: cy, ratio: ratio.value};
            const a = frame(Object.assign({imageWidth: proxy[0], imageHeight: proxy[1]}, options));
            const b = frame(Object.assign({imageWidth: width, imageHeight: height}, options));
            for (const key of ['x', 'width']) ok(near(a.crop[key] / proxy[0], b.crop[key] / width, 2e-3), `${width}x${height} ${ratio.id} crop.${key} drifted`);
            for (const key of ['y', 'height']) ok(near(a.crop[key] / proxy[1], b.crop[key] / height, 2e-3), `${width}x${height} ${ratio.id} crop.${key} drifted`);
          }
    }
  });

  test('export size keeps the ratio, caps the long edge, and never upscales', () => {
    const cases = [
      [{width: 1920, height: 1080}, 16 / 9, 1920, 1080],
      [{width: 6000, height: 4000}, 3 / 2, 4096, 2731],
      [{width: 3000, height: 4000}, 3 / 4, 3000, 4000],
      [{width: 3000, height: 6000}, 1 / 2, 2048, 4096]
    ];
    for (const [crop, ratio, width, height] of cases) {
      const size = exportSize(crop, ratio, 4096);
      ok(size.width === width && size.height === height, `${crop.width}x${crop.height} -> ${size.width}x${size.height}, expected ${width}x${height}`);
    }
    for (const ratio of RATIOS) {
      const geo = frame({imageWidth: 6000, imageHeight: 4000, zoom: 1, centerX: .5, centerY: .5, ratio: ratio.value});
      const size = exportSize(geo.crop, ratio.value, 4096);
      ok(Math.max(size.width, size.height) <= 4096, `${ratio.id} exceeds 4096 px`);
      ok(Math.abs(size.width / size.height - ratio.value) < .002, `${ratio.id} export shape drifted`);
      ok(size.width <= Math.round(geo.crop.width) + 1, `${ratio.id} upscaled the source`);
    }
  });

  log(`${passed} geometry checks passed, ${failed} failed`);
  if (failed && typeof process !== 'undefined') process.exitCode = 1;
})();
