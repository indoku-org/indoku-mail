import { createHash, randomUUID } from "node:crypto"
import { ImapFlow } from "imapflow"
import nodemailer from "nodemailer"
import MailComposer from "nodemailer/lib/mail-composer"
import { simpleParser } from "mailparser"
import sanitizeHtml from "sanitize-html"

const env = (k: string, d: string) => process.env[k] ?? d
const PAGE = 30

export async function withImap<T>(user: string, pass: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = new ImapFlow({
    host: env("IMAP_HOST", "server.griv.co.id"),
    port: +env("IMAP_PORT", "993"),
    secure: env("IMAP_SECURE", "true") !== "false", // "false" is only for local test servers
    auth: { user, pass },
    logger: false,
  })
  c.on("error", () => {})
  await c.connect()
  try { return await fn(c) } finally { await c.logout().catch(() => {}) }
}

// ---------- helpers ----------
type Addr = { name?: string; address?: string }
const flat = (a: any): Addr[] => (Array.isArray(a) ? a.flatMap((x) => x.value) : a?.value ?? [])
const fmtAddr = (x: Addr) => (x.name ? `${x.name} <${x.address}>` : x.address ?? "")
// Gravatar's current scheme: SHA-256 of the trimmed, lower-cased address.
const avatarHash = (email?: string) => (email ? createHash("sha256").update(email.trim().toLowerCase()).digest("hex") : "")
const bare = (s: string) => (s.match(/<([^<>]+)>\s*$/)?.[1] ?? s).trim()
const parseList = (s?: string) => (s ?? "").split(/[,;]/).map((x) => x.trim()).filter(Boolean)
const validate = (x: string) => { if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(bare(x))) throw new Error(`Invalid address: ${x}`) }

const KIND: [string, RegExp][] = [
  ["\\Drafts", /^drafts?$/i], ["\\Sent", /^sent( items| mail)?$/i], ["\\Trash", /^(trash|deleted( items)?)$/i],
  ["\\Archive", /^archives?$/i], ["\\Junk", /^(junk|spam)$/i],
]
const kindOf = (m: any): string => m.specialUse ?? (String(m.path).toUpperCase() === "INBOX" ? "\\Inbox" : KIND.find(([, re]) => re.test(m.name))?.[0] ?? "")
const find = async (c: ImapFlow, use: string) => (await c.list()).find((m) => kindOf(m) === use)?.path

// ---------- folders & lists ----------
export const folders = (u: string, p: string) =>
  withImap(u, p, async (c) => {
    const all: any[] = await c.list({ statusQuery: { messages: true, unseen: true } } as any)
    return all
      .filter((m) => !m.flags?.has("\\Noselect"))
      .map((m) => ({ path: m.path, name: m.name, use: kindOf(m), total: m.status?.messages ?? 0, unseen: m.status?.unseen ?? 0 }))
  })

const hasAtt = (n: any): boolean =>
  !!n && (n.disposition === "attachment" || (!!n.parameters?.name && !n.id && !/^(text|multipart)\//.test(n.type || "")) || (n.childNodes ?? []).some(hasAtt))

const summarize = (m: any, useTo: boolean) => {
  const f = (useTo ? m.envelope?.to?.[0] : m.envelope?.from?.[0]) as Addr | undefined
  return {
    uid: m.uid, subject: m.envelope?.subject || "(no subject)", from: f?.name || f?.address || (useTo ? "" : "?"), email: f?.address || "",
    avatar: avatarHash(f?.address), att: hasAtt(m.bodyStructure), date: m.envelope?.date, seen: m.flags?.has("\\Seen") ?? false, flagged: m.flags?.has("\\Flagged") ?? false,
  }
}

export const list = (u: string, p: string, folder: string, page: number, q = "") =>
  withImap(u, p, async (c) => {
    const info = (await c.list()).find((m) => m.path === folder)
    const kind = info ? kindOf(info) : ""
    const useTo = kind === "\\Sent" || kind === "\\Drafts"
    const lock = await c.getMailboxLock(folder)
    try {
      const fields = { uid: true, envelope: true, flags: true, bodyStructure: true }
      if (q.trim()) {
        const term = q.trim()
        const uids = (((await c.search({ or: [{ subject: term }, { from: term }, { to: term }, { body: term }] }, { uid: true })) as number[]) || []).sort((a, b) => b - a)
        const slice = uids.slice(page * PAGE, (page + 1) * PAGE)
        const items: any[] = []
        if (slice.length) for await (const m of c.fetch(slice.join(","), fields, { uid: true })) items.push(summarize(m, useTo))
        return { total: uids.length, items: items.sort((a, b) => b.uid - a.uid) }
      }
      const total = (c.mailbox as any).exists as number
      const end = total - page * PAGE
      if (end < 1) return { total, items: [] }
      const items: any[] = []
      for await (const m of c.fetch(`${Math.max(1, end - PAGE + 1)}:${end}`, fields)) items.push(summarize(m, useTo))
      return { total, items: items.reverse() }
    } finally { lock.release() }
  })

// ---------- reading ----------
const clean = (raw: string, images: boolean) => {
  const out = sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span", "center"]),
    allowedAttributes: {
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
      "*": ["style", "align", "valign", "width", "height", "bgcolor", "cellpadding", "cellspacing", "border", "colspan", "rowspan", "dir"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: images ? ["data", "https"] : ["data"] }, // remote images only when the reader opts in
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  })
  // Inline styles can also load remote images (background:url(...)): neutralise them unless images are allowed.
  return images ? out : out.replace(/style="([^"]*)"/gi, (_m, s: string) => `style="${s.replace(/url\([^)]*\)/gi, "none")}"`)
}

