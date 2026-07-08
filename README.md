# EXIF Cleaner

Strip EXIF metadata (location, camera info, timestamps, etc.) from images fully offline in the browser.

## Features

- **100% offline & private** - All processing happens in your browser. No uploads, no server, no tracking
- **React + Vite app** - Static frontend built into `dist/`
- **Multi-file support** - Drag & drop or browse multiple images at once
- **Per-file progress** - See status and size reduction for each image
- **Preview** - Click any thumbnail to preview the cleaned result
- **Download options** - Download individually or all at once as ZIP
- **Persistent** - Files and results survive page refresh with IndexedDB
- **Dark/Light mode** - Follows your system preference, toggle manually, saved between sessions
- **Supported formats** - JPEG, PNG, WebP, AVIF
- **Build hash footer** - Production builds show `Build <hash>` linked to the GitHub commit when available

## How It Works

Images are redrawn through the Canvas API, which does not carry over EXIF metadata. The output is a clean image with all metadata stripped.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build      # same as ./build.sh
./build.sh         # create the static production site in dist/
```

`build.sh` installs dependencies when `node_modules` is missing, computes the GitHub repository URL and current commit hash, then passes them to Vite as:

- `VITE_GITHUB_REPO_URL`
- `VITE_BUILD_COMMIT`
- `VITE_BUILD_COMMIT_SHORT`

The generated static site is written to `dist/`, matching `wrangler.jsonc`.

## Preview Production Build

```bash
npm run preview
```

## License

MIT
