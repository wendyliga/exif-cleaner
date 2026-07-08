import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { buildHref, buildVersion, githubRepoUrl } from './core/buildInfo'

const SUPPORTED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
const EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
}
const DB_NAME = 'ExifCleanerDB'
const DB_VERSION = 1
const STORE = 'files'

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = (event) => resolve(event.target.result)
    req.onerror = (event) => reject(event.target.error)
  })
}

async function dbSave(entry) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = (event) => reject(event.target.error)
  })
}

async function dbGetAll() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = (event) => reject(event.target.error)
  })
}

async function dbClear() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = (event) => reject(event.target.error)
  })
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function cleanedName(file) {
  return `${file.name.replace(/\.[^.]+$/, '')}_cleaned${EXT_MAP[file.type] || ''}`
}

function stripExif(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(img.src)
          if (blob) resolve(blob)
          else reject(new Error('Canvas toBlob failed'))
        },
        file.type,
        file.type === 'image/png' ? undefined : 0.92,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Image load failed'))
    }
    img.src = URL.createObjectURL(file)
  })
}

function Thumb({ item, onClick }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const objectUrl = URL.createObjectURL(item.file)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [item.file])

  return <img src={url} alt="" onClick={onClick} />
}

function Preview({ item, onClose }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const source = item.status === 'done' && item.blob ? item.blob : item.file
    const objectUrl = URL.createObjectURL(source)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [item])

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="preview-overlay" onClick={onClose}>
      <img src={url} alt="" onClick={(event) => event.stopPropagation()} />
      <button className="preview-close" type="button" onClick={onClose} aria-label="Close preview">
        &times;
      </button>
    </div>
  )
}

