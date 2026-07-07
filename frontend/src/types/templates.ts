export interface OptionEntry {
  key: string
  label: string
  en?: string
  jp?: string
  extra?: string
}

export interface VariantStyle {
  id: string
  label: string
  description: string
  toneHint: string
}

export interface ConsentModalTemplate {
  title: string
  summaryLabel: string
  destinationLabel: string
  purposeLabel: string
  consentButtonLabel: string
  cancelButtonLabel: string
  notes: string
}

export interface PromptTemplates {
  meta: {
    version: string
    description: string
    sourceOfTruth: string
  }
  genres: OptionEntry[]
  moods: OptionEntry[]
  vocalTypes: OptionEntry[]
  instrumentElements: OptionEntry[]
  songStructures: OptionEntry[]
  atmospheres: OptionEntry[]
  sentenceTemplates: {
    en: Record<string, string>
    jp: Record<string, string>
  }
  variantStyles: VariantStyle[]
  consentModalTemplate: ConsentModalTemplate
}
