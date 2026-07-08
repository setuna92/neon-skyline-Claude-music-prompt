import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  HistoryEntry,
  LyricsPromptHistoryEntry,
  ClaudeCompositionHistoryEntry,
  PresetEntry,
  EncryptedPayload,
  ConsentRecord,
} from '../types/persistence'
import type { GenerationInput } from '../types/generation'
import type { ImportedPrompt } from '../types/promptLibrary'
import type { DemotedKeyword, DiscoveredKeyword, KeywordAssociation, TemplateOverride, TempoHint } from '../types/learning'
import type { TextMutation } from '../types/textGenome'
import type { AutoLoopLifetimeStats } from '../types/autoLoop'
import { EMPTY_LIFETIME_STATS } from '../types/autoLoop'
import { deriveKey, encryptJSON, decryptJSON, generateSalt, toBase64, fromBase64 } from './crypto'
import { maskPIIDeep } from './masking'
import { setActiveKey, clearActiveKey, getActiveKey } from './keyStore'

const DB_NAME = 'music-prompt-app'
const DB_VERSION = 2
const SALT_SETTINGS_KEY = 'cryptoSalt'
const PASSPHRASE_CHECK_SETTINGS_KEY = 'passphraseCheck'
const CONSENT_SETTINGS_KEY = 'externalSendConsent'
const CLAUDE_API_KEY_SETTINGS_KEY = 'claudeApiKey'
const CLAUDE_MODEL_SETTINGS_KEY = 'claudeModel'
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5'
const TEMPLATE_OVERRIDES_SETTINGS_KEY = 'templateOverrides'
const TEXT_MUTATIONS_SETTINGS_KEY = 'textMutations'
const DISCOVERED_KEYWORDS_SETTINGS_KEY = 'discoveredKeywords'
const KEYWORD_ASSOCIATIONS_SETTINGS_KEY = 'keywordAssociations'
const DEMOTED_KEYWORDS_SETTINGS_KEY = 'demotedKeywords'
const TEMPO_HINTS_SETTINGS_KEY = 'tempoHints'
const AUTO_LOOP_LIFETIME_STATS_KEY = 'autoLoopLifetimeStats'
const SMART_LOOP_AUTOSTART_SETTINGS_KEY = 'smartLoopAutoStart'

interface EncryptedRecord {
  id: string
  createdAt: string
  payload: EncryptedPayload
}

interface SettingsRecord {
  key: string
  value: unknown
}

interface AppDBSchema extends DBSchema {
  history: { key: string; value: EncryptedRecord; indexes: { 'by-createdAt': string } }
  presets: { key: string; value: EncryptedRecord; indexes: { 'by-createdAt': string } }
  importedPrompts: { key: string; value: EncryptedRecord; indexes: { 'by-createdAt': string } }
  settings: { key: string; value: SettingsRecord }
}

let dbPromise: Promise<IDBPDatabase<AppDBSchema>> | null = null

// getAllHistory()は多数のフック(ランキング・キーワード提案・組み合わせ学習等)から
// 同時に呼ばれるため、キャッシュ無しだと同じ全履歴を何度も復号することになる。
// 書き込み系の操作でのみ無効化する単純なメモリキャッシュ。
let historyCache: HistoryEntry[] | null = null

// 履歴・学習系データ(テンプレート優先度、発見語彙、文脈連想、降格語、テンポヒント等)が
// 書き込まれるたびに通知する購読機構。各フックはこれを購読して自動的に再取得することで、
// 評価やAuto-Loopの適用がタブを切り替えなくてもすぐ画面に反映されるようにする。
const dataChangeListeners = new Set<() => void>()

export function onDataChange(listener: () => void): () => void {
  dataChangeListeners.add(listener)
  return () => dataChangeListeners.delete(listener)
}

function notifyDataChange(): void {
  for (const listener of dataChangeListeners) listener()
}

function invalidateHistoryCache(): void {
  historyCache = null
  notifyDataChange()
}

