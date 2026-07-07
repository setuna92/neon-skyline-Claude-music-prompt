import type { ImportedPrompt } from '../types/promptLibrary'

type DraftPrompt = Omit<ImportedPrompt, 'id' | 'createdAt'>

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function extractTitleAndBody(item: unknown, fallbackTitle: string): DraftPrompt {
  if (typeof item === 'string') {
    return { title: fallbackTitle, body: item, sourceFormat: 'json' }
  }
  if (item !== null && typeof item === 'object') {
    const obj = item as Record<string, unknown>
    const title = pickString(obj.title) ?? pickString(obj.name) ?? fallbackTitle
    const body =
      pickString(obj.text) ?? pickString(obj.body) ?? pickString(obj.content) ?? pickString(obj.prompt) ??
      JSON.stringify(item)
    return { title, body, sourceFormat: 'json' }
  }
  return { title: fallbackTitle, body: JSON.stringify(item), sourceFormat: 'json' }
}

/** JSON文字列からインポートプロンプトの配列を抽出する。配列/単一オブジェクト/文字列配列のいずれにも対応する。 */
export function parseImportedPromptsFromJSON(raw: string, fallbackTitlePrefix: string): DraftPrompt[] {
  const parsed: unknown = JSON.parse(raw)

  if (Array.isArray(parsed)) {
    return parsed.map((item, i) => extractTitleAndBody(item, `${fallbackTitlePrefix} #${i + 1}`))
  }
  return [extractTitleAndBody(parsed, fallbackTitlePrefix)]
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      fields.push(current)
      current = ''
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

const TITLE_HEADER_ALIASES = ['title', 'name']
const BODY_HEADER_ALIASES = ['text', 'body', 'content', 'prompt']

/** 本文らしい列が見つからない場合のフォールバック。タイトル列と同じ値を本文に複製しないよう、タイトル以外の最初の列を使う。 */
function fallbackBody(fields: string[], titleIndex: number): string {
  const candidateIndex = fields.findIndex((_, idx) => idx !== titleIndex)
  return candidateIndex === -1 ? '' : (fields[candidateIndex] ?? '')
}

/** CSV文字列からインポートプロンプトの配列を抽出する。title/text等のヘッダーがあれば列を対応付け、無ければ各行を本文として扱う。 */
export function parseImportedPromptsFromCSV(raw: string, fallbackTitlePrefix: string): DraftPrompt[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return []

  const headerFields = parseCsvLine(lines[0]).map((f) => f.trim().toLowerCase())
  const titleIndex = headerFields.findIndex((f) => TITLE_HEADER_ALIASES.includes(f))
  const bodyIndex = headerFields.findIndex((f) => BODY_HEADER_ALIASES.includes(f))
  const hasHeader = titleIndex !== -1 || bodyIndex !== -1

  const dataLines = hasHeader ? lines.slice(1) : lines

  return dataLines.map((line, i) => {
    const fields = parseCsvLine(line)
    const fallbackTitle = `${fallbackTitlePrefix} #${i + 1}`
    if (!hasHeader) {
      return { title: fallbackTitle, body: fields[0] ?? '', sourceFormat: 'csv' as const }
    }
    const title = (titleIndex !== -1 ? fields[titleIndex] : undefined)?.trim() || fallbackTitle
    const body = bodyIndex !== -1 ? (fields[bodyIndex] ?? '') : fallbackBody(fields, titleIndex)
    return { title, body, sourceFormat: 'csv' as const }
  })
}

export function parseImportedPromptsFromFile(filename: string, raw: string): DraftPrompt[] {
  const prefix = filename.replace(/\.[^.]+$/, '')
  if (filename.toLowerCase().endsWith('.csv')) {
    return parseImportedPromptsFromCSV(raw, prefix)
  }
  return parseImportedPromptsFromJSON(raw, prefix)
}
