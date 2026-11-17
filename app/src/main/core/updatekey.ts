import { createHash, createPublicKey, verify } from 'node:crypto'
import { closeSync, createReadStream, openSync, readSync } from 'node:fs'

/**
 * Подпись обновлений своим ключом (Ed25519). Закрытый ключ — только у автора, вне репозитория
 * (scripts/keygen.mjs, scripts/release.mjs). Здесь — открытый: им программа проверяет скачанный установщик.
 * Подписывается строка «crossember-update / версия / SHA-512 установщика», подпись — файл <установщик>.sig в релизе.
 * Без верной подписи обновление не ставится, даже если GitHub-аккаунт взломан и файлы в релизе подменены.
 */
export const UPDATE_PUBLIC_KEY = 'MCowBQYDK2VwAyEApYahkNyeYP0jAgE/4O+EzpLPKM/7GR7wesPI5mdqq38='

export function signedMessage(version: string, sha512: string): Buffer {
  return Buffer.from(`crossember-update\n${version}\n${sha512}`, 'utf8')
}

export function sha512File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(path).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('base64')))
  })
}

/** То же синхронно — для выхода из программы (обработчик quit не ждёт промисы). */
export function sha512FileSync(path: string): string {
  const h = createHash('sha512')
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.allocUnsafe(1 << 20)
    let n: number
    while ((n = readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n))
  } finally {
    closeSync(fd)
  }
  return h.digest('base64')
}

/** Подпись (base64) верна для этой версии и этого отпечатка файла. */
export function checkSignature(version: string, sha512: string, signature: string, publicKey = UPDATE_PUBLIC_KEY): boolean {
  try {
    const sig = Buffer.from(signature.trim(), 'base64')
    if (sig.length !== 64) return false
    const key = createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
    return verify(null, signedMessage(version, sha512), key, sig)
  } catch {
    return false
  }
}