function getDB(): Promise<IDBPDatabase<AppDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<AppDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const history = db.createObjectStore('history', { keyPath: 'id' })
          history.createIndex('by-createdAt', 'createdAt')

          const presets = db.createObjectStore('presets', { keyPath: 'id' })
          presets.createIndex('by-createdAt', 'createdAt')

          db.createObjectStore('settings', { keyPath: 'key' })
        }
        if (oldVersion < 2) {
          const importedPrompts = db.createObjectStore('importedPrompts', { keyPath: 'id' })
          importedPrompts.createIndex('by-createdAt', 'createdAt')
        }
      },
    })
  }
  return dbPromise
}

/** テスト用: キャッシュ済みのDB接続を閉じてリセットする（本番コードからは呼ばれない） */
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise
    db.close()
    dbPromise = null
  }
  invalidateHistoryCache()
}

// --- 暗号化キーのアンロック/ロック ---

/** ソルトが既に保存されているか = 過去にパスフレーズが設定済みか（初回起動判定に使う） */
export async function isInitialized(): Promise<boolean> {
  const db = await getDB()
  const saltRecord = await db.get('settings', SALT_SETTINGS_KEY)
  return Boolean(saltRecord)
}

export async function unlockWithPassphrase(passphrase: string): Promise<void> {
  const db = await getDB()
  const saltRecord = await db.get('settings', SALT_SETTINGS_KEY)

  let salt: Uint8Array
  if (saltRecord) {
    salt = fromBase64(saltRecord.value as string)
  } else {
    salt = generateSalt()
    await db.put('settings', { key: SALT_SETTINGS_KEY, value: toBase64(salt) })
  }

  const key = await deriveKey(passphrase, salt)

  // 間違ったパスフレーズでも鍵の導出自体は常に成功してしまうため、
  // 復号可能かをここで検証する。検証しないと「アプリは開くが履歴が全部消えて見える」
  // という無言の故障モードになる。
  const checkRecord = await db.get('settings', PASSPHRASE_CHECK_SETTINGS_KEY)
  if (checkRecord) {
    try {
      await decryptJSON(key, checkRecord.value as EncryptedPayload)
    } catch {
      throw new Error('パスフレーズが正しくありません')
    }
  } else {
    // 旧バージョンで作られたDBには検証レコードが無い。既存の暗号化データが
    // あればそれを復号して検証し、通ったら検証レコードを追記して次回以降に備える。
    const [firstHistory] = await db.getAll('history', undefined, 1)
    const [firstPreset] = await db.getAll('presets', undefined, 1)
    const [firstImported] = await db.getAll('importedPrompts', undefined, 1)
    const existing = firstHistory ?? firstPreset ?? firstImported
    if (existing) {
      try {
        await decryptJSON(key, existing.payload)
      } catch {
        throw new Error('パスフレーズが正しくありません')
      }
    }
    await db.put('settings', {
      key: PASSPHRASE_CHECK_SETTINGS_KEY,
      value: await encryptJSON(key, { check: 'ok' }),
    })
  }

  setActiveKey(key)
  // 万一lock()を挟まずに再度unlockされた場合に備え、直前の鍵で読んだキャッシュを持ち越さない
  invalidateHistoryCache()
}

export function lock(): void {
  clearActiveKey()
  invalidateHistoryCache()
}

// --- 外部送信の同意 ---

export async function setExternalSendConsent(granted: boolean): Promise<void> {
  const db = await getDB()
  const record: ConsentRecord = { granted, grantedAt: granted ? new Date().toISOString() : undefined }
  await db.put('settings', { key: CONSENT_SETTINGS_KEY, value: record })
}

export async function getExternalSendConsent(): Promise<ConsentRecord> {
  const db = await getDB()
  const record = await db.get('settings', CONSENT_SETTINGS_KEY)
  return (record?.value as ConsentRecord | undefined) ?? { granted: false }
}

// --- Claude API設定（APIキーは暗号化して保存、モデルIDは非機密なので平文） ---

export async function setClaudeApiKey(apiKey: string): Promise<void> {
  const key = getActiveKey()
  const payload = await encryptJSON(key, { apiKey })
  const db = await getDB()
  await db.put('settings', { key: CLAUDE_API_KEY_SETTINGS_KEY, value: payload })
}

