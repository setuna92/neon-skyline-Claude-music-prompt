import { copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const files = [
  ['templates.json', 'templates.json'],
  [join('genreKeywords', 'genreKeywords.json'), 'genreKeywords.json'],
  ['selectionKeywords.json', 'selectionKeywords.json'],
]

for (const [src, dest] of files) {
  const source = join(here, '..', '..', 'prompts', src)
  const destination = join(here, '..', 'src', 'data', dest)
  copyFileSync(source, destination)
  console.log(`Synced ${source} -> ${destination}`)
}
