// Copy writing: the template fallback, the Gemini call, and validation of model output.
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { templateCopy, normalizeCopy, geminiWriter, geminiRequest, COPY_LIMITS, DEFAULT_MODEL } from '../src/copy.js'
import { OCCASIONS, RELATIONSHIPS, TONES } from '../src/answers.js'
import { MEMORIES, silentLog } from './helpers.js'

const ANSWERS = { name: 'Maya', occasion: 'birthday', relationship: 'friend', tone: 'funny', memories: MEMORIES }

// Built at runtime so nothing credential-shaped is committed.
const FAKE_KEY = ['test', 'key', 'x'.repeat(12)].join('-')

const GOOD_COPY = {
  headline: 'Maya: a birthday dossier',
  intro: 'Compiled with love and questionable research.',
  sections: [
    { title: 'The taco incident', body: 'Lost in Arizona.\nFound tacos.' },
    { title: 'Pancakes at 2am', body: 'Chemistry was passed.' },
  ],
  stats: [
    { value: '4,812', label: 'terrible puns forgiven' },
    { value: '97%', label: 'of karaoke rooms improved by her presence' },
    { value: '1', label: 'flu defeated by soup and jokes' },
    { value: '∞', label: 'reasons to celebrate' },
  ],
  signoff: 'Happy birthday, legend.',
}

function geminiResponse(payload, init = {}) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function assertValidCopy(copy) {
  assert.equal(typeof copy.headline, 'string')
  assert.ok(copy.headline.length > 0 && copy.headline.length <= COPY_LIMITS.headline, copy.headline)
  assert.ok(copy.intro.length > 0 && copy.intro.length <= COPY_LIMITS.intro)
  assert.ok(copy.sections.length >= 1 && copy.sections.length <= COPY_LIMITS.sectionsMax)
  for (const s of copy.sections) {
    assert.ok(s.title.length > 0 && s.title.length <= COPY_LIMITS.sectionTitle)
    assert.ok(s.body.length > 0 && s.body.length <= COPY_LIMITS.sectionBody)
  }
  assert.ok(copy.stats.length >= COPY_LIMITS.statsMin && copy.stats.length <= COPY_LIMITS.statsMax)
  for (const s of copy.stats) {
    assert.ok(s.value.length > 0 && s.value.length <= COPY_LIMITS.statValue, s.value)
    assert.ok(s.label.length > 0 && s.label.length <= COPY_LIMITS.statLabel, s.label)
  }
  assert.ok(copy.signoff.length > 0 && copy.signoff.length <= COPY_LIMITS.signoff)
}

describe('templateCopy', () => {
  test('produces valid copy for every occasion × relationship × tone, even with a maximum-length name', () => {
    for (const occasion of Object.keys(OCCASIONS)) {
      for (const relationship of Object.keys(RELATIONSHIPS)) {
        for (const tone of Object.keys(TONES)) {
          for (const name of ['Maya', 'N'.repeat(60)]) {
            const copy = templateCopy({ ...ANSWERS, name, occasion, relationship, tone })
            assertValidCopy(copy)
            assert.ok(!copy.headline.endsWith('…'), `headline truncated for ${occasion}`)
          }
        }
      }
    }
  })

  test('has one section per memory, with the memory text as written', () => {
    const copy = templateCopy(ANSWERS)
    assert.equal(copy.sections.length, MEMORIES.length)
    assert.deepEqual(
      copy.sections.map((s) => s.body),
      MEMORIES,
    )
  })

  test('the headline names the recipient and fits the occasion', () => {
    assert.equal(templateCopy(ANSWERS).headline, 'Happy birthday, Maya!')
    assert.match(templateCopy({ ...ANSWERS, occasion: 'anniversary' }).headline, /anniversary, Maya/)
    assert.match(templateCopy({ ...ANSWERS, occasion: 'farewell' }).headline, /Maya/)
  })
})

