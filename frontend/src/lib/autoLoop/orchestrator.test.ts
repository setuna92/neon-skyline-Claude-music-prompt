import 'fake-indexeddb/auto'
import { deleteDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutoLoopConfig } from '../../types/autoLoop'

const DB_NAME = 'music-prompt-app'
let activeDbModule: typeof import('../db') | null = null

async function freshDb() {
  if (activeDbModule) await activeDbModule.closeDB()
  await deleteDB(DB_NAME).catch(() => {})
  vi.resetModules()
  activeDbModule = await import('../db')
  return activeDbModule
}

afterEach(async () => {
  if (activeDbModule) {
    await activeDbModule.closeDB()
    activeDbModule = null
  }
})

function baseConfig(overrides: Partial<AutoLoopConfig>): AutoLoopConfig {
  return {
    concurrencyLimit: 1,
    cycleDelayMs: 1,
    maxCyclesPerSession: 1000,
    failureThreshold: 100,
    reviewWindowSize: 1000,
    reviewerScoreThreshold: 0.6,
    maxApiCallsPerSession: 0,
    executorMode: 'mock',
    ...overrides,
  }
}

describe('AutoLoopOrchestrator', () => {
  it('runs exactly maxCyclesPerSession cycles then stops with that reason', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { AutoLoopOrchestrator } = await import('./orchestrator')

    const orchestrator = new AutoLoopOrchestrator(baseConfig({ maxCyclesPerSession: 3 }))

    await new Promise<void>((resolve) => {
      const unsubscribe = orchestrator.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void orchestrator.start()
    })

    const metrics = orchestrator.getMetrics()
    expect(metrics.cyclesCompleted).toBe(3)
    expect(metrics.lastStopReason).toContain('最大サイクル数')
  })

  it('stop() halts the loop before maxCyclesPerSession is reached', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { AutoLoopOrchestrator } = await import('./orchestrator')

    const orchestrator = new AutoLoopOrchestrator(baseConfig({ cycleDelayMs: 20 }))

    await new Promise<void>((resolve) => {
      let stopped = false
      const unsubscribe = orchestrator.subscribe(({ latestCycle }) => {
        if (latestCycle && !stopped) {
          stopped = true
          orchestrator.stop('test stop')
        }
      })
      setTimeout(() => {
        unsubscribe()
        resolve()
      }, 100)
      void orchestrator.start()
    })

    const metrics = orchestrator.getMetrics()
    expect(metrics.status).toBe('stopped')
    expect(metrics.lastStopReason).toBe('test stop')
    expect(metrics.cyclesCompleted).toBeLessThan(1000)
  })

  it('auto-stops after failureThreshold consecutive rejected diffs', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')
    const { AutoLoopOrchestrator } = await import('./orchestrator')

    // 閾値を非現実的に高くして Tester が必ず不合格になるようにし、安全停止を発火させる
    const orchestrator = new AutoLoopOrchestrator(
      baseConfig({ failureThreshold: 2, reviewWindowSize: 3, reviewerScoreThreshold: 0.999 }),
    )

    await new Promise<void>((resolve) => {
      const unsubscribe = orchestrator.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void orchestrator.start()
    })

    const metrics = orchestrator.getMetrics()
    expect(metrics.consecutiveFailures).toBeGreaterThanOrEqual(2)
    expect(metrics.lastStopReason).toContain('連続')
  }, 10000)

  it('applies a passing diff via db.addTemplateOverride and increments improvementsApplied', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    // ヒューリスティックスコアは入力のランダム性に左右され「必ず合格する」閾値を
    // 決定的に選べないため、Improver/Tester をモックして合格ケースを直接再現する。
    vi.doMock('./improver', () => ({
      proposeDiff: () => ({
        kind: 'ranking',
        id: 'forced',
        category: 'genreKey',
        key: 'jrock',
        delta: 5,
        reason: 'forced for test',
      }),
    }))
    vi.doMock('./tester', () => ({
      testDiff: () => ({ passed: true, beforeScore: 0.3, afterScore: 0.9, reason: 'forced pass' }),
    }))

    const { AutoLoopOrchestrator } = await import('./orchestrator')
    const orchestrator = new AutoLoopOrchestrator(baseConfig({ reviewWindowSize: 3, maxCyclesPerSession: 1 }))

    await new Promise<void>((resolve) => {
      const unsubscribe = orchestrator.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void orchestrator.start()
    })

    const metrics = orchestrator.getMetrics()
    expect(metrics.improvementsApplied).toBe(1)

    const overrides = await db.getTemplateOverrides()
    expect(overrides).toHaveLength(1)
    expect(overrides[0].key).toBe('jrock')

    vi.doUnmock('./improver')
    vi.doUnmock('./tester')
  })

  it('applies a passing text-mutation diff via db.addTextMutation', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    vi.doMock('./improver', () => ({
      proposeDiff: () => ({
        kind: 'textMutation',
        id: 'forced-mutation',
        mutationType: 'hookPhrase',
        value: 'ねえ、聞いて――',
        reason: 'forced for test',
      }),
    }))
    vi.doMock('./tester', () => ({
      testDiff: () => ({ passed: true, beforeScore: 0.3, afterScore: 0.9, reason: 'forced pass' }),
    }))

    const { AutoLoopOrchestrator } = await import('./orchestrator')
    const orchestrator = new AutoLoopOrchestrator(baseConfig({ reviewWindowSize: 3, maxCyclesPerSession: 1 }))

    await new Promise<void>((resolve) => {
      const unsubscribe = orchestrator.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void orchestrator.start()
    })

    const metrics = orchestrator.getMetrics()
    expect(metrics.improvementsApplied).toBe(1)

    const mutations = await db.getTextMutations()
    expect(mutations).toHaveLength(1)
    expect(mutations[0].type).toBe('hookPhrase')
    expect(mutations[0].value).toBe('ねえ、聞いて――')

    vi.doUnmock('./improver')
    vi.doUnmock('./tester')
  })

  it('mines a high-rated unknown keyword from history and persists it via db.addDiscoveredKeyword', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    // どのプールにも無い手入力キーワードが高評価で2回使われた履歴を用意する
    const UNKNOWN = '深夜のコンビニ帰り'
    for (const rating of [5, 4]) {
      const entry = await db.addHistoryEntry({
        kind: 'composition',
        input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [], themeKeywords: [UNKNOWN] },
        variants: [],
        tags: [],
      })
      await db.updateHistoryEntry(entry.id, { rating })
    }

    // Testerだけモックして検証を確実に通す（マイニング→提案→適用の経路自体を検証したい）
    vi.doMock('./tester', () => ({
      testDiff: () => ({ passed: true, beforeScore: 0.5, afterScore: 0.8, reason: 'forced pass' }),
    }))

    const { AutoLoopOrchestrator } = await import('./orchestrator')
    const orchestrator = new AutoLoopOrchestrator(baseConfig({ reviewWindowSize: 3, maxCyclesPerSession: 1 }))

    await new Promise<void>((resolve) => {
      const unsubscribe = orchestrator.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void orchestrator.start()
    })

    expect(orchestrator.getMetrics().improvementsApplied).toBe(1)

    const discovered = await db.getDiscoveredKeywords()
    expect(discovered).toHaveLength(1)
    expect(discovered[0].word).toBe(UNKNOWN)
    expect(discovered[0].source).toBe('history')

    vi.doUnmock('./tester')
  })

  it('learns a mood association from history and persists it via db.addKeywordAssociation', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const WORD = '深夜のコンビニ帰り'
    for (const rating of [5, 4]) {
      const entry = await db.addHistoryEntry({
        kind: 'composition',
        input: {
          genreKey: 'pop',
          instrumentKeys: [],
          atmosphereKeys: [],
          moodKey: 'late_night_drive',
          themeKeywords: [WORD],
        },
        variants: [],
        tags: [],
      })
      await db.updateHistoryEntry(entry.id, { rating })
    }

    vi.doMock('./tester', () => ({
      testDiff: () => ({ passed: true, beforeScore: 0.5, afterScore: 0.8, reason: 'forced pass' }),
    }))

    const { AutoLoopOrchestrator } = await import('./orchestrator')
    // WORDは未知語のため discoveryCandidates にも association candidates にも同時に載る。
    // pendingDiffQueue は discovery → association → demotion の順に積まれ、1サイクルにつき
    // 1件しか消費しないため、両方が処理されるまで2サイクル分回す。
    const orchestrator = new AutoLoopOrchestrator(baseConfig({ reviewWindowSize: 3, maxCyclesPerSession: 2 }))

    await new Promise<void>((resolve) => {
      const unsubscribe = orchestrator.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void orchestrator.start()
    })

    expect(orchestrator.getMetrics().improvementsApplied).toBe(2)

    const associations = await db.getKeywordAssociations()
    expect(associations).toHaveLength(1)
    expect(associations[0].word).toBe(WORD)
    expect(associations[0].contextType).toBe('mood')
    expect(associations[0].contextKey).toBe('late_night_drive')

    vi.doUnmock('./tester')
  })

  it('demotes a consistently low-rated keyword from history and persists it via db.addDemotedKeyword', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    const WORD = '微妙な語'
    for (const rating of [2, 2, 3]) {
      const entry = await db.addHistoryEntry({
        kind: 'composition',
        input: { genreKey: 'pop', instrumentKeys: [], atmosphereKeys: [], themeKeywords: [WORD] },
        variants: [],
        tags: [],
      })
      await db.updateHistoryEntry(entry.id, { rating })
    }

    const { AutoLoopOrchestrator } = await import('./orchestrator')
    const orchestrator = new AutoLoopOrchestrator(baseConfig({ reviewWindowSize: 3, maxCyclesPerSession: 1 }))

    await new Promise<void>((resolve) => {
      const unsubscribe = orchestrator.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void orchestrator.start()
    })

    // 降格はテキスト再生成の検証を経ずに即時合格するため、モック不要で適用される
    expect(orchestrator.getMetrics().improvementsApplied).toBe(1)

    const demoted = await db.getDemotedKeywords()
    expect(demoted).toHaveLength(1)
    expect(demoted[0].word).toBe(WORD)
  })

  it('learns a tempo hint from composition history and persists it via db.addTempoHint', async () => {
    const db = await freshDb()
    await db.unlockWithPassphrase('test-passphrase')

    for (const rating of [5, 4]) {
      const entry = await db.addHistoryEntry({
        kind: 'composition',
        input: { genreKey: 'jrock', instrumentKeys: [], atmosphereKeys: [], tempo: 128, themeKeywords: [] },
        variants: [],
        tags: [],
      })
      await db.updateHistoryEntry(entry.id, { rating })
    }

    const { AutoLoopOrchestrator } = await import('./orchestrator')
    const orchestrator = new AutoLoopOrchestrator(baseConfig({ reviewWindowSize: 3, maxCyclesPerSession: 1 }))

    await new Promise<void>((resolve) => {
      const unsubscribe = orchestrator.subscribe(({ metrics }) => {
        if (metrics.status === 'stopped') {
          unsubscribe()
          resolve()
        }
      })
      void orchestrator.start()
    })

    // テンポ学習も生成品質の再検証を経ずに即時合格するため、モック不要で適用される
    expect(orchestrator.getMetrics().improvementsApplied).toBe(1)

    const hints = await db.getTempoHints()
    expect(hints).toHaveLength(1)
    expect(hints[0].genreKey).toBe('jrock')
    expect(hints[0].tempo).toBe(128)
  })
})