export const read = (u: string, p: string, folder: string, uid: number, images = false) =>
  withImap(u, p, async (c) => {
    const lock = await c.getMailboxLock(folder)
    try {
      const msg = await c.fetchOne(String(uid), { source: true, flags: true }, { uid: true })
      if (!msg || !msg.source) return null
      if (!msg.flags?.has("\\Seen")) await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true })
      const m = await simpleParser(msg.source)
      let raw = typeof m.html === "string" ? m.html : ""
      for (const a of (m.attachments || []) as any[]) {
        if (!a.cid || !/^image\/(png|jpe?g|gif|webp)$/i.test(a.contentType) || !a.content || a.content.length > 2_000_000) continue
        const cid = String(a.cid).replace(/^<|>$/g, "")
        raw = raw.split(`cid:${cid}`).join(`data:${a.contentType};base64,${(a.content as Buffer).toString("base64")}`)
      }
      const blockedImages = images ? 0 : (raw.match(/<img\b[^>]*\ssrc\s*=\s*["']?https?:/gi) || []).length
      const f0 = flat(m.from)[0]
      const toL = flat(m.to).map(fmtAddr), ccL = flat(m.cc).map(fmtAddr), bccL = flat(m.bcc).map(fmtAddr)
      const attachments = (m.attachments || [])
        .map((a: any, i: number) => ({ a, i }))
        .filter(({ a }: any) => !(a.related && a.contentDisposition !== "attachment")) // skip inline (cid) images
        .map(({ a, i }: any) => ({ i, filename: a.filename || "attachment", type: a.contentType, size: a.size ?? a.content?.length ?? 0 }))
      return {
        subject: m.subject || "(no subject)", from: flat(m.from).map(fmtAddr).join(", "), fromName: f0?.name || f0?.address || "", fromEmail: f0?.address || "",
        avatar: avatarHash(f0?.address), replyTo: m.replyTo?.value?.[0]?.address || f0?.address || "",
        to: toL.join(", "), toList: toL, cc: ccL.join(", "), ccList: ccL, bccList: bccL,
        date: m.date, html: raw ? clean(raw, images) : "", text: m.text || "", messageId: m.messageId, inReplyTo: m.inReplyTo, references: m.references,
        images, blockedImages, attachments, flagged: msg.flags?.has("\\Flagged") ?? false,
      }
    } finally { lock.release() }
  })

export const attachment = (u: string, p: string, folder: string, uid: number, index: number) =>
  withImap(u, p, async (c) => {
    const lock = await c.getMailboxLock(folder)
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true })
      if (!msg || !msg.source) return null
      const a: any = (await simpleParser(msg.source)).attachments?.[index]
      return a ? { filename: (a.filename as string) || "attachment", type: (a.contentType as string) || "application/octet-stream", content: a.content as Buffer } : null
    } finally { lock.release() }
  })

// ---------- changing messages ----------
const set = (x: number | number[]) => ([] as number[]).concat(x).join(",")

export const remove = (u: string, p: string, folder: string, uid: number | number[]) =>
  withImap(u, p, async (c) => {
    const trash = await find(c, "\\Trash")
    const lock = await c.getMailboxLock(folder)
    try {
      if (trash && trash !== folder) await c.messageMove(set(uid), trash, { uid: true })
      else await c.messageDelete(set(uid), { uid: true })
    } finally { lock.release() }
  })

export const move = (u: string, p: string, folder: string, uid: number | number[], to: "archive" | "junk" | "inbox") =>
  withImap(u, p, async (c) => {
    const dest = to === "inbox" ? "INBOX" : await find(c, to === "archive" ? "\\Archive" : "\\Junk")
    if (!dest) throw new Error(to === "archive" ? "No Archive folder found on the server." : "No Junk folder found on the server.")
    const lock = await c.getMailboxLock(folder)
    try { await c.messageMove(set(uid), dest, { uid: true }) } finally { lock.release() }
  })

