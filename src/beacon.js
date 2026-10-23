// The RepoHQ usage beacon, served at /beacon.js as `(${beaconClient})()`. web.js only puts
// it on pages of the production deployment (VERCEL_ENV=production), so previews, local
// runs and tests never load it. It must stay self-contained: no imports.
//
//   visit     a public page was opened: once per browser session (sessionStorage)
//   activate  this browser made its first gift page (the form's core action): once per browser (localStorage)
//   checkout  someone clicked the Buy button ("Unlock for $9")
//
// Each event is one fire-and-forget POST of {"slug":"giftlet","kind":…,"referrer":…}, with
// no cookies. The referrer is sent only when the visitor came from another site, so a gift
// page's private link never leaves the page. Nothing is sent by automated browsers
// (navigator.webdriver) or from a browser with localStorage "repohq:notrack" set (the owner's).
export const SIGNAL_URL = 'https://repohq.vercel.app/api/ideas/signal'

export function beaconClient() {
  const ENDPOINT = 'https://repohq.vercel.app/api/ideas/signal'
  const isPublicPage = document.currentScript?.dataset.page === 'public'

  // Off for bots and the owner. Storage that can't be read counts as off too.
  function muted() {
    if (navigator.webdriver) return true
    try {
      return window.localStorage.getItem('repohq:notrack') !== null
    } catch {
      return true
    }
  }

  function externalReferrer() {
    try {
      return document.referrer && new URL(document.referrer).origin !== location.origin ? document.referrer : null
    } catch {
      return null
    }
  }

  function send(kind) {
    if (muted()) return
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        keepalive: true, // survives the navigation that usually follows (to Stripe, or to the new page)
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug: 'giftlet', kind, referrer: externalReferrer() }),
      }).catch(() => {})
    } catch {
      // never let counting break the page
    }
  }

  // Sends `kind` only if `key` isn't in the storage yet. Without working storage nothing
  // is sent: undercounting beats counting every page view as a new visit.
  function once(storage, key, kind) {
    if (muted()) return
    try {
      const store = storage()
      if (store.getItem(key) !== null) return
      store.setItem(key, '1')
    } catch {
      return
    }
    send(kind)
  }

  if (isPublicPage) once(() => window.sessionStorage, 'repohq:visit', 'visit')
  // form.js dispatches this when POST /generate has made a page.
  document.addEventListener('giftlet:activate', () => once(() => window.localStorage, 'repohq:activate', 'activate'))
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-signal="checkout"]')) send('checkout')
  })
}
