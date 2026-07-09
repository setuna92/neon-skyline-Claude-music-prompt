const HELPER_BASE_URL = 'http://127.0.0.1:5175'
const HEALTH_CHECK_TIMEOUT_MS = 1500

export interface SunoComposeResult {
  ok: boolean
  error?: string
}

/**
 * ローカルPCで動くSuno自動化ヘルパー(suno-automation-helper)が起動しているか確認する。
 * ヘルパーは同一オリジンではなく http://127.0.0.1:5175 で動くため、ここへのfetchは常にクロスオリジンになる
 * (デプロイ版のhttpsページから呼ぶ場合も、ブラウザはloopbackアドレスへのfetchを混在コンテンツとして
 * ブロックしないため問題なく届く)。
 */
export async function isSunoHelperRunning(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS)
    const res = await fetch(`${HELPER_BASE_URL}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

/** 生成済みのSuno向け作曲プロンプト文を、ローカルの自動化ヘルパー経由でSunoに送信し、自動で作曲させる。 */
export async function composeSunoSongViaHelper(promptText: string): Promise<SunoComposeResult> {
  try {
    const res = await fetch(`${HELPER_BASE_URL}/compose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: promptText }),
    })
    const data = (await res.json()) as SunoComposeResult
    if (!res.ok) {
      return { ok: false, error: data.error ?? `ヘルパーがエラーを返しました (HTTP ${res.status})` }
    }
    return data
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'ローカルのSuno自動化ヘルパーに接続できませんでした',
    }
  }
}
