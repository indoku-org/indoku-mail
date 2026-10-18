export type Folder = { path: string; name: string; use: string; total: number; unseen: number }
export type Item = { uid: number; subject: string; from: string; email: string; avatar: string; att: boolean; date: string; seen: boolean; flagged: boolean }
export type Att = { i: number; filename: string; type: string; size: number }
export type Msg = {
  subject: string; from: string; fromName: string; fromEmail: string; avatar: string; replyTo: string
  to: string; toList: string[]; cc: string; ccList: string[]; bccList: string[]
  date: string; html: string; text: string; messageId?: string; inReplyTo?: string; references?: any
  images: boolean; blockedImages: number; attachments: Att[]; flagged: boolean
}
export type Draft = { to: string; cc: string; bcc: string; subject: string; text: string; html?: string; inReplyTo?: string; references?: any; uid?: number }
export type Api = (path: string, body?: object) => Promise<any>

// Every call names the account it acts on (the /u/<n>/ index), so tabs can use different accounts at once.
export const makeApi = (acct: number): Api => async (path, body = {}) => {
  const r = await fetch("/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, acct }) })
  if (r.status === 401) { location.href = "/login"; throw new Error("Session expired") }
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.error || "Something went wrong")
  return d
}

export const fmt = (d: string) => {
  const t = new Date(d), n = new Date()
  if (t.toDateString() === n.toDateString()) return t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return t.toLocaleDateString("en-US", t.getFullYear() === n.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" })
}
export const fmtFull = (d: string) => new Date(d).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)

// Stable colour per sender, so the same person always gets the same avatar.
export const hue = (s: string) => { let h = 0; for (const ch of s.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360; return h }
export const addrOf = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim().toLowerCase()

export const slug = (path: string) => (path.toUpperCase() === "INBOX" ? "inbox" : encodeURIComponent(path))
export const unslug = (s: string) => (s.toLowerCase() === "inbox" ? "INBOX" : decodeURIComponent(s))

const KEY = "mail:images-ok"
export const loadImgOk = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")) } catch { return new Set() } }
export const saveImgOk = (s: Set<string>) => { try { localStorage.setItem(KEY, JSON.stringify([...s])) } catch { /* private mode */ } }

// ---------- per-browser preferences (the server is stateless, so these live in localStorage) ----------
const ls = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const lset = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }

export type Contact = { name: string; email: string }
export const loadContacts = (u: string): { list: Contact[]; fresh: boolean } => {
  try { const x = JSON.parse(ls(`mail:contacts:${u}`) || "null"); return x ? { list: x.list, fresh: Date.now() - x.ts < 864e5 } : { list: [], fresh: false } } catch { return { list: [], fresh: false } }
}
export const saveContacts = (u: string, list: Contact[]) => lset(`mail:contacts:${u}`, JSON.stringify({ ts: Date.now(), list }))

export const getSig = (u: string) => ls(`mail:sig:${u}`) ?? ""
export const setSig = (u: string, v: string) => lset(`mail:sig:${u}`, v)

export const notifDismissed = () => ls("mail:notif-dismissed") === "1"
export const dismissNotif = () => lset("mail:notif-dismissed", "1")

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
export const textToHtml = (s: string) => esc(s).replace(/\n/g, "<br>")
