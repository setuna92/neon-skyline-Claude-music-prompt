import templatesData from '../data/templates.json'
import type { PromptTemplates, OptionEntry } from '../types/templates'
import type { ClaudeCompositionInput, ClaudeCompositionVariant, ClaudeCompositionResult } from '../types/claudeComposition'
import type { ValidationResult } from '../types/generation'

const templates = templatesData as PromptTemplates

function findByKey(list: OptionEntry[], key: string | undefined): OptionEntry | undefined {
  if (!key) return undefined
  return list.find((entry) => entry.key === key)
}

export function validateClaudeCompositionInput(input: ClaudeCompositionInput): ValidationResult {
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

function resolveInput(input: ClaudeCompositionInput): ResolvedInput {
  const genre = findByKey(templates.genres, input.genreKey)
  if (!genre) throw new Error(`未知のジャンルキーです: ${input.genreKey}`)

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

function conditionLines(r: ResolvedInput): string[] {
  const lines = [`ジャンル: ${r.genre.label}${r.genre.en ? ` (${r.genre.en})` : ''}`]
  if (r.mood) lines.push(`ムード: ${r.mood.label}`)
  if (r.tempo) lines.push(`テンポ: BPM ${r.tempo}`)
  lines.push(`ボーカル: ${hasVocal(r.vocalType) ? r.vocalType.label : 'ボーカルなし(インストゥルメンタル)'}`)
  if (r.instruments.length) lines.push(`主な楽器: ${r.instruments.map((i) => i.label).join('、')}`)
  if (r.structure) lines.push(`曲構成: ${r.structure.label}`)
  if (r.atmospheres.length) lines.push(`雰囲気: ${r.atmospheres.map((a) => a.label).join('、')}`)
  if (r.themeKeywords.length) lines.push(`テーマ・要素: ${r.themeKeywords.join('、')}`)
  return lines
}

// --- 標準スタイル: 条件を箇条書きで明示し、Suno用プロンプトの書き方を具体的に指示する ---

function buildStandard(r: ResolvedInput): string {
  const lines = [
    'あなたはSuno(AI作曲サービス)向けの高品質な作曲プロンプトを書く専門家です。',
    '以下の条件を満たす、Sunoにそのまま貼り付けられる英語の作曲プロンプトを1つ書いてください。',
    '',
    ...conditionLines(r),
    '',
    '作成の指針:',
    '・ジャンル・楽器・雰囲気を表す具体的な英単語やプロダクションタグを効果的に使ってください。',
    '・曲の展開(イントロ→展開→サビ相当の盛り上がり等)が伝わるようにしてください。',
    '・冗長な説明文ではなく、Sunoが解釈しやすい簡潔で密度の高い表現にしてください。',
    '・出力は最終的な英語プロンプト文のみとし、前置きや解説、日本語訳は書かないでください。',
  ]
  return lines.join('\n')
}

// --- 詩的スタイル: 情景を伝えつつ、最終出力はSuno向けプロンプトであることを明確に指定する ---

function buildPoetic(r: ResolvedInput): string {
  const parts: string[] = [
    `Suno(AI作曲サービス)に渡す作曲プロンプトを書いてください。曲のイメージは${r.genre.label}です。`,
  ]
  if (r.mood) parts.push(`${r.mood.label}を漂わせる情景を思い浮かべてください。`)
  if (r.tempo) parts.push(`鼓動のようなBPM${r.tempo}のテンポで進んでください。`)
  parts.push(
    hasVocal(r.vocalType)
      ? `${r.vocalType.label}の声が情景に息を吹き込むようにしてください。`
      : 'ボーカルは無く、楽器だけで情景を描いてください。',
  )
  if (r.instruments.length) parts.push(`${r.instruments.map((i) => i.label).join('、')}が情景に色を添えるようにしてください。`)
  if (r.structure) parts.push(`${r.structure.label}のような展開で物語を運んでください。`)
  if (r.atmospheres.length) parts.push(`空気そのものが${r.atmospheres.map((a) => a.label).join('、')}を感じさせるようにしてください。`)
  if (r.themeKeywords.length) parts.push(`${r.themeKeywords.join('、')}の面影を音楽に込めてください。`)
  parts.push(
    'この情景を踏まえた上で、実際にSunoに貼り付けて使える、簡潔で密度の高い英語の作曲プロンプトを1つ書いてください。',
  )
  parts.push('出力は最終的な英語プロンプト文のみとし、前置きや解説、日本語訳は書かないでください。')
  return parts.join(' ')
}

// --- ミニマルスタイル: 条件を短く列挙し、簡潔な依頼文にする ---

function buildMinimal(r: ResolvedInput): string {
  const parts = [
    r.genre.label,
    r.mood?.label,
    r.tempo ? `BPM${r.tempo}` : undefined,
    hasVocal(r.vocalType) ? r.vocalType.label : 'ボーカルなし',
    r.instruments.length ? r.instruments.map((i) => i.label).join('/') : undefined,
    r.structure?.label,
    r.atmospheres.length ? r.atmospheres.map((a) => a.label).join('/') : undefined,
    r.themeKeywords.length ? `テーマ:${r.themeKeywords.join('/')}` : undefined,
  ].filter((p): p is string => Boolean(p))
  return (
    `${parts.join('／')} の条件で、Sunoにそのまま貼り付けられる英語の作曲プロンプトを1つ書いてください。` +
    '簡潔で密度の高い表現にしてください。出力は最終的な英語プロンプト文のみとし、前置きや解説、日本語訳は書かないでください。'
  )
}

const BUILDERS: Record<string, (r: ResolvedInput) => string> = {
  standard: buildStandard,
  poetic: buildPoetic,
  minimal: buildMinimal,
}

export function generateClaudeCompositionPromptVariant(
  input: ClaudeCompositionInput,
  styleId: string,
): ClaudeCompositionVariant {
  const style = templates.variantStyles.find((s) => s.id === styleId)
  if (!style) throw new Error(`未知のバリエーションスタイルです: ${styleId}`)

  const builder = BUILDERS[styleId]
  if (!builder) throw new Error(`スタイル "${styleId}" のビルダーが未実装です`)

  const resolved = resolveInput(input)

  return {
    variantId: `${styleId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    styleId: style.id,
    styleLabel: style.label,
    promptText: builder(resolved),
  }
}

export function generateClaudeCompositionPromptVariants(input: ClaudeCompositionInput): ClaudeCompositionResult {
  const { valid, errors } = validateClaudeCompositionInput(input)
  if (!valid) throw new Error(errors.join(' / '))

  const variants = templates.variantStyles.map((style) => generateClaudeCompositionPromptVariant(input, style.id))

  return {
    input,
    variants,
    generatedAt: new Date().toISOString(),
  }
}
