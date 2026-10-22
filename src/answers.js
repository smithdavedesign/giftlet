// The questionnaire: allowed values, limits, and validation of a submitted form.

export const OCCASIONS = {
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  farewell: 'Retirement or send-off',
}

// A fixed list (no free text) keeps pages about exes out by construction.
export const RELATIONSHIPS = {
  partner: 'partner',
  spouse: 'spouse',
  parent: 'parent',
  sibling: 'sibling',
  child: 'grown-up kid',
  grandparent: 'grandparent',
  friend: 'friend',
  coworker: 'coworker',
  family: 'family member',
}

export const TONES = {
  funny: 'Funny',
  sweet: 'Sweet',
  heartfelt: 'Heartfelt',
}

// The look of the gift page. A presentation choice, not something about the
// recipient, so it is returned next to `answers` and never reaches the copy writer.
export const THEMES = {
  confetti: 'Confetti: bright and bubbly',
  blush: 'Blush: soft and romantic',
  postcard: 'Postcard: warm and classic',
}
export const DEFAULT_THEME = 'confetti'

export const LIMITS = {
  nameMax: 60,
  memoriesMin: 3,
  memoriesMax: 5,
  memoryMax: 500,
  photosMin: 3,
  photosMax: 12,
  photoMaxBytes: 5 * 1024 * 1024,
}

// Control and format characters (incl. bidi overrides) are stripped, except newline
// and the zero-width (non-)joiners that emoji sequences need.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu
const KEEP = new Set([0x0a, 0x200c, 0x200d])
const dropInvisible = (ch) => (KEEP.has(ch.codePointAt(0)) ? ch : '')

// Normalizes user or model text: '' for non-strings; strips invisible characters;
// collapses whitespace (keeping single blank lines when multiline).
export function cleanText(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return ''
  let text = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(INVISIBLE, dropInvisible)
  text = multiline
    ? text
        .split('\n')
        .map((line) => line.replace(/ +/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
    : text.replace(/\s+/g, ' ')
  return text.trim()
}

// Identifies an image by its magic bytes; the client's declared type is never trusted.
// SVG is deliberately absent: it can carry script.
export function sniffImage(bytes) {
  const startsWith = (sig, at = 0) => bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b)
  const ascii = (text) => [...text].map((ch) => ch.charCodeAt(0))
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(ascii('GIF87a')) || startsWith(ascii('GIF89a'))) return 'image/gif'
  if (startsWith(ascii('RIFF')) && startsWith(ascii('WEBP'), 8)) return 'image/webp'
  return null
}

const fail = (status, field, error) => ({ ok: false, status, field, error })
const isOneOf = (options, value) => typeof value === 'string' && Object.hasOwn(options, value)

// Validates the multipart form from POST /generate.
// Returns { ok: true, answers, theme, photos: [{ mime, bytes }] } or { ok: false, status, field, error }.
export async function readSubmission(form) {
  const name = cleanText(form.get('name'))
  if (!name) return fail(400, 'name', 'Tell us their name.')
  if (name.length > LIMITS.nameMax) return fail(400, 'name', `Keep the name to ${LIMITS.nameMax} characters.`)

  const occasion = form.get('occasion')
  if (!isOneOf(OCCASIONS, occasion)) return fail(400, 'occasion', 'Pick an occasion.')
  const relationship = form.get('relationship')
  if (!isOneOf(RELATIONSHIPS, relationship)) return fail(400, 'relationship', 'Pick who they are to you.')
  const tone = form.get('tone')
  if (!isOneOf(TONES, tone)) return fail(400, 'tone', 'Pick a tone.')
  // Optional for API callers from before themes existed; present but unknown is an error.
  const theme = form.get('theme') ?? DEFAULT_THEME
  if (!isOneOf(THEMES, theme)) return fail(400, 'theme', 'Pick a look for the page.')

  const memories = form
    .getAll('memory')
    .map((m) => cleanText(m, { multiline: true }))
    .filter(Boolean)
  if (memories.length < LIMITS.memoriesMin || memories.length > LIMITS.memoriesMax) {
    return fail(400, 'memory', `Share ${LIMITS.memoriesMin} to ${LIMITS.memoriesMax} memories.`)
  }
  const tooLong = memories.findIndex((m) => m.length > LIMITS.memoryMax)
  if (tooLong !== -1) {
    return fail(400, 'memory', `Memory ${tooLong + 1} is longer than ${LIMITS.memoryMax} characters.`)
  }

  const files = form.getAll('photo')
  if (files.some((f) => typeof f === 'string')) return fail(400, 'photo', 'Photos must be uploaded as files.')
  if (files.length < LIMITS.photosMin || files.length > LIMITS.photosMax) {
    return fail(400, 'photo', `Add ${LIMITS.photosMin} to ${LIMITS.photosMax} photos.`)
  }
  const oversized = files.findIndex((f) => f.size > LIMITS.photoMaxBytes)
  if (oversized !== -1) {
    const mb = LIMITS.photoMaxBytes / (1024 * 1024)
    return fail(413, 'photo', `Photo ${oversized + 1} is larger than ${mb} MB.`)
  }
  const photos = []
  for (const [i, file] of files.entries()) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mime = sniffImage(bytes)
    if (!mime) return fail(415, 'photo', `Photo ${i + 1} isn't a JPEG, PNG, GIF or WebP image.`)
    photos.push({ mime, bytes })
  }

  return { ok: true, answers: { name, occasion, relationship, tone, memories }, theme, photos }
}
