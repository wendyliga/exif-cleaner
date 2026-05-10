# EXIF Cleaner

Strip EXIF metadata (location, camera info, timestamps, etc.) from images — fully offline, no server.

**Try it**: Open `index.html` in any browser. That's it.

## Features

- **One file, zero setup** — Single `index.html`, no build step, no install
- **100% offline & private** — All processing happens in your browser. No uploads, no server, no tracking
- **Multi-file support** — Drag & drop or browse multiple images at once
- **Per-file progress** — See status and size reduction for each image
- **Preview** — Click any thumbnail to preview the cleaned result
- **Download options** — Download individually or all at once as ZIP
- **Persistent** — Files and results survive page refresh (IndexedDB)
- **Dark/Light mode** — Follows your system preference, toggle manually, saved between sessions
- **Supported formats** — JPEG, PNG, WebP, AVIF

## How It Works

Images are redrawn through the Canvas API, which does not carry over EXIF metadata. The output is a clean image with all metadata stripped.

## Quick Start

```bash
# Just open it
open index.html

# Or serve locally
python3 -m http.server 8000
```

## License

MIT
