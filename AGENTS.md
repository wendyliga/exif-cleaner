# AGENTS.md — EXIF Cleaner

## Project Overview

Single-file, zero-server web app that strips EXIF metadata (GPS, camera info, timestamps, etc.) from images entirely in the browser. No build step, no framework, no backend.

**Architecture**: One `index.html` containing all HTML, CSS, and JS inline. One `favicon.svg` for branding. That's the entire codebase.

**How EXIF stripping works**: Images are drawn onto an offscreen `<canvas>` then re-exported via `canvas.toBlob()`. Canvas does not preserve EXIF metadata, so the output is clean. This is lossy (re-encoded) but simple and works for all canvas-supported formats.

**Supported formats**: JPEG, PNG, WebP, AVIF (limited to what the browser's Canvas API can decode/encode).

## Build & Commands

No build system. Open `index.html` directly in a browser or serve with any static file server:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .
```

No package manager, no dependencies to install. The only external dependency (JSZip) is loaded via CDN.

## Code Style

- Vanilla JS (no modules, no framework), all in a single `<script>` block
- CSS uses custom properties (`--bg`, `--surface`, `--text`, etc.) for theming, defined in `:root` (dark) and `[data-theme="light"]` (light)
- DOM manipulation via imperative `document.createElement()` — no templating library
- Async/await for all IndexedDB operations
- Deduplication by `(name, size)` pair

## Key Data Flow

1. **Add files** → snapshot `FileList` to array (critical: `Array.from()` before async, since `FileList` is live and `fileInput.value = ''` clears it) → save to IndexedDB → push to `files[]` → render
2. **Process** → sequential loop over pending items → `stripExif()` per file → update IndexedDB with cleaned blob → render
3. **Download** → JSZip bundles all cleaned blobs → trigger download via temporary `<a>` element
4. **Restore on load** → `restoreFromDB()` reads all entries from IndexedDB → reconstructs `File` objects from stored Blobs → render

## Persistence

Two storage mechanisms:

- **IndexedDB** (`ExifCleanerDB` → `files` store): Stores original + cleaned image Blobs, keyed by `id` (timestamp + random). Survives refresh. Cleared by "Clear" button.
- **localStorage** (`theme` key): Stores `"light"` or `"dark"`. Falls back to `prefers-color-scheme` media query.

### IndexedDB Schema

Object store `files`, keyPath: `id`

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (timestamp + random) |
| `name` | string | Original filename |
| `type` | string | MIME type |
| `originalSize` | number | File size in bytes |
| `originalBlob` | Blob | Original file data |
| `cleanedBlob` | Blob/null | Cleaned image (null until processed) |
| `cleanedSize` | number | Cleaned file size |
| `status` | string | `"pending"` / `"processing"` / `"done"` / `"error"` |

## Security

- **No server communication**: All processing is client-side. No network requests except the JSZip CDN load.
- **No data exfiltration surface**: No analytics, no tracking, no API calls.
- **XSS note**: `render()` uses `innerHTML` for file metadata display. File names come from `File.name` which is read-only and browser-sanitized, but if refactored, sanitize any user-controlled strings before inserting into HTML.
- **URL.createObjectURL lifecycle**: Always call `URL.revokeObjectURL()` after use (in `stripExif`, `showPreview`, `downloadSingle`, `downloadZip`) to prevent memory leaks.

## Known Gotchas

- **FileList is live**: Must `Array.from(fileListInput)` before any `await` in `addFiles()`, otherwise `fileInput.value = ''` empties the list mid-iteration.
- **Canvas re-encoding is lossy**: JPEG quality is set to 0.92, PNG is lossless. Original pixel data is not preserved bit-for-bit for JPEG/WebP.
- **IndexedDB is per-origin**: Moving `index.html` to a different path creates a separate IndexedDB — previous data won't appear.
- **AVIF support varies**: Canvas encode/decode for AVIF depends on browser support. Will silently fail or fall back in unsupported browsers.
