/* Recorta fuentes locales a una portada JPEG 1200x900. Debe cargarse antes de gestionar-curso.js. */
(() => {
  const MAX_SOURCE_BYTES = 10_000_000;
  const SOURCE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
  const OUTPUT_WIDTH = 1200;
  const OUTPUT_HEIGHT = 900;
  const OUTPUT_MIME = "image/jpeg";
  const OUTPUT_QUALITY = 0.85;
  const BACKGROUND = "#071017";

  function baseScale(iw, ih, width, height) {
    return Math.max(width / iw, height / ih);
  }

  function clampPan(x, y, iw, ih, width, height, zoom) {
    const scale = baseScale(iw, ih, width, height) * zoom;
    const maxX = Math.max(0, (iw * scale - width) / 2);
    const maxY = Math.max(0, (ih * scale - height) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }

  function calculateCrop(iw, ih, width, height, zoom, tx, ty) {
    const scale = baseScale(iw, ih, width, height) * zoom;
    return {
      scale,
      sx: (iw - width / scale) / 2 - tx / scale,
      sy: (ih - height / scale) / 2 - ty / scale,
      sw: width / scale,
      sh: height / scale,
    };
  }

  function validateSource(file) {
    if (!file || !Number.isFinite(file.size) || file.size < 1 || file.size > MAX_SOURCE_BYTES) {
      throw new Error("La imagen debe pesar entre 1 byte y 10 MB.");
    }
    if (!SOURCE_MIMES.has(String(file.type || "").toLowerCase())) {
      throw new Error("Selecciona una imagen JPG, PNG o WebP.");
    }
  }

  function create(options) {
    const canvas = options.canvas;
    const onStateChange = options.onStateChange || (() => {});
    const createBitmap = options.createImageBitmapImpl || globalThis.createImageBitmap?.bind(globalThis);
    const createObjectURL = options.createObjectURL || globalThis.URL?.createObjectURL?.bind(globalThis.URL);
    const revokeObjectURL = options.revokeObjectURL || globalThis.URL?.revokeObjectURL?.bind(globalThis.URL);
    const createCanvas = options.createCanvas || (() => document.createElement("canvas"));
    const ratio = options.devicePixelRatio || (() => globalThis.devicePixelRatio || 1);
    let source = null;
    let generation = 0;
    let zoom = 1;
    let pan = { x: 0, y: 0 };
    let phase = "empty";
    let error = null;
    let fallbackOperation = null;

    function state() {
      return { phase, zoom, minZoom: 1, maxZoom: 3, pan: { ...pan }, error };
    }

    function notify() {
      onStateChange(state());
    }

    function setPhase(next, message = null) {
      phase = next;
      error = message;
      notify();
    }

    function releaseSource() {
      source?.close?.();
      source = null;
      fallbackOperation?.cancel();
      fallbackOperation = null;
    }

    function dimensions() {
      return {
        width: Math.max(1, canvas.clientWidth || 400),
        height: Math.max(1, canvas.clientHeight || 300),
      };
    }

    function render() {
      if (!source || phase === "empty" || phase === "decoding") return;
      const viewport = dimensions();
      const dpr = Math.max(1, ratio());
      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
      const context = canvas.getContext("2d");
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);
      const iw = source.width || source.naturalWidth;
      const ih = source.height || source.naturalHeight;
      pan = clampPan(pan.x, pan.y, iw, ih, viewport.width, viewport.height, zoom);
      const scale = baseScale(iw, ih, viewport.width, viewport.height) * zoom;
      context.drawImage(
        source,
        (viewport.width - iw * scale) / 2 + pan.x,
        (viewport.height - ih * scale) / 2 + pan.y,
        iw * scale,
        ih * scale
      );
    }

    async function decodeFallback(file) {
      if (!createObjectURL || typeof globalThis.Image !== "function") {
        throw new Error("Tu navegador no puede decodificar esta imagen.");
      }
      const objectUrl = createObjectURL(file);
      const image = new globalThis.Image();
      let settled = false;
      let cleaned = false;
      let resolveLoad;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        image.onload = null;
        image.onerror = null;
        image.src = "";
        revokeObjectURL?.(objectUrl);
      };
      const operation = {
        cancel() {
          cleanup();
          if (settled) return;
          settled = true;
          resolveLoad();
        },
      };
      fallbackOperation = operation;
      await new Promise((resolve, reject) => {
        resolveLoad = resolve;
        image.onload = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        image.onerror = () => {
          if (settled) return;
          settled = true;
          cleanup();
          if (fallbackOperation === operation) fallbackOperation = null;
          reject(new Error("No se pudo decodificar la imagen."));
        };
        image.src = objectUrl;
      });
      return image;
    }

    async function decode(file) {
      if (createBitmap) {
        try {
          return await createBitmap(file, { imageOrientation: "from-image" });
        } catch {
          return decodeFallback(file);
        }
      }
      return decodeFallback(file);
    }

    async function load(file) {
      const current = ++generation;
      releaseSource();
      try {
        validateSource(file);
        setPhase("decoding");
        const decoded = await decode(file);
        if (current !== generation) {
          decoded?.close?.();
          return;
        }
        source = decoded;
        zoom = 1;
        pan = { x: 0, y: 0 };
        setPhase("ready");
        render();
      } catch (cause) {
        if (current !== generation) return;
        releaseSource();
        const message = cause?.message || "No se pudo preparar la imagen.";
        setPhase("error", message);
        throw cause;
      }
    }

    function panBy(dx, dy) {
      if (phase !== "ready") return;
      const viewport = dimensions();
      pan = clampPan(
        pan.x + dx, pan.y + dy,
        source.width || source.naturalWidth, source.height || source.naturalHeight,
        viewport.width, viewport.height, zoom
      );
      render();
      notify();
    }

    function setZoom(value) {
      if (phase !== "ready") return;
      zoom = Math.max(1, Math.min(3, Number(value) || 1));
      panBy(0, 0);
    }

    function reset() {
      if (phase !== "ready") return;
      zoom = 1;
      pan = { x: 0, y: 0 };
      render();
      notify();
    }

    async function exportFile() {
      if (phase !== "ready" || !source) throw new Error("Prepara un recorte válido antes de continuar.");
      const temporary = createCanvas();
      temporary.width = OUTPUT_WIDTH;
      temporary.height = OUTPUT_HEIGHT;
      setPhase("exporting");
      try {
        const context = temporary.getContext("2d");
        context.fillStyle = BACKGROUND;
        context.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
        const viewport = dimensions();
        const crop = calculateCrop(
          source.width || source.naturalWidth,
          source.height || source.naturalHeight,
          viewport.width,
          viewport.height,
          zoom,
          pan.x,
          pan.y
        );
        context.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
        const blob = await new Promise((resolve) => temporary.toBlob(resolve, OUTPUT_MIME, OUTPUT_QUALITY));
        if (!blob || blob.size < 1 || blob.type !== OUTPUT_MIME) throw new Error("No se pudo generar un JPEG válido.");
        const verified = await decode(blob);
        try {
          const width = verified.width || verified.naturalWidth;
          const height = verified.height || verified.naturalHeight;
          if (width !== OUTPUT_WIDTH || height !== OUTPUT_HEIGHT) throw new Error("La portada generada no mide 1200 × 900.");
        } finally {
          verified?.close?.();
        }
        setPhase("ready");
        return new File([blob], "course-cover.jpg", { type: OUTPUT_MIME, lastModified: Date.now() });
      } catch (cause) {
        setPhase("error", cause?.message || "No se pudo generar la portada.");
        throw cause;
      } finally {
        temporary.width = 0;
        temporary.height = 0;
      }
    }

    function destroy() {
      generation++;
      releaseSource();
      canvas.width = 0;
      canvas.height = 0;
      phase = "empty";
      error = null;
    }

    return Object.freeze({ load, pan: panBy, setZoom, reset, exportFile, getState: state, render, destroy });
  }

  const api = Object.freeze({ create, calculateCrop, clampPan });
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window === "object") window.courseCoverCropper = api;
})();
