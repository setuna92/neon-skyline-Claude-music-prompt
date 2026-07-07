import type { GenerationInput } from '../types/generation'
import { addPreset } from './db'

// 旧Flask版 (static/script.js) が localStorage に保存していたプリセット形式
const LEGACY_STORAGE_KEY = 'music_prompt_presets'

interface LegacyPresetSettings {
  genres?: string[]
  mood?: string
  tempo?: string | number
  vocal_type?: string
  instrument_elements?: string[]
  song_structure?: string
  atmospheres?: string[]
}

interface LegacyPreset {
  id: number
  name: string
  settings: LegacyPresetSettings
  created_at: string
}

function toGenerationInput(settings: LegacyPresetSettings): GenerationInput | null {
  const genreKey = settings.genres?.[0]
  if (!genreKey) return null

  const tempo = settings.tempo !== undefined && settings.tempo !== '' ? Number(settings.tempo) : undefined

  return {
    genreKey,
    moodKey: settings.mood || undefined,
    tempo: tempo !== undefined && Number.isFinite(tempo) ? tempo : undefined,
    vocalTypeKey: settings.vocal_type || undefined,
    instrumentKeys: settings.instrument_elements ?? [],
    songStructureKey: settings.song_structure || undefined,
    atmosphereKeys: settings.atmospheres ?? [],
  }
}

/**
 * 同一オリジンの localStorage に旧Flask版のプリセットが残っていれば IndexedDB へ移行する。
 * 呼び出し前に暗号化キーがアンロックされている必要がある。
 * 戻り値は移行できた件数（ジャンル未設定など復元不能なものはスキップする）。
 */
export async function migrateLegacyPresetsFromLocalStorage(): Promise<number> {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) return 0

  let legacyPresets: LegacyPreset[]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return 0
    legacyPresets = parsed as LegacyPreset[]
  } catch {
    return 0
  }

  let migrated = 0
  for (const legacy of legacyPresets) {
    const input = toGenerationInput(legacy.settings ?? {})
    if (!input) continue
    await addPreset(legacy.name || '無題のプリセット', input)
    migrated++
  }

  localStorage.removeItem(LEGACY_STORAGE_KEY)
  return migrated
}