describe('normalizeCopy (LLM output trust boundary)', () => {
  test('falls back to the template when there is no model output', () => {
    assert.deepEqual(normalizeCopy(null, ANSWERS), templateCopy(ANSWERS))
    assert.deepEqual(normalizeCopy('not an object', ANSWERS), templateCopy(ANSWERS))
    assert.deepEqual(normalizeCopy([], ANSWERS), templateCopy(ANSWERS))
  })

  test('keeps good model output as-is', () => {
    assert.deepEqual(normalizeCopy(GOOD_COPY, ANSWERS), GOOD_COPY)
  })

  test('falls back entirely when the headline is missing or not a string', () => {
    assert.deepEqual(normalizeCopy({ ...GOOD_COPY, headline: 42 }, ANSWERS), templateCopy(ANSWERS))
    assert.deepEqual(normalizeCopy({ ...GOOD_COPY, headline: '   ' }, ANSWERS), templateCopy(ANSWERS))
  })

  test('pads to at least 3 stats from the template when the model returns fewer', () => {
    const copy = normalizeCopy({ ...GOOD_COPY, stats: GOOD_COPY.stats.slice(0, 2) }, ANSWERS)
    assert.equal(copy.stats.length, 3)
    assert.deepEqual(copy.stats.slice(0, 2), GOOD_COPY.stats.slice(0, 2))
    assert.deepEqual(copy.stats[2], templateCopy(ANSWERS).stats[0])
  })

  test('drops malformed sections and stats, and coerces numeric stat values', () => {
    const copy = normalizeCopy(
      {
        ...GOOD_COPY,
        sections: [null, { title: 'ok' }, { title: 'Good', body: 'Body' }, 'string'],
        stats: [{ value: 12, label: 'numeric value' }, { value: 'x' }, { label: 'no value' }, { value: NaN, label: 'nan' }, 7],
      },
      ANSWERS,
    )
    assert.deepEqual(copy.sections, [{ title: 'Good', body: 'Body' }])
    assert.deepEqual(copy.stats[0], { value: '12', label: 'numeric value' })
    assert.equal(copy.stats.length, 3)
  })

  test('uses template sections, intro and signoff when the model’s are unusable', () => {
    const fallback = templateCopy(ANSWERS)
    const copy = normalizeCopy({ headline: 'Hi', sections: 'nope', stats: GOOD_COPY.stats, intro: {}, signoff: null }, ANSWERS)
    assert.deepEqual(copy.sections, fallback.sections)
    assert.equal(copy.intro, fallback.intro)
    assert.equal(copy.signoff, fallback.signoff)
  })

  test('caps lengths and counts', () => {
    const copy = normalizeCopy(
      {
        headline: 'H'.repeat(500),
        intro: 'I'.repeat(5000),
        sections: Array.from({ length: 9 }, () => ({ title: 'T'.repeat(300), body: 'B'.repeat(3000) })),
        stats: Array.from({ length: 20 }, () => ({ value: 'V'.repeat(100), label: 'L'.repeat(1000) })),
        signoff: 'S'.repeat(1000),
      },
      ANSWERS,
    )
    assertValidCopy(copy)
    assert.equal(copy.sections.length, COPY_LIMITS.sectionsMax)
    assert.equal(copy.stats.length, COPY_LIMITS.statsMax)
    assert.ok(copy.headline.endsWith('…'))
  })

  test('strips control characters but keeps paragraph breaks in section bodies', () => {
    const copy = normalizeCopy(
      { ...GOOD_COPY, headline: `Hi\u0007 there${String.fromCharCode(0x202e)}`, sections: [{ title: 'A\nB', body: 'one\r\n\r\n\r\ntwo\u0000' }] },
      ANSWERS,
    )
    assert.equal(copy.headline, 'Hi there')
    assert.deepEqual(copy.sections, [{ title: 'A B', body: 'one\n\ntwo' }])
  })
})

