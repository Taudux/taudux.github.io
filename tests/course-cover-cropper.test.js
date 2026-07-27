const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { File } = require("node:buffer");

const { create, calculateCrop, clampPan } = require(path.resolve(
  "src/app/features/courses/course-cover-cropper.js"
));
const { crearFlujoMutacionCurso } = require(path.resolve(
  "src/app/core/cursos/portadas-curso.service.js"
));

function sourceFile({ size = 1, type = "image/png" } = {}) {
  return new File([new Uint8Array(size)], "source.png", { type });
}

function canvasHarness(blob = new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)], { type: "image/jpeg" })) {
  const calls = [];
  const context = {
    fillStyle: "",
    setTransform: (...args) => calls.push(["setTransform", ...args]),
    clearRect: (...args) => calls.push(["clearRect", ...args]),
    fillRect: (...args) => calls.push(["fillRect", context.fillStyle, ...args]),
    drawImage: (...args) => calls.push(["drawImage", ...args]),
  };
  const canvas = {
    clientWidth: 400,
    clientHeight: 300,
    width: 0,
    height: 0,
    getContext: () => context,
    toBlob(callback, type, quality) {
      calls.push(["toBlob", type, quality]);
      callback(blob);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
  };
  return { canvas, calls };
}

function createHarness(options = {}) {
  const preview = canvasHarness();
  const exportCanvas = canvasHarness(options.blob);
  let closed = 0;
  const bitmaps = options.bitmaps || [
    { width: 1600, height: 900, close() { closed++; } },
    { width: 1200, height: 900, close() { closed++; } },
  ];
  const cropper = create({
    canvas: preview.canvas,
    createCanvas: () => exportCanvas.canvas,
    createImageBitmapImpl: async () => bitmaps.shift(),
    createObjectURL: () => "blob:source",
    revokeObjectURL() {},
    devicePixelRatio: () => 2,
  });
  return { cropper, preview, exportCanvas, get closed() { return closed; } };
}

function fallbackHarness(t) {
  const originalImage = globalThis.Image;
  const images = [];
  const revoked = [];
  let nextUrl = 0;
  globalThis.Image = class ControlledImage {
    constructor() {
      this.naturalWidth = 1200;
      this.naturalHeight = 900;
      this.src = "";
      images.push(this);
    }
  };
  t.after(() => { globalThis.Image = originalImage; });
  const { canvas } = canvasHarness();
  const cropper = create({
    canvas,
    createObjectURL: () => `blob:source-${++nextUrl}`,
    revokeObjectURL: (url) => revoked.push(url),
  });
  return { cropper, images, revoked };
}

test("source selection accepts the exact decimal boundary and rejects invalid guidance inputs", async () => {
  const accepted = createHarness();
  await accepted.cropper.load(sourceFile({ size: 10_000_000, type: "image/webp" }));
  assert.equal(accepted.cropper.getState().phase, "ready");

  for (const file of [
    sourceFile({ size: 0 }),
    sourceFile({ size: 10_000_001 }),
    sourceFile({ type: "image/gif" }),
  ]) {
    const harness = createHarness();
    await assert.rejects(harness.cropper.load(file));
    assert.equal(harness.cropper.getState().phase, "error");
  }
});

test("geometry fills 4:3 output, clamps pan, zooms, and resets to center", async () => {
  assert.deepEqual(calculateCrop(1600, 900, 400, 300, 1, 0, 0), {
    scale: 1 / 3,
    sx: 200,
    sy: 0,
    sw: 1200,
    sh: 900,
  });
  const clamped = clampPan(999, -999, 1600, 900, 400, 300, 1);
  assert.ok(Math.abs(clamped.x - 200 / 3) < Number.EPSILON * 256);
  assert.equal(Math.abs(clamped.y), 0);
  const { cropper } = createHarness();
  await cropper.load(sourceFile());
  cropper.setZoom(2);
  cropper.pan(500, -500);
  assert.equal(cropper.getState().zoom, 2);
  cropper.reset();
  assert.equal(cropper.getState().zoom, 1);
  assert.deepEqual(cropper.getState().pan, { x: 0, y: 0 });
});

test("a stale decode is closed and cannot replace the newest source", async () => {
  const resolvers = [];
  let closed = 0;
  const { canvas } = canvasHarness();
  const cropper = create({
    canvas,
    createImageBitmapImpl: () => new Promise((resolve) => resolvers.push(resolve)),
  });
  const first = cropper.load(sourceFile());
  const second = cropper.load(sourceFile({ type: "image/jpeg" }));
  resolvers[1]({ width: 1200, height: 900, close() { closed++; } });
  await second;
  resolvers[0]({ width: 800, height: 600, close() { closed++; } });
  await first;
  assert.equal(cropper.getState().phase, "ready");
  assert.equal(closed, 1);
  cropper.destroy();
  assert.equal(closed, 2);
});

test("fallback supersession and destruction settle silently with latest-wins resource ownership", async (t) => {
  const { cropper, images, revoked } = fallbackHarness(t);
  let firstSettlements = 0;
  const first = cropper.load(sourceFile()).then(() => { firstSettlements++; });
  const staleError = images[0].onerror;
  const second = cropper.load(sourceFile({ type: "image/jpeg" }));
  images[1].onload();
  await second;
  await Promise.resolve();

  assert.equal(firstSettlements, 1);
  assert.equal(cropper.getState().phase, "ready");
  assert.equal(images[0].src, "");
  assert.deepEqual(revoked, ["blob:source-1"]);
  staleError(new Error("late stale failure"));
  assert.equal(cropper.getState().phase, "ready");
  await first;

  const third = cropper.load(sourceFile());
  let thirdSettlements = 0;
  third.then(() => { thirdSettlements++; });
  const staleLoad = images[2].onload;
  cropper.destroy();
  await third;
  assert.equal(thirdSettlements, 1);
  assert.equal(cropper.getState().phase, "empty");
  staleLoad();
  assert.equal(cropper.getState().phase, "empty");
  assert.deepEqual(revoked, ["blob:source-1", "blob:source-2", "blob:source-3"]);
  assert.equal(new Set(revoked).size, revoked.length);
});

test("upload rejection keeps the prepared crop ready for one-at-a-time manual retry", async () => {
  const { cropper } = createHarness();
  await cropper.load(sourceFile());
  cropper.setZoom(2);
  cropper.pan(25, -15);
  const prepared = cropper.getState();
  let uploadAttempts = 0;
  const error = Object.assign(new Error("La portada generada no es un JPEG válido de 1200 × 900."), {
    code: "invalid_image",
  });
  const flow = crearFlujoMutacionCurso({
    subirPortada: async () => { uploadAttempts++; throw error; },
    crearCurso: async () => { throw new Error("must not save"); },
    actualizarCurso: async () => { throw new Error("must not save"); },
    generarOperacionId: () => "operation-1",
  });
  const result = await flow.ejecutar({
    cursoId: null,
    datos: { titulo: "Curso" },
    archivoPortada: sourceFile({ type: "image/jpeg" }),
    firma: "same-crop",
    controles: [],
  });

  assert.equal(result.codigo, "invalid_image");
  assert.equal(uploadAttempts, 1);
  assert.deepEqual(cropper.getState(), prepared);
});

test("export flattens onto #071017 and verifies a non-empty 1200x900 JPEG", async () => {
  const harness = createHarness();
  await harness.cropper.load(sourceFile());
  const file = await harness.cropper.exportFile();
  assert.equal(file.name, "course-cover.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.ok(file.size > 0);
  assert.deepEqual(harness.exportCanvas.calls.find((call) => call[0] === "fillRect").slice(1, 2), ["#071017"]);
  assert.deepEqual(harness.exportCanvas.calls.find((call) => call[0] === "toBlob").slice(1), ["image/jpeg", 0.85]);
  assert.equal(harness.exportCanvas.canvas.width, 0);
  assert.equal(harness.exportCanvas.canvas.height, 0);
});

test("export blocks null, wrong MIME, and decoded dimension mismatches while releasing resources", async () => {
  for (const blob of [null, new Blob([Uint8Array.of(1)], { type: "image/png" })]) {
    const harness = createHarness({ blob });
    await harness.cropper.load(sourceFile());
    await assert.rejects(harness.cropper.exportFile());
    assert.equal(harness.cropper.getState().phase, "error");
  }
  const mismatch = createHarness({
    bitmaps: [
      { width: 1600, height: 900, close() {} },
      { width: 1199, height: 900, close() {} },
    ],
  });
  await mismatch.cropper.load(sourceFile());
  await assert.rejects(mismatch.cropper.exportFile());
  assert.equal(mismatch.exportCanvas.canvas.width, 0);
});
