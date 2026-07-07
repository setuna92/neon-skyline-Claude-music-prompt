import { test, expect } from '@playwright/test'

test('composition prompt: input -> generate -> rate -> history', async ({ page }) => {
  await page.goto('/')

  // 初回起動: パスフレーズ設定
  await expect(page.getByRole('heading', { name: 'ロック解除' })).toBeVisible()
  await page.locator('#passphrase').fill('e2e-test-passphrase')
  await page.locator('#passphrase-confirm').fill('e2e-test-passphrase')
  await page.getByRole('button', { name: '設定して開始' }).click()

  await expect(page.getByRole('heading', { name: 'AI音楽プロンプトジェネレーター' })).toBeVisible()

  // ジャンル選択・テンポ入力
  await page.locator('select[size="6"]').selectOption('jrock')
  await page.locator('#tempo').fill('128')

  // 生成
  await page.getByRole('button', { name: 'プロンプトを生成' }).click()

  const articles = page.locator('main article')
  await expect(articles).toHaveCount(3)
  await expect(articles.first()).toContainText('J-Rock')

  // 1件目(標準案)を採用し、評価とタグを付ける
  await articles.first().getByRole('button', { name: 'これを採用' }).click()
  await page.getByRole('radiogroup', { name: '評価' }).getByRole('radio').nth(3).click()

  const tagsInput = page.locator('#tags-input')
  await tagsInput.fill('良かった')
  await tagsInput.blur()

  await expect(page.getByText('保存済み')).toBeVisible()

  // 履歴タブで反映を確認
  await page.getByRole('button', { name: '履歴', exact: true }).click()
  const historyArticle = page.locator('main article').first()
  await expect(historyArticle).toContainText('J-ロック')
  await expect(historyArticle).toContainText('良かった')
  await expect(historyArticle).toContainText('作曲プロンプト')
})

test('lyrics prompt: theme keywords -> generate -> copy -> history', async ({ page }) => {
  await page.goto('/')

  await page.locator('#passphrase').fill('e2e-test-passphrase-2')
  await page.locator('#passphrase-confirm').fill('e2e-test-passphrase-2')
  await page.getByRole('button', { name: '設定して開始' }).click()
  await expect(page.getByRole('heading', { name: 'AI音楽プロンプトジェネレーター' })).toBeVisible()

  await page.getByRole('button', { name: '歌詞プロンプト' }).click()

  await page.locator('select[size="6"]').selectOption('city_pop')
  await page.locator('#lyrics-theme').fill('夏, 花火, 切なさ')

  await page.getByRole('button', { name: '歌詞プロンプトを生成' }).click()

  const articles = page.locator('main article')
  await expect(articles).toHaveCount(3)
  await expect(articles.first()).toContainText('シティポップ')
  await expect(articles.first()).toContainText('夏、花火、切なさ')

  await page.getByRole('button', { name: '履歴', exact: true }).click()
  const historyArticle = page.locator('main article').first()
  await expect(historyArticle).toContainText('歌詞プロンプト')
  await expect(historyArticle).toContainText('シティポップ')
})

test('lyrics prompt: genre-specific keyword suggestions merge into the theme keywords', async ({ page }) => {
  await page.goto('/')

  await page.locator('#passphrase').fill('e2e-test-passphrase-3')
  await page.locator('#passphrase-confirm').fill('e2e-test-passphrase-3')
  await page.getByRole('button', { name: '設定して開始' }).click()
  await expect(page.getByRole('heading', { name: 'AI音楽プロンプトジェネレーター' })).toBeVisible()

  await page.getByRole('button', { name: '歌詞プロンプト' }).click()

  // 語彙バンクを持つ新ジャンル(51ジャンルの1つ)を選ぶと候補チップが出る
  await page.locator('select[size="6"]').selectOption('emo_electronic_rock_x_drumnbass')
  await expect(page.getByText('選択内容に応じたキーワード候補です')).toBeVisible()

  await page.getByRole('button', { name: '壊れないで', exact: true }).click()
  await page.locator('#lyrics-theme').fill('夏')

  await page.getByRole('button', { name: '歌詞プロンプトを生成' }).click()

  const articles = page.locator('main article')
  await expect(articles).toHaveCount(3)
  await expect(articles.first()).toContainText('夏、壊れないで')

  // 語彙バンクを持たない既存ジャンルに切り替えると候補セクション自体が消える
  await page.locator('select[size="6"]').selectOption('pop')
  await expect(page.getByText('選択内容に応じたキーワード候補です')).toHaveCount(0)

  // ただしムードを選ぶと、ジャンルバンクが無くてもムード連想語グループが出る
  await page.locator('#lyrics-mood').selectOption('late_night_drive')
  await expect(page.getByText('ムード「深夜ドライブ」の連想語')).toBeVisible()
  await page.getByRole('button', { name: 'ヘッドライト', exact: true }).click()

  await page.getByRole('button', { name: '歌詞プロンプトを生成' }).click()
  await expect(page.locator('main article').first()).toContainText('ヘッドライト')
})

test('composition prompt: genre-specific keyword suggestions merge into the generated prompt', async ({ page }) => {
  await page.goto('/')

  await page.locator('#passphrase').fill('e2e-test-passphrase-4')
  await page.locator('#passphrase-confirm').fill('e2e-test-passphrase-4')
  await page.getByRole('button', { name: '設定して開始' }).click()
  await expect(page.getByRole('heading', { name: 'AI音楽プロンプトジェネレーター' })).toBeVisible()

  // 作曲タブ(初期表示)で語彙バンクを持つジャンルを選ぶと候補チップが出る
  await page.locator('select[size="6"]').selectOption('emo_electronic_rock_x_drumnbass')
  await expect(page.getByText('選択内容に応じたキーワード候補です')).toBeVisible()
  // 作曲プロンプト向けにはプロダクション指示語カテゴリも表示される
  await expect(page.getByText('プロダクション指示語')).toBeVisible()

  await page.getByRole('button', { name: 'distorted guitar riff', exact: true }).click()
  await page.locator('#composition-theme').fill('夜のドライブ')

  await page.getByRole('button', { name: 'プロンプトを生成' }).click()

  const articles = page.locator('main article')
  await expect(articles).toHaveCount(3)
  await expect(articles.first()).toContainText('夜のドライブ')
  await expect(articles.first()).toContainText('distorted guitar riff')
})
