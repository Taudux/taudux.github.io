# Canvas JPEG Fixture Provenance

- Browser: Google Chrome 150.0.7871.186 (headless, Windows)
- Canvas: 1200 × 900 CSS pixels
- Export: `canvas.toDataURL("image/jpeg", 0.85)`
- MIME: `image/jpeg`
- Size: 29,007 bytes
- SHA-256: `c9cb32611fb4fc63b3e5ec86ded2e9277df49a3c569327876121aeb90f85d383`

## Capture procedure

1. Create a 1200 × 900 browser Canvas.
2. Paint a `#071017` background, a contrasting rectangle, and browser-rendered text.
3. Export through the browser Canvas JPEG encoder at quality `0.85`.
4. Strip the `data:image/jpeg;base64,` prefix and decode the payload to
   `course-cover-canvas-1200x900.jpg`.

Tests inspect the fixture bytes, dimensions, and malformed variants; the filename is not trusted as validation evidence.
