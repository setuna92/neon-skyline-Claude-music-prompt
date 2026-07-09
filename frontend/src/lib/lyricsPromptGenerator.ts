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
  synopsis?: string
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
    synopsis: input.synopsis,
  }
}

function baseSection(r: ResolvedInput, heading: string): string {
  return r.basePromptText ? `\n\n${heading}:\n${r.basePromptText}` : ''
}

function synopsisLines(r: ResolvedInput): string[] {
  return r.synopsis ? ['', 'あらすじ(必ずこれに従って書いてください):', r.synopsis] : []
}

function synopsisSentence(r: ResolvedInput): string[] {
  return r.synopsis ? [`あらすじ(必ずこれに従って書いてください): ${r.synopsis}`] : []
}

function buildStandard(r: ResolvedInput): string {
  const lines = [
    'あなたはプロの作詞家です。以下の条件を満たす歌詞を、今この場で最初から最後まで完全に書き切ってください。',
    '書き方の相談・確認・前置きは不要です。実際の歌詞本文そのものを出力してください。',
    `ジャンル: ${r.genre.label}`,
  ]
  if (r.mood) lines.push(`ムード: ${r.mood.label}`)
  if (r.atmospheres.length) lines.push(`雰囲気: ${r.atmospheres.map((a) => a.label).join('、')}`)
  if (r.vocalType) lines.push(`ボーカルスタイル: ${r.vocalType.label}`)
  if (r.structure) lines.push(`曲構成: ${r.structure.label}`)
  lines.push(`盛り込みたいテーマ・キーワード: ${r.themeKeywords.join('、')}`)
  lines.push(`言語: ${r.languageLabel}`)
  lines.push(...synopsisLines(r))
  lines.push(
    '',
    '作詞の指針:',
    '・毎回、これまでに書いた中で一番だと胸を張れる一曲を目指し、全力で書いてください。',
    '・キーワードは「世界観・質感・ムードのヒント」であり、歌詞にそのまま使うことは禁止です。情景・人物の行動・身体感覚に翻訳して表現してください（例:「サブベースのウォブル」→地響き、胸を揺らす振動、遠雷などの比喩に変換）。',
    '・音楽用語・制作用語(ビート、ベース、シンセ、コーラス、ハーモニー、BPM等)を歌詞本文に使うことは禁止です。曲自体や演奏についての言及(メタ表現)も禁止です。',
    '・執筆前に必ず内部で物語を設計してください:「主人公は誰か／いつどこで／何が起きて／最後に何が変わるか」を決めてから書き、冒頭とラストで主人公の状況・心情が変化する起承転結の構成にしてください。',
    '・[Aメロ][Bメロ][サビ]のようにセクションを明記し、Aメロ=状況と小さな違和感の提示、Bメロ=転機と助走、サビ=感情の解放と核フレーズ、ラストサビ=物語の回収と変化の提示という役割を守ってください。',
    '・核フレーズを1つ定め、各サビで繰り返しつつ、ラストサビでは意味が変化・回収されるように書いてください。',
    '・具体描写のノルマとして、五感描写(音・光・匂い・温度・手触り)を5箇所以上、固有の小物・場所・時刻(例: 冷蔵庫の唸り、始発、自販機の灯り)を3つ以上盛り込んでください。',
    '・「翼を広げて」「輝く未来」「心のままに」「君となら」「無限の空」「光の粒子」のような使い古されたクリシェは避け、具体的で新鮮な言葉を選んでください。',
    '・メロディに乗せて歌えるよう、一行あたりの文字数・音数のバランスを意識してください。',
    '・Aメロ・Bメロは長すぎなくてよいので、簡潔にまとめてください。',
    '・盛り上がりと落ち着きの緩急をつけ、曲全体が単調にならないようにしてください。',
    '・同じ単語やフレーズを使いすぎず、表現にバリエーションを持たせてください。',
    '・出力は歌詞本文のみとし、前置きや解説は書かないでください。',
  )
  return lines.join('\n') + baseSection(r, '参考プロンプト')
}

