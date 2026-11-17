// Пишет рядом с установщиком файл .sha256 (формат sha256sum: «хэш *имя»), чтобы друзья могли сверить скачанное.
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../dist/', import.meta.url))
const files = readdirSync(dir).filter((f) => /^Crossember-Setup-.+\.exe$/.test(f))
if (!files.length) throw new Error('В dist нет установщика Crossember-Setup-*.exe')
for (const f of files) {
  const h = createHash('sha256')
  await new Promise((resolve, reject) => createReadStream(join(dir, f)).on('data', (c) => h.update(c)).on('end', resolve).on('error', reject))
  const line = `${h.digest('hex')} *${f}\n`
  writeFileSync(join(dir, f + '.sha256'), line)
  process.stdout.write(line)
}
