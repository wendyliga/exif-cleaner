import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { buildHref, buildVersion, githubRepoUrl } from './core/buildInfo'
import { groupExif, hasAnyExif, readExif } from './core/exif'

const SUPPORTED = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heif',
  'image/heic',
]
const EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
}
const TYPE_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  heif: 'image/heif',
  heic: 'image/heic',
}
const OUTPUT_TYPE_MAP = {
  'image/heif': 'image/jpeg',
  'image/heic': 'image/jpeg',
}
const DB_NAME = 'ExifCleanerDB'
const DB_VERSION = 1
const STORE = 'files'
const heifPreviewCache = new WeakMap()

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

async function dbDelete(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = (event) => reject(event.target.error)
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

function getFileExtension(name) {
  const match = /\.([^.]+)$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

function imageTypeForFile(file) {
  if (SUPPORTED.includes(file.type)) return file.type
  return TYPE_BY_EXTENSION[getFileExtension(file.name)] || ''
}

function outputTypeForFile(file) {
  const imageType = imageTypeForFile(file)
  return OUTPUT_TYPE_MAP[imageType] || imageType
}

function isHeifFile(file) {
  const imageType = imageTypeForFile(file)
  return imageType === 'image/heif' || imageType === 'image/heic'
}

function cleanedName(file) {
  return `${file.name.replace(/\.[^.]+$/, '')}_cleaned${EXT_MAP[outputTypeForFile(file)] || ''}`
}

function normalizeHeifResult(result) {
  if (Array.isArray(result)) return result[0]
  return result
}

async function decodeHeifToJpeg(file) {
  const cached = heifPreviewCache.get(file)
  if (cached) return cached

  const promise = import('heic2any')
    .then((module) =>
      module.default({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.92,
      }),
    )
    .then((result) => {
      const blob = normalizeHeifResult(result)
      if (!blob) throw new Error('HEIF decode failed')
      return blob
    })
    .catch((error) => {
      heifPreviewCache.delete(file)
      throw error
    })

  heifPreviewCache.set(file, promise)
  return promise
}

async function displayBlobForSource(source) {
  if (!source || !isHeifFile(source)) return source
  return decodeHeifToJpeg(source)
}

async function stripExif(file) {
  const source = isHeifFile(file) ? await decodeHeifToJpeg(file) : file
  return new Promise((resolve, reject) => {
    const outputType = outputTypeForFile(file)
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
        outputType,
        outputType === 'image/png' ? undefined : 0.92,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Image load failed'))
    }
    img.src = URL.createObjectURL(source)
  })
}

function useDisplayObjectUrl(source) {
  const [state, setState] = useState({ url: '', loading: false, error: null })

  useEffect(() => {
    let ignore = false
    let objectUrl = ''

    if (!source) {
      setState({ url: '', loading: false, error: null })
      return undefined
    }

    setState({ url: '', loading: isHeifFile(source), error: null })
    displayBlobForSource(source)
      .then((blob) => {
        if (ignore) return
        objectUrl = URL.createObjectURL(blob)
        setState({ url: objectUrl, loading: false, error: null })
      })
      .catch((error) => {
        if (ignore) return
        setState({
          url: '',
          loading: false,
          error: error?.message || 'Preview failed',
        })
      })

    return () => {
      ignore = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [source])

  return state
}

function useExif(file, cacheRef, id) {
  const [state, setState] = useState({ loading: true, raw: null, error: null })

  useEffect(() => {
    if (!file || !id) {
      setState({ loading: false, raw: null, error: null })
      return undefined
    }
    const cached = cacheRef.current.get(id)
    if (cached) {
      setState({ loading: false, raw: cached, error: null })
      return undefined
    }
    let ignore = false
    setState({ loading: true, raw: null, error: null })
    readExif(file)
      .then((raw) => {
        if (ignore) return
        cacheRef.current.set(id, raw)
        setState({ loading: false, raw, error: null })
      })
      .catch((error) => {
        if (ignore) return
        setState({ loading: false, raw: null, error: error?.message || 'Read failed' })
      })
    return () => {
      ignore = true
    }
  }, [file, id, cacheRef])

  return state
}

function statusLabel(status) {
  if (status === 'pending') return 'Waiting'
  if (status === 'processing') return 'Processing'
  if (status === 'done') return 'Cleaned'
  if (status === 'error') return 'Error'
  return status
}

function StatusPill({ status }) {
  return (
    <span className={`status-pill status-${status}`}>
      <span className="status-dot" />
      {statusLabel(status)}
    </span>
  )
}

function ExifPanel({ item, cacheRef }) {
  const { loading, raw, error } = useExif(item?.file, cacheRef, item?.id)
  const grouped = useMemo(() => groupExif(raw), [raw])
  const rawHasSomething = hasAnyExif(raw)

  if (!item) {
    return (
      <div className="exif-panel empty">
        <div className="exif-empty">Select an image to view metadata.</div>
      </div>
    )
  }

  const isEmptyState = !loading && (error || grouped.totalCount === 0)

  return (
    <aside className="exif-panel">
      <header className="exif-panel-head">
        <div className="exif-panel-eyebrow">Metadata</div>
        <div className="exif-panel-title" title={item.file.name}>
          {item.file.name}
        </div>
      </header>

      <div className={`exif-panel-body ${isEmptyState || loading ? 'centered' : ''}`}>
        {loading ? (
          <div className="exif-empty">Reading metadata...</div>
        ) : error ? (
          <div className="exif-empty error">Could not read metadata: {error}</div>
        ) : grouped.totalCount === 0 ? (
          <div className="exif-empty">
            {rawHasSomething
              ? 'No recognizable EXIF fields found.'
              : 'No EXIF metadata. Nothing to strip.'}
          </div>
        ) : (
          <>
            <div className="exif-summary">
              <span className="exif-count">{grouped.totalCount} fields</span>
              {grouped.hasGps ? (
                <span className="exif-warning">Location data present</span>
              ) : null}
            </div>
            <div className="exif-groups">
              {grouped.groups.map((group) => (
                <section key={group.id} className="exif-group">
                  <h3>{group.label}</h3>
                  <dl>
                    {group.entries.map((entry) => (
                      <div key={entry.key} className="exif-row">
                        <dt>{entry.label}</dt>
                        <dd>{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

function Thumb({ file, active, onClick, onRemove }) {
  const { url, loading, error } = useDisplayObjectUrl(file)
  const placeholder = error ? '!' : isHeifFile(file) && loading ? 'HEIF' : loading ? '...' : ''

  return (
    <div className={`thumb-item ${active ? 'active' : ''}`}>
      <button
        className="thumb-select"
        type="button"
        onClick={onClick}
        aria-label={file.name}
        aria-current={active ? 'true' : undefined}
      >
        {url ? <img src={url} alt="" /> : (
          <span className="thumb-placeholder">{placeholder}</span>
        )}
      </button>
      <button
        className="thumb-remove"
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        aria-label={`Remove ${file.name}`}
        title="Remove"
      >
        ×
      </button>
    </div>
  )
}

function PreviewOverlay({ source, onClose }) {
  const { url, loading, error } = useDisplayObjectUrl(source)

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={onClose}>
      {url ? (
        <img
          className="preview-img"
          src={url}
          alt=""
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <div className="preview-empty" onClick={(event) => event.stopPropagation()}>
          {loading ? 'Preparing preview...' : error || 'Preview unavailable'}
        </div>
      )}
      <button
        className="modal-close"
        type="button"
        onClick={onClose}
        aria-label="Close preview"
      >
        &times;
      </button>
    </div>
  )
}

function App() {
  const [files, setFiles] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingId, setProcessingId] = useState(null)
  const [isZipping, setIsZipping] = useState(false)
  const [previewSource, setPreviewSource] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [theme, setTheme] = useState(() => {
    const current = document.documentElement.dataset.theme
    return current === 'light' || current === 'dark' ? current : 'dark'
  })
  const fileInputRef = useRef(null)
  const dragCounter = useRef(0)
  const exifCacheRef = useRef(new Map())

  useEffect(() => {
    let ignore = false

    async function restoreFromDB() {
      const entries = await dbGetAll()
      if (ignore) return

      const restored = entries.map((entry) => ({
        id: entry.id,
        file: new File([entry.originalBlob], entry.name, { type: entry.type }),
        status: entry.status,
        blob: entry.cleanedBlob || null,
        originalSize: entry.originalSize,
        cleanedSize: entry.cleanedSize || 0,
      }))
      setFiles(restored)
      if (restored.length > 0) setActiveId(restored[0].id)
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

  const activeIndex = useMemo(
    () => files.findIndex((item) => item.id === activeId),
    [files, activeId],
  )
  const activeItem = activeIndex >= 0 ? files[activeIndex] : null

  const stats = useMemo(() => {
    let totalOrig = 0
    let totalOrigDone = 0
    let totalClean = 0
    let doneCount = 0

    for (const item of files) {
      totalOrig += item.originalSize
      if (item.status === 'done') {
        totalOrigDone += item.originalSize
        totalClean += item.cleanedSize
        doneCount += 1
      }
    }
    return { totalOrig, totalOrigDone, totalClean, doneCount }
  }, [files])

  const reduction = useMemo(() => {
    if (!stats.doneCount || stats.totalOrigDone <= 0) return 0
    return Math.round((1 - stats.totalClean / stats.totalOrigDone) * 100)
  }, [stats])

  const addFiles = useCallback(
    async (fileListInput) => {
      const arr = Array.from(fileListInput)
      const nextItems = []
      const seen = new Set(files.map((item) => `${item.file.name}:${item.file.size}`))

      for (const file of arr) {
        const imageType = imageTypeForFile(file)
        if (!imageType) continue
        const key = `${file.name}:${file.size}`
        if (seen.has(key)) continue
        seen.add(key)

        const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const entry = {
          id,
          name: file.name,
          type: file.type || imageType,
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

        if (isHeifFile(file)) {
          decodeHeifToJpeg(file).catch((error) => {
            console.warn('HEIF preview failed', error)
          })
        }
      }

      if (!nextItems.length) return

      setFiles((current) => {
        const freshItems = nextItems.filter(
          (item) =>
            !current.some(
              (existing) =>
                existing.file.name === item.file.name && existing.file.size === item.file.size,
            ),
        )
        const merged = [...current, ...freshItems]
        return merged
      })
      setActiveId(nextItems[0].id)
    },
    [files],
  )

  const persistProcessed = useCallback(async (item, blob) => {
    await dbSave({
      id: item.id,
      name: item.file.name,
      type: imageTypeForFile(item.file) || item.file.type,
      originalSize: item.originalSize,
      originalBlob: item.file,
      cleanedBlob: blob,
      cleanedSize: blob.size,
      status: 'done',
    })
  }, [])

  const processOne = useCallback(
    async (id) => {
      const item = files.find((candidate) => candidate.id === id)
      if (!item || item.status === 'done') return

      setProcessingId(id)
      setFiles((current) =>
        current.map((candidate) =>
          candidate.id === id ? { ...candidate, status: 'processing' } : candidate,
        ),
      )

      try {
        const blob = await stripExif(item.file)
        await persistProcessed(item, blob)
        setFiles((current) =>
          current.map((candidate) =>
            candidate.id === id
              ? { ...candidate, blob, cleanedSize: blob.size, status: 'done' }
              : candidate,
          ),
        )
      } catch (error) {
        console.error(error)
        setFiles((current) =>
          current.map((candidate) =>
            candidate.id === id ? { ...candidate, status: 'error' } : candidate,
          ),
        )
      } finally {
        setProcessingId(null)
      }
    },
    [files, persistProcessed],
  )

  async function processAll() {
    setIsProcessing(true)
    const pendingIds = files.filter((item) => item.status !== 'done').map((item) => item.id)
    for (const id of pendingIds) {
      await processOne(id)
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
    if (!item?.blob) return
    downloadBlob(item.blob, cleanedName(item.file))
  }

  async function removeItem(id) {
    await dbDelete(id)
    exifCacheRef.current.delete(id)
    setFiles((current) => {
      const next = current.filter((item) => item.id !== id)
      setActiveId((currentActive) => {
        if (currentActive !== id) return currentActive
        if (!next.length) return null
        const removedIndex = current.findIndex((item) => item.id === id)
        const fallback = next[Math.min(removedIndex, next.length - 1)]
        return fallback?.id ?? null
      })
      return next
    })
  }

  async function clearAll() {
    await dbClear()
    exifCacheRef.current.clear()
    setFiles([])
    setActiveId(null)
    setPreviewSource(null)
  }

  const goPrev = useCallback(() => {
    if (activeIndex <= 0) return
    setActiveId(files[activeIndex - 1].id)
  }, [activeIndex, files])

  const goNext = useCallback(() => {
    if (activeIndex < 0 || activeIndex >= files.length - 1) return
    setActiveId(files[activeIndex + 1].id)
  }, [activeIndex, files])

  useEffect(() => {
    function onKeyDown(event) {
      if (previewSource) return
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goPrev()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [goPrev, goNext, previewSource])

  useEffect(() => {
    function onWindowDragEnter(event) {
      if (!event.dataTransfer?.types?.includes('Files')) return
      dragCounter.current += 1
      setIsDragging(true)
    }
    function onWindowDragLeave() {
      dragCounter.current = Math.max(0, dragCounter.current - 1)
      if (dragCounter.current === 0) setIsDragging(false)
    }
    function onWindowDrop() {
      dragCounter.current = 0
      setIsDragging(false)
    }
    window.addEventListener('dragenter', onWindowDragEnter)
    window.addEventListener('dragleave', onWindowDragLeave)
    window.addEventListener('drop', onWindowDrop)
    return () => {
      window.removeEventListener('dragenter', onWindowDragEnter)
      window.removeEventListener('dragleave', onWindowDragLeave)
      window.removeEventListener('drop', onWindowDrop)
    }
  }, [])

  const hasFiles = files.length > 0
  const pendingCount = files.filter((item) => item.status !== 'done').length
  const allDone = hasFiles && pendingCount === 0
  const canProcessBatch = pendingCount > 0 && !isProcessing
  const canDownloadZip = stats.doneCount > 0 && !isZipping

  const activePreviewSource =
    activeItem?.status === 'done' && activeItem.blob ? activeItem.blob : activeItem?.file
  const {
    url: activeUrl,
    loading: activePreviewLoading,
    error: activePreviewError,
  } = useDisplayObjectUrl(activePreviewSource || null)

  const activeReduction =
    activeItem?.status === 'done' && activeItem.originalSize > 0
      ? Math.round((1 - activeItem.cleanedSize / activeItem.originalSize) * 100)
      : 0
  const activeGrew = activeReduction < 0

  return (
    <>
      <div className="bg-glow" aria-hidden="true" />
      <main className="app-shell">
        <header className="header">
          <div className="header-left">
            <img className="logo" src="./favicon.svg" alt="" />
            <div>
              <h1>EXIF Cleaner</h1>
              <p className="tagline">Inspect and strip metadata, entirely in your browser.</p>
            </div>
          </div>
          <div className="header-right">
            <button
              className="icon-btn"
              type="button"
              title="Toggle theme"
              onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? '☀' : '☾'}
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

        {!hasFiles ? (
          <section
            className={`drop-zone ${isDragging ? 'drag-over' : ''}`}
            role="button"
            tabIndex="0"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click()
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              dragCounter.current = 0
              setIsDragging(false)
              addFiles(event.dataTransfer.files)
            }}
          >
            <div className="drop-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <div className="drop-title">Drop images here or click to browse</div>
            <div className="drop-sub">JPEG · PNG · WebP · AVIF · HEIF/HEIC</div>
          </section>
        ) : (
          <section className={`workspace ${isDragging ? 'drag-over' : ''}`}>
            <div
              className="preview-panel"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                dragCounter.current = 0
                setIsDragging(false)
                addFiles(event.dataTransfer.files)
              }}
            >
              <section className="stats-row" aria-label="Batch summary">
                <div className="stat">
                  <span className="stat-label">Files</span>
                  <span className="stat-value">
                    {stats.doneCount}/{files.length}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">Original</span>
                  <span className="stat-value">{formatSize(stats.totalOrig)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Cleaned</span>
                  <span className="stat-value">
                    {stats.doneCount ? formatSize(stats.totalClean) : '—'}
                  </span>
                </div>
                <div className="stat">
                  <span className="stat-label">{reduction >= 0 ? 'Reduction' : 'Change'}</span>
                  <span className={`stat-value ${reduction >= 0 ? 'accent' : 'grew'}`}>
                    {stats.doneCount
                      ? reduction >= 0
                        ? `-${reduction}%`
                        : `+${Math.abs(reduction)}%`
                      : '—'}
                  </span>
                </div>
              </section>

              <div className="preview-stage">
                {activeUrl ? (
                  <img
                    src={activeUrl}
                    alt=""
                    onClick={() => setPreviewSource(activePreviewSource)}
                  />
                ) : activeItem ? (
                  <div className="preview-empty">
                    {activePreviewLoading && isHeifFile(activePreviewSource)
                      ? 'Preparing HEIF preview...'
                      : activePreviewLoading
                        ? 'Preparing preview...'
                        : activePreviewError || 'Preview unavailable'}
                  </div>
                ) : null}

                {activeItem ? (
                  <div className="stage-overlay-tl" aria-hidden="false">
                    <div className="stage-name" title={activeItem.file.name}>
                      {activeItem.file.name}
                    </div>
                    <div className="stage-meta">
                      <span>{formatSize(activeItem.originalSize)}</span>
                      {activeItem.status === 'done' ? (
                        <>
                          <span className="meta-arrow">→</span>
                          <span>{formatSize(activeItem.cleanedSize)}</span>
                          <span className={`meta-pill ${activeGrew ? 'grew' : ''}`}>
                            {activeGrew
                              ? `+${Math.abs(activeReduction)}%`
                              : `-${activeReduction}%`}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {activeItem ? (
                  <div className="stage-overlay-tr">
                    <StatusPill status={activeItem.status} />
                    <button
                      className="stage-close"
                      type="button"
                      onClick={() => removeItem(activeItem.id)}
                      title="Remove image"
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                  </div>
                ) : null}

                {files.length > 1 ? (
                  <>
                    <button
                      className="nav-btn prev"
                      type="button"
                      onClick={goPrev}
                      disabled={activeIndex <= 0}
                      aria-label="Previous image"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                    <button
                      className="nav-btn next"
                      type="button"
                      onClick={goNext}
                      disabled={activeIndex >= files.length - 1}
                      aria-label="Next image"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </>
                ) : null}

                <div className="stage-thumbstrip" aria-label="Image navigation">
                  <div className="thumbstrip-scroller">
                    {files.map((item) => (
                      <Thumb
                        key={item.id}
                        file={item.file}
                        active={item.id === activeId}
                        onClick={() => setActiveId(item.id)}
                        onRemove={() => removeItem(item.id)}
                      />
                    ))}
                    <button
                      className="thumb-add"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Add more images"
                      aria-label="Add more images"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              <div className="preview-actions">
                <div className="action-group">
                  <button
                    className="btn-primary"
                    type="button"
                    disabled={
                      !activeItem ||
                      activeItem.status === 'done' ||
                      activeItem.status === 'processing' ||
                      processingId != null
                    }
                    onClick={() => activeItem && processOne(activeItem.id)}
                  >
                    {activeItem?.status === 'processing'
                      ? 'Processing...'
                      : activeItem?.status === 'done'
                        ? 'Cleaned'
                        : 'Process'}
                  </button>
                  <button
                    className="btn-primary-soft"
                    type="button"
                    disabled={!canProcessBatch}
                    onClick={processAll}
                    title="Process every pending image"
                  >
                    {isProcessing ? 'Processing…' : `Process all (${pendingCount})`}
                  </button>
                </div>
                <div className="action-group">
                  <button
                    className="btn-secondary"
                    type="button"
                    disabled={!activeItem || activeItem.status !== 'done'}
                    onClick={() => downloadSingle(activeItem)}
                  >
                    Download
                  </button>
                  <button
                    className="btn-secondary-soft"
                    type="button"
                    disabled={!canDownloadZip}
                    onClick={downloadZip}
                    title="Download every cleaned image as ZIP"
                  >
                    {isZipping ? 'Zipping…' : `Download ZIP (${stats.doneCount})`}
                  </button>
                </div>
                <button className="btn-link" type="button" onClick={clearAll}>
                  Clear all
                </button>
              </div>
            </div>

            <ExifPanel item={activeItem} cacheRef={exifCacheRef} />
          </section>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif,image/heif,image/heic,.heif,.heic"
          hidden
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
        />

        <footer className="site-footer">
          <div className="privacy">
            <strong>100% Private &amp; Offline.</strong> Photos never leave your device. All
            processing happens in your browser. No uploads, no tracking, works offline.
          </div>
          <a className="footer-link" href={buildHref} target="_blank" rel="noopener noreferrer">
            <span>Build</span>
            <span className="footer-build-pill">{buildVersion}</span>
          </a>
        </footer>
      </main>

      {previewSource ? (
        <PreviewOverlay source={previewSource} onClose={() => setPreviewSource(null)} />
      ) : null}
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
