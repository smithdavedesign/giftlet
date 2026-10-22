// The printable keepsake: a paid gift page as a two-page US Letter PDF, built with pdf-lib.
//   page 1, the cover: occasion, headline, "For <name>", intro, up to 6 photos, sign-off
//   page 2, the story: every memory, then the made-up statistics, each tagged JOKE STAT
// Layout code runs twice, first measuring and then drawing (a pen without a page only
// measures), so text can shrink to fit and the PDF never grows a third page.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { DEFAULT_THEME, OCCASIONS, THEMES } from './answers.js'

export const KEEPSAKE_LIMITS = {
  photos: 6,
  // Vercel caps a function's response at 4.5 MB; photos are dropped until the PDF fits under this.
  maxBytes: 4 * 1024 * 1024,
  // PNGs are decoded to raw RGBA before embedding (4 bytes a pixel, up to 6 of them, and
  // again if the size budget forces a re-render). The form's JPEGs are at most 1600 px a side.
  pngMaxPixels: 4_000_000,
}

const PAGE_W = 612 // US Letter, in points
const PAGE_H = 792
const MARGIN = 54
const TEXT_W = PAGE_W - 2 * MARGIN
// Page 2 tries these font scales in order, then cuts memory text as a last resort.
const STORY_SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.65, 0.6]
const ELLIPSIS = '…'
const JOKE_TAG = 'JOKE STAT'

const palette = (colors) =>
  Object.fromEntries(
    Object.entries(colors).map(([name, hex]) => [name, rgb(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255))]),
  )

// Each web theme's palette (the same values as its CSS) and heading type, for paper.
// Body text stays Helvetica in every theme, for legibility. One entry per THEMES key.
export const LOOKS = {
  confetti: {
    colors: palette({ ink: '#2b1d3a', muted: '#6b5b7b', accent: '#e8457c', sun: '#ffc94a', sky: '#5ec8e5' }),
    heading: StandardFonts.HelveticaBold,
    decorate: confettiDots,
  },
  blush: {
    colors: palette({ ink: '#3b2330', muted: '#80606e', accent: '#c0396b', sun: '#ffd9e2', sky: '#f6b3c6' }),
    heading: StandardFonts.TimesRomanBoldItalic,
    decorate: blushCircles,
  },
  postcard: {
    colors: palette({ ink: '#2f2a24', muted: '#6f6253', accent: '#b5502d', sun: '#e9c46a', sky: '#2a6f97' }),
    heading: StandardFonts.TimesRomanBold,
    decorate: airmailBorder,
  },
}

// --- Text: the standard fonts only encode WinAnsi (Windows-1252) ---

const charsets = new WeakMap()
const canDraw = (font, ch) => {
  if (!charsets.has(font)) charsets.set(font, new Set(font.getCharacterSet()))
  return charsets.get(font).has(ch.codePointAt(0))
}

// Characters outside WinAnsi with a close stand-in, by code point.
const SUBSTITUTES = new Map([
  [0x00a0, ' '], // no-break space
  [0x2009, ' '], // thin space
  [0x202f, ' '], // narrow no-break space
  [0x2212, '-'], // minus sign
  [0x2192, '->'], // arrows
  [0x2190, '<-'],
])

// Keeps what the font can draw (plus newlines); emoji and other scripts are dropped,
// because one unencodable character makes pdf-lib throw for the whole document.
function printable(font, value) {
  let out = ''
  for (const ch of String(value ?? '').normalize('NFC')) {
    for (const c of SUBSTITUTES.get(ch.codePointAt(0)) ?? ch) if (c === '\n' || canDraw(font, c)) out += c
  }
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

const widthOf = (font, size, text) => font.widthOfTextAtSize(text, size)

// Splits text into lines no wider than `width`, breaking long words by character.
function wrap(text, font, size, width) {
  const lines = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ').filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (widthOf(font, size, candidate) <= width) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      let used = 0
      for (const ch of word) {
        const w = widthOf(font, size, ch)
        if (line && used + w > width) {
          lines.push(line)
          line = ''
          used = 0
        }
        line += ch
        used += w
      }
    }
    lines.push(line)
  }
  return lines
}

