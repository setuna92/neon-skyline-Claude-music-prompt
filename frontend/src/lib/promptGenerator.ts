import templatesData from '../data/templates.json'
import type { PromptTemplates, OptionEntry } from '../types/templates'
import type {
  GenerationInput,
  GeneratedVariant,
  GenerationResult,
  ValidationResult,
} from '../types/generation'

const templates = templatesData as PromptTemplates

function findByKey(list: OptionEntry[], key: string | undefined): OptionEntry | undefined {
  if (!key) return undefined
  return list.find((entry) => entry.key === key)
}

function joinNonEmpty(parts: (string | undefined)[], separator: string): string {
  return parts.filter((p): p is string => Boolean(p && p.length > 0)).join(separator)
}

export function validateGenerationInput(input: GenerationInput): ValidationResult {
  const errors: string[] = []
  if (!input.genreKey) {
    errors.push('ジャンルを最低1つ選択してください')
  } else if (!findByKey(templates.genres, input.genreKey)) {
    errors.push(`未知のジャンルキーです: ${input.genreKey}`)
  }
  if (input.tempo !== undefined && (!Number.isFinite(input.tempo) || input.tempo <= 0)) {
    errors.push('テンポは正の数値で指定してください')
  }
  return { valid: errors.length === 0, errors }
}

export function validateVariant(variant: GeneratedVariant): ValidationResult {
  const errors: string[] = []
  if (!variant.englishPrompt.trim()) errors.push('英語プロンプトが空です')
  if (!variant.japanesePrompt.trim()) errors.push('日本語プロンプトが空です')
  return { valid: errors.length === 0, errors }
}

interface ResolvedInput {
  genre: OptionEntry
  mood?: OptionEntry
  tempo?: number
  vocalType?: OptionEntry
  instruments: OptionEntry[]
  structure?: OptionEntry
  atmospheres: OptionEntry[]
  themeKeywords: string[]
}

function resolveInput(input: GenerationInput): ResolvedInput {
  const genre = findByKey(templates.genres, input.genreKey)
  if (!genre) {
    throw new Error(`未知のジャンルキーです: ${input.genreKey}`)
  }
  return {
    genre,
    mood: findByKey(templates.moods, input.moodKey),
    tempo: input.tempo,
    vocalType: findByKey(templates.vocalTypes, input.vocalTypeKey),
    instruments: input.instrumentKeys
      .map((key) => findByKey(templates.instrumentElements, key))
      .filter((e): e is OptionEntry => Boolean(e)),
    structure: findByKey(templates.songStructures, input.songStructureKey),
    atmospheres: input.atmosphereKeys
      .map((key) => findByKey(templates.atmospheres, key))
      .filter((e): e is OptionEntry => Boolean(e)),
    themeKeywords: input.themeKeywords ?? [],
  }
}

function hasVocal(vocalType: OptionEntry | undefined): vocalType is OptionEntry {
  return Boolean(vocalType && vocalType.key !== 'no_vocal')
}

// --- 標準スタイル: 既存Flask版 generate_english_prompt / translate_to_japanese を移植 ---

function buildStandardEnglish(r: ResolvedInput): string {
  const sentences: string[] = []

  sentences.push(
    r.tempo
      ? `Create a ${r.genre.en} track at BPM ${r.tempo}.`
      : `Create a ${r.genre.en} track.`,
  )

  if (r.mood?.en) sentences.push(`The overall mood should evoke ${r.mood.en}.`)
  if (hasVocal(r.vocalType)) sentences.push(`Include ${r.vocalType.en} with expressive delivery.`)
  if (r.instruments.length) {
    sentences.push(`Use ${r.instruments.map((i) => i.en).join(', ')} as the main instruments.`)
  }
  if (r.structure?.en) sentences.push(`Follow ${r.structure.en}.`)
  if (r.atmospheres.length) {
    sentences.push(`The atmosphere should feel ${r.atmospheres.map((a) => a.en).join(', ')}.`)
  }
  if (r.themeKeywords.length) {
    sentences.push(`Incorporate the following themes and elements: ${r.themeKeywords.join(', ')}.`)
  }
  if (r.genre.extra) sentences.push(r.genre.extra)

  return sentences.join(' ')
}

function buildStandardJapanese(r: ResolvedInput): string {
  const lines: string[] = []

  if (r.tempo) {
    lines.push(templates.sentenceTemplates.jp.bpm.replace('{tempo}', String(r.tempo)))
  }
  lines.push(templates.sentenceTemplates.jp.genre.replace('{genreEn}', r.genre.en ?? r.genre.label))
  if (r.mood?.jp) lines.push(r.mood.jp)
  if (hasVocal(r.vocalType) && r.vocalType.jp) lines.push(r.vocalType.jp)
  if (r.instruments.length) {
    const instrumentList = r.instruments.map((i) => i.label).join('、')
    lines.push(templates.sentenceTemplates.jp.instruments.replace('{instrumentList}', instrumentList))
  }
  if (r.structure?.jp) lines.push(r.structure.jp)
  for (const atmosphere of r.atmospheres) {
    if (atmosphere.jp) lines.push(atmosphere.jp)
  }
  if (r.themeKeywords.length) {
    lines.push(`テーマ・要素として ${r.themeKeywords.join('、')} を反映してください。`)
  }

  return lines.join('\n')
}

// --- 詩的スタイル: 情景描写を増やした言い回し ---

