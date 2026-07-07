import { ClaudeApiError, type ClaudeConfig } from '../types/llm'

const API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const MAX_TOKENS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529
}

interface ClaudeTextBlock {
  type: string
  text?: string
}

async function callOnce(prompt: string, config: ClaudeConfig): Promise<string> {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // ブラウザから直接呼び出すための明示的なオプトインヘッダー。
      // このアプリはローカル単一ユーザー向けのため、ユーザー自身のAPIキーを
      // ユーザー自身のブラウザから使う分にはリスクを許容できる設計としている。
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    let message = `Claude APIエラー (HTTP ${response.status})`
    try {
      const body: unknown = await response.json()
      const apiMessage = (body as { error?: { message?: string } })?.error?.message
      if (apiMessage) message = apiMessage
    } catch {
      // レスポンスがJSONでない場合はデフォルトメッセージのまま
    }
    throw new ClaudeApiError(message, response.status, isRetryableStatus(response.status))
  }

  const data: unknown = await response.json()
  const content = (data as { content?: ClaudeTextBlock[] })?.content
  const text = Array.isArray(content)
    ? content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('\n')
    : ''

  if (!text) {
    throw new ClaudeApiError('Claude APIの応答を解析できませんでした（テキストが含まれていません）')
  }
  return text
}

/** Claude Messages APIを呼び出す。一過性エラー(429/5xx/ネットワークエラー)は指数バックオフで自動リトライする。 */
export async function callClaude(prompt: string, config: ClaudeConfig): Promise<string> {
  if (!config.apiKey) throw new ClaudeApiError('APIキーが設定されていません')

  let lastError: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callOnce(prompt, config)
    } catch (err) {
      lastError = err
      const retryable = err instanceof ClaudeApiError ? err.retryable : true
      if (!retryable || attempt === MAX_RETRIES) break
      await sleep(BASE_DELAY_MS * 2 ** attempt)
    }
  }
  throw lastError instanceof Error ? lastError : new ClaudeApiError('Claude API呼び出しに失敗しました')
}
