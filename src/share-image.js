// The 1200×630 share image behind og:image and twitter:image, drawn in code: a confetti
// background, "giftlet" in a dot-matrix font and the pitch in a pixel font, encoded as
// PNG with node:zlib. No image file to bundle, nothing copied from the web, no build step.
// It is drawn once, on the first request for /og.png, and kept in memory.
import { deflateSync } from 'node:zlib'

export const SHARE_IMAGE = {
  path: '/og.png',
  width: 1200,
  height: 630,
  alt: 'giftlet: a personal gift website in two minutes, for $9',
}
const TAGLINE = ['a personal gift website', 'in two minutes, for $9']

const W = SHARE_IMAGE.width
const H = SHARE_IMAGE.height
// The site's palette (pages.js :root).
const PAPER = [0xff, 0xfa, 0xf3]
const BLUSH = [0xff, 0xe6, 0xee]
const INK = [0x2b, 0x1d, 0x3a]
const MUTED = [0x6b, 0x5b, 0x7b]
const ACCENT = [0xe8, 0x45, 0x7c]
const SUN = [0xff, 0xc9, 0x4a]
const SKY = [0x5e, 0xc8, 0xe5]
const CARD = [0xff, 0xff, 0xff]

// 5-wide glyphs: rows 0–6 sit on the baseline, rows 7–8 are descenders.
const GLYPHS = {
  a: ['.....', '.....', '.###.', '....#', '.####', '#...#', '.####'],
  b: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '####.'],
  c: ['.....', '.....', '.###.', '#....', '#....', '#....', '.###.'],
  d: ['....#', '....#', '.####', '#...#', '#...#', '#...#', '.####'],
  e: ['.....', '.....', '.###.', '#...#', '#####', '#....', '.###.'],
  f: ['..##.', '.#...', '####.', '.#...', '.#...', '.#...', '.#...'],
  g: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  h: ['#....', '#....', '####.', '#...#', '#...#', '#...#', '#...#'],
  i: ['..#..', '.....', '.##..', '..#..', '..#..', '..#..', '.###.'],
  j: ['...#.', '.....', '..##.', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  k: ['#....', '#....', '#..#.', '#.#..', '##...', '#.#..', '#..#.'],
  l: ['.##..', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  n: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '#...#'],
  o: ['.....', '.....', '.###.', '#...#', '#...#', '#...#', '.###.'],
  p: ['.....', '.....', '####.', '#...#', '#...#', '#...#', '####.', '#....', '#....'],
  q: ['.....', '.....', '.####', '#...#', '#...#', '#...#', '.####', '....#', '....#'],
  r: ['.....', '.....', '#.##.', '##..#', '#....', '#....', '#....'],
  s: ['.....', '.....', '.####', '#....', '.###.', '....#', '####.'],
  t: ['.#...', '.#...', '####.', '.#...', '.#...', '.#..#', '..##.'],
  u: ['.....', '.....', '#...#', '#...#', '#...#', '#..##', '.##.#'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['.....', '.....', '#...#', '#...#', '#...#', '#...#', '.####', '....#', '.###.'],
  z: ['.....', '.....', '#####', '...#.', '..#..', '.#...', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  ',': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..', '..#..', '.#...'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
}

// Pixel width and height of `text` at `cell` pixels per glyph cell (5 wide + 1 gap, 9 rows).
function textBox(text, cell) {
  return { width: text.length * 6 * cell - cell, height: 9 * cell }
}

function canvas() {
  const px = new Uint8Array(W * H * 3)
  // Alpha-blends a colour into one pixel (coverage 0–1); off-canvas pixels are ignored.
  const blend = (x, y, rgb, alpha = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H || alpha <= 0) return
    const i = (y * W + x) * 3
    const a = Math.min(1, alpha)
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] + (rgb[k] - px[i + k]) * a)
  }
  // An anti-aliased disc: coverage falls off over the last pixel of the radius.
  const disc = (cx, cy, r, rgb) => {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        blend(x, y, rgb, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy))
      }
    }
  }
  const rect = (x0, y0, w, h, rgb) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) blend(x, y, rgb)
  }
  // Draws `text` with its top-left corner at (x0, y0): each lit cell a dot or a square.
  const write = (text, x0, y0, cell, rgb, style) => {
    ;[...text].forEach((ch, n) => {
      const glyph = GLYPHS[ch]
      if (!glyph) throw new Error(`share image: no glyph for ${JSON.stringify(ch)}`)
      glyph.forEach((row, r) => {
        for (let c = 0; c < 5; c++) {
          if (row[c] !== '#') continue
          const x = x0 + (n * 6 + c) * cell
          const y = y0 + r * cell
          if (style === 'dots') disc(x + cell / 2, y + cell / 2, cell * 0.43, rgb)
          else rect(x, y, cell, cell, rgb)
        }
      })
    })
  }
  return { px, blend, disc, rect, write }
}

function draw() {
  const { px, blend, disc, write } = canvas()
  // Paper fading to blush, top to bottom.
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1)
    const rgb = PAPER.map((v, k) => v + (BLUSH[k] - v) * t)
    for (let x = 0; x < W; x++) blend(x, y, rgb)
  }

  const title = { text: 'giftlet', cell: 22, y: 92 }
  const lines = [
    { text: TAGLINE[0], cell: 7, y: 346, rgb: INK },
    { text: TAGLINE[1], cell: 7, y: 432, rgb: MUTED },
  ]
  const boxes = [title, ...lines].map(({ text, cell, y }) => {
    const { width, height } = textBox(text, cell)
    return { x: Math.round((W - width) / 2), y, width, height }
  })

  // Confetti from a fixed seed (the same image every time), kept clear of the text.
  let seed = 20261023
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  const colours = [SUN, SKY, ACCENT]
  for (let placed = 0, tries = 0; placed < 64 && tries < 2000; tries++) {
    const r = 5 + random() * 9
    const x = random() * W
    const y = random() * (H - 40)
    const clear = boxes.every((b) => x < b.x - 36 - r || x > b.x + b.width + 36 + r || y < b.y - 30 - r || y > b.y + b.height + 30 + r)
    if (!clear) continue
    disc(x, y, r, colours[placed % 3])
    placed++
  }

  write(title.text, boxes[0].x, title.y, title.cell, ACCENT, 'dots')
  lines.forEach((line, i) => write(line.text, boxes[i + 1].x, line.y, line.cell, line.rgb, 'pixels'))

  // An airmail edge along the bottom, like the Postcard theme.
  const stripes = [ACCENT, CARD, SKY, CARD]
  for (let y = H - 22; y < H; y++) {
    for (let x = 0; x < W; x++) blend(x, y, stripes[Math.floor((x + (H - y)) / 18) % 4])
  }
  return px
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

export function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

// RGB pixels -> PNG bytes (8-bit truecolour, no interlace, filter 0 on every row).
function encodePng(px, width, height) {
  const rows = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    Buffer.from(px.buffer, px.byteOffset + y * width * 3, width * 3).copy(rows, y * (1 + width * 3) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let cached
export function shareImagePng() {
  cached ??= new Uint8Array(encodePng(draw(), W, H))
  return cached
}