function buildPoeticEnglish(r: ResolvedInput): string {
  const sentences: string[] = []

  sentences.push(
    r.tempo
      ? `Imagine a ${r.genre.en} piece, pulsing at ${r.tempo} BPM, waiting to unfold.`
      : `Imagine a ${r.genre.en} piece, waiting to unfold.`,
  )
  if (r.mood?.en) sentences.push(`Let it drift through ${r.mood.en}, as if the music remembers it.`)
  if (hasVocal(r.vocalType)) {
    sentences.push(`Weave in ${r.vocalType.en}, delivered with raw, expressive feeling.`)
  }
  if (r.instruments.length) {
    sentences.push(
      `Paint the soundscape with ${r.instruments.map((i) => i.en).join(', ')}, each voice given room to breathe.`,
    )
  }
  if (r.structure?.en) sentences.push(`Shape the journey around ${r.structure.en}.`)
  if (r.atmospheres.length) {
    sentences.push(`Let the air itself feel ${r.atmospheres.map((a) => a.en).join(', ')}.`)
  }
  if (r.themeKeywords.length) {
    sentences.push(`Let images of ${r.themeKeywords.join(', ')} linger between the notes.`)
  }
  if (r.genre.extra) sentences.push(r.genre.extra)

  return sentences.join(' ')
}

function buildPoeticJapanese(r: ResolvedInput): string {
  const lines: string[] = []

  lines.push(
    r.tempo
      ? `${r.genre.label}の情景を、BPM${r.tempo}の鼓動にのせて描いてください。`
      : `${r.genre.label}の情景を、ゆっくりと描き出してください。`,
  )
  if (r.mood?.label) lines.push(`${r.mood.label}の記憶をなぞるように、音楽を漂わせてください。`)
  if (hasVocal(r.vocalType)) lines.push(`${r.vocalType.label}に、飾らない生々しい感情を込めてください。`)
  if (r.instruments.length) {
    lines.push(`${r.instruments.map((i) => i.label).join('、')}が、それぞれ息づく余白を持って響き合うようにしてください。`)
  }
  if (r.structure?.label) lines.push(`${r.structure.label}を軸に、旅のような展開を描いてください。`)
  if (r.atmospheres.length) {
    lines.push(`空気そのものが${r.atmospheres.map((a) => a.label).join('、')}を感じさせるようにしてください。`)
  }
  if (r.themeKeywords.length) {
    lines.push(`${r.themeKeywords.join('、')}の面影が、音の隙間に漂うようにしてください。`)
  }

  return lines.join('\n')
}

// --- ミニマルスタイル: キーワード列挙に近い簡潔な文体 ---

function buildMinimalEnglish(r: ResolvedInput): string {
  return joinNonEmpty(
    [
      r.tempo ? `${r.genre.en}, ${r.tempo} BPM` : r.genre.en,
      r.mood?.en,
      hasVocal(r.vocalType) ? r.vocalType.en : 'no vocals',
      r.instruments.length ? r.instruments.map((i) => i.en).join('/') : undefined,
      r.structure?.en,
      r.atmospheres.length ? r.atmospheres.map((a) => a.en).join('/') : undefined,
      r.themeKeywords.length ? `themes: ${r.themeKeywords.join('/')}` : undefined,
    ],
    ', ',
  )
}

function buildMinimalJapanese(r: ResolvedInput): string {
  return joinNonEmpty(
    [
      r.tempo ? `${r.genre.label}／BPM${r.tempo}` : r.genre.label,
      r.mood?.label,
      hasVocal(r.vocalType) ? r.vocalType.label : 'ボーカルなし',
      r.instruments.length ? r.instruments.map((i) => i.label).join('/') : undefined,
      r.structure?.label,
      r.atmospheres.length ? r.atmospheres.map((a) => a.label).join('/') : undefined,
      r.themeKeywords.length ? `テーマ:${r.themeKeywords.join('/')}` : undefined,
    ],
    '、',
  )
}

const BUILDERS: Record<string, { en: (r: ResolvedInput) => string; jp: (r: ResolvedInput) => string }> = {
  standard: { en: buildStandardEnglish, jp: buildStandardJapanese },
  poetic: { en: buildPoeticEnglish, jp: buildPoeticJapanese },
  minimal: { en: buildMinimalEnglish, jp: buildMinimalJapanese },
}

const SUMMARY_INSTRUCTION_EN = 'After outputting everything, summarize it in 1000 characters.'
const SUMMARY_INSTRUCTION_JP = '全体を出力した後、それを1000字でまとめる'

export function generateVariant(input: GenerationInput, styleId: string): GeneratedVariant {
  const style = templates.variantStyles.find((s) => s.id === styleId)
  if (!style) throw new Error(`未知のバリエーションスタイルです: ${styleId}`)

  const builder = BUILDERS[styleId]
  if (!builder) throw new Error(`スタイル "${styleId}" のビルダーが未実装です`)

  const resolved = resolveInput(input)

  return {
    variantId: `${styleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    styleId: style.id,
    styleLabel: style.label,
    englishPrompt: `${builder.en(resolved)}\n\n${SUMMARY_INSTRUCTION_EN}`,
    japanesePrompt: `${builder.jp(resolved)}\n\n${SUMMARY_INSTRUCTION_JP}`,
  }
}

export function generateVariants(input: GenerationInput): GenerationResult {
  const { valid, errors } = validateGenerationInput(input)
  if (!valid) throw new Error(errors.join(' / '))

  const variants = templates.variantStyles.map((style) => generateVariant(input, style.id))

  for (const variant of variants) {
    const result = validateVariant(variant)
    if (!result.valid) {
      throw new Error(`生成結果の検証に失敗しました (${variant.styleId}): ${result.errors.join(' / ')}`)
    }
  }

  return {
    input,
    variants,
    generatedAt: new Date().toISOString(),
  }
}
