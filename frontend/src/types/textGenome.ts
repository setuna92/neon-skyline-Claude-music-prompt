export type TextMutationType = 'hookPhrase' | 'connectorPhrase'

export interface TextMutation {
  id: string
  type: TextMutationType
  value: string
  reason: string
  createdAt: string
}

export interface TextGenome {
  hookPhrases: string[]
  connectorPhrases: string[]
}

export const EMPTY_GENOME: TextGenome = { hookPhrases: [], connectorPhrases: [] }

export function genomeFromMutations(mutations: TextMutation[]): TextGenome {
  return {
    hookPhrases: mutations.filter((m) => m.type === 'hookPhrase').map((m) => m.value),
    connectorPhrases: mutations.filter((m) => m.type === 'connectorPhrase').map((m) => m.value),
  }
}
