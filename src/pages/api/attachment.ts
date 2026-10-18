import type { APIRoute } from "astro"
import { getSession } from "../../lib/session"
import * as mail from "../../lib/mail"

export const prerender = false

// Attachments are always sent as downloads (never rendered inline) so a hostile HTML/SVG file cannot run on our origin.
export const GET: APIRoute = async ({ url, cookies }) => {
  const s = getSession(cookies.get("sid")?.value)
  if (!s) return new Response("Unauthorized", { status: 401 })
  const a = s.accounts[Number(url.searchParams.get("acct") ?? 0)]
  const folder = url.searchParams.get("folder") ?? ""
  const uid = Number(url.searchParams.get("uid")), i = Number(url.searchParams.get("i"))
  if (!a || !folder || !Number.isInteger(uid) || uid < 1 || !Number.isInteger(i) || i < 0) return new Response("Bad request", { status: 400 })
  try {
    const f = await mail.attachment(a.user, a.pass, folder, uid, i)
    if (!f) return new Response("Not found", { status: 404 })
    return new Response(f.content, {
      headers: {
        "content-type": f.type,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    })
  } catch (e: any) {
    console.error("[attachment]", e?.code, e?.message)
    return new Response("Could not load the attachment", { status: 500 })
  }
}