// At most `max` lines; the last one ends in an ellipsis if anything was cut.
function clamp(lines, max, font, size, width) {
  if (lines.length <= max) return lines
  const kept = lines.slice(0, max)
  let last = kept[max - 1]
  while (last && widthOf(font, size, `${last}${ELLIPSIS}`) > width) last = last.slice(0, -1)
  kept[max - 1] = `${last.trimEnd()}${ELLIPSIS}`
  return kept
}

// A pen moves down the page. Without a page it only measures.
function pen(page, top) {
  return {
    y: top,
    lines(lines, { font, size, color, x = MARGIN, width = TEXT_W, align = 'left', leading = 1.3 }) {
      const step = size * leading
      lines.forEach((line, i) => {
        if (!page || !line) return
        const dx = align === 'center' ? (width - widthOf(font, size, line)) / 2 : 0
        page.drawText(line, { x: x + dx, y: this.y - size - i * step, size, font, color })
      })
      this.y -= lines.length * step
    },
    text(value, { max = Infinity, ...style }) {
      const width = style.width ?? TEXT_W
      this.lines(clamp(wrap(value, style.font, style.size, width), max, style.font, style.size, width), style)
    },
    gap(points) {
      this.y -= points
    },
  }
}

// --- Page 1: the cover ---

const HEADLINE_SIZES = [34, 30, 26, 22, 19, 16]
const SIGNOFF_SIZE = 17

function cover(page, { look, fonts, c, images }) {
  const { colors } = look
  look.decorate(page, colors, true)
  const p = pen(page, PAGE_H - MARGIN - 6)
  const occasion = printable(fonts.body, (OCCASIONS[c.occasion] ?? '').toUpperCase())
  p.text(occasion, { font: fonts.body, size: 11, color: colors.muted, align: 'center' })
  p.gap(10)

  // The largest headline size that fits in three lines.
  const headline = printable(fonts.heading, c.headline)
  const size = HEADLINE_SIZES.find((s) => wrap(headline, fonts.heading, s, TEXT_W).length <= 3) ?? HEADLINE_SIZES.at(-1)
  p.text(headline, { font: fonts.heading, size, color: colors.ink, align: 'center', max: 3, leading: 1.15 })
  p.gap(8)
  p.text(`For ${c.name}`, { font: fonts.body, size: 16, color: colors.ink, align: 'center', max: 2 })
  p.gap(8)
  p.text(printable(fonts.body, c.intro), {
    font: fonts.body,
    size: 12,
    color: colors.muted,
    align: 'center',
    x: MARGIN + 30,
    width: TEXT_W - 60,
    max: 6,
  })

  // The sign-off sits at the bottom and the photos fill the space in between. Without a
  // photo that could be embedded (only API uploads can lack one) it follows the intro.
  const signoff = clamp(wrap(printable(fonts.heading, c.signoff), fonts.heading, SIGNOFF_SIZE, TEXT_W), 3, fonts.heading, SIGNOFF_SIZE, TEXT_W)
  const signoffTop = images.length ? MARGIN + 14 + signoff.length * SIGNOFF_SIZE * 1.25 : p.y - 36
  pen(page, signoffTop).lines(signoff, { font: fonts.heading, size: SIGNOFF_SIZE, color: colors.accent, align: 'center', leading: 1.25 })
  pen(page, MARGIN - 4).lines(['A giftlet keepsake'], { font: fonts.body, size: 8, color: colors.muted, align: 'center' })

  photoGrid(page, images, { top: p.y - 20, bottom: signoffTop + 20 }, colors)
}

