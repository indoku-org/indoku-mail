import type { APIRoute } from "astro"
import { MAX_ACCOUNTS, addAccount, createSession, getSession, noteFail, tooMany } from "../../lib/session"
import * as mail from "../../lib/mail"

export const prerender = false

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })
const cookieOpts = () => ({ httpOnly: true, sameSite: "strict" as const, secure: import.meta.env.PROD, path: "/", maxAge: 28800 })
const str = (v: unknown) => String(v ?? "")
const MAX_UPLOAD = 3 * 1024 * 1024 // raw bytes across all files (Vercel caps request bodies at ~4.5 MB, base64 adds 33%)
const uploads = (v: unknown): mail.Upload[] => {
  if (!Array.isArray(v)) return []
  const out = v.slice(0, 10).map((x: any) => ({ filename: str(x?.filename).slice(0, 200) || "attachment", content: str(x?.content), type: str(x?.type) || undefined }))
  if (out.reduce((n, a) => n + (a.content.length * 3) / 4, 0) > MAX_UPLOAD) throw new Error("Attachments are too large (3 MB max in total).")
  return out
}
const idsOf = (b: any) => (Array.isArray(b.uids) ? b.uids.slice(0, 500).map(uidOf) : [uidOf(b.uid)])
const uidOf = (v: unknown) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new Error("Invalid message id."); return n }

export const ALL: APIRoute = async ({ request, cookies, params }) => {
  if (request.method !== "POST") return json({ error: "POST only" }, 405)
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "bad request" }, 415)
  const body: any = await request.json().catch(() => ({}))
  const route = params.path
  const sid = cookies.get("sid")?.value

  if (route === "login") {
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"
    if (tooMany(ip)) return json({ error: "Too many attempts. Try again in 10 minutes." }, 429)
    const user = str(body.user).trim().toLowerCase()
    const pass = str(body.pass)
    try {
      await mail.withImap(user, pass, async () => {})
    } catch (e: any) {
      if (e?.authenticationFailed) {
        noteFail(ip)
        return json({ error: "Incorrect email or password." }, 401)
      }
      // Connection/TLS problem, not a wrong password: surface it and keep it out of the rate limiter.
      console.error("[login] IMAP connection error:", e?.code, e?.message)
      return json({ error: "Can't reach the mail server right now. Please try again in a moment." }, 502)
    }
    // Signing in while already signed in adds the account (up to MAX_ACCOUNTS) instead of replacing the session.
    const added = addAccount(getSession(sid)?.accounts ?? [], { user, pass })
    if (!added) return json({ error: `You can be signed in to at most ${MAX_ACCOUNTS} accounts.` }, 400)
    cookies.set("sid", createSession(added.accounts), cookieOpts())
    return json({ ok: true, index: added.index })
  }

  if (route === "logout") {
    const cur = getSession(sid)?.accounts ?? []
    const idx = Number(body.acct)
    const next = body.all ? [] : cur.filter((_, i) => i !== idx)
    if (next.length) cookies.set("sid", createSession(next), cookieOpts())
    else cookies.delete("sid", { path: "/" })
    return json({ ok: true, remaining: next.length })
  }

  const s = getSession(sid)
  if (!s) return json({ error: "unauthorized" }, 401)
  const a = s.accounts[Number.isInteger(Number(body.acct)) ? Number(body.acct) : 0]
  if (!a) return json({ error: "Account not found." }, 404)

  try {
    switch (route) {
      case "me": return json({ user: a.user })
      case "folders": return json(await mail.folders(a.user, a.pass))
      case "list": return json(await mail.list(a.user, a.pass, str(body.folder) || "INBOX", Math.max(0, Number(body.page) || 0), str(body.q)))
      case "read": return json(await mail.read(a.user, a.pass, str(body.folder), uidOf(body.uid), body.images === true))
      case "delete": await mail.remove(a.user, a.pass, str(body.folder), idsOf(body)); return json({ ok: true })
      case "move": {
        if (body.to !== "archive" && body.to !== "junk" && body.to !== "inbox") return json({ error: "bad request" }, 400)
        await mail.move(a.user, a.pass, str(body.folder), idsOf(body), body.to)
        return json({ ok: true })
      }
      case "flag": {
        const arr = (v: unknown) => (Array.isArray(v) ? v.map(str) : [])
        await mail.flag(a.user, a.pass, str(body.folder), idsOf(body), arr(body.add), arr(body.remove))
        return json({ ok: true })
      }
      case "empty": {
        if (body.kind !== "trash" && body.kind !== "junk") return json({ error: "bad request" }, 400)
        return json(await mail.empty(a.user, a.pass, body.kind))
      }
      case "contacts": return json(await mail.contacts(a.user, a.pass))
      case "draft-save": {
        const r = await mail.saveDraft(a.user, a.pass, { to: str(body.to), cc: str(body.cc), bcc: str(body.bcc), subject: str(body.subject), text: str(body.text), html: str(body.html), inReplyTo: body.inReplyTo, references: body.references, replace: body.replace ? uidOf(body.replace) : undefined })
        return json(r)
      }
      case "draft-delete": await mail.deleteDraft(a.user, a.pass, uidOf(body.uid)); return json({ ok: true })
      case "send":
        await mail.send(a.user, a.pass, { to: str(body.to), cc: str(body.cc), bcc: str(body.bcc), subject: str(body.subject), text: str(body.text), html: str(body.html), inReplyTo: body.inReplyTo, references: body.references, draftUid: body.draftUid ? uidOf(body.draftUid) : undefined, attachments: uploads(body.attachments) })
        return json({ ok: true })
      default: return json({ error: "not found" }, 404)
    }
  } catch (e: any) {
    console.error(`[api/${route}]`, e?.code, e?.message)
    return json({ error: e?.message || "server error" }, 500)
  }
}