function buildPoetic(r: ResolvedInput): string {
  const parts: string[] = [
    `あなたはプロの作詞家です。次のイメージをもとに、心に響く歌詞を今この場で最後まで書き切ってください。相談や確認は不要です。ジャンルは${r.genre.label}です。`,
  ]
  if (r.mood) parts.push(`${r.mood.label}を漂わせながら展開してください。`)
  if (r.atmospheres.length) parts.push(`${r.atmospheres.map((a) => a.label).join('、')}な世界観を描いてください。`)
  if (r.vocalType) parts.push(`ボーカルは${r.vocalType.label}を想定してください。`)
  if (r.structure) parts.push(`${r.structure.label}に沿って展開してください。`)
  parts.push(`特に次の情景・言葉を大切に織り込んでください：${r.themeKeywords.join('、')}。`)
  parts.push(`言語は${r.languageLabel}でお願いします。`)
  parts.push(...synopsisSentence(r))
  parts.push('毎回、これまでに書いた中で一番だと胸を張れる一曲を目指し、全力で書いてください。')
  parts.push('キーワードは世界観・質感・ムードのヒントであり、歌詞にそのまま使うのは禁止です。情景や人物の行動、身体感覚に翻訳して描いてください。')
  parts.push('ビート、ベース、シンセ、コーラス、ハーモニー、BPMのような音楽用語・制作用語や、曲・演奏そのものへの言及は歌詞に書かないでください。')
  parts.push('書き始める前に、主人公は誰か、いつどこで何が起きて最後に何が変わるかを内で決め、冒頭とラストで主人公の状況や心情が変わる起承転結を描いてください。')
  parts.push('Aメロは状況と小さな違和感、Bメロは転機と助走、サビは核フレーズと感情の解放、ラストサビは物語の回収と変化を担うよう役割を守ってください。')
  parts.push('核フレーズを1つ定めて各サビで繰り返しつつ、ラストサビではその意味が変化し回収されるように書いてください。')
  parts.push('五感の描写(音・光・匂い・温度・手触り)を5箇所以上、冷蔵庫の唸りや始発、自販機の灯りのような固有の小物・場所・時刻を3つ以上織り込んでください。')
  parts.push('「翼を広げて」「輝く未来」「心のままに」「君となら」「無限の空」「光の粒子」のような使い古された表現は避けてください。')
  parts.push('一行の長さは歌って自然なリズムになるよう意識してください。')
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
    `あなたはプロの作詞家です。${parts.join('／')} の歌詞を、今この場で最後まで完全に書き切ってください。相談や確認は不要です。` +
    (r.synopsis ? ` あらすじ(必ずこれに従ってください): ${r.synopsis}。` : '') +
    'セクション([Aメロ][Bメロ][サビ]等)を明記し、Aメロ=状況提示、Bメロ=転機、サビ=核フレーズと感情解放、ラストサビ=物語の回収という起承転結の役割を守ってください。' +
    'キーワードはそのまま歌詞にせず、情景や身体感覚の比喩に翻訳してください。' +
    'ビートやベース、シンセ、BPMなどの音楽用語・制作用語、曲や演奏そのものへの言及は禁止です。' +
    '核フレーズを1つ定めて各サビで繰り返し、ラストサビで意味を変化・回収してください。' +
    '五感描写を5箇所以上、固有の小物・場所・時刻を3つ以上盛り込み、' +
    '「翼を広げて」「輝く未来」「心のままに」「君となら」「無限の空」「光の粒子」等の使い古されたクリシェは避けてください。' +
    'Aメロ・Bメロは長すぎなくてよく、曲全体が単調にならないよう緩急をつけ、' +
    '同じワードを使いすぎないでください。' +
    '毎回、これまでに書いた中で一番だと胸を張れる一曲を目指し、全力で書いてください。' +
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

/** 歌詞プロンプト本体の生成に必要な項目のうち、あらすじ生成に使うもの */
export type SynopsisPromptInput = Pick<
  LyricsPromptInput,
  'genreKey' | 'moodKey' | 'atmosphereKeys' | 'themeKeywords' | 'languageKey'
>

/**
 * 2段階生成の1段目: キーワードから「主人公・出来事・結末」のあらすじだけを
 * Claudeに考えさせるためのプロンプトを作る。ここで得たあらすじを
 * LyricsPromptInput.synopsis に渡すと、2段目の歌詞プロンプトに必須条件として埋め込まれる。
 */
export function generateSynopsisPrompt(input: SynopsisPromptInput): string {
  const genre = findByKey(templates.genres, input.genreKey)
  if (!genre) throw new Error(`未知のジャンルキーです: ${input.genreKey}`)
  const mood = findByKey(templates.moods, input.moodKey)
  const atmospheres = input.atmosphereKeys
    .map((key) => findByKey(templates.atmospheres, key))
    .filter((e): e is OptionEntry => Boolean(e))
  const languageLabel = LANGUAGE_LABELS[input.languageKey]

  const lines = [
    'あなたはプロの作詞家です。次の条件をもとに、歌詞のあらすじを今この場で考えてください。相談や確認は不要です。',
    `ジャンル: ${genre.label}`,
  ]
  if (mood) lines.push(`ムード: ${mood.label}`)
  if (atmospheres.length) lines.push(`雰囲気: ${atmospheres.map((a) => a.label).join('、')}`)
  lines.push(`キーワード(世界観・質感のヒント。歌詞にそのまま使う必要はありません): ${input.themeKeywords.join('、')}`)
  lines.push(`言語: ${languageLabel}`)
  lines.push(
    '',
    '主人公は誰か、いつどこで何が起きて、最後に何が変わるかが伝わるように、',
    '起承転結のある短いあらすじを考えてください。抽象的な情景描写だけで終わらせず、',
    '具体的な行動や出来事を含めてください。',
    '',
    '出力形式(必ずこの3行のみ。前置き・説明・タイトルは一切書かないこと):',
    '主人公: (誰が、どんな状況か)',
    '出来事: (何が起きるか)',
    '結末: (最後に何がどう変わるか)',
  )
  return lines.join('\n')
}