function photoGrid(page, images, { top, bottom }, colors) {
  const n = images.length
  const height = top - bottom
  if (!n || height < 80) return
  const cols = n === 4 ? 2 : Math.min(n, 3)
  const rows = Math.ceil(n / cols)
  const gap = 14
  const side = Math.min((TEXT_W - gap * (cols - 1)) / cols, (height - gap * (rows - 1)) / rows, 250)
  const gridH = rows * side + gap * (rows - 1)
  images.forEach((image, i) => {
    const row = Math.floor(i / cols)
    const inRow = Math.min(cols, n - row * cols) // a short last row is centered
    const x0 = MARGIN + (TEXT_W - (inRow * side + gap * (inRow - 1))) / 2 + (i % cols) * (side + gap)
    const y0 = top - (height - gridH) / 2 - (row + 1) * side - row * gap
    // A polaroid: white frame, soft shadow, wider bottom edge; the photo fits inside uncropped.
    page.drawRectangle({ x: x0 + 2, y: y0 - 2, width: side, height: side, color: colors.ink, opacity: 0.12 })
    page.drawRectangle({ x: x0, y: y0, width: side, height: side, color: rgb(1, 1, 1), borderColor: colors.muted, borderWidth: 0.5, borderOpacity: 0.35 })
    const pad = side * 0.06
    const chin = side * 0.16
    const boxW = side - 2 * pad
    const boxH = side - pad - chin
    const scale = Math.min(boxW / image.width, boxH / image.height)
    const w = image.width * scale
    const h = image.height * scale
    page.drawImage(image, { x: x0 + pad + (boxW - w) / 2, y: y0 + chin + (boxH - h) / 2, width: w, height: h })
  })
}

// --- Page 2: the story ---

// Stat values may use symbols (the template's "∞"); those come from the Symbol font.
function valueRuns(value, fonts) {
  const runs = []
  for (const ch of String(value ?? '').normalize('NFC')) {
    const font = canDraw(fonts.bold, ch) ? fonts.bold : canDraw(fonts.symbol, ch) ? fonts.symbol : null
    if (!font) continue
    if (runs.at(-1)?.font === font) runs.at(-1).text += ch
    else runs.push({ font, text: ch })
  }
  if (runs.length) {
    runs[0].text = runs[0].text.trimStart()
    runs.at(-1).text = runs.at(-1).text.trimEnd()
  }
  const kept = runs.filter((r) => r.text)
  return kept.length ? kept : [{ font: fonts.bold, text: '–' }]
}

// Draws (or, with page = null, measures) page 2 and returns the height it uses.
function story(page, ctx, scale, bodyMax = Infinity) {
  const { look, fonts, c } = ctx
  const { colors } = look
  const s = (n) => n * scale
  const p = pen(page, PAGE_H - MARGIN)
  p.text(printable(fonts.body, `${OCCASIONS[c.occasion] ?? 'A gift'} · for ${c.name}`), { font: fonts.body, size: s(10), color: colors.muted })
  p.gap(s(12))

  for (const section of c.sections) {
    const top = p.y
    p.text(printable(fonts.heading, section.title), { font: fonts.heading, size: s(15), color: colors.accent, max: 2 })
    p.gap(s(3))
    p.text(printable(fonts.body, section.body), { font: fonts.body, size: s(11.5), color: colors.ink, max: bodyMax })
    if (page) page.drawRectangle({ x: MARGIN - 12, y: p.y, width: 3, height: top - p.y, color: colors.sky, opacity: 0.8 })
    p.gap(s(12))
  }

  // The statistics sit in a tinted box, measured first so the box is drawn behind them.
  const boxTop = p.y
  const statsHeight = stats(null, ctx, s, boxTop)
  if (page) {
    page.drawRectangle({ x: MARGIN - 12, y: boxTop - statsHeight, width: TEXT_W + 24, height: statsHeight, color: colors.sun, opacity: 0.18 })
    stats(page, ctx, s, boxTop)
  }
  p.gap(statsHeight)
  return PAGE_H - MARGIN - p.y
}

