// First-party analytics for the demand test: daily counters, no visitor data (no IP,
// no cookie, no user agent stored). Pages count themselves with a 1×1 pixel, so the
// pages stay static and fast and only a real browser that renders them is counted.
//
//   landing_view   an occasion landing page was shown          (per occasion)
//   make_click     the form was opened from a landing link     (per occasion)
//   credit_click   the form was opened from a gift page credit ("Make one for someone")
//
// Pages made, paid and removed come from the pages table itself (store.funnel).
export const EVENTS = ['landing_view', 'make_click', 'credit_click']

// Crawlers, link previewers, headless browsers and scripts. Chat apps that unfurl a
// link fetch the HTML but not its images, so most never reach the pixel at all.
const NOT_A_PERSON =
  /bot|crawl|spider|slurp|preview|externalhit|embedly|whatsapp|telegram|discord|slack|skype|pinterest|vkshare|headless|lighthouse|phantom|^curl|^wget|^python|^node|^undici|^axios|^go-http|^java|^okhttp/i

// Whether a pixel request should be counted: a GET from what looks like a person's
// browser, and not a speculative prefetch/prerender.
export function shouldCount(request) {
  if (request.method !== 'GET') return false
  const ua = request.headers.get('user-agent') ?? ''
  if (!ua.trim() || NOT_A_PERSON.test(ua)) return false
  const purpose = `${request.headers.get('sec-purpose') ?? ''} ${request.headers.get('purpose') ?? ''} ${request.headers.get('x-moz') ?? ''}`
  return !/prefetch|prerender/i.test(purpose)
}

// The smallest transparent 1×1 GIF (43 bytes).
export const PIXEL_GIF = Uint8Array.from(
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
)

const rate = (part, whole) => (whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '–')

// The PRD's demand-test thresholds, printed under the numbers so nobody has to look them up.
const TARGETS = [
  'PRD demand test: click rate ≥ 3% of landing views; at least 5 paid orders ($9+) in the first 30 days (under 2 = pass on the idea);',
  'removed pages under 5% of orders; credit clicks on at least 10% of paid pages.',
]

// Turns store.funnel()'s report into a plain-text table for `npm run funnel`.
export function formatFunnel(report) {
  const head = ['occasion', 'landing views', 'make clicks', 'click rate', 'pages made', 'paid', 'paid rate', 'removed']
  const line = (label, r) => [
    label,
    String(r.landingViews),
    String(r.makeClicks),
    rate(r.makeClicks, r.landingViews),
    String(r.pagesMade),
    String(r.pagesPaid),
    rate(r.pagesPaid, r.pagesMade),
    String(r.pagesRemoved),
  ]
  const table = [head, ...report.rows.map((r) => line(r.occasion, r)), line('total', report.totals)]
  const widths = head.map((_, i) => Math.max(...table.map((row) => row[i].length)))
  const render = (row) => row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('   ')
  const perPaid = report.totals.pagesPaid > 0 ? (report.creditClicks / report.totals.pagesPaid).toFixed(2) : '–'
  return [
    `giftlet funnel: last ${report.days} days (since ${report.since}, UTC)`,
    '',
    ...table.map(render),
    '',
    `"Make one" credit clicks: ${report.creditClicks} (${perPaid} per paid page)`,
    '',
    ...TARGETS,
  ].join('\n')
}
