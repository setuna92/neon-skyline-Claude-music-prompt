import { describe, expect, it } from 'vitest'
import { decryptJSON, deriveKey, encryptJSON, fromBase64, generateSalt, toBase64 } from './crypto'

describe('base64 helpers', () => {
  it('round-trips arbitrary byte arrays', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64))
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
})

describe('deriveKey + encryptJSON + decryptJSON', () => {
  it('encrypts and decrypts a JSON payload with the same passphrase and salt', async () => {
    const salt = generateSalt()
    const key = await deriveKey('correct horse battery staple', salt)

    const data = { hello: 'world', numbers: [1, 2, 3] }
    const payload = await encryptJSON(key, data)

    expect(payload.iv).toBeTruthy()
    expect(payload.ciphertext).toBeTruthy()

    const decrypted = await decryptJSON<typeof data>(key, payload)
    expect(decrypted).toEqual(data)
  })

  it('produces ciphertext that does not contain the plaintext', async () => {
    const salt = generateSalt()
    const key = await deriveKey('passphrase', salt)
    const payload = await encryptJSON(key, { secret: 'do-not-leak-this-text' })
    expect(payload.ciphertext).not.toContain('do-not-leak-this-text')
  })

  it('fails to decrypt with the wrong passphrase', async () => {
    const salt = generateSalt()
    const correctKey = await deriveKey('correct-passphrase', salt)
    const wrongKey = await deriveKey('wrong-passphrase', salt)

    const payload = await encryptJSON(correctKey, { data: 'sensitive' })
    await expect(decryptJSON(wrongKey, payload)).rejects.toThrow()
  })

  it('fails to decrypt with a different salt (different derived key)', async () => {
    const key1 = await deriveKey('same-passphrase', generateSalt())
    const key2 = await deriveKey('same-passphrase', generateSalt())

    const payload = await encryptJSON(key1, { data: 'sensitive' })
    await expect(decryptJSON(key2, payload)).rejects.toThrow()
  })
})
