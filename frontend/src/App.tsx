import { useEffect, useState } from 'react'
import type { GenerationResult } from './types/generation'
import type { LyricsPromptResult, LyricsPromptSeed } from './types/lyricsPrompt'
import { PassphraseGate } from './components/PassphraseGate'
import { GenerationForm } from './components/GenerationForm'
import { GenerationResultPanel } from './components/GenerationResultPanel'
import { LyricsPromptForm } from './components/LyricsPromptForm'
import { LyricsPromptResultPanel } from './components/LyricsPromptResultPanel'
import { HistoryPanel } from './components/HistoryPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { AutoLoopPanel } from './components/AutoLoopPanel'
import { SmartGenerationPanel } from './components/SmartGenerationPanel'
import { getSmartGenerationLoop } from './lib/autoLoop/smartGenerationSingleton'
import { getSmartLoopAutoStart } from './lib/db'

type Tab = 'generate' | 'lyrics' | 'autoloop' | 'history' | 'settings'

function App() {
  const [unlocked, setUnlocked] = useState(false)
  const [tab, setTab] = useState<Tab>('generate')
  const [lastGeneration, setLastGeneration] = useState<{ historyEntryId: string; result: GenerationResult } | null>(
    null,
  )
  const [lastLyricsPrompt, setLastLyricsPrompt] = useState<{
    historyEntryId: string
    result: LyricsPromptResult
  } | null>(null)
  const [lyricsSeed, setLyricsSeed] = useState<LyricsPromptSeed | null>(null)

  useEffect(() => {
    if (!unlocked) return
    // 「次回自動的に再開する」が有効なら、タブを開かなくてもロック解除した瞬間に
    // おまかせ自動生成ループを再開する(ブラウザ/PWAを閉じている間は動かせないため、
    // 次に開いた時にすぐ追いつけるようにするための代替)
    getSmartLoopAutoStart()
      .then((enabled) => {
        if (enabled) void getSmartGenerationLoop().start()
      })
      .catch(() => {})
  }, [unlocked])

  if (!unlocked) {
    return <PassphraseGate onUnlock={() => setUnlocked(true)} />
  }

  function handleLock() {
    setUnlocked(false)
    setLastGeneration(null)
    setLastLyricsPrompt(null)
    setLyricsSeed(null)
    setTab('generate')
  }

  function handleSendToLyrics(seed: LyricsPromptSeed) {
    setLyricsSeed(seed)
    setTab('lyrics')
  }

  return (
    <div className="min-h-svh text-text-primary flex flex-col">
      <header className="px-4 pt-5 pb-4 text-center">
        <h1 className="text-2xl font-extrabold tracking-wide title-gradient inline-block">
          🎵 AI音楽プロンプトジェネレーター
        </h1>
        <p className="text-[11px] text-text-muted mt-1 tracking-[0.2em] uppercase">Local-first · Self-evolving · PWA</p>
      </header>

      <nav className="sticky top-0 z-40 flex backdrop-blur-md bg-dark-bg/70 border-b border-border-neon">
        {(
          [
            { id: 'generate', label: '作曲' },
            { id: 'lyrics', label: '歌詞プロンプト' },
            { id: 'autoloop', label: '自動ループ' },
            { id: 'history', label: '履歴' },
            { id: 'settings', label: '設定' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`flex-1 py-3 text-xs font-medium transition-colors duration-200 ${
              tab === item.id ? 'tab-active' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 px-4 py-4 max-w-lg mx-auto w-full space-y-4 pb-10">
        {tab === 'generate' && (
          <>
            <GenerationForm
              onGenerated={(historyEntryId, result) => setLastGeneration({ historyEntryId, result })}
            />
            {lastGeneration && (
              <GenerationResultPanel
                historyEntryId={lastGeneration.historyEntryId}
                result={lastGeneration.result}
                onSendToLyrics={handleSendToLyrics}
              />
            )}
          </>
        )}
        {tab === 'lyrics' && (
          <>
            <LyricsPromptForm
              seed={lyricsSeed}
              onSeedConsumed={() => setLyricsSeed(null)}
              onGenerated={(historyEntryId, result) => setLastLyricsPrompt({ historyEntryId, result })}
            />
            {lastLyricsPrompt && (
              <LyricsPromptResultPanel
                historyEntryId={lastLyricsPrompt.historyEntryId}
                result={lastLyricsPrompt.result}
              />
            )}
          </>
        )}
        {tab === 'autoloop' && (
          <>
            <SmartGenerationPanel />
            <AutoLoopPanel />
          </>
        )}
        {tab === 'history' && <HistoryPanel />}
        {tab === 'settings' && <SettingsPanel onLock={handleLock} />}
      </main>
    </div>
  )
}

export default App
