export const MAX_FILE_BYTES = 10_000_000;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 40_000_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const MIME_FORMATS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
function invalid() {
  throw new Error("Invalid image file.");
}
function be16(bytes, offset) {
  return bytes[offset] * 256 + bytes[offset + 1];
}
function be32(bytes, offset) {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 + bytes[offset + 3];
}
function le32(bytes, offset) {
  return (bytes[offset] + bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 + bytes[offset + 3] * 0x1000000) >>> 0;
}
function text(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}
function dimensions(width, height) {
  if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION ||
      width * height > MAX_PIXELS) invalid();
  return { width, height };
}
function inspectPng(bytes) {
  let offset = 8;
  let imageData = false;
  let size;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) invalid();
    const length = be32(bytes, offset);
    const type = text(bytes, offset + 4);
    const end = offset + length + 12;
    if (end > bytes.length) invalid();
    if (offset === 8) {
      if (type !== "IHDR" || length !== 13) invalid();
      size = dimensions(be32(bytes, offset + 8), be32(bytes, offset + 12));
      const depth = bytes[offset + 16];
      const color = bytes[offset + 17];
      const legalDepths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!legalDepths[color]?.includes(depth) || bytes[offset + 18] !== 0 ||
          bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) invalid();
    } else if (type === "IHDR") invalid();
    if (type === "IDAT" && length > 0) imageData = true;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length || !imageData) invalid();
      return size;
    }
    offset = end;
  }
  invalid();
}
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function inspectJpeg(bytes) {
  let offset = 2;
  let size;
  let sawScan = false;
  let entropy = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) invalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (offset !== bytes.length || !size || !sawScan || !entropy) invalid();
      return size;
    }
    if (!marker || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) ||
        offset + 2 > bytes.length) invalid();
    const length = be16(bytes, offset);
    const data = offset + 2;
    const end = offset + length;
    if (length < 2 || end > bytes.length) invalid();
    if (SOF_MARKERS.has(marker)) {
      const components = bytes[data + 5];
      if (size || length !== 8 + 3 * components) invalid();
      size = dimensions(be16(bytes, data + 3), be16(bytes, data + 1));
    }
    if (marker !== 0xda) {
      offset = end;
      continue;
    }
    const components = bytes[data];
    if (!size || !components || length !== 6 + 2 * components) invalid();
    sawScan = true;
    offset = end;
    let nextMarker = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) {
        entropy = true;
        offset++;
        continue;
      }
      const markerStart = offset;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const next = bytes[offset];
      if (next === 0x00) {
        entropy = true;
        offset++;
      } else if (next >= 0xd0 && next <= 0xd7) {
        offset++;
      } else {
        offset = markerStart;
        nextMarker = true;
        break;
      }
    }
    if (!nextMarker) invalid();
  }
  invalid();
}
function inspectWebp(bytes) {
  if (bytes.length < 26 || le32(bytes, 4) !== bytes.length - 8) invalid();
  let offset = 12;
  let canvas;
  let image;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) invalid();
    const type = text(bytes, offset);
    const length = le32(bytes, offset + 4);
    const data = offset + 8;
    const end = data + length;
    const next = end + (length & 1);
    if (next > bytes.length || ((length & 1) && bytes[end] !== 0)) invalid();
    if (type === "VP8X") {
      if (offset !== 12 || canvas || length !== 10 || (bytes[data] & 0xc1) ||
          bytes[data + 1] || bytes[data + 2] || bytes[data + 3]) invalid();
      const width = 1 + bytes[data + 4] + bytes[data + 5] * 256 + bytes[data + 6] * 65536;
      const height = 1 + bytes[data + 7] + bytes[data + 8] * 256 + bytes[data + 9] * 65536;
      canvas = dimensions(width, height);
    } else if (type === "VP8 ") {
      if (image || length < 10 || (bytes[data] & 1) || bytes[data + 3] !== 0x9d ||
          bytes[data + 4] !== 1 || bytes[data + 5] !== 0x2a || !(bytes[data] & 0x10)) invalid();
      image = dimensions((bytes[data + 6] + bytes[data + 7] * 256) & 0x3fff,
        (bytes[data + 8] + bytes[data + 9] * 256) & 0x3fff);
    } else if (type === "VP8L") {
      if (image || length < 5 || bytes[data] !== 0x2f) invalid();
      const bits = le32(bytes, data + 1);
      if (bits >>> 29) invalid();
      image = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    offset = next;
  }
  if (offset !== bytes.length || !image) invalid();
  return canvas || image;
}
export function inspectImage(input, declaredMime) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const expected = MIME_FORMATS[String(declaredMime || "").toLowerCase()];
  if (!bytes.length || bytes.length > MAX_FILE_BYTES || !expected) invalid();
  let extension;
  let size;
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    extension = "png";
    size = inspectPng(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    extension = "jpg";
    size = inspectJpeg(bytes);
  } else if (text(bytes, 0) === "RIFF" && text(bytes, 8) === "WEBP") {
    extension = "webp";
    size = inspectWebp(bytes);
  } else invalid();
  if (extension !== expected) invalid();
  return { ...size, extension, mime: `image/${extension === "jpg" ? "jpeg" : extension}` };
}
export function inspectGeneratedCover(input, declaredMime) {
  const image = inspectImage(input, declaredMime);
  if (image.extension !== "jpg" || image.width !== 1200 || image.height !== 900) invalid();
  return image;
}
export async function contentPath(bytes, extension) {
  if (!["jpg", "png", "webp"].includes(extension)) invalid();
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256/${hash}.${extension}`;
}