export async function getClaudeApiKey(): Promise<string | null> {
  const db = await getDB()
  const record = await db.get('settings', CLAUDE_API_KEY_SETTINGS_KEY)
  if (!record) return null
  const key = getActiveKey()
  try {
    const { apiKey } = await decryptJSON<{ apiKey: string }>(key, record.value as EncryptedPayload)
    return apiKey
  } catch {
    // 保存されたキーが壊れている場合は例外を伝播させず、未設定として扱いつつ自己修復する
    await db.delete('settings', CLAUDE_API_KEY_SETTINGS_KEY)
    return null
  }
}

export async function clearClaudeApiKey(): Promise<void> {
  const db = await getDB()
  await db.delete('settings', CLAUDE_API_KEY_SETTINGS_KEY)
}

export async function hasClaudeApiKey(): Promise<boolean> {
  const db = await getDB()
  return Boolean(await db.get('settings', CLAUDE_API_KEY_SETTINGS_KEY))
}

export async function setClaudeModel(model: string): Promise<void> {
  const db = await getDB()
  await db.put('settings', { key: CLAUDE_MODEL_SETTINGS_KEY, value: model })
}

export async function getClaudeModel(): Promise<string> {
  const db = await getDB()
  const record = await db.get('settings', CLAUDE_MODEL_SETTINGS_KEY)
  return (record?.value as string | undefined) ?? DEFAULT_CLAUDE_MODEL
}

// --- 自己学習ループ: テンプレートオーバーライド（承認済みの差分） ---
// 提案のスコア自体はPIIを含まないため、他の設定同様に平文で保存する。

export async function getTemplateOverrides(): Promise<TemplateOverride[]> {
  const db = await getDB()
  const record = await db.get('settings', TEMPLATE_OVERRIDES_SETTINGS_KEY)
  return (record?.value as TemplateOverride[] | undefined) ?? []
}

