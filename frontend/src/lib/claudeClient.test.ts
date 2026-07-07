import { afterEach, describe, expect, it, vi } from 'vitest'
import { callClaude } from './claudeClient'
import type { ClaudeConfig } from '../types/llm'

const CONFIG: ClaudeConfig = { apiKey: 'test-key', model: 'claude-test' }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('callClaude', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('throws immediately when no API key is configured (no network call)', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock
    await expect(callClaude('prompt', { apiKey: '', model: 'x' })).rejects.toThrow('APIキーが設定されていません')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the joined text from all text content blocks on success', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'World' }] }))
    await expect(callClaude('prompt', CONFIG)).resolves.toBe('Hello\nWorld')
  })

  it('sends the API key and the direct-browser-access opt-in header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }))
    globalThis.fetch = fetchMock
    await callClaude('prompt', CONFIG)
    const [, options] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(options.headers['x-api-key']).toBe('test-key')
    expect(options.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
  })

  it('fails immediately on a non-retryable error (401) without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'invalid x-api-key' } }, 401))
    globalThis.fetch = fetchMock
    await expect(callClaude('prompt', CONFIG)).rejects.toThrow('invalid x-api-key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a retryable error (429) and succeeds once the server recovers', async () => {
    vi.useFakeTimers()
    let call = 0
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      call++
      if (call < 3) return jsonResponse({ error: { message: 'rate limited' } }, 429)
      return jsonResponse({ content: [{ type: 'text', text: 'recovered' }] })
    })
    const promise = callClaude('prompt', CONFIG)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('recovered')
    expect(call).toBe(3)
  })

  it('gives up after exhausting retries on a persistently retryable error', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500))
    globalThis.fetch = fetchMock
    const promise = callClaude('prompt', CONFIG)
    const expectation = expect(promise).rejects.toThrow(/HTTP 500/)
    await vi.runAllTimersAsync()
    await expectation
    expect(fetchMock).toHaveBeenCalledTimes(4) // initial attempt + 3 retries
  })

  it('treats a thrown network error as retryable and recovers', async () => {
    vi.useFakeTimers()
    let call = 0
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      call++
      if (call === 1) throw new TypeError('network error')
      return jsonResponse({ content: [{ type: 'text', text: 'ok after network blip' }] })
    })
    const promise = callClaude('prompt', CONFIG)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBe('ok after network blip')
  })

  it('falls back to a generic HTTP-status message when the error body is not JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('not json', { status: 401 }))
    await expect(callClaude('prompt', CONFIG)).rejects.toThrow('HTTP 401')
  })

  it('throws a parse error when the response has no text content blocks', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ content: [] }))
    await expect(callClaude('prompt', CONFIG)).rejects.toThrow('テキストが含まれていません')
  })
})
