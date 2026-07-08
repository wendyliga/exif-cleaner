import exifr from 'exifr'

const CATEGORIES = [
  {
    id: 'camera',
    label: 'Camera',
    fields: [
      ['Make', 'Make'],
      ['Model', 'Model'],
      ['LensMake', 'Lens Make'],
      ['LensModel', 'Lens'],
      ['Software', 'Software'],
      ['SerialNumber', 'Body Serial'],
      ['LensSerialNumber', 'Lens Serial'],
    ],
  },
  {
    id: 'exposure',
    label: 'Exposure',
    fields: [
      ['FNumber', 'Aperture', (v) => `f/${Number(v).toFixed(1)}`],
      ['ExposureTime', 'Shutter', formatShutter],
      ['ISO', 'ISO'],
      ['FocalLength', 'Focal Length', (v) => `${Number(v).toFixed(0)} mm`],
      ['FocalLengthIn35mmFormat', 'Focal (35mm eq.)', (v) => `${Number(v).toFixed(0)} mm`],
      ['ExposureProgram', 'Program'],
      ['ExposureCompensation', 'Exposure Comp.', (v) => `${Number(v).toFixed(2)} EV`],
      ['MeteringMode', 'Metering'],
      ['Flash', 'Flash'],
      ['WhiteBalance', 'White Balance'],
    ],
  },
  {
    id: 'image',
    label: 'Image',
    fields: [
      ['ExifImageWidth', 'Width', (v) => `${v} px`],
      ['ExifImageHeight', 'Height', (v) => `${v} px`],
      ['Orientation', 'Orientation'],
      ['XResolution', 'X Resolution', (v) => `${v} dpi`],
      ['YResolution', 'Y Resolution', (v) => `${v} dpi`],
      ['ColorSpace', 'Color Space'],
    ],
  },
  {
    id: 'date',
    label: 'Date & Time',
    fields: [
      ['DateTimeOriginal', 'Taken', formatDate],
      ['CreateDate', 'Created', formatDate],
      ['ModifyDate', 'Modified', formatDate],
      ['OffsetTimeOriginal', 'Timezone'],
    ],
  },
  {
    id: 'location',
    label: 'Location',
    fields: [
      ['latitude', 'Latitude', (v) => Number(v).toFixed(6)],
      ['longitude', 'Longitude', (v) => Number(v).toFixed(6)],
      ['GPSAltitude', 'Altitude', (v) => `${Number(v).toFixed(1)} m`],
      ['GPSSpeed', 'Speed'],
      ['GPSImgDirection', 'Direction'],
      ['GPSDateStamp', 'GPS Date'],
    ],
  },
  {
    id: 'other',
    label: 'Other',
    fields: [
      ['Artist', 'Artist'],
      ['Copyright', 'Copyright'],
      ['ImageDescription', 'Description'],
      ['UserComment', 'Comment'],
    ],
  },
]

const CLAIMED_KEYS = new Set(CATEGORIES.flatMap((cat) => cat.fields.map(([key]) => key)))

function formatShutter(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return String(v)
  if (n >= 1) return `${n.toFixed(1)} s`
  return `1/${Math.round(1 / n)} s`
}

function formatDate(v) {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatValue(value, formatter) {
  if (value == null || value === '') return ''
  if (formatter) {
    try {
      return formatter(value)
    } catch {
      return String(value)
    }
  }
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export async function readExif(fileOrBlob) {
  try {
    const data = await exifr.parse(fileOrBlob, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: true,
      ifd1: false,
      interop: false,
      xmp: false,
      icc: false,
      iptc: true,
      jfif: false,
      translateKeys: true,
      translateValues: true,
      reviveValues: true,
      mergeOutput: true,
    })
    return data || null
  } catch {
    return null
  }
}

export function groupExif(raw) {
  if (!raw) return { groups: [], totalCount: 0, hasGps: false }

  const groups = CATEGORIES.map((cat) => {
    const entries = []
    for (const [key, label, formatter] of cat.fields) {
      const value = raw[key]
      const formatted = formatValue(value, formatter)
      if (formatted) entries.push({ key, label, value: formatted })
    }
    return { id: cat.id, label: cat.label, entries }
  }).filter((group) => group.entries.length > 0)

  const totalCount = groups.reduce((sum, group) => sum + group.entries.length, 0)
  const hasGps =
    raw.latitude != null || raw.longitude != null || raw.GPSLatitude != null

  return { groups, totalCount, hasGps }
}

export function hasAnyExif(raw) {
  if (!raw) return false
  for (const key of Object.keys(raw)) {
    if (CLAIMED_KEYS.has(key) && raw[key] != null && raw[key] !== '') return true
  }
  return Object.keys(raw).length > 0
}
