import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

// Stateless session: credentials of every signed-in account live in ONE AES-256-GCM encrypted,
// httpOnly cookie. Required for Vercel (serverless: no shared memory between requests).
// Which account a request acts on is chosen by its index (/u/<n>/...), like Gmail.
const TTL = 1000 * 60 * 60 * 8
export const MAX_ACCOUNTS = 5
export type Account = { user: string; pass: string }

const key = () => {
  const s = process.env.SESSION_SECRET ?? ""
  if (s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)")
  return createHash("sha256").update(s).digest()
}

export const createSession = (accounts: Account[]) => {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key(), iv)
  const ct = Buffer.concat([c.update(JSON.stringify({ a: accounts, exp: Date.now() + TTL }), "utf8"), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url")
}

export const getSession = (token?: string): { accounts: Account[] } | null => {
  if (!token) return null
  try {
    const b = Buffer.from(token, "base64url")
    const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12))
    d.setAuthTag(b.subarray(12, 28))
    const s = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"))
    if (!(s.exp > Date.now())) return null
    // Older single-account cookies: { user, pass, exp }
    const accounts: Account[] = Array.isArray(s.a) ? s.a : s.user ? [{ user: s.user, pass: s.pass }] : []
    return accounts.length ? { accounts } : null
  } catch { return null }
}

// Adds (or refreshes the password of) an account. Returns null when the limit is reached.
export const addAccount = (cur: Account[], a: Account): { accounts: Account[]; index: number } | null => {
  const i = cur.findIndex((x) => x.user === a.user)
  if (i >= 0) { const next = cur.slice(); next[i] = a; return { accounts: next, index: i } }
  if (cur.length >= MAX_ACCOUNTS) return null
  return { accounts: [...cur, a], index: cur.length }
}

// Best-effort per instance (serverless): 5 failed logins / 10 min / IP.
const fails: Map<string, number[]> = ((globalThis as any).__mailFails ??= new Map())
export const tooMany = (ip: string) => (fails.get(ip) ?? []).filter((t) => t > Date.now() - 6e5).length >= 5
export const noteFail = (ip: string) => fails.set(ip, [...(fails.get(ip) ?? []).filter((t) => t > Date.now() - 6e5), Date.now()])
