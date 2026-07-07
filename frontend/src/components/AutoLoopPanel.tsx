import { useEffect, useMemo, useState } from 'react'
import { getAutoLoopOrchestrator } from '../lib/autoLoop/singleton'
import { getAutoLoopLifetimeStats } from '../lib/db'
import { EMPTY_LIFETIME_STATS } from '../types/autoLoop'
import type { AutoLoopConfig, AutoLoopDiff, AutoLoopLifetimeStats, AutoLoopMetrics, CycleResult } from '../types/autoLoop'

type OutcomeFilter = 'all' | 'applied' | 'rejected' | 'no-diff'
type SortMode = 'time' | 'score'

function outcomeOf(cycle: CycleResult): OutcomeFilter {
  if (!cycle.diffProposed) return 'no-diff'
  return cycle.applied ? 'applied' : 'rejected'
}

function downloadCSV(rows: CycleResult[]): void {
  const header = [
    'cycle_index',
    'timestamp',
    'variant_id',
    'genre_key',
    'score',
    'keyword',
    'hook',
    'grammar',
    'diversity',
    'issues',
    'decision',
    'reason',
  ]
  const lines = [header.join(',')]
  for (const cycle of rows) {
    for (const review of cycle.reviews) {
      const decision = cycle.diffProposed ? (cycle.applied ? 'applied' : 'rejected') : 'no-diff'
      const reason = cycle.testResult?.reason ?? ''
      const cells = [
        cycle.cycleIndex,
        cycle.timestamp,
        review.variantId,
        review.genreKey,
        review.score.toFixed(3),
        review.subScores.keyword.toFixed(3),
        review.subScores.hook.toFixed(3),
        review.subScores.grammar.toFixed(3),
        review.subScores.diversity.toFixed(3),
        review.issues.join(' / '),
        decision,
        reason,
      ]
      lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `autoloop-log-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const MUTATION_TYPE_LABELS: Record<'hookPhrase' | 'connectorPhrase', string> = {
  hookPhrase: 'フックフレーズ',
  connectorPhrase: '接続フレーズ',
}

const CONTEXT_TYPE_LABELS: Record<'mood' | 'atmosphere', string> = { mood: 'ムード', atmosphere: '雰囲気' }

function describeDiff(diff: AutoLoopDiff): string {
  if (diff.kind === 'ranking') {
    return `[${diff.category}] ${diff.key} を +${diff.delta}`
  }
  if (diff.kind === 'keywordDiscovery') {
    return `[新語彙の発見] 「${diff.word}」を提案語彙に昇格`
  }
  if (diff.kind === 'keywordAssociation') {
    return `[文脈連想の学習] 「${diff.word}」を${CONTEXT_TYPE_LABELS[diff.contextType]}「${diff.contextKey}」の連想語に追加`
  }
  if (diff.kind === 'keywordDemotion') {
    return `[低評価語の除外] 「${diff.word}」を提案から除外`
  }
  if (diff.kind === 'tempoHint') {
    return `[おすすめテンポの学習] ジャンル「${diff.genreKey}」にBPM${diff.tempo}を追加`
  }
  return `[文章表現・${MUTATION_TYPE_LABELS[diff.mutationType]}] 「${diff.value}」を追加`
}

const CONFIG_FIELDS: { key: keyof AutoLoopConfig; label: string; min: number; step: number }[] = [
  { key: 'concurrencyLimit', label: '同時実行数 (concurrencyLimit)', min: 1, step: 1 },
  { key: 'cycleDelayMs', label: 'サイクル間隔 ms (cycleDelayMs)', min: 0, step: 500 },
  { key: 'maxCyclesPerSession', label: '最大サイクル数 (maxCyclesPerSession)', min: 1, step: 10 },
  { key: 'failureThreshold', label: '連続失敗許容数 (failureThreshold)', min: 1, step: 1 },
  { key: 'reviewWindowSize', label: '分析対象件数 (reviewWindowSize)', min: 1, step: 1 },
]

export function AutoLoopPanel() {
  // タブを切り替えてもバックグラウンドで動き続けるモジュールレベルのシングルトン。
  // ここではその「今の状態」を購読して表示するだけで、生成/破棄は行わない。
  const orchestrator = getAutoLoopOrchestrator()

  const [config, setConfig] = useState<AutoLoopConfig>(orchestrator.getConfig())
  const [metrics, setMetrics] = useState<AutoLoopMetrics>(orchestrator.getMetrics())
  const [log, setLog] = useState<CycleResult[]>(orchestrator.getRecentLog())
  const [lifetimeStats, setLifetimeStats] = useState<AutoLoopLifetimeStats>(EMPTY_LIFETIME_STATS)
  const [genreFilter, setGenreFilter] = useState<string>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('time')

  useEffect(() => {
    getAutoLoopLifetimeStats().then(setLifetimeStats)

    const unsubscribe = orchestrator.subscribe(({ metrics: nextMetrics, latestCycle }) => {
      setMetrics(nextMetrics)
      if (latestCycle) {
        setLog(orchestrator.getRecentLog())
        void getAutoLoopLifetimeStats().then(setLifetimeStats)
      }
    })
    // アンマウント(タブ切り替え)時にはループを止めない。購読を外すだけ。
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const availableGenres = useMemo(() => {
    const genres = new Set<string>()
    for (const cycle of log) {
      for (const review of cycle.reviews) genres.add(review.genreKey)
    }
    return [...genres].sort()
  }, [log])

  const filteredLog = useMemo(() => {
    let rows = log
    if (genreFilter !== 'all') {
      rows = rows.filter((cycle) => cycle.reviews.some((r) => r.genreKey === genreFilter))
    }
    if (outcomeFilter !== 'all') {
      rows = rows.filter((cycle) => outcomeOf(cycle) === outcomeFilter)
    }
    if (sortMode === 'score') {
      rows = [...rows].sort((a, b) => b.averageScore - a.averageScore)
    }
    return rows
  }, [log, genreFilter, outcomeFilter, sortMode])

  function handleStart() {
    setLog([])
    void orchestrator.start(config)
  }

  const running = metrics.status === 'running'
  const paused = metrics.status === 'paused'
  const canEditConfig = metrics.status === 'idle' || metrics.status === 'stopped'

  return (
    <div className="space-y-4">
      <section className="glass-panel glass-panel-hover p-4 space-y-3">
        <h2 className="text-neon-cyan font-semibold">自動改善ループ (Auto-Loop)</h2>
        <p className="text-xs text-text-secondary">
          歌詞プロンプトをランダムなキーワードで自動生成→ルールベースで自動評価→評価が低い場合はジャンル選択の優先度や
          文章表現を小さく調整する差分を提案→検証に合格した場合のみ適用、を繰り返します。外部LLM呼び出しは行わず端末内で完結します。
          他のタブに移動しても裏で動き続けます（実際に適用された改善はページを閉じても保持されます）。
        </p>

        <div className="grid grid-cols-2 gap-2">
          {CONFIG_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="text-[11px] text-text-secondary block mb-1" htmlFor={`autoloop-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`autoloop-${field.key}`}
                type="number"
                min={field.min}
                step={field.step}
                value={config[field.key] as number}
                disabled={!canEditConfig}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, [field.key]: Number(e.target.value) || field.min }))
                }
                className="w-full input-neon px-2 py-1 text-xs"
              />
            </div>
          ))}
          <div>
            <label className="text-[11px] text-text-secondary block mb-1" htmlFor="autoloop-threshold">
              合格スコア閾値 (reviewerScoreThreshold)
            </label>
            <input
              id="autoloop-threshold"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={config.reviewerScoreThreshold}
              disabled={!canEditConfig}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, reviewerScoreThreshold: Number(e.target.value) || 0 }))
              }
              className="w-full input-neon px-2 py-1 text-xs"
            />
          </div>
        </div>

        <div className="flex gap-2">
          {!running && !paused && (
            <button
              type="button"
              onClick={handleStart}
              className="flex-1 btn-primary py-2 text-sm"
            >
              Start Auto-Loop
            </button>
          )}
          {running && (
            <button
              type="button"
              onClick={() => orchestrator.pause()}
              className="flex-1 btn-ghost py-2 text-sm"
            >
              一時停止
            </button>
          )}
          {paused && (
            <button
              type="button"
              onClick={() => orchestrator.resume()}
              className="flex-1 btn-primary py-2 text-sm"
            >
              再開
            </button>
          )}
          {(running || paused) && (
            <button
              type="button"
              onClick={() => orchestrator.stop()}
              className="flex-1 btn-danger-ghost py-2 text-sm"
            >
              Stop
            </button>
          )}
        </div>
      </section>

      <section className="glass-panel glass-panel-hover p-4">
        <h3 className="text-neon-purple text-sm font-semibold mb-2">メトリクス（このセッション）</h3>
        <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
          <div>
            状態: <span className="text-text-primary">{metrics.status}</span>
          </div>
          <div>
            サイクル数: <span className="text-text-primary">{metrics.cyclesCompleted}</span>
          </div>
          <div>
            改善適用数: <span className="text-neon-green">{metrics.improvementsApplied}</span>
          </div>
          <div>
            改善却下数: <span className="text-text-primary">{metrics.improvementsRejected}</span>
          </div>
          <div>
            連続失敗数: <span className="text-text-primary">{metrics.consecutiveFailures}</span>
          </div>
          <div>
            成功率: <span className="text-text-primary">{(metrics.successRate * 100).toFixed(0)}%</span>
          </div>
        </div>
        {metrics.lastStopReason && <p className="text-[11px] text-neon-pink mt-2">停止理由: {metrics.lastStopReason}</p>}
      </section>

      <section className="glass-panel glass-panel-hover p-4">
        <h3 className="text-neon-purple text-sm font-semibold mb-2">累計実績（端末に保存・ページを閉じても保持）</h3>
        <div className="grid grid-cols-3 gap-2 text-xs text-text-secondary">
          <div>
            累計サイクル数: <span className="text-text-primary">{lifetimeStats.totalCyclesCompleted}</span>
          </div>
          <div>
            累計適用数: <span className="text-neon-green">{lifetimeStats.totalImprovementsApplied}</span>
          </div>
          <div>
            累計却下数: <span className="text-text-primary">{lifetimeStats.totalImprovementsRejected}</span>
          </div>
        </div>
        <p className="text-[10px] text-text-muted mt-2">
          設定タブの「自己学習ループ」欄で、実際に適用済みのジャンルブースト・文章表現を確認・取り消しできます。
        </p>
      </section>

      <section className="glass-panel glass-panel-hover p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-neon-purple text-sm font-semibold">ライブログ</h3>
          <button
            type="button"
            onClick={() => downloadCSV(filteredLog)}
            disabled={filteredLog.length === 0}
            className="text-[11px] px-2 py-0.5 btn-ghost disabled:opacity-40"
          >
            CSVダウンロード
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-2">
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value)}
            aria-label="ジャンルで絞り込み"
            className="input-neon px-2 py-1 text-[11px]"
          >
            <option value="all">全ジャンル</option>
            {availableGenres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as OutcomeFilter)}
            aria-label="結果で絞り込み"
            className="input-neon px-2 py-1 text-[11px]"
          >
            <option value="all">全結果</option>
            <option value="applied">適用済みのみ</option>
            <option value="rejected">却下のみ</option>
            <option value="no-diff">提案なし</option>
          </select>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            aria-label="並び替え"
            className="input-neon px-2 py-1 text-[11px]"
          >
            <option value="time">新しい順</option>
            <option value="score">平均スコア順</option>
          </select>
        </div>

        {filteredLog.length === 0 && (
          <p className="text-xs text-text-secondary">
            {log.length === 0 ? 'まだサイクルは実行されていません。' : '絞り込み条件に一致するサイクルがありません。'}
          </p>
        )}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredLog.map((cycle) => (
            <div key={cycle.cycleIndex} className="bg-dark-lighter border border-border-neon rounded-lg p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-neon-blue">#{cycle.cycleIndex}</span>
                <span className="text-text-muted text-[10px]">{new Date(cycle.timestamp).toLocaleString()}</span>
                <span className="text-text-secondary">平均スコア {cycle.averageScore.toFixed(2)}</span>
              </div>
              {cycle.diffProposed && (
                <p className="text-[11px] text-text-secondary mt-1">
                  提案: {describeDiff(cycle.diffProposed)}
                  {' '}
                  {cycle.applied ? (
                    <span className="text-neon-green">適用済み</span>
                  ) : (
                    <span className="text-neon-pink">却下</span>
                  )}
                </p>
              )}
              {cycle.testResult && (
                <p className="text-[10px] text-text-muted mt-1">
                  検証: before {cycle.testResult.beforeScore.toFixed(2)} → after {cycle.testResult.afterScore.toFixed(2)}
                  （{cycle.testResult.reason}）
                </p>
              )}
              {cycle.testResult?.stack && (
                <details className="mt-1">
                  <summary className="text-[10px] text-neon-pink cursor-pointer">スタックトレース</summary>
                  <pre className="text-[9px] text-text-muted whitespace-pre-wrap break-all">{cycle.testResult.stack}</pre>
                </details>
              )}
              <details className="mt-1">
                <summary className="text-[10px] text-text-muted cursor-pointer">
                  候補ごとの内訳（{cycle.reviews.length}件）
                </summary>
                <div className="mt-1 space-y-1">
                  {cycle.reviews.map((review) => (
                    <div key={review.variantId} className="border-t border-border-neon pt-1 text-[10px] text-text-muted">
                      <div className="flex justify-between">
                        <span>
                          {review.variantId} / {review.genreKey}
                        </span>
                        <span>score {review.score.toFixed(2)}</span>
                      </div>
                      <div>
                        keyword {review.subScores.keyword.toFixed(2)} / hook {review.subScores.hook.toFixed(2)} / grammar{' '}
                        {review.subScores.grammar.toFixed(2)} / diversity {review.subScores.diversity.toFixed(2)}
                      </div>
                      {review.issues.length > 0 && <div className="text-neon-pink">issues: {review.issues.join(' / ')}</div>}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