function stats(page, { look, fonts, c }, s, top) {
  const { colors } = look
  const p = pen(page, top - s(12))
  p.text('Totally made-up statistics', { font: fonts.heading, size: s(15), color: colors.ink })
  p.text('Every number here is a joke, not real data.', { font: fonts.body, size: s(9.5), color: colors.muted })
  p.gap(s(8))
  const valueW = 120
  const labelX = MARGIN + valueW + 12
  const labelW = TEXT_W - valueW - 12
  for (const stat of c.stats) {
    const rowTop = p.y
    // The value, shrunk if needed to fit its column.
    const runs = valueRuns(stat.value, fonts)
    const base = s(20)
    const natural = runs.reduce((w, r) => w + widthOf(r.font, base, r.text), 0)
    const size = Math.min(base, (base * valueW) / Math.max(natural, 1))
    if (page) {
      let x = MARGIN
      for (const r of runs) {
        page.drawText(r.text, { x, y: rowTop - size, size, font: r.font, color: colors.accent })
        x += widthOf(r.font, size, r.text)
      }
    }
    const label = pen(page, rowTop)
    label.text(printable(fonts.body, stat.label), { font: fonts.body, size: s(11), color: colors.ink, x: labelX, width: labelW, max: 4 })
    // Every statistic carries the same label as on the web page.
    const tagSize = s(7.5)
    const tagW = widthOf(fonts.bold, tagSize, JOKE_TAG) + 8
    if (page) page.drawRectangle({ x: labelX, y: label.y - tagSize - 4, width: tagW, height: tagSize + 5, color: colors.sun })
    label.gap(2)
    label.lines([JOKE_TAG], { font: fonts.bold, size: tagSize, color: colors.ink, x: labelX + 4, leading: 1 })
    label.gap(4)
    p.y = Math.min(label.y, rowTop - size * 1.2)
    p.gap(s(9))
  }
  p.gap(s(4))
  return top - p.y
}

// --- Decorations, one per theme (drawn first, behind the text) ---

function confettiDots(page, colors, isCover) {
  const dots = [colors.sun, colors.sky, colors.accent]
  let seed = 7
  const next = () => (seed = (seed * 9301 + 49297) % 233280) / 233280 // deterministic: the same keepsake every time
  const count = isCover ? 90 : 30
  for (let i = 0; i < count; i++) {
    const [low, high] = isCover && i % 3 === 2 ? [10, 80] : [PAGE_H - (isCover ? 170 : 40), PAGE_H - 8]
    page.drawCircle({ x: 10 + next() * (PAGE_W - 20), y: low + next() * (high - low), size: 1.5 + next() * 2.5, color: dots[i % 3], opacity: 0.6 })
  }
}

function blushCircles(page, colors, isCover) {
  const circles = isCover
    ? [
        [0.1, PAGE_H - 140, 70, colors.sun],
        [0.9, PAGE_H - 250, 48, colors.sky],
        [0.64, PAGE_H - 40, 26, colors.sun],
        [0.86, 70, 60, colors.sky],
      ]
    : [[0.94, PAGE_H - 30, 46, colors.sun]]
  for (const [fx, y, size, color] of circles) page.drawCircle({ x: fx * PAGE_W, y, size, color, opacity: 0.45 })
}

// Red and blue airmail stripes around the page: two dashed borders, offset by half a period.
function airmailBorder(page, colors) {
  const frame = { x: 18, y: 18, width: PAGE_W - 36, height: PAGE_H - 36, borderWidth: 7, borderDashArray: [14, 42] }
  page.drawRectangle({ ...frame, borderColor: colors.accent, borderDashPhase: 0 })
  page.drawRectangle({ ...frame, borderColor: colors.sky, borderDashPhase: 28 })
}

// --- Photos ---

// Width × height from a PNG's IHDR header, without decoding anything.
function pngPixels(bytes) {
  if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return Infinity
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(16) * view.getUint32(20)
}