function App() {
  const [files, setFiles] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isZipping, setIsZipping] = useState(false)
  const [previewItem, setPreviewItem] = useState(null)
  const [theme, setTheme] = useState(() => {
    const current = document.documentElement.dataset.theme
    return current === 'light' || current === 'dark' ? current : 'dark'
  })
  const fileInputRef = useRef(null)

  useEffect(() => {
    let ignore = false

    async function restoreFromDB() {
      const entries = await dbGetAll()
      if (ignore) return

      setFiles(
        entries.map((entry) => ({
          id: entry.id,
          file: new File([entry.originalBlob], entry.name, { type: entry.type }),
          status: entry.status,
          blob: entry.cleanedBlob || null,
          originalSize: entry.originalSize,
          cleanedSize: entry.cleanedSize || 0,
        })),
      )
    }

    restoreFromDB().catch(console.error)
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  const stats = useMemo(() => {
    let totalOrig = 0
    let totalClean = 0
    let doneCount = 0

    for (const item of files) {
      totalOrig += item.originalSize
      if (item.status === 'done') {
        totalClean += item.cleanedSize
        doneCount += 1
      }
    }

    return { totalOrig, totalClean, doneCount }
  }, [files])

  const summary = useMemo(() => {
    if (!files.length) return ''
    if (!stats.doneCount) return `${files.length} file(s) selected`

    const reduction =
      stats.totalOrig > 0 ? Math.round((1 - stats.totalClean / stats.totalOrig) * 100) : 0
    return `${stats.doneCount}/${files.length} files cleaned - ${formatSize(
      stats.totalOrig,
    )} -> ${formatSize(stats.totalClean)} (${reduction}% total reduction)`
  }, [files.length, stats])

  async function addFiles(fileListInput) {
    const arr = Array.from(fileListInput)
    const nextItems = []
    const seen = new Set(files.map((item) => `${item.file.name}:${item.file.size}`))

    for (const file of arr) {
      if (!SUPPORTED.includes(file.type)) continue
      const key = `${file.name}:${file.size}`
      if (seen.has(key)) continue
      seen.add(key)

      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const entry = {
        id,
        name: file.name,
        type: file.type,
        originalSize: file.size,
        originalBlob: file,
        cleanedBlob: null,
        cleanedSize: 0,
        status: 'pending',
      }

      await dbSave(entry)
      nextItems.push({
        id,
        file,
        status: 'pending',
        blob: null,
        originalSize: file.size,
        cleanedSize: 0,
      })
    }

    setFiles((current) => {
      const freshItems = nextItems.filter(
        (item) =>
          !current.some(
            (existing) =>
              existing.file.name === item.file.name && existing.file.size === item.file.size,
          ),
      )
      return [...current, ...freshItems]
    })
  }

  async function processAll() {
    setIsProcessing(true)

    const pendingIds = files.filter((item) => item.status !== 'done').map((item) => item.id)
    for (const id of pendingIds) {
      const item = files.find((candidate) => candidate.id === id)
      if (!item) continue

      setFiles((current) =>
        current.map((candidate) =>
          candidate.id === id ? { ...candidate, status: 'processing' } : candidate,
        ),
      )

      try {
        const blob = await stripExif(item.file)
        const nextItem = {
          ...item,
          blob,
          cleanedSize: blob.size,
          status: 'done',
        }
        await dbSave({
          id: item.id,
          name: item.file.name,
          type: item.file.type,
          originalSize: item.originalSize,
          originalBlob: item.file,
          cleanedBlob: blob,
          cleanedSize: blob.size,
          status: 'done',
        })
        setFiles((current) =>
          current.map((candidate) => (candidate.id === id ? nextItem : candidate)),
        )
      } catch (error) {
        console.error(error)
        setFiles((current) =>
          current.map((candidate) =>
            candidate.id === id ? { ...candidate, status: 'error' } : candidate,
          ),
        )
      }
    }

    setIsProcessing(false)
  }

  async function downloadZip() {
    const done = files.filter((item) => item.status === 'done' && item.blob)
    if (!done.length) return

    setIsZipping(true)
    const zip = new JSZip()
    done.forEach((item) => {
      zip.file(cleanedName(item.file), item.blob)
    })

    const content = await zip.generateAsync({ type: 'blob' })
    downloadBlob(content, 'cleaned_images.zip')
    setIsZipping(false)
  }

  function downloadSingle(item) {
    if (!item.blob) return
    downloadBlob(item.blob, cleanedName(item.file))
  }

  async function clearAll() {
    await dbClear()
    setFiles([])
  }

  const hasFiles = files.length > 0
  const allDone = files.every((item) => item.status === 'done')
  const canProcess = hasFiles && !allDone && !isProcessing
  const canDownload = stats.doneCount > 0 && !isZipping

  return (
    <>
      <main className="app-shell">
        <header className="header">
          <div className="header-left">
            <img className="logo" src="./favicon.svg" alt="" />
            <h1>EXIF Cleaner</h1>
          </div>
          <div className="header-right">
            <button
              className="icon-btn"
              type="button"
              title="Toggle theme"
              onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
            >
              {theme === 'light' ? '\u2600' : '\u263E'}
            </button>
            <a
              className="icon-btn"
              href={githubRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="GitHub"
              aria-label="GitHub"
            >
              <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
            </a>
          </div>
        </header>

        <p className="sub">
          Strip EXIF metadata (location, camera info, etc.) from JPEG, PNG, WebP - fully
          offline, no server.
        </p>

        <div
          className="drop-zone"
          role="button"
          tabIndex="0"
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            addFiles(event.dataTransfer.files)
          }}
        >
          <span>Drop images here or click to browse</span>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/avif"
            hidden
            onChange={(event) => {
              addFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>

        <div className="files">
          {files.map((item) => {
            const reduction =
              item.status === 'done' && item.originalSize > 0
                ? Math.round((1 - item.cleanedSize / item.originalSize) * 100)
                : 0

            return (
              <article className="file-card" key={item.id}>
                <Thumb item={item} onClick={() => setPreviewItem(item)} />
                <div className="file-info">
                  <div className="file-name">{item.file.name}</div>
                  <div className="file-meta">
                    {formatSize(item.originalSize)}
                    {item.status === 'done'
                      ? ` -> ${formatSize(item.cleanedSize)} (${reduction}% smaller)`
                      : ''}
                  </div>
                  {item.status === 'processing' ? (
                    <div className="progress-bar">
                      <div className="progress-fill processing" />
                    </div>
                  ) : null}
                  {item.status === 'done' ? (
                    <div className="progress-bar">
                      <div className="progress-fill done" />
                    </div>
                  ) : null}
                </div>
                <div className={`file-status ${item.status}`}>
                  {item.status === 'pending'
                    ? 'Waiting'
                    : item.status === 'processing'
                      ? 'Processing...'
                      : item.status === 'done'
                        ? 'Done'
                        : 'Error'}
                </div>
                <button
                  className="btn-dl"
                  type="button"
                  disabled={item.status !== 'done'}
                  onClick={() => downloadSingle(item)}
                >
                  Download
                </button>
              </article>
            )
          })}
        </div>

        <div className="summary">{summary}</div>

        {hasFiles ? (
          <div className="actions">
            <button className="btn-primary" type="button" disabled={!canProcess} onClick={processAll}>
              {isProcessing ? 'Processing...' : 'Process All'}
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={!canDownload}
              onClick={downloadZip}
            >
              {isZipping ? 'Creating ZIP...' : 'Download ZIP'}
            </button>
            <button className="btn-secondary" type="button" onClick={clearAll}>
              Clear
            </button>
          </div>
        ) : null}

        <footer className="site-footer">
          <div className="privacy">
            <strong>100% Private &amp; Offline</strong> - Your photos never leave your device. All
            processing happens entirely in your browser with zero server communication. No uploads,
            no cloud, no tracking. Works offline.
          </div>
          <a className="footer-link" href={buildHref} target="_blank" rel="noopener noreferrer">
            <span>Build</span>
            <span className="footer-build-pill">{buildVersion}</span>
          </a>
        </footer>
      </main>

      {previewItem ? <Preview item={previewItem} onClose={() => setPreviewItem(null)} /> : null}
    </>
  )
}

function downloadBlob(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export default App