// Permanently deletes everything in Trash or Junk (only those two folders, never anything else).
export const empty = (u: string, p: string, kind: "trash" | "junk") =>
  withImap(u, p, async (c) => {
    const path = await find(c, kind === "trash" ? "\\Trash" : "\\Junk")
    if (!path) return { removed: 0 }
    const lock = await c.getMailboxLock(path)
    try {
      const n = (c.mailbox as any).exists as number
      if (n) await c.messageDelete("1:*")
      return { removed: n }
    } finally { lock.release() }
  })

// ---------- contacts (no database: learned from recent Sent recipients and Inbox senders) ----------
export const contacts = (u: string, p: string) =>
  withImap(u, p, async (c) => {
    const me = u.toLowerCase()
    const seen = new Map<string, { name: string; email: string; n: number }>()
    const add = (a: Addr | undefined, w: number) => {
      const e = a?.address?.trim().toLowerCase()
      if (!e || e === me || /(^|[._-])(no-?reply|donotreply|mailer-daemon|postmaster|bounce)/i.test(e)) return
      const x = seen.get(e)
      if (x) { x.n += w; if (!x.name && a?.name) x.name = a.name } else seen.set(e, { name: a?.name || "", email: e, n: w })
    }
    const scan = async (use: string, fn: (m: any) => void) => {
      const path = use === "\\Inbox" ? "INBOX" : await find(c, use)
      if (!path) return
      const lock = await c.getMailboxLock(path)
      try {
        const total = (c.mailbox as any).exists as number
        if (!total) return
        for await (const m of c.fetch(`${Math.max(1, total - 199)}:*`, { envelope: true })) fn(m)
      } finally { lock.release() }
    }
    await scan("\\Sent", (m) => [...(m.envelope?.to || []), ...(m.envelope?.cc || [])].forEach((a: Addr) => add(a, 3)))
    await scan("\\Inbox", (m) => (m.envelope?.from || []).forEach((a: Addr) => add(a, 1)))
    return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 400).map(({ name, email }) => ({ name, email }))
  })

const FLAGS = new Set(["\\Seen", "\\Flagged"])
export const flag = (u: string, p: string, folder: string, uid: number | number[], add: string[] = [], rem: string[] = []) =>
  withImap(u, p, async (c) => {
    const lock = await c.getMailboxLock(folder)
    try {
      const a = add.filter((f) => FLAGS.has(f)), r = rem.filter((f) => FLAGS.has(f))
      if (a.length) await c.messageFlagsAdd(set(uid), a, { uid: true })
      if (r.length) await c.messageFlagsRemove(set(uid), r, { uid: true })
    } finally { lock.release() }
  })

// ---------- composing ----------
export type Upload = { filename: string; content: string; type?: string } // content = base64
type Out = { to?: string; cc?: string; bcc?: string; subject?: string; text?: string; inReplyTo?: string; references?: any; attachments?: Upload[]; html?: string }
// Outgoing HTML is whitelisted (formatting + links only) and always accompanied by a plain-text alternative.
const cleanOut = (h: string) => sanitizeHtml(h, {
  allowedTags: ["p", "div", "br", "b", "strong", "i", "em", "u", "s", "strike", "ul", "ol", "li", "a", "blockquote", "span", "h1", "h2", "h3", "pre", "code", "hr"],
  allowedAttributes: { a: ["href"] }, allowedSchemes: ["http", "https", "mailto"],
  transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }) },
})
const toText = (h: string) => h
  .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-3]|blockquote|pre)>/gi, "\n").replace(/<li[^>]*>/gi, "• ")
  .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => (t.replace(/<[^>]+>/g, "") === href ? href : `${t.replace(/<[^>]+>/g, "")} (${href})`))
  .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
  .replace(/\n{3,}/g, "\n\n").trim()
const build = (mc: any): Promise<Buffer> => new Promise((res, rej) => mc.compile().build((e: any, b: Buffer) => (e ? rej(e) : res(b))))
const compose = (from: string, o: Out, extra: { keepBcc?: boolean; messageId?: string } = {}) => {
  const html = o.html?.trim() ? cleanOut(o.html) : ""
  return build(new (MailComposer as any)({
    from, to: o.to || undefined, cc: o.cc || undefined, bcc: o.bcc || undefined, subject: o.subject || "", ...(html ? { html, text: toText(html) } : { text: o.text || "" }),
    inReplyTo: o.inReplyTo || undefined, references: o.references || undefined, messageId: extra.messageId, keepBcc: !!extra.keepBcc,
    attachments: (o.attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.content, "base64"), contentType: a.type || undefined })),
  }))
}