export async function addTemplateOverride(override: Omit<TemplateOverride, 'id' | 'createdAt'>): Promise<TemplateOverride> {
  const db = await getDB()
  const current = await getTemplateOverrides()
  // 同じカテゴリ・キーへのブーストは追加せず更新する。追加し続けると同じジャンルの重複が
  // 積み重なり、executor.tsのpickWeightedGenreKeyのような「配列から均等ランダムに選ぶ」処理で
  // 承認回数の多いジャンルが不当に選ばれやすくなる(自己強化的な偏り)ため。
  const existingIndex = current.findIndex((o) => o.category === override.category && o.key === override.key)
  const full: TemplateOverride = {
    ...override,
    id: existingIndex >= 0 ? current[existingIndex].id : crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const next = existingIndex >= 0 ? current.map((o, i) => (i === existingIndex ? full : o)) : [...current, full]
  await db.put('settings', { key: TEMPLATE_OVERRIDES_SETTINGS_KEY, value: next })
  notifyDataChange()
  return full
}

export async function removeTemplateOverride(id: string): Promise<void> {
  const db = await getDB()
  const current = await getTemplateOverrides()
  await db.put('settings', {
    key: TEMPLATE_OVERRIDES_SETTINGS_KEY,
    value: current.filter((o) => o.id !== id),
  })
  notifyDataChange()
}

// --- 自己学習ループ: テキスト遺伝子（文章表現そのものの進化） ---
// フックフレーズ・接続フレーズの追加は生成文に直接混ぜ込まれるためPIIを含み得ないが、
// 念のため他の学習系設定と同様に平文で保存する(自動ループが生成する定型文のみが対象)。

export async function getTextMutations(): Promise<TextMutation[]> {
  const db = await getDB()
  const record = await db.get('settings', TEXT_MUTATIONS_SETTINGS_KEY)
  return (record?.value as TextMutation[] | undefined) ?? []
}

export async function addTextMutation(mutation: Omit<TextMutation, 'id' | 'createdAt'>): Promise<TextMutation> {
  const db = await getDB()
  const current = await getTextMutations()
  const full: TextMutation = {
    ...mutation,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  await db.put('settings', { key: TEXT_MUTATIONS_SETTINGS_KEY, value: [...current, full] })
  notifyDataChange()
  return full
}

export async function removeTextMutation(id: string): Promise<void> {
  const db = await getDB()
  const current = await getTextMutations()
  await db.put('settings', {
    key: TEXT_MUTATIONS_SETTINGS_KEY,
    value: current.filter((m) => m.id !== id),
  })
  notifyDataChange()
}

// --- 自己学習ループ: 自動発見された語彙 ---
// 手入力で使われ高評価だった未知語などをAuto-Loopが検証・昇格させたもの。
// 提案チップの「自動発見された語」グループとAuto-Loop実行時の語彙プールに使われる。

export async function getDiscoveredKeywords(): Promise<DiscoveredKeyword[]> {
  const db = await getDB()
  const record = await db.get('settings', DISCOVERED_KEYWORDS_SETTINGS_KEY)
  return (record?.value as DiscoveredKeyword[] | undefined) ?? []
}

export async function addDiscoveredKeyword(keyword: Omit<DiscoveredKeyword, 'id' | 'createdAt'>): Promise<DiscoveredKeyword> {
  const db = await getDB()
  const current = await getDiscoveredKeywords()
  const full: DiscoveredKeyword = {
    ...keyword,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  await db.put('settings', { key: DISCOVERED_KEYWORDS_SETTINGS_KEY, value: [...current, full] })
  notifyDataChange()
  return full
}

export async function removeDiscoveredKeyword(id: string): Promise<void> {
  const db = await getDB()
  const current = await getDiscoveredKeywords()
  await db.put('settings', {
    key: DISCOVERED_KEYWORDS_SETTINGS_KEY,
    value: current.filter((k) => k.id !== id),
  })
  notifyDataChange()
}

// --- 自己学習ループ: 文脈連想キーワード ---
// 「特定のムード/雰囲気と組み合わせた時に高評価だった語」をAuto-Loopが検証・追加したもの。
// 該当する文脈のキーワード提案グループにのみ注入される（グローバルな発見語彙とは別系統）。

export async function getKeywordAssociations(): Promise<KeywordAssociation[]> {
  const db = await getDB()
  const record = await db.get('settings', KEYWORD_ASSOCIATIONS_SETTINGS_KEY)
  return (record?.value as KeywordAssociation[] | undefined) ?? []
}

export async function addKeywordAssociation(
  association: Omit<KeywordAssociation, 'id' | 'createdAt'>,
): Promise<KeywordAssociation> {
  const db = await getDB()
  const current = await getKeywordAssociations()
  const full: KeywordAssociation = {
    ...association,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  await db.put('settings', { key: KEYWORD_ASSOCIATIONS_SETTINGS_KEY, value: [...current, full] })
  notifyDataChange()
  return full
}

export async function removeKeywordAssociation(id: string): Promise<void> {
  const db = await getDB()
  const current = await getKeywordAssociations()
  await db.put('settings', {
    key: KEYWORD_ASSOCIATIONS_SETTINGS_KEY,
    value: current.filter((a) => a.id !== id),
  })
  notifyDataChange()
}

// --- 自己学習ループ: 低評価キーワードの降格 ---
// 実績上ずっと低評価が続いた語を、以後の提案から除外するためのブロックリスト。

export async function getDemotedKeywords(): Promise<DemotedKeyword[]> {
  const db = await getDB()
  const record = await db.get('settings', DEMOTED_KEYWORDS_SETTINGS_KEY)
  return (record?.value as DemotedKeyword[] | undefined) ?? []
}

export async function addDemotedKeyword(keyword: Omit<DemotedKeyword, 'id' | 'createdAt'>): Promise<DemotedKeyword> {
  const db = await getDB()
  const current = await getDemotedKeywords()
  const full: DemotedKeyword = {
    ...keyword,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  await db.put('settings', { key: DEMOTED_KEYWORDS_SETTINGS_KEY, value: [...current, full] })
  notifyDataChange()
  return full
}

export async function removeDemotedKeyword(id: string): Promise<void> {
  const db = await getDB()
  const current = await getDemotedKeywords()
  await db.put('settings', {
    key: DEMOTED_KEYWORDS_SETTINGS_KEY,
    value: current.filter((k) => k.id !== id),
  })
  notifyDataChange()
}

// --- 自己学習ループ: おすすめテンポ ---
// 「特定のジャンルで高評価だった時のテンポ(BPM)」をAuto-Loopが作曲履歴から学習したもの。
// ジャンル1件につき1件のヒントのみ保持する(取り消せば再学習の対象に戻る)。

export async function getTempoHints(): Promise<TempoHint[]> {
  const db = await getDB()
  const record = await db.get('settings', TEMPO_HINTS_SETTINGS_KEY)
  return (record?.value as TempoHint[] | undefined) ?? []
}

export async function addTempoHint(hint: Omit<TempoHint, 'id' | 'createdAt'>): Promise<TempoHint> {
  const db = await getDB()
  const current = await getTempoHints()
  const full: TempoHint = {
    ...hint,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  await db.put('settings', { key: TEMPO_HINTS_SETTINGS_KEY, value: [...current, full] })
  notifyDataChange()
  return full
}

export async function removeTempoHint(id: string): Promise<void> {
  const db = await getDB()
  const current = await getTempoHints()
  await db.put('settings', {
    key: TEMPO_HINTS_SETTINGS_KEY,
    value: current.filter((h) => h.id !== id),
  })
  notifyDataChange()
}

// --- 自動ループの累計実績 ---
// ページ再読み込みやアプリ再起動をまたいでも「本当に動いていたか」が分かるように、
// セッションごとにリセットされる画面上のメトリクスとは別に永続化する。

export async function getAutoLoopLifetimeStats(): Promise<AutoLoopLifetimeStats> {
  const db = await getDB()
  const record = await db.get('settings', AUTO_LOOP_LIFETIME_STATS_KEY)
  return (record?.value as AutoLoopLifetimeStats | undefined) ?? EMPTY_LIFETIME_STATS
}

export async function addAutoLoopLifetimeStats(delta: Partial<AutoLoopLifetimeStats>): Promise<AutoLoopLifetimeStats> {
  const db = await getDB()
  const current = await getAutoLoopLifetimeStats()
  const updated: AutoLoopLifetimeStats = {
    totalCyclesCompleted: current.totalCyclesCompleted + (delta.totalCyclesCompleted ?? 0),
    totalImprovementsApplied: current.totalImprovementsApplied + (delta.totalImprovementsApplied ?? 0),
    totalImprovementsRejected: current.totalImprovementsRejected + (delta.totalImprovementsRejected ?? 0),
  }
  await db.put('settings', { key: AUTO_LOOP_LIFETIME_STATS_KEY, value: updated })
  return updated
}

// --- おまかせ自動生成ループの自動再開設定 ---
// ブラウザ/PWAが完全に閉じている間は(サービスワーカーでも暗号化鍵をメモリ保持できないため)
// 動かせないが、次にアプリを開いてパスフレーズを解除した瞬間に自動で再開できるようにする設定。

export async function getSmartLoopAutoStart(): Promise<boolean> {
  const db = await getDB()
  const record = await db.get('settings', SMART_LOOP_AUTOSTART_SETTINGS_KEY)
  return Boolean(record?.value)
}

export async function setSmartLoopAutoStart(enabled: boolean): Promise<void> {
  const db = await getDB()
  await db.put('settings', { key: SMART_LOOP_AUTOSTART_SETTINGS_KEY, value: enabled })
}

// --- 履歴 (history) ---

// 1件でも復号に失敗すると Promise.all が全体を落とし「履歴が全部消えた」ように
// 見えてしまうため、復号できないレコードはスキップして読めるものだけ返す。
// （過去にパスフレーズ検証が無かった時期に別の鍵で書かれたレコードが混在し得る）
async function decryptAllOrSkip<T>(key: CryptoKey, records: EncryptedRecord[]): Promise<T[]> {
  const results = await Promise.all(
    records.map(async (r) => {
      try {
        return await decryptJSON<T>(key, r.payload)
      } catch {
        console.warn(`復号できないレコードをスキップしました: ${r.id}（別のパスフレーズで保存された可能性）`)
        return null
      }
    }),
  )
  return results.filter((e): e is Awaited<T> => e !== null)
}

export type AddHistoryEntryInput = Omit<HistoryEntry, 'id' | 'createdAt' | 'tags'> & { tags?: string[] }

export async function addHistoryEntry(entry: AddHistoryEntryInput): Promise<HistoryEntry> {
  const key = getActiveKey()
  const full = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    tags: maskPIIDeep(entry.tags ?? []),
  } as HistoryEntry
  const payload = await encryptJSON(key, full)
  const db = await getDB()
  await db.put('history', { id: full.id, createdAt: full.createdAt, payload })
  invalidateHistoryCache()
  return full
}

// 旧バージョン (kind 追加前) に保存された履歴を補完する
function normalizeHistoryEntry(entry: HistoryEntry): HistoryEntry {
  const raw = entry as unknown as Record<string, unknown>
  return raw.kind ? entry : ({ ...raw, kind: 'composition' } as HistoryEntry)
}

export async function updateHistoryEntry(
  id: string,
  patch: Partial<Pick<HistoryEntry, 'selectedVariantId' | 'rating' | 'tags'>>,
): Promise<HistoryEntry> {
  const key = getActiveKey()
  const db = await getDB()
  const record = await db.get('history', id)
  if (!record) throw new Error(`履歴が見つかりません: ${id}`)

  const existing = normalizeHistoryEntry(await decryptJSON<HistoryEntry>(key, record.payload))
  const updated: HistoryEntry = {
    ...existing,
    ...patch,
    tags: patch.tags ? maskPIIDeep(patch.tags) : existing.tags,
  }
  const payload = await encryptJSON(key, updated)
  await db.put('history', { id: updated.id, createdAt: updated.createdAt, payload })
  invalidateHistoryCache()
  return updated
}

/**
 * 歌詞プロンプト履歴に「実際に得られた歌詞」とその評価を記録する。
 * プロンプトの見た目ではなく最終成果物の質で自己学習が動くようにするための専用エントリポイント。
 * (Claude API・Copilotへのコピペなど、取得経路を問わずユーザーが手動で貼り付ける想定)
 */
export async function updateLyricsQuality(
  id: string,
  patch: { actualLyricsText?: string; lyricsQualityRating?: number },
): Promise<LyricsPromptHistoryEntry> {
  const key = getActiveKey()
  const db = await getDB()
  const record = await db.get('history', id)
  if (!record) throw new Error(`履歴が見つかりません: ${id}`)

  const existing = normalizeHistoryEntry(await decryptJSON<HistoryEntry>(key, record.payload))
  if (existing.kind !== 'lyricsPrompt') {
    throw new Error('歌詞の質の記録は歌詞プロンプトの履歴にのみ設定できます')
  }

  const updated: LyricsPromptHistoryEntry = {
    ...existing,
    ...patch,
    actualLyricsText:
      patch.actualLyricsText !== undefined ? maskPIIDeep(patch.actualLyricsText) : existing.actualLyricsText,
  }
  const payload = await encryptJSON(key, updated)
  await db.put('history', { id: updated.id, createdAt: updated.createdAt, payload })
  invalidateHistoryCache()
  return updated
}

/**
 * Claude作曲履歴に「実際にClaudeが書いた作曲プロンプト」とその評価を記録する。
 * 指示文の見た目ではなく最終成果物の質で自己学習が動くようにするための専用エントリポイント。
 * (updateLyricsQualityの作曲版)
 */
export async function updateClaudeCompositionQuality(
  id: string,
  patch: { actualCompositionPromptText?: string; compositionPromptQualityRating?: number },
): Promise<ClaudeCompositionHistoryEntry> {
  const key = getActiveKey()
  const db = await getDB()
  const record = await db.get('history', id)
  if (!record) throw new Error(`履歴が見つかりません: ${id}`)

  const existing = normalizeHistoryEntry(await decryptJSON<HistoryEntry>(key, record.payload))
  if (existing.kind !== 'claudeComposition') {
    throw new Error('作曲プロンプトの質の記録はClaude作曲の履歴にのみ設定できます')
  }

  const updated: ClaudeCompositionHistoryEntry = {
    ...existing,
    ...patch,
    actualCompositionPromptText:
      patch.actualCompositionPromptText !== undefined
        ? maskPIIDeep(patch.actualCompositionPromptText)
        : existing.actualCompositionPromptText,
  }
  const payload = await encryptJSON(key, updated)
  await db.put('history', { id: updated.id, createdAt: updated.createdAt, payload })
  invalidateHistoryCache()
  return updated
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('history', id)
  invalidateHistoryCache()
}

export async function clearHistory(): Promise<void> {
  const db = await getDB()
  await db.clear('history')
  invalidateHistoryCache()
}

export async function getAllHistory(): Promise<HistoryEntry[]> {
  if (historyCache) return [...historyCache]

  const key = getActiveKey()
  const db = await getDB()
  const records = await db.getAllFromIndex('history', 'by-createdAt')
  const entries = await decryptAllOrSkip<HistoryEntry>(key, records)
  const sorted = entries.map(normalizeHistoryEntry).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  historyCache = sorted
  return [...sorted]
}

// --- プリセット (presets) ---

export async function addPreset(name: string, input: GenerationInput): Promise<PresetEntry> {
  const key = getActiveKey()
  const full: PresetEntry = {
    id: crypto.randomUUID(),
    name: maskPIIDeep(name),
    input,
    createdAt: new Date().toISOString(),
  }
  const payload = await encryptJSON(key, full)
  const db = await getDB()
  await db.put('presets', { id: full.id, createdAt: full.createdAt, payload })
  return full
}

export async function deletePreset(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('presets', id)
}

export async function getAllPresets(): Promise<PresetEntry[]> {
  const key = getActiveKey()
  const db = await getDB()
  const records = await db.getAllFromIndex('presets', 'by-createdAt')
  const entries = await decryptAllOrSkip<PresetEntry>(key, records)
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// --- プロンプトライブラリ (importedPrompts) ---

export async function addImportedPrompts(
  prompts: Omit<ImportedPrompt, 'id' | 'createdAt'>[],
): Promise<ImportedPrompt[]> {
  const key = getActiveKey()

  // 暗号化(非同期)は全件分をトランザクション開始前に終わらせておく。
  // IndexedDBのトランザクションは保留中のリクエストが途切れると自動的にコミットされてしまうため、
  // await を挟んだ状態でトランザクション内のストアにアクセスすると失敗する。
  const encrypted = await Promise.all(
    prompts.map(async (prompt) => {
      const full: ImportedPrompt = {
        ...prompt,
        id: crypto.randomUUID(),
        title: maskPIIDeep(prompt.title),
        body: maskPIIDeep(prompt.body),
        createdAt: new Date().toISOString(),
      }
      const payload = await encryptJSON(key, full)
      return { full, payload }
    }),
  )

  const db = await getDB()
  const tx = db.transaction('importedPrompts', 'readwrite')
  for (const { full, payload } of encrypted) {
    void tx.store.put({ id: full.id, createdAt: full.createdAt, payload })
  }
  await tx.done

  return encrypted.map((e) => e.full)
}

export async function deleteImportedPrompt(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('importedPrompts', id)
}

export async function getAllImportedPrompts(): Promise<ImportedPrompt[]> {
  const key = getActiveKey()
  const db = await getDB()
  const records = await db.getAllFromIndex('importedPrompts', 'by-createdAt')
  const entries = await decryptAllOrSkip<ImportedPrompt>(key, records)
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// --- 暗号化バックアップのエクスポート/インポート ---
// レコードは既に暗号化済みのため、ソルトと合わせてそのままダンプ/復元するだけでよい。
// インポート先でも同じパスフレーズが分かっていれば復号できる。

export interface EncryptedBackup {
  version: 1
  exportedAt: string
  salt: string
  history: EncryptedRecord[]
  presets: EncryptedRecord[]
  importedPrompts: EncryptedRecord[]
}

export async function exportEncryptedBackup(): Promise<EncryptedBackup> {
  const db = await getDB()
  const saltRecord = await db.get('settings', SALT_SETTINGS_KEY)
  const [history, presets, importedPrompts] = await Promise.all([
    db.getAll('history'),
    db.getAll('presets'),
    db.getAll('importedPrompts'),
  ])
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    salt: (saltRecord?.value as string) ?? '',
    history,
    presets,
    importedPrompts,
  }
}

export async function importEncryptedBackup(backup: EncryptedBackup): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['history', 'presets', 'importedPrompts', 'settings'], 'readwrite')
  if (backup.salt) {
    await tx.objectStore('settings').put({ key: SALT_SETTINGS_KEY, value: backup.salt })
  }
  for (const record of backup.history) {
    await tx.objectStore('history').put(record)
  }
  for (const record of backup.presets) {
    await tx.objectStore('presets').put(record)
  }
  for (const record of backup.importedPrompts ?? []) {
    await tx.objectStore('importedPrompts').put(record)
  }
  await tx.done
  invalidateHistoryCache()
}
