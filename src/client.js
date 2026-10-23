// Browser script for the questionnaire, served at /form.js as `(${formClient})()`.
// It must stay self-contained: no imports, nothing from the enclosing module.
//
// Why it exists: Vercel rejects function request bodies over 4.5 MB *in total*, so
// photos are shrunk and re-encoded as JPEG here before upload. Re-encoding through a
// canvas also drops EXIF metadata (e.g. GPS location) from phone photos.
export function formClient() {
  const form = document.getElementById('gift-form')
  if (!form) return
  const status = document.getElementById('status')
  const button = form.querySelector('button[type="submit"]')
  const TOTAL_BUDGET = 3.8 * 1024 * 1024 // leaves room for text fields and multipart overhead
  const MIN_PHOTOS = Number(form.elements.photo.dataset.min)
  const MAX_PHOTOS = Number(form.elements.photo.dataset.max)

  function say(message, isError) {
    status.textContent = message
    status.className = isError ? 'error' : ''
  }

  async function loadImage(file) {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode() // browsers apply EXIF orientation when decoding
      return img
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function shrink(file, budget) {
    const img = await loadImage(file)
    let edge = 1600
    let quality = 0.82
    let blob = null
    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= budget) return blob
      edge = Math.round(edge * 0.8)
      quality = Math.max(0.5, quality - 0.08)
    }
    return blob
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const files = Array.from(form.elements.photo.files)
    if (files.length < MIN_PHOTOS || files.length > MAX_PHOTOS) {
      say(`Pick ${MIN_PHOTOS} to ${MAX_PHOTOS} photos.`, true)
      return
    }
    if (!form.reportValidity()) return

    // Every answer as the form has it (blank optional memories are dropped by the
    // server); only the photos are swapped for shrunk copies below.
    const data = new FormData(form)
    data.delete('photo')

    button.disabled = true
    try {
      const budget = Math.floor(TOTAL_BUDGET / files.length)
      for (let i = 0; i < files.length; i++) {
        say(`Shrinking photo ${i + 1} of ${files.length}…`)
        let blob = null
        try {
          blob = await shrink(files[i], budget)
        } catch {
          blob = null
        }
        if (!blob) throw new Error(`Couldn't read photo ${i + 1}. Try a JPEG or PNG.`)
        data.append('photo', blob, `photo-${i + 1}.jpg`)
      }
      say('Writing your page… this takes a few seconds.')
      const res = await fetch('/generate', { method: 'POST', body: data, headers: { accept: 'application/json' } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Something went wrong (${res.status}). Please try again.`)
      // The core action worked: /beacon.js (production only) counts it as "activate".
      document.dispatchEvent(new Event('giftlet:activate'))
      window.location.assign(body.url)
    } catch (err) {
      say(err.message, true)
      button.disabled = false
    }
  })
}
