import templatesData from '../data/templates.json'
import type { PromptTemplates, OptionEntry } from '../types/templates'
import type { LyricsPromptInput, LyricsPromptVariant, LyricsPromptResult } from '../types/lyricsPrompt'
import type { ValidationResult } from '../types/generation'
import type { TextGenome } from '../types/textGenome'
import { EMPTY_GENOME } from '../types/textGenome'

const templates = templatesData as PromptTemplates

function pickRandom<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/**
 * 自動ループが進化させた「フックフレーズ」「接続フレーズ」を本文に反映する。
 * 遺伝子が空の場合は完全に既存の出力と同一(後方互換)。
 */
function applyGenome(text: string, genome: TextGenome): string {
  let result = text
  if (genome.hookPhrases.length > 0) {
    result = `${pickRandom(genome.hookPhrases)} ${result}`
  }
  if (genome.connectorPhrases.length > 0) {
    result = `${result}\n${pickRandom(genome.connectorPhrases)}`
  }
  return result
}

const LANGUAGE_LABELS: Record<LyricsPromptInput['languageKey'], string> = {
  ja: '日本語',
  en: '英語',
}

function findByKey(list: OptionEntry[], key: string | undefined): OptionEntry | undefined {
  if (!key) return undefined
  return list.find((entry) => entry.key === key)
}

export function validateLyricsPromptInput(input: LyricsPromptInput): ValidationResult {
  const errors: string[] = []
  if (!input.genreKey) {
    errors.push('ジャンルを最低1つ選択してください')
  } else if (!findByKey(templates.genres, input.genreKey)) {
    errors.push(`未知のジャンルキーです: ${input.genreKey}`)
  }
  if (input.themeKeywords.length === 0) {
    errors.push('テーマ・キーワードを最低1つ入力してください')
  }
  return { valid: errors.length === 0, errors }
}

interface ResolvedInput {
  genre: OptionEntry
  mood?: OptionEntry
  atmospheres: OptionEntry[]
  vocalType?: OptionEntry
  structure?: OptionEntry
  themeKeywords: string[]
  languageLabel: string
  basePromptText?: string
}

function resolveInput(input: LyricsPromptInput): ResolvedInput {
  const genre = findByKey(templates.genres, input.genreKey)
  if (!genre) throw new Error(`未知のジャンルキーです: ${input.genreKey}`)

  return {
    genre,
    mood: findByKey(templates.moods, input.moodKey),
    atmospheres: input.atmosphereKeys
      .map((key) => findByKey(templates.atmospheres, key))
      .filter((e): e is OptionEntry => Boolean(e)),
    vocalType: findByKey(templates.vocalTypes, input.vocalTypeKey),
    structure: findByKey(templates.songStructures, input.songStructureKey),
    themeKeywords: input.themeKeywords,
    languageLabel: LANGUAGE_LABELS[input.languageKey],
    basePromptText: input.basePromptText,
  }
}

function baseSection(r: ResolvedInput, heading: string): string {
  return r.basePromptText ? `\n\n${heading}:\n${r.basePromptText}` : ''
}

function buildStandard(r: ResolvedInput): string {
  const lines = ['以下の条件で歌詞を書いてください。', `ジャンル: ${r.genre.label}`]
  if (r.mood) lines.push(`ムード: ${r.mood.label}`)
  if (r.atmospheres.length) lines.push(`雰囲気: ${r.atmospheres.map((a) => a.label).join('、')}`)
  if (r.vocalType) lines.push(`ボーカルスタイル: ${r.vocalType.label}`)
  if (r.structure) lines.push(`曲構成: ${r.structure.label}`)
  lines.push(`盛り込みたいテーマ・キーワード: ${r.themeKeywords.join('、')}`)
  lines.push(`言語: ${r.languageLabel}`)
  lines.push(
    '',
    '作詞の指針:',
    '・[Aメロ][Bメロ][サビ]のようにセクションを明記して構成してください。',
    '・サビは核となる一行を軸にし、曲中で1〜2回繰り返して印象に残るようにしてください。',
    '・抽象的な言葉だけでなく、音・光・匂い・肌触りなど具体的な感覚描写を織り交ぜてください。',
    '・ありきたりな比喩や使い古された言い回しは避け、テーマ・キーワードならではの言葉を選んでください。',
    '・メロディに乗せて歌えるよう、一行あたりの文字数・音数のバランスを意識してください。',
    '・全体を通して一つの物語が伝わるよう、ストーリー性を持たせてください。',
    '・Aメロ・Bメロは長すぎなくてよいので、簡潔にまとめてください。',
    '・盛り上がりと落ち着きの緩急をつけ、曲全体が単調にならないようにしてください。',
    '・同じ単語やフレーズを使いすぎず、表現にバリエーションを持たせてください。',
    '・出力は歌詞本文のみとし、前置きや解説は書かないでください。',
  )
  return lines.join('\n') + baseSection(r, '参考プロンプト')
}

