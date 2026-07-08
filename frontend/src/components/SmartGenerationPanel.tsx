import { useEffect, useState } from 'react'
import templatesData from '../data/templates.json'
import type { PromptTemplates } from '../types/templates'
import { getSmartGenerationLoop } from '../lib/autoLoop/smartGenerationSingleton'
import type { SmartLoopConfig, SmartLoopCycleResult, SmartLoopMetrics } from '../lib/autoLoop/smartGenerationLoop'
import { getSmartLoopAutoStart, setSmartLoopAutoStart } from '../lib/db'

const templates = templatesData as PromptTemplates

const CONFIG_FIELDS: { key: 'cycleDelayMs' | 'maxCyclesPerSession'; label: string; min: number; step: number }[] = [
  { key: 'cycleDelayMs', label: 'サイクル間隔 ms (cycleDelayMs)', min: 1000, step: 1000 },
  { key: 'maxCyclesPerSession', label: '最大サイクル数 (maxCyclesPerSession)', min: 1, step: 5 },
]

export function SmartGenerationPanel() {
  // AutoLoopPanelと同様、タブ切り替えでも裏で動き続けるモジュールレベルのシングルトンを購読する
  const loop = getSmartGenerationLoop()

  const [config, setConfig] = useState<SmartLoopConfig>(loop.getConfig())
  const [metrics, setMetrics] = useState<SmartLoopMetrics>(loop.getMetrics())
  const [log, setLog] = useState<SmartLoopCycleResult[]>(loop.getRecentLog())
  const [autoStart, setAutoStart] = useState(false)

  useEffect(() => {
    const unsubscribe = loop.subscribe(({ metrics: nextMetrics, latestCycle }) => {
      setMetrics(nextMetrics)
      if (latestCycle) setLog(loop.getRecentLog())
    })
    getSmartLoopAutoStart().then(setAutoStart).catch(() => setAutoStart(false))
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleStart() {
    setLog([])
    void loop.start(config)
  }

  async function handleToggleAutoStart(checked: boolean) {
    setAutoStart(checked)
    await setSmartLoopAutoStart(checked)
  }

  function toggleGenre(key: string) {
    setConfig((prev) => {
      const has = prev.allowedGenreKeys.includes(key)
      return {
        ...prev,
        allowedGenreKeys: has ? prev.allowedGenreKeys.filter((k) => k !== key) : [...prev.allowedGenreKeys, key],
      }
    })
  }

  const running = metrics.status === 'running'
  const canEditConfig = metrics.status === 'idle' || metrics.status === 'stopped'

  return (
    <div className="space-y-4">
      <section className="glass-panel glass-panel-hover p-4 space-y-3">
        <h2 className="text-neon-cyan font-semibold">🎯 おまかせ自動生成ループ</h2>
        <p className="text-xs text-text-secondary">
          上の自動改善ループとは別の機能です。こちらは「自動選択」と同じ相性ベースのロジックで、実際に使える
          作曲プロンプト→対になる歌詞プロンプトのペアを繰り返し生成し、履歴に保存し続けます。評価は過去の実績から
          自動で予測して付けます（「自動選択ループ」タグ付きで履歴に残るので、後から見返して手動で評価し直せます）。
          同じ組み合わせばかりにならないよう、実績を重視しつつも一定確率でジャンル・ムードなどを
          あえて広めに探索します。このループ自身の自動評価は自己学習の集計には使わないので、
          ユーザーの実評価だけが今後の傾向に反映されます。
        </p>

        <div className="grid grid-cols-2 gap-2">
          {CONFIG_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="text-[11px] text-text-secondary block mb-1" htmlFor={`smartloop-${field.key}`}>
                {field.label}
              </label>
              <input
                id={`smartloop-${field.key}`}
                type="number"
                min={field.min}
                step={field.step}
                value={config[field.key]}
                disabled={!canEditConfig}
                onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: Number(e.target.value) || field.min }))}
                className="w-full input-neon px-2 py-1 text-xs"
              />
            </div>
          ))}
        </div>

        <div>
          <p className="text-[11px] text-text-secondary mb-1">
            生成するジャンル（何も選ばなければ全ジャンルからバランス良く生成します）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {templates.genres.map((genre) => {
              const active = config.allowedGenreKeys.includes(genre.key)
              return (
                <button
                  key={genre.key}
                  type="button"
                  disabled={!canEditConfig}
                  onClick={() => toggleGenre(genre.key)}
                  className={`px-2 py-1 rounded-full text-[11px] border transition-colors ${
                    active
                      ? 'bg-neon-cyan/20 border-neon-cyan text-neon-cyan'
                      : 'border-border-neon text-text-secondary'
                  }`}
                >
                  {genre.label}
                </button>
              )
            })}
          </div>
          {config.allowedGenreKeys.length > 0 && (
            <button
              type="button"
              disabled={!canEditConfig}
              onClick={() => setConfig((prev) => ({ ...prev, allowedGenreKeys: [] }))}
              className="text-[10px] text-text-muted underline mt-1"
            >
              選択解除（全ジャンルに戻す）
            </button>
          )}
        </div>

        <div className="flex gap-2">
          {!running && (
            <button type="button" onClick={handleStart} className="flex-1 btn-primary py-2 text-sm">
              おまかせ自動生成を開始
            </button>
          )}
          {running && (
            <button type="button" onClick={() => loop.stop()} className="flex-1 btn-danger-ghost py-2 text-sm">
              停止
            </button>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs text-text-secondary pt-1">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => void handleToggleAutoStart(e.target.checked)}
          />
          次回パスフレーズ解除時に自動的に再開する
        </label>
        <p className="text-[10px] text-text-muted">
          ブラウザ/アプリを完全に閉じている間は動きません（Webアプリの仕組み上、暗号化の鍵をメモリ上にしか
          保持しないため）。オンにしておくと、次にこのアプリを開いてロック解除した瞬間に自動で再開します。
          ボタンを押す手間だけを省くイメージです。
        </p>
      </section>

      <section className="glass-panel glass-panel-hover p-4">
        <h3 className="text-neon-purple text-sm font-semibold mb-2">メトリクス</h3>
        <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
          <div>
            状態: <span className="text-text-primary">{metrics.status}</span>
          </div>
          <div>
            サイクル数: <span className="text-text-primary">{metrics.cyclesCompleted}</span>
          </div>
        </div>
        {metrics.lastStopReason && <p className="text-[11px] text-neon-pink mt-2">停止理由: {metrics.lastStopReason}</p>}
      </section>

      <section className="glass-panel glass-panel-hover p-4">
        <h3 className="text-neon-purple text-sm font-semibold mb-2">生成ログ</h3>
        {log.length === 0 && <p className="text-xs text-text-secondary">まだ生成されていません。</p>}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {log.map((cycle) => (
            <div key={cycle.cycleIndex} className="bg-dark-lighter border border-border-neon rounded-lg p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-neon-blue">#{cycle.cycleIndex}</span>
                <span className="text-text-muted text-[10px]">{new Date(cycle.timestamp).toLocaleString()}</span>
              </div>
              <p className="text-text-secondary mt-1">
                {cycle.genreLabel} ・ 予測評価 ★{cycle.predictedRating}
              </p>
              <p className="text-[10px] text-text-muted mt-1">履歴タブで確認・再評価できます</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
