// Выпуск обновления: npm run release — собирает установщик и создаёт релиз v<версия> на GitHub (нужен вход в gh).
// Перед запуском: поднять "version" в package.json и написать release-notes.md — пункты «- …», их увидят друзья в окне «Что нового».
import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const app = fileURLToPath(new URL('..', import.meta.url))
const { version } = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
const notes = join(app, 'release-notes.md')
if (!existsSync(notes) || !/^\s*[-*]\s+\S/m.test(readFileSync(notes, 'utf8'))) throw new Error('Нужен release-notes.md с пунктами «- что изменилось»')
// «Справка → Что нового» в самой программе должна знать про эту версию.
if (!readFileSync(join(app, 'src/renderer/src/changelog.ts'), 'utf8').includes(`version: '${version}'`)) throw new Error(`Нет записи о версии ${version} в src/renderer/src/changelog.ts`)
if (!existsSync(join(app, 'resources/youtube/oauth-client.json'))) throw new Error('Нет resources/youtube/oauth-client.json — у друзей не будет входа в YouTube')
// Ключ подписи обновлений (scripts/keygen.mjs). Без него не выпускаем: программа друзей не поставит неподписанное.
const keyPath = process.env.CROSSEMBER_SIGN_KEY || join(homedir(), '.crossember', 'update-signing.pem')
if (!existsSync(keyPath)) throw new Error('Нет ключа подписи обновлений (~/.crossember/update-signing.pem) — восстановите из резервной копии')
const privateKey = createPrivateKey(readFileSync(keyPath))
const pub = /UPDATE_PUBLIC_KEY = '([A-Za-z0-9+/=]+)'/.exec(readFileSync(join(app, 'src/main/core/updatekey.ts'), 'utf8'))?.[1]
if (!pub || createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).toString('base64') !== pub) throw new Error('Ключ подписи не совпадает с открытым ключом в updatekey.ts')

// Релиз должен соответствовать коду на GitHub: чистое дерево, коммит уже отправлен, тег ставится именно на него.
const git = (...a) => execFileSync('git', a, { cwd: app, encoding: 'utf8' }).trim()
if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('Есть незакоммиченные изменения — сначала коммит и push')
git('fetch', 'origin')
const sha = git('rev-parse', 'HEAD')
if (!git('branch', '-r', '--contains', sha)) throw new Error('Текущий коммит не отправлен на GitHub — сначала git push')

const run = (cmd, args) => execFileSync(cmd, args, { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' })
run('npm', ['run', 'dist'])
const exe = `Crossember-Setup-${version}.exe`
// Подпись: «crossember-update / версия / SHA-512 установщика» (формат — signedMessage в updatekey.ts).
const sha512 = createHash('sha512').update(readFileSync(join(app, 'dist', exe))).digest('base64')
const message = Buffer.from(['crossember-update', version, sha512].join('\n'), 'utf8')
const signature = sign(null, message, privateKey)
if (!verify(null, message, createPublicKey({ key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' }), signature)) throw new Error('Подпись не проверилась')
writeFileSync(join(app, 'dist', `${exe}.sig`), signature.toString('base64'))
const files = [exe, `${exe}.blockmap`, `${exe}.sha256`, `${exe}.sig`, 'latest.yml'].map((f) => join(app, 'dist', f))
for (const f of files) if (!existsSync(f)) throw new Error(`Нет файла ${f}`)
run('gh', ['release', 'create', `v${version}`, ...files, '--repo', 'erronsivors/Crossember', '--target', sha, '--title', `Crossember ${version}`, '--notes-file', notes])
