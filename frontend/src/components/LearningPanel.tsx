import { useEffect, useState } from 'react'
import type {
  DemotedKeyword,
  DiscoveredKeyword,
  KeywordAssociation,
  TemplateOverride,
  TemplateSuggestion,
  TempoHint,
} from '../types/learning'
import type { TextMutation, TextMutationType } from '../types/textGenome'
import {
  addTemplateOverride,
  getAllHistory,
  getDemotedKeywords,
  getDiscoveredKeywords,
  getKeywordAssociations,
  getTemplateOverrides,
  getTempoHints,
  getTextMutations,
  onDataChange,
  removeDemotedKeyword,
  removeDiscoveredKeyword,
  removeKeywordAssociation,
  removeTemplateOverride,
  removeTempoHint,
  removeTextMutation,
} from '../lib/db'
import { computeScoresByCategory } from '../lib/learning/ranking'
import { generateSuggestions } from '../lib/learning/suggestions'

const APPROVED_BOOST = 15

const CATEGORY_LABELS: Record<TemplateSuggestion['category'], string> = {
  genreKey: 'ジャンル',
  moodKey: 'ムード',
  vocalTypeKey: 'ボーカル',
  songStructureKey: '曲構成',
  atmosphereKeys: '雰囲気',
  instrumentKeys: '楽器',
  variantStyle: '生成バリエーション',
}

const MUTATION_TYPE_LABELS: Record<TextMutationType, string> = {
  hookPhrase: 'フックフレーズ',
  connectorPhrase: '接続フレーズ',
}

const CONTEXT_TYPE_LABELS: Record<KeywordAssociation['contextType'], string> = {
  mood: 'ムード',
  atmosphere: '雰囲気',
}

