import type { APIRoute } from "astro"
import { createSession, destroySession, getSession, noteFail, tooMany } from "../../lib/session"
import * as mail from "../../lib/mail"

export const prerender = false

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } })

export const ALL: APIRoute = async ({ request, cookies, params }) => {
  if (request.method !== "POST") return json({ error: "POST only" }, 405)
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "bad request" }, 415)
  const body: any = await request.json().catch(() => ({}))
  const route = params.path

  if (route === "login") {
    const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local"
    if (tooMany(ip)) return json({ error: "Too many attempts. Try again in 10 minutes." }, 429)
    const user = String(body.user ?? "").trim().toLowerCase()
    const pass = String(body.pass ?? "")
    try {
      await mail.withImap(user, pass, async () => {})
    } catch {
      noteFail(ip)
      return json({ error: "Incorrect email or password." }, 401)
    }
    cookies.set("sid", createSession(user, pass), { httpOnly: true, sameSite: "strict", secure: import.meta.env.PROD, path: "/", maxAge: 28800 })
    return json({ ok: true })
  }

  const sid = cookies.get("sid")?.value
  if (route === "logout") { destroySession(sid); cookies.delete("sid", { path: "/" }); return json({ ok: true }) }

  const s = getSession(sid)
  if (!s) return json({ error: "unauthorized" }, 401)
  try {
    switch (route) {
      case "me": return json({ user: s.user })
      case "folders": return json(await mail.folders(s.user, s.pass))
      case "list": return json(await mail.list(s.user, s.pass, String(body.folder || "INBOX"), +body.page || 0))
      case "read": return json(await mail.read(s.user, s.pass, String(body.folder), +body.uid))
      case "delete": await mail.remove(s.user, s.pass, String(body.folder), +body.uid); return json({ ok: true })
      case "send": await mail.send(s.user, s.pass, { to: String(body.to), subject: String(body.subject || ""), text: String(body.text || ""), inReplyTo: body.inReplyTo, references: body.references }); return json({ ok: true })
      default: return json({ error: "not found" }, 404)
    }
  } catch (e: any) {
    return json({ error: e?.message || "server error" }, 500)
  }
}
