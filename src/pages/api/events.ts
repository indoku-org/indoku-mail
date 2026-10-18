import type { APIRoute } from "astro"
import { getSession } from "../../lib/session"
import * as mail from "../../lib/mail"

export const prerender = false

// Server-Sent Events: pushes "new" / "change" when the Inbox changes (IMAP IDLE). One short-lived stream per open tab;
// the browser reconnects automatically. Session cookie required, and it only ever watches the signed-in account's INBOX.
export const GET: APIRoute = async ({ url, cookies, request }) => {
  const s = getSession(cookies.get("sid")?.value)
  if (!s) return new Response("Unauthorized", { status: 401 })
  const a = s.accounts[Number(url.searchParams.get("acct") ?? 0)]
  if (!a) return new Response("Not found", { status: 404 })
  const secs = Math.min(55, Math.max(10, Number(import.meta.env.IDLE_SECONDS ?? process.env.IDLE_SECONDS ?? 25)))
  return new Response(mail.watch(a.user, a.pass, secs, request.signal), {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  })
}
