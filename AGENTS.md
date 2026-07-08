# AGENTS.md — EXIF Cleaner

## Project Overview

Static React + Vite web app that strips EXIF metadata (GPS, camera info, timestamps, etc.) from images entirely in the browser. Also lets users inspect existing EXIF metadata before stripping. No backend and no server-side processing.

**Architecture**:

- `index.html`: Vite HTML entry and metadata
- `src/main.jsx`: React mount entry
- `src/App.jsx`: App state, IndexedDB persistence, EXIF stripping, preview, EXIF viewer, download flow
- `src/App.css`: Theme tokens and UI styles
- `src/core/buildInfo.js`: Build hash/repository metadata from Vite env vars
- `src/core/exif.js`: EXIF read/parse wrapper around `exifr`, plus grouping into Camera / Exposure / Image / Date & Time / Location / Other categories for the viewer
- `public/favicon.svg`: Static favicon copied into `dist/`
- `sample/`: Test images with real EXIF metadata. See [Testing](#testing).
- `build.sh`: Cloudflare/static hosting production build wrapper

**How EXIF stripping works**: Images are drawn onto an offscreen `<canvas>` then re-exported via `canvas.toBlob()`. Canvas does not preserve EXIF metadata, so the output is clean. This is lossy (re-encoded) but simple and works for all canvas-supported formats.

**Supported formats**: JPEG, PNG, WebP, AVIF (limited to what the browser's Canvas API can decode/encode).

## Build & Commands

```bash
npm install
npm run dev
npm run build      # calls ./build.sh
./build.sh         # writes production output to dist/
npm run preview
```

`build.sh` mirrors the Converter project pattern: install dependencies if `node_modules` is missing, compute `VITE_GITHUB_REPO_URL`, `VITE_BUILD_COMMIT`, and `VITE_BUILD_COMMIT_SHORT`, then run `npm run build:site -- "$@"`.

Cloudflare Pages output directory is `dist/` through `wrangler.jsonc`.

## Testing

The `sample/` directory holds real-world images with intact EXIF metadata. Use these when testing the EXIF viewer, stripping flow, or size-reduction stats — the app has no automated test suite, so these are the reference inputs for manual verification.

**Do not modify, overwrite, or re-encode files in `sample/`.** They are the source of truth for reproducing EXIF-related behavior; stripping their metadata in place would silently invalidate every future test. Copy them elsewhere if you need a scratch version.

Current samples:

- `sample/0bs1zdxbgx8nhs8kf01aeehmm0.jpg` (Sony ILCE-7M2, GPS + full EXIF)
- `sample/23xxesym0e9w18z2904frnpgy7.jpg`

## Code Style

- React function components with hooks
- Vite env vars are read through `import.meta.env`
- CSS uses custom properties (`--bg`, `--surface`, `--text`, etc.) for theming, defined in `:root` (dark) and `[data-theme="light"]` (light)
- Async/await for IndexedDB operations
- Deduplication by `(name, size)` pair
- Keep image/Blob object URLs paired with `URL.revokeObjectURL()`

## Key Data Flow

1. **Add files** -> snapshot `FileList` to array (critical: `Array.from()` before async, since `FileList` is live and `fileInput.value = ''` clears it) -> save to IndexedDB -> push to React state -> render
2. **Process** -> sequential loop over pending items -> `stripExif()` per file -> update IndexedDB with cleaned blob -> update React state
3. **Download** -> JSZip bundles all cleaned blobs -> trigger download via temporary `<a>` element
4. **Restore on load** -> `restoreFromDB()` reads all entries from IndexedDB -> reconstructs `File` objects from stored Blobs -> render
5. **Build footer** -> `buildInfo.js` exposes `buildVersion` and `buildHref`; footer renders `Build <hash>` or `Build development`

## Persistence

Two storage mechanisms:

- **IndexedDB** (`ExifCleanerDB` -> `files` store): Stores original + cleaned image Blobs, keyed by `id` (timestamp + random). Survives refresh. Cleared by "Clear" button.
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

- **No server communication**: All processing is client-side. Runtime app has no uploads, analytics, tracking, or API calls.
- **Dependency note**: JSZip and `exifr` are bundled through npm/Vite rather than loaded from a CDN at runtime.
- **XSS note**: React escapes file names by default. If adding raw HTML later, sanitize user-controlled strings first.
- **URL.createObjectURL lifecycle**: Always call `URL.revokeObjectURL()` after use (in `stripExif`, previews, thumbnails, `downloadSingle`, `downloadZip`) to prevent memory leaks.

## Known Gotchas

- **FileList is live**: Must `Array.from(fileListInput)` before any `await` in `addFiles()`, otherwise `fileInput.value = ''` empties the list mid-iteration.
- **Canvas re-encoding is lossy**: JPEG quality is set to 0.92, PNG is lossless. Original pixel data is not preserved bit-for-bit for JPEG/WebP.
- **IndexedDB is per-origin**: Dev server, preview server, file URL, and production URL each get separate IndexedDB storage.
- **AVIF support varies**: Canvas encode/decode for AVIF depends on browser support. Will fail or fall back in unsupported browsers.
- **Build hash**: Local builds without git metadata show `Build development`; normal git builds show the short commit hash.