export function LearningPanel() {
  const [suggestions, setSuggestions] = useState<TemplateSuggestion[]>([])
  const [overrides, setOverrides] = useState<TemplateOverride[]>([])
  const [textMutations, setTextMutations] = useState<TextMutation[]>([])
  const [discoveredKeywords, setDiscoveredKeywords] = useState<DiscoveredKeyword[]>([])
  const [keywordAssociations, setKeywordAssociations] = useState<KeywordAssociation[]>([])
  const [demotedKeywords, setDemotedKeywords] = useState<DemotedKeyword[]>([])
  const [tempoHints, setTempoHints] = useState<TempoHint[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    setLoadError(null)
    try {
      const [
        entries,
        currentOverrides,
        currentMutations,
        currentDiscovered,
        currentAssociations,
        currentDemoted,
        currentTempoHints,
      ] = await Promise.all([
        getAllHistory(),
        getTemplateOverrides(),
        getTextMutations(),
        getDiscoveredKeywords(),
        getKeywordAssociations(),
        getDemotedKeywords(),
        getTempoHints(),
      ])
      const scores = computeScoresByCategory(entries)
      setSuggestions(generateSuggestions(scores, currentOverrides))
      setOverrides(currentOverrides)
      setTextMutations(currentMutations)
      setDiscoveredKeywords(currentDiscovered)
      setKeywordAssociations(currentAssociations)
      setDemotedKeywords(currentDemoted)
      setTempoHints(currentTempoHints)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '学習データの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    // Auto-Loopがバックグラウンドで適用した変更を、設定タブを開いたままでも反映する
    return onDataChange(() => void reload())
  }, [])

  async function handleApprove(suggestion: TemplateSuggestion) {
    await addTemplateOverride({
      category: suggestion.category,
      key: suggestion.key,
      boost: APPROVED_BOOST,
      reason: suggestion.reason,
    })
    await reload()
  }

  async function handleRevoke(id: string) {
    await removeTemplateOverride(id)
    await reload()
  }

  async function handleRevokeMutation(id: string) {
    await removeTextMutation(id)
    await reload()
  }

  async function handleRevokeDiscovered(id: string) {
    await removeDiscoveredKeyword(id)
    await reload()
  }

  async function handleRevokeAssociation(id: string) {
    await removeKeywordAssociation(id)
    await reload()
  }

  async function handleRevokeDemoted(id: string) {
    await removeDemotedKeyword(id)
    await reload()
  }

  async function handleRevokeTempoHint(id: string) {
    await removeTempoHint(id)
    await reload()
  }

  return (
    <section className="glass-panel glass-panel-hover p-4 space-y-3">
      <h2 className="text-neon-cyan font-semibold">自己学習ループ</h2>
      <p className="text-xs text-text-secondary">
        評価の高い選択肢は各フォームで自動的に上位表示され「⭐」が付きます（即時・全自動）。
        さらに十分な件数・高評価が蓄積された組み合わせは下記に提案として表示され、承認すると
        その並び順の優先度が恒久的に強化されます（未承認のうちは表示順に影響しません）。
        「自動ループ」タブで自動改善を回すと、ジャンル優先度の調整に加えて、歌詞プロンプトの
        文章表現（冒頭のフックフレーズ・結びの接続フレーズ）も自動的に進化し、下記に反映されます。
      </p>

      {loading && <p className="text-xs text-text-secondary">読み込み中…</p>}

      {!loading && loadError && (
        <div className="space-y-2">
          <p className="text-xs text-neon-pink">読み込みに失敗しました: {loadError}</p>
          <button type="button" onClick={() => void reload()} className="text-xs btn-ghost px-3 py-1">
            再試行
          </button>
        </div>
      )}

      {!loading && !loadError && suggestions.length === 0 && (
        <p className="text-xs text-text-secondary">現時点で提案はありません。評価付きの履歴が増えると表示されます。</p>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map((s) => (
            <div
              key={`${s.category}:${s.key}`}
              className="flex items-center justify-between gap-2 bg-dark-lighter border border-border-neon rounded-lg px-3 py-2"
            >
              <div className="text-xs">
                <p className="text-text-primary">
                  [{CATEGORY_LABELS[s.category]}] {s.label}
                </p>
                <p className="text-text-muted text-[11px]">{s.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => handleApprove(s)}
                className="text-[11px] shrink-0 border border-neon-green text-neon-green rounded px-2 py-1"
              >
                適用
              </button>
            </div>
          ))}
        </div>
      )}

      {overrides.length > 0 && (
        <div className="pt-2 border-t border-border-neon space-y-2">
          <h3 className="text-xs text-neon-purple">承認済みの調整</h3>
          {overrides.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between gap-2 bg-dark-lighter border border-border-neon rounded-lg px-3 py-2"
            >
              <div className="text-xs">
                <p className="text-text-primary">
                  [{CATEGORY_LABELS[o.category]}] {o.key}
                </p>
                <p className="text-text-muted text-[11px]">{o.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRevoke(o.id)}
                className="text-[11px] shrink-0 text-neon-pink"
              >
                取り消す
              </button>
            </div>
          ))}
        </div>
      )}

      {textMutations.length > 0 && (
        <div className="pt-2 border-t border-border-neon space-y-2">
          <h3 className="text-xs text-neon-purple">進化した文章表現（自動ループ適用済み）</h3>
          {textMutations.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-2 bg-dark-lighter border border-border-neon rounded-lg px-3 py-2"
            >
              <div className="text-xs">
                <p className="text-text-primary">
                  [{MUTATION_TYPE_LABELS[m.type]}] 「{m.value}」
                </p>
                <p className="text-text-muted text-[11px]">{m.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRevokeMutation(m.id)}
                className="text-[11px] shrink-0 text-neon-pink"
              >
                取り消す
              </button>
            </div>
          ))}
        </div>
      )}

      {discoveredKeywords.length > 0 && (
        <div className="pt-2 border-t border-border-neon space-y-2">
          <h3 className="text-xs text-neon-purple">自動発見された語彙（自動ループ適用済み）</h3>
          {discoveredKeywords.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between gap-2 bg-dark-lighter border border-border-neon rounded-lg px-3 py-2"
            >
              <div className="text-xs">
                <p className="text-text-primary">「{k.word}」</p>
                <p className="text-text-muted text-[11px]">{k.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRevokeDiscovered(k.id)}
                className="text-[11px] shrink-0 text-neon-pink"
              >
                取り消す
              </button>
            </div>
          ))}
        </div>
      )}

      {keywordAssociations.length > 0 && (
        <div className="pt-2 border-t border-border-neon space-y-2">
          <h3 className="text-xs text-neon-purple">学習された文脈連想（自動ループ適用済み）</h3>
          {keywordAssociations.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-2 bg-dark-lighter border border-border-neon rounded-lg px-3 py-2"
            >
              <div className="text-xs">
                <p className="text-text-primary">
                  [{CONTEXT_TYPE_LABELS[a.contextType]}「{a.contextKey}」] 「{a.word}」
                </p>
                <p className="text-text-muted text-[11px]">{a.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRevokeAssociation(a.id)}
                className="text-[11px] shrink-0 text-neon-pink"
              >
                取り消す
              </button>
            </div>
          ))}
        </div>
      )}

      {demotedKeywords.length > 0 && (
        <div className="pt-2 border-t border-border-neon space-y-2">
          <h3 className="text-xs text-neon-purple">低評価により除外された語彙（自動ループ適用済み）</h3>
          {demotedKeywords.map((k) => (
            <div
              key={k.id}
              className="flex items-center justify-between gap-2 bg-dark-lighter border border-border-neon rounded-lg px-3 py-2"
            >
              <div className="text-xs">
                <p className="text-text-primary">「{k.word}」</p>
                <p className="text-text-muted text-[11px]">{k.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRevokeDemoted(k.id)}
                className="text-[11px] shrink-0 text-neon-pink"
              >
                取り消す（復活させる）
              </button>
            </div>
          ))}
        </div>
      )}

      {tempoHints.length > 0 && (
        <div className="pt-2 border-t border-border-neon space-y-2">
          <h3 className="text-xs text-neon-purple">学習されたおすすめテンポ（自動ループ適用済み）</h3>
          {tempoHints.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between gap-2 bg-dark-lighter border border-border-neon rounded-lg px-3 py-2"
            >
              <div className="text-xs">
                <p className="text-text-primary">
                  [{h.genreKey}] BPM{h.tempo}
                </p>
                <p className="text-text-muted text-[11px]">{h.reason}</p>
              </div>
              <button
                type="button"
                onClick={() => handleRevokeTempoHint(h.id)}
                className="text-[11px] shrink-0 text-neon-pink"
              >
                取り消す
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
