export interface ClaudeConfig {
  apiKey: string
  model: string
}

export class ClaudeApiError extends Error {
  status?: number
  retryable: boolean

  constructor(message: string, status?: number, retryable = false) {
    super(message)
    this.name = 'ClaudeApiError'
    this.status = status
    this.retryable = retryable
  }
}