const deleteUid = async (c: ImapFlow, path: string, uid: number) => {
  const lock = await c.getMailboxLock(path)
  try { await c.messageDelete(String(uid), { uid: true }) } finally { lock.release() }
}

// IMAP has no "edit": a draft is saved by appending the new version and deleting the previous one.
export async function saveDraft(u: string, p: string, o: Out & { replace?: number }) {
  const messageId = `<${randomUUID()}@${u.split("@")[1] || "indoku.org"}>`
  const raw = await compose(u, o, { keepBcc: true, messageId })
  return withImap(u, p, async (c) => {
    const drafts = await find(c, "\\Drafts")
    if (!drafts) throw new Error("No Drafts folder found on the server.")
    const res: any = await c.append(drafts, raw, ["\\Draft", "\\Seen"])
    let uid: number | undefined = res?.uid
    if (!uid) { // server without UIDPLUS: find what we just appended
      const lock = await c.getMailboxLock(drafts)
      try { uid = (((await c.search({ header: { "message-id": messageId } }, { uid: true })) as number[]) || [])[0] } finally { lock.release() }
    }
    if (o.replace && o.replace !== uid) await deleteUid(c, drafts, o.replace)
    return { uid }
  })
}

export const deleteDraft = (u: string, p: string, uid: number) =>
  withImap(u, p, async (c) => {
    const drafts = await find(c, "\\Drafts")
    if (drafts) await deleteUid(c, drafts, uid)
  })

export async function send(u: string, p: string, o: Out & { draftUid?: number }) {
  const to = parseList(o.to), cc = parseList(o.cc), bcc = parseList(o.bcc)
  if (!to.length && !cc.length && !bcc.length) throw new Error("Add at least one recipient.")
  ;[...to, ...cc, ...bcc].forEach(validate)
  // Bcc is delivered through the SMTP envelope only; it is never written into the message headers.
  const raw = await compose(u, { ...o, to: to.join(", "), cc: cc.join(", "), bcc: "" })
  const smtp = nodemailer.createTransport({ host: env("SMTP_HOST", "smtp.indoku.org"), port: +env("SMTP_PORT", "465"), secure: true, auth: { user: u, pass: p } })
  await smtp.sendMail({ envelope: { from: u, to: [...to, ...cc, ...bcc].map(bare) }, raw })
  await withImap(u, p, async (c) => {
    const sent = await find(c, "\\Sent")
    if (sent) await c.append(sent, raw, ["\\Seen"])
    if (o.draftUid) { const drafts = await find(c, "\\Drafts"); if (drafts) await deleteUid(c, drafts, o.draftUid) }
  }).catch(() => {})
}

// ---------- realtime: one IMAP IDLE session streamed as Server-Sent Events ----------
// Serverless functions cannot live forever, so a stream lasts `secs` seconds and the browser (EventSource) reconnects.
export function watch(u: string, p: string, secs: number, signal: AbortSignal): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let c: ImapFlow | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let ping: ReturnType<typeof setInterval> | undefined
  let closed = false
  let ctl!: ReadableStreamDefaultController<Uint8Array>
  const write = (t: string) => { if (!closed) try { ctl.enqueue(enc.encode(t)) } catch { /* client went away */ } }
  const send = (ev: string, d: unknown) => write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`)
  const stop = async () => {
    if (closed) return
    closed = true
    clearTimeout(timer); clearInterval(ping)
    try { ctl.close() } catch { /* already closed */ }
    await c?.logout().catch(() => {})
  }
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      ctl = controller
      signal.addEventListener("abort", () => void stop())
      write("retry: 1500\n\n")
      try {
        c = new ImapFlow({ host: env("IMAP_HOST", "server.griv.co.id"), port: +env("IMAP_PORT", "993"), secure: env("IMAP_SECURE", "true") !== "false", auth: { user: u, pass: p }, logger: false })
        c.on("error", () => void stop())
        c.on("close", () => void stop())
        await c.connect()
        const box: any = await c.mailboxOpen("INBOX")
        c.on("exists", (e: any) => { if (e.count > e.prevCount) send("new", { exists: e.count }); else send("change", {}) })
        c.on("expunge", () => send("change", {}))
        c.on("flags", () => send("change", {}))
        send("ready", { exists: box.exists })
        ping = setInterval(() => write(": ping\n\n"), 15000)
        timer = setTimeout(() => void stop(), secs * 1000)
      } catch (e: any) {
        send("error", { message: e?.authenticationFailed ? "auth" : "connect" })
        await stop()
      }
    },
    cancel() { return stop() },
  })
}
