// 派生した暗号化キーはメモリ上のみで保持し、永続化しない（パスフレーズ自体も保存しない）
let activeKey: CryptoKey | null = null

export function setActiveKey(key: CryptoKey): void {
  activeKey = key
}

export function clearActiveKey(): void {
  activeKey = null
}

export function hasActiveKey(): boolean {
  return activeKey !== null
}

export function getActiveKey(): CryptoKey {
  if (!activeKey) {
    throw new Error('暗号化キーが未設定です。先にパスフレーズでアンロックしてください。')
  }
  return activeKey
}
