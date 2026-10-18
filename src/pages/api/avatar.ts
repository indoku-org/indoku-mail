import type { APIRoute } from "astro"
import { getSession } from "../../lib/session"

export const prerender = false

// Sender photos come from Gravatar. We fetch them server-side so the reader's IP address is never
// sent to a third party; sessions only, and only a 64-char hash is accepted (no open proxy).
export const GET: APIRoute = async ({ url, cookies }) => {
  if (!getSession(cookies.get("sid")?.value)) return new Response(null, { status: 401 })
  const h = url.searchParams.get("h") ?? ""
  if (!/^[a-f0-9]{64}$/.test(h)) return new Response(null, { status: 400 })
  try {
    const r = await fetch(`https://gravatar.com/avatar/${h}?s=96&d=404`, { signal: AbortSignal.timeout(4000) })
    if (!r.ok) return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=86400" } })
    return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") ?? "image/jpeg", "cache-control": "private, max-age=604800" } })
  } catch {
    return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=300" } })
  }
}
