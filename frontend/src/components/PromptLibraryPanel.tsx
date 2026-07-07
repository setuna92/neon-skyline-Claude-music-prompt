import { useEffect, useState } from 'react'
import type { ImportedPrompt } from '../types/promptLibrary'
import { addImportedPrompts, deleteImportedPrompt, getAllImportedPrompts } from '../lib/db'
import { parseImportedPromptsFromFile } from '../lib/promptImport'

interface PromptLibraryPanelProps {
  selectedId?: string
  onSelect: (prompt: ImportedPrompt | null) => void
}

export function PromptLibraryPanel({ selectedId, onSelect }: PromptLibraryPanelProps) {
  const [prompts, setPrompts] = useState<ImportedPrompt[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 普段の生成フローの邪魔にならないよう既定は折りたたむ。既に選択中のプロンプトがあれば開いておく。
  const [open, setOpen] = useState(Boolean(selectedId))

  async function reload() {
    setPrompts(await getAllImportedPrompts())
  }

  useEffect(() => {
    void reload()
  }, [])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    setBusy(true)
    try {
      const drafts = []
      for (const file of Array.from(files)) {
        const text = await file.text()
        drafts.push(...parseImportedPromptsFromFile(file.name, text))
      }
      await addImportedPrompts(drafts)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? `読み込みに失敗しました: ${err.message}` : '読み込みに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    await deleteImportedPrompt(id)
    if (selectedId === id) onSelect(null)
    await reload()
  }

  const filtered = prompts.filter(
    (p) => query.trim() === '' || p.title.includes(query) || p.body.includes(query),
  )

  const selectedPrompt = prompts.find((p) => p.id === selectedId)

  return (
    <section className="glass-panel glass-panel-hover p-4 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm"
      >
        <span className="text-neon-purple font-semibold">
          プロンプトライブラリ{prompts.length > 0 ? ` (${prompts.length})` : ''}
        </span>
        <span className="text-xs text-text-secondary">{open ? '▲ 閉じる' : '▼ 開く'}</span>
      </button>
      {!open && selectedPrompt && (
        <p className="text-[11px] text-text-secondary">選択中: {selectedPrompt.title}</p>
      )}

      {open && (
        <>
          <p className="text-xs text-text-secondary">
            JSON/CSVファイル（複数選択可）を取り込み、参考プロンプトとして選択できます。
          </p>

          <input
            type="file"
            accept=".json,.csv"
            multiple
            disabled={busy}
            onChange={(e) => void handleFiles(e.target.files)}
            className="w-full text-xs text-text-secondary"
          />
          {error && <p className="text-xs text-neon-pink">{error}</p>}

          {prompts.length > 0 && (
            <>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ライブラリ内を検索…"
                className="w-full input-neon px-3 py-2 text-sm"
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filtered.map((p) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 ${
                      selectedId === p.id ? 'border-neon-blue' : 'border-border-neon'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(selectedId === p.id ? null : p)}
                      className="flex-1 text-left text-xs text-text-secondary truncate"
                      title={p.body}
                    >
                      {selectedId === p.id ? '✓ ' : ''}
                      {p.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id)}
                      className="text-[11px] text-neon-pink shrink-0"
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}