function buildPoetic(r: ResolvedInput): string {
  const parts: string[] = [
    `次のイメージをもとに、心に響く歌詞を紡いでください。ジャンルは${r.genre.label}です。`,
  ]
  if (r.mood) parts.push(`${r.mood.label}を漂わせながら展開してください。`)
  if (r.atmospheres.length) parts.push(`${r.atmospheres.map((a) => a.label).join('、')}な世界観を描いてください。`)
  if (r.vocalType) parts.push(`ボーカルは${r.vocalType.label}を想定してください。`)
  if (r.structure) parts.push(`${r.structure.label}に沿って展開してください。`)
  parts.push(`特に次の情景・言葉を大切に織り込んでください：${r.themeKeywords.join('、')}。`)
  parts.push(`言語は${r.languageLabel}でお願いします。`)
  parts.push('Aメロ・Bメロ・サビのようにセクションを分けて構成し、サビは何度も心に残る一行を軸に据えてください。')
  parts.push('陳腐な比喩に頼らず、匂いや光、肌触りのような五感の手触りで情景を描いてください。')
  parts.push('一行の長さは歌って自然なリズムになるよう意識してください。')
  parts.push('全体を通して一つの物語が伝わるよう、ストーリー性を持たせてください。')
  parts.push('Aメロ・Bメロは長すぎなくてよいので、簡潔にまとめてください。')
  parts.push('盛り上がりと落ち着きの緩急をつけ、曲全体が単調にならないようにしてください。')
  parts.push('同じ単語やフレーズを使いすぎず、表現にバリエーションを持たせてください。')
  parts.push('前置きや解説は書かず歌詞本文のみを出力してください。')
  return parts.join(' ') + baseSection(r, '参考プロンプト')
}

function buildMinimal(r: ResolvedInput): string {
  const parts = [
    r.genre.label,
    r.mood?.label,
    r.atmospheres.length ? r.atmospheres.map((a) => a.label).join('/') : undefined,
    r.vocalType?.label,
    r.structure?.label,
    `テーマ:${r.themeKeywords.join('/')}`,
    `言語:${r.languageLabel}`,
  ].filter((p): p is string => Boolean(p))
  return (
    `${parts.join('／')} の歌詞を書いてください。` +
    'セクション([Aメロ][Bメロ][サビ]等)を明記し、サビは核となる一行を繰り返してください。' +
    '陳腐な比喩は避けてください。' +
    'ストーリー性を持たせ、Aメロ・Bメロは長すぎなくてよく、曲全体が単調にならないよう緩急をつけ、' +
    '同じワードを使いすぎないでください。' +
    '歌詞本文のみを出力してください。' +
    baseSection(r, '参考')
  )
}

const BUILDERS: Record<string, (r: ResolvedInput) => string> = {
  standard: buildStandard,
  poetic: buildPoetic,
  minimal: buildMinimal,
}

export function generateLyricsPromptVariant(
  input: LyricsPromptInput,
  styleId: string,
  genome: TextGenome = EMPTY_GENOME,
): LyricsPromptVariant {
  const style = templates.variantStyles.find((s) => s.id === styleId)
  if (!style) throw new Error(`未知のバリエーションスタイルです: ${styleId}`)

  const builder = BUILDERS[styleId]
  if (!builder) throw new Error(`スタイル "${styleId}" のビルダーが未実装です`)

  const resolved = resolveInput(input)

  return {
    variantId: `${styleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    styleId: style.id,
    styleLabel: style.label,
    promptText: applyGenome(builder(resolved), genome),
  }
}

export function generateLyricsPromptVariants(
  input: LyricsPromptInput,
  genome: TextGenome = EMPTY_GENOME,
): LyricsPromptResult {
  const { valid, errors } = validateLyricsPromptInput(input)
  if (!valid) throw new Error(errors.join(' / '))

  const variants = templates.variantStyles.map((style) => generateLyricsPromptVariant(input, style.id, genome))

  return {
    input,
    variants,
    generatedAt: new Date().toISOString(),
  }
}
