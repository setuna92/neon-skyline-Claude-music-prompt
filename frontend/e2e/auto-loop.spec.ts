import { test, expect } from '@playwright/test'

test('auto-loop: start completes cycles and stops at maxCyclesPerSession', async ({ page }) => {
  await page.goto('/')

  await page.locator('#passphrase').fill('e2e-autoloop-passphrase')
  await page.locator('#passphrase-confirm').fill('e2e-autoloop-passphrase')
  await page.getByRole('button', { name: '設定して開始' }).click()
  await expect(page.getByRole('heading', { name: 'AI音楽プロンプトジェネレーター' })).toBeVisible()

  await page.getByRole('button', { name: '自動ループ' }).click()
  await expect(page.getByRole('heading', { name: '自動改善ループ (Auto-Loop)' })).toBeVisible()

  // 短時間で完走するように設定を調整
  await page.locator('#autoloop-cycleDelayMs').fill('50')
  await page.locator('#autoloop-maxCyclesPerSession').fill('3')
  await page.locator('#autoloop-reviewWindowSize').fill('3')

  await page.getByRole('button', { name: 'Start Auto-Loop' }).click()

  // 実行中は Pause/Stop ボタンが出る
  await expect(page.getByRole('button', { name: '一時停止' })).toBeVisible()

  // 最大サイクル数に到達して自動停止するまで待つ
  await expect(page.getByText('状態:').locator('..')).toContainText('stopped', { timeout: 15_000 })
  await expect(page.getByText(/^サイクル数:\s*3/)).toBeVisible()
  await expect(page.getByText('最大サイクル数に到達しました')).toBeVisible()

  // ライブログに3件分のサイクル結果が出ている
  await expect(page.locator('main').getByText(/^#\d+$/)).toHaveCount(3)
})

test('auto-loop: pause halts progress and stop ends the run', async ({ page }) => {
  await page.goto('/')

  await page.locator('#passphrase').fill('e2e-autoloop-passphrase-2')
  await page.locator('#passphrase-confirm').fill('e2e-autoloop-passphrase-2')
  await page.getByRole('button', { name: '設定して開始' }).click()
  await expect(page.getByRole('heading', { name: 'AI音楽プロンプトジェネレーター' })).toBeVisible()

  await page.getByRole('button', { name: '自動ループ' }).click()
  await page.locator('#autoloop-cycleDelayMs').fill('50')
  await page.locator('#autoloop-maxCyclesPerSession').fill('1000')

  await page.getByRole('button', { name: 'Start Auto-Loop' }).click()
  await page.getByRole('button', { name: '一時停止' }).click()
  await expect(page.getByText('状態:').locator('..')).toContainText('paused')

  const cyclesWhilePaused = await page.getByText(/^サイクル数:/).textContent()
  await page.waitForTimeout(300)
  await expect(page.getByText(/^サイクル数:/)).toHaveText(cyclesWhilePaused ?? '')

  await page.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByText('状態:').locator('..')).toContainText('stopped')
})

test('auto-loop: keeps running in the background when switching tabs away and back', async ({ page }) => {
  await page.goto('/')

  await page.locator('#passphrase').fill('e2e-autoloop-passphrase-3')
  await page.locator('#passphrase-confirm').fill('e2e-autoloop-passphrase-3')
  await page.getByRole('button', { name: '設定して開始' }).click()
  await expect(page.getByRole('heading', { name: 'AI音楽プロンプトジェネレーター' })).toBeVisible()

  await page.getByRole('button', { name: '自動ループ' }).click()
  await page.locator('#autoloop-cycleDelayMs').fill('50')
  await page.locator('#autoloop-maxCyclesPerSession').fill('1000')
  await page.getByRole('button', { name: 'Start Auto-Loop' }).click()

  // 数サイクル進んだのを確認してから、別タブへ移動(AutoLoopPanelはアンマウントされる)
  await expect
    .poll(async () => Number((await page.getByText(/^サイクル数:/).textContent())?.match(/\d+/)?.[0] ?? 0))
    .toBeGreaterThan(0)

  await page.getByRole('button', { name: '履歴', exact: true }).click()
  await page.waitForTimeout(500)

  // 自動ループタブに戻ると、稼働中のまま・サイクル数が0にリセットされていないことを確認する
  await page.getByRole('button', { name: '自動ループ' }).click()
  await expect(page.getByText('状態:').locator('..')).toContainText('running')
  const cyclesAfterReturn = Number((await page.getByText(/^サイクル数:/).textContent())?.match(/\d+/)?.[0] ?? 0)
  expect(cyclesAfterReturn).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Stop' }).click()
})