// Embeds what it can and returns [{ index, image }]. Broken photos are left out.
async function embedPhotos(doc, photos) {
  const embedded = []
  for (const [index, photo] of photos.entries()) {
    // A fresh copy at byteOffset 0: pdf-lib 1.17's JPEG reader ignores byteOffset, and
    // pg returns small bytea values as slices of Node's shared buffer pool.
    const bytes = new Uint8Array(photo.bytes)
    try {
      if (photo.mime === 'image/jpeg') embedded.push({ index, image: await doc.embedJpg(bytes) })
      else if (photo.mime === 'image/png' && pngPixels(bytes) <= KEEPSAKE_LIMITS.pngMaxPixels) {
        embedded.push({ index, image: await doc.embedPng(bytes) })
      }
      // GIF and WebP can't go into a PDF as they are; the browser form always uploads JPEG.
    } catch {
      // Unreadable image data: the keepsake is still made without it.
    }
  }
  return embedded
}

async function render(content, photos, theme) {
  const look = LOOKS[theme]
  const doc = await PDFDocument.create()
  const loaded = new Map()
  const font = async (name) => {
    if (!loaded.has(name)) loaded.set(name, await doc.embedFont(name))
    return loaded.get(name)
  }
  const fonts = {
    heading: await font(look.heading),
    body: await font(StandardFonts.Helvetica),
    bold: await font(StandardFonts.HelveticaBold),
    symbol: await font(StandardFonts.Symbol),
  }
  const embedded = await embedPhotos(doc, photos)
  const c = { ...content, name: printable(fonts.body, content.rawName) || 'you' }

  doc.setTitle(`A keepsake for ${c.rawName}`) // metadata is UTF-16: any name works here
  doc.setProducer('giftlet')
  doc.setCreator('giftlet')

  cover(doc.addPage([PAGE_W, PAGE_H]), { look, fonts, c, images: embedded.map((e) => e.image) })

  const second = doc.addPage([PAGE_W, PAGE_H])
  look.decorate(second, look.colors, false)
  const room = PAGE_H - 2 * MARGIN - 16 // above the footer line
  const ctx = { look, fonts, c }
  const scale = STORY_SCALES.find((s) => story(null, ctx, s) <= room)
  if (scale !== undefined) {
    story(second, ctx, scale)
  } else {
    // Still too long at the smallest size: cut every memory to the same number of lines.
    const smallest = STORY_SCALES.at(-1)
    let bodyMax = 30
    while (bodyMax > 1 && story(null, ctx, smallest, bodyMax) > room) bodyMax--
    story(second, ctx, smallest, bodyMax)
  }
  pen(second, MARGIN - 4).lines(['Made with giftlet'], { font: fonts.body, size: 8, color: look.colors.muted, align: 'center' })

  // Uncompressed object storage: a little larger, readable by older PDF viewers and printers.
  return { bytes: await doc.save({ useObjectStreams: false }), embedded }
}

// The keepsake for a page's stored content plus its photos ([{ mime, bytes }], in order).
export async function keepsakePdf({ theme, answers, copy, photos = [] }, { maxBytes = KEEPSAKE_LIMITS.maxBytes } = {}) {
  const look = Object.hasOwn(LOOKS, theme ?? '') && Object.hasOwn(THEMES, theme) ? theme : DEFAULT_THEME
  const content = {
    occasion: answers.occasion,
    rawName: answers.name,
    headline: copy.headline,
    intro: copy.intro,
    sections: copy.sections,
    stats: copy.stats,
    signoff: copy.signoff,
  }
  let candidates = photos.slice(0, KEEPSAKE_LIMITS.photos)
  for (;;) {
    const { bytes, embedded } = await render(content, candidates, look)
    if (bytes.length <= maxBytes || embedded.length === 0) return bytes
    // Too big for the response cap: keep only photos that embedded, minus the last one, and retry.
    const drop = embedded.at(-1).index
    candidates = candidates.filter((_, i) => i !== drop && embedded.some((e) => e.index === i))
  }
}

// An ASCII, header-safe filename: "giftlet-keepsake-jose-maria.pdf".
export function keepsakeFilename(name) {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '') // accents: "José" -> "Jose"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug ? `giftlet-keepsake-${slug}.pdf` : 'giftlet-keepsake.pdf'
}
