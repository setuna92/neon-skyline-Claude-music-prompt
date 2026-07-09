import { afterEach, describe, expect, it, vi } from 'vitest'
import { composeSunoSongViaHelper, isSunoHelperRunning } from './sunoAutomationClient'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('isSunoHelperRunning', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns true when the local helper responds ok to /health', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    await expect(isSunoHelperRunning()).resolves.toBe(true)
  })

  it('returns false when the helper is not reachable (fetch throws)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused'))
    await expect(isSunoHelperRunning()).resolves.toBe(false)
  })

  it('returns false when the helper responds with a non-ok status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, 500))
    await expect(isSunoHelperRunning()).resolves.toBe(false)
  })
})

describe('composeSunoSongViaHelper', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('posts the prompt text to the helper and returns its success result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    globalThis.fetch = fetchMock
    await expect(composeSunoSongViaHelper('a suno prompt')).resolves.toEqual({ ok: true })
    const [url, options] = fetchMock.mock.calls[0] as [string, { method: string; body: string }]
    expect(url).toContain('/compose')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ prompt: 'a suno prompt' })
  })

  it('surfaces the helper-provided error message on a non-ok response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: 'selector not found' }, 500))
    await expect(composeSunoSongViaHelper('x')).resolves.toEqual({ ok: false, error: 'selector not found' })
  })

  it('returns a friendly error when the helper is not running (fetch throws)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connection refused'))
    const result = await composeSunoSongViaHelper('x')
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
