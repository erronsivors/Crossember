// Создать ключ подписи обновлений (один раз): node scripts/keygen.mjs
// Закрытый ключ — в ~/.crossember/update-signing.pem (или путь из CROSSEMBER_SIGN_KEY), вне репозитория.
// Открытый ключ печатается — его вставляют в src/main/core/updatekey.ts.
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const path = process.env.CROSSEMBER_SIGN_KEY || join(homedir(), '.crossember', 'update-signing.pem')
if (existsSync(path)) {
  console.error('Ключ уже есть — не перезаписываю. Новый ключ сломает обновления у тех, кто уже установил программу.')
  process.exit(1)
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519')
mkdirSync(dirname(path), { recursive: true })
writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' })
console.log('Закрытый ключ сохранён (сделайте резервную копию, в Git не класть).')
console.log('Открытый ключ для updatekey.ts:')
console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))