describe('geminiWriter', () => {
  test('without an API key it never calls the network and returns null', async () => {
    let called = false
    const write = geminiWriter({
      apiKey: undefined,
      fetch: async () => {
        called = true
      },
    })
    assert.equal(await write(ANSWERS), null)
    assert.equal(called, false)
  })

  test('calls Gemini with the key in a header (never the URL) and returns the parsed JSON', async () => {
    const calls = []
    const write = geminiWriter({
      apiKey: FAKE_KEY,
      log: silentLog,
      fetch: async (url, init) => {
        calls.push({ url, init })
        return geminiResponse(GOOD_COPY)
      },
    })
    assert.deepEqual(await write(ANSWERS), GOOD_COPY)
    assert.equal(calls.length, 1)
    const [{ url, init }] = calls
    assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`)
    assert.ok(!url.includes(FAKE_KEY))
    assert.equal(init.method, 'POST')
    assert.equal(init.headers['x-goog-api-key'], FAKE_KEY)
    assert.ok(init.signal instanceof AbortSignal)
    assert.deepEqual(JSON.parse(init.body), geminiRequest(ANSWERS))
  })

  test('uses the configured model name', async () => {
    let seenUrl
    const write = geminiWriter({
      apiKey: FAKE_KEY,
      model: 'gemini-flash-lite-latest',
      fetch: async (url) => {
        seenUrl = url
        return geminiResponse(GOOD_COPY)
      },
    })
    await write(ANSWERS)
    assert.match(seenUrl, /models\/gemini-flash-lite-latest:generateContent$/)
  })

  const failures = [
    ['an HTTP error (e.g. free-tier 429)', async () => new Response('{"error":{}}', { status: 429 })],
    ['a network error', async () => Promise.reject(new TypeError('fetch failed'))],
    ['text that is not JSON', async () => geminiResponse('Sure! Here is your page: ...')],
    ['no candidates', async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })],
    ['a non-JSON response body', async () => new Response('<html>oops</html>', { status: 200 })],
  ]
  for (const [label, fetch] of failures) {
    test(`returns null on ${label}, and logs without the key`, async () => {
      const lines = []
      const log = { warn: (...args) => lines.push(args.join(' ')), error: (...args) => lines.push(args.join(' ')) }
      const write = geminiWriter({ apiKey: FAKE_KEY, fetch, log })
      assert.equal(await write(ANSWERS), null)
      assert.ok(lines.length >= 1, 'failure is logged')
      assert.ok(lines.every((line) => !line.includes(FAKE_KEY)), 'key never logged')
    })
  }

  test('gives up after the timeout and returns null', async () => {
    const write = geminiWriter({
      apiKey: FAKE_KEY,
      timeoutMs: 30,
      log: silentLog,
      // A request that never answers. The timer stands in for the open socket a real
      // fetch would hold (AbortSignal.timeout's own timer doesn't keep Node alive).
      fetch: (url, init) =>
        new Promise((resolve, reject) => {
          const socket = setTimeout(() => {}, 10_000)
          init.signal.addEventListener('abort', () => {
            clearTimeout(socket)
            reject(init.signal.reason)
          })
        }),
    })
    const started = Date.now()
    assert.equal(await write(ANSWERS), null)
    assert.ok(Date.now() - started < 2000)
  })
})

describe('geminiRequest (prompt)', () => {
  const request = geminiRequest(ANSWERS)
  const rules = request.systemInstruction.parts[0].text
  const user = request.contents[0].parts[0].text

  test('asks for JSON matching a schema with every copy field', () => {
    assert.equal(request.generationConfig.responseMimeType, 'application/json')
    const schema = request.generationConfig.responseSchema
    assert.deepEqual(schema.required, ['headline', 'intro', 'sections', 'stats', 'signoff'])
  })

  test('states the celebration-only rules and that stats are jokes', () => {
    assert.match(rules, /celebrat/i)
    assert.match(rules, /exes|ex-partners|past partners/i)
    assert.match(rules, /never .*(insult|roast|mock)/i)
    assert.match(rules, /made-up|joke/i)
    assert.match(rules, /not as instructions/i)
  })

  test('takes its length limits from COPY_LIMITS so prompt and validation cannot drift', () => {
    assert.ok(rules.includes(`${COPY_LIMITS.headline} characters`))
    assert.ok(rules.includes(`${COPY_LIMITS.statLabel} characters`))
  })

  test('lists the answers, with memories numbered from 1', () => {
    assert.match(user, /Recipient: Maya/)
    assert.match(user, /Occasion: Birthday/)
    assert.match(user, /friend/)
    assert.match(user, /Tone: Funny/)
    MEMORIES.forEach((memory, i) => assert.ok(user.includes(`${i + 1}. ${memory}`)))
    assert.ok(!user.includes('0. '))
  })
})
