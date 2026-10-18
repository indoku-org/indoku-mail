import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

// Stateless session: credentials live in an AES-256-GCM encrypted, httpOnly cookie.
// Required for Vercel (serverless: no shared memory between requests).
const TTL = 1000 * 60 * 60 * 8
const key = () => {
  const s = process.env.SESSION_SECRET ?? ""
  if (s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)")
  return createHash("sha256").update(s).digest()
}

export const createSession = (user: string, pass: string) => {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key(), iv)
  const ct = Buffer.concat([c.update(JSON.stringify({ user, pass, exp: Date.now() + TTL }), "utf8"), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url")
}

export const getSession = (token?: string): { user: string; pass: string } | null => {
  if (!token) return null
  try {
    const b = Buffer.from(token, "base64url")
    const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12))
    d.setAuthTag(b.subarray(12, 28))
    const s = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"))
    return s.exp > Date.now() ? s : null
  } catch { return null }
}

export const destroySession = (_token?: string) => {} // cookie deletion handles logout

// Best-effort per instance (serverless): 5 failed logins / 10 min / IP.
const fails: Map<string, number[]> = ((globalThis as any).__mailFails ??= new Map())
export const tooMany = (ip: string) => (fails.get(ip) ?? []).filter((t) => t > Date.now() - 6e5).length >= 5
export const noteFail = (ip: string) => fails.set(ip, [...(fails.get(ip) ?? []).filter((t) => t > Date.now() - 6e5), Date.now()])
