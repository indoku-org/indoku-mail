import { ImapFlow } from "imapflow"
import nodemailer from "nodemailer"
import { simpleParser } from "mailparser"
import sanitizeHtml from "sanitize-html"

const env = (k: string, d: string) => process.env[k] ?? d
const PAGE = 30

export async function withImap<T>(user: string, pass: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = new ImapFlow({ host: env("IMAP_HOST", "server.griv.co.id"), port: +env("IMAP_PORT", "993"), secure: true, auth: { user, pass }, logger: false })
  c.on("error", () => {})
  await c.connect()
  try { return await fn(c) } finally { await c.logout().catch(() => {}) }
}

const find = async (c: ImapFlow, use: string, re: RegExp) => {
  const all = await c.list()
  return (all.find((m) => m.specialUse === use) ?? all.find((m) => re.test(m.path)))?.path
}

export const folders = (u: string, p: string) =>
  withImap(u, p, async (c) => (await c.list()).map((m) => ({ path: m.path, name: m.name, use: m.specialUse ?? (m.path.toUpperCase() === "INBOX" ? "\\Inbox" : "") })))

export const list = (u: string, p: string, folder: string, page: number) =>
  withImap(u, p, async (c) => {
    const lock = await c.getMailboxLock(folder)
    try {
      const total = (c.mailbox as any).exists as number
      const end = total - page * PAGE
      if (end < 1) return { total, items: [] }
      const items: any[] = []
      for await (const m of c.fetch(`${Math.max(1, end - PAGE + 1)}:${end}`, { uid: true, envelope: true, flags: true })) {
        const f = m.envelope?.from?.[0]
        items.push({ uid: m.uid, subject: m.envelope?.subject || "(no subject)", from: f?.name || f?.address || "?", date: m.envelope?.date, seen: m.flags?.has("\\Seen") })
      }
      return { total, items: items.reverse() }
    } finally { lock.release() }
  })

export const read = (u: string, p: string, folder: string, uid: number) =>
  withImap(u, p, async (c) => {
    const lock = await c.getMailboxLock(folder)
    try {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true })
      if (!msg || !msg.source) return null
      await c.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true })
      const m = await simpleParser(msg.source)
      const html = m.html
        ? sanitizeHtml(m.html, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span", "center"]),
            allowedAttributes: { a: ["href", "name"], img: ["src", "alt"], "*": ["style"] },
            allowedSchemes: ["http", "https", "mailto"],
            allowedSchemesByTag: { img: ["data"] }, // remote images are stripped (anti-tracking)
            transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
          })
        : ""
      const addr = (a: any) => (Array.isArray(a) ? a.flatMap((x) => x.value) : a?.value ?? []).map((x: any) => (x.name ? `${x.name} <${x.address}>` : x.address)).join(", ")
      return { subject: m.subject || "(no subject)", from: addr(m.from), replyTo: m.replyTo?.value?.[0]?.address || m.from?.value?.[0]?.address, to: addr(m.to), date: m.date, html, text: m.text || "", messageId: m.messageId, references: m.references }
    } finally { lock.release() }
  })

export const remove = (u: string, p: string, folder: string, uid: number) =>
  withImap(u, p, async (c) => {
    const trash = await find(c, "\\Trash", /trash/i)
    const lock = await c.getMailboxLock(folder)
    try {
      if (trash && trash !== folder) await c.messageMove(String(uid), trash, { uid: true })
      else await c.messageDelete(String(uid), { uid: true })
    } finally { lock.release() }
  })

export async function send(u: string, p: string, o: { to: string; subject: string; text: string; inReplyTo?: string; references?: any }) {
  const to = o.to.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
  if (!to.length) throw new Error("No recipient")
  const opts = { from: u, to, subject: o.subject, text: o.text, inReplyTo: o.inReplyTo, references: o.references }
  const raw = ((await nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" } as any).sendMail(opts)) as any).message as Buffer
  const smtp = nodemailer.createTransport({ host: env("SMTP_HOST", "smtp.indoku.org"), port: +env("SMTP_PORT", "465"), secure: true, auth: { user: u, pass: p } })
  await smtp.sendMail({ envelope: { from: u, to }, raw })
  await withImap(u, p, async (c) => {
    const sent = await find(c, "\\Sent", /sent/i)
    if (sent) await c.append(sent, raw, ["\\Seen"])
  }).catch(() => {})
}
