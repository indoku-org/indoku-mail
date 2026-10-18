import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Provider, Box, Flex, Stack, Text, Span, Button, IconButton, Input, Skeleton, ColorModeButton } from "@indoku/ui"
import { LuArchive, LuBell, LuChevronUp, LuFileText, LuFolder, LuInbox, LuLogOut, LuMail, LuMailOpen, LuMenu, LuPaperclip, LuPencil, LuPlus, LuRefreshCw, LuSearch, LuSend, LuSettings, LuShieldAlert, LuShieldCheck, LuStar, LuTrash2, LuX } from "react-icons/lu"
import Compose from "./Compose"
import MessageView from "./MessageView"
import SenderAvatar from "./SenderAvatar"
import Settings from "./Settings"
import { addrOf, dismissNotif, esc, fmt, getSig, loadContacts, loadImgOk, makeApi, notifDismissed, saveContacts, saveImgOk, slug, textToHtml, unslug, type Contact, type Draft, type Folder, type Item, type Msg } from "../lib/client"

const ICON: Record<string, any> = { "\\Inbox": LuInbox, "\\Sent": LuSend, "\\Trash": LuTrash2, "\\Drafts": LuFileText, "\\Junk": LuShieldAlert, "\\Archive": LuArchive }
const ORDER = ["\\Inbox", "\\Drafts", "\\Sent", "\\Archive", "\\Junk", "\\Trash"]
const rank = (f: Folder) => { const i = ORDER.indexOf(f.use); return i < 0 ? 99 : i }
const sortFolders = (f: Folder[]) => [...f].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
const label = (f: Folder) => (f.use === "\\Inbox" ? "Inbox" : f.name.charAt(0).toUpperCase() + f.name.slice(1))
const blank = (): Draft => ({ to: "", cc: "", bcc: "", subject: "", text: "" })
const ICON_URL = "/apple-touch-icon.png"

export default function MailApp(props: { acct: number; accounts: string[] }) {
  return <Provider defaultColorMode="system"><Shell {...props} /></Provider>
}

function Shell({ acct, accounts }: { acct: number; accounts: string[] }) {
  const user = accounts[acct]
  const api = useMemo(() => makeApi(acct), [acct])
  const base = `/u/${acct}`

  // The URL is the source of truth for what is open: /u/<n>/<folder>[/<uid>][?q=...]
  const parse = useCallback(() => {
    const parts = location.pathname.slice(base.length).split("/").filter(Boolean)
    return {
      folder: parts[0] ? unslug(parts[0]) : "INBOX",
      uid: parts[1] && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null,
      q: new URLSearchParams(location.search).get("q") ?? "",
    }
  }, [base])
  const init = useMemo(parse, [parse])

  const [wide, setWide] = useState(() => matchMedia("(min-width: 900px)").matches)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folder, setFolder] = useState(init.folder)
  const [q, setQ] = useState(init.q)
  const [qInput, setQInput] = useState(init.q)
  const [sel, setSel] = useState<number | null>(init.uid)
  const [items, setItems] = useState<Item[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [composeId, setComposeId] = useState(0)
  const [contacts, setContacts] = useState<Contact[]>(() => loadContacts(user).list)
  const [perm, setPerm] = useState<string>(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission))
  const [bannerHidden, setBannerHidden] = useState(notifDismissed)
  const [err, setErr] = useState("")
  const [notice, setNotice] = useState("")
  const imgOk = useRef(loadImgOk())
  const itemsRef = useRef(items); itemsRef.current = items
  const view = useRef({ folder, page, q }); view.current = { folder, page, q }

  const kind = folders.find((f) => f.path === folder)?.use ?? (folder === "INBOX" ? "\\Inbox" : "")
  const notify = (t: string) => { setNotice(t); setTimeout(() => setNotice(""), 3000) }

  // ---- navigation ----
  const apply = useCallback(() => { const r = parse(); setFolder(r.folder); setQ(r.q); setQInput(r.q); setSel(r.uid) }, [parse])
  const go = useCallback((f: string, uid: number | null = null, query = "", replace = false) => {
    const url = `${base}/${slug(f)}${uid ? "/" + uid : ""}${query ? "?q=" + encodeURIComponent(query) : ""}`
    if (replace) history.replaceState(null, "", url); else history.pushState(null, "", url)
    apply()
  }, [base, apply])
  const goRef = useRef(go); goRef.current = go
  useEffect(() => { addEventListener("popstate", apply); return () => removeEventListener("popstate", apply) }, [apply])
  useEffect(() => { const m = matchMedia("(min-width: 900px)"); const f = () => setWide(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f) }, [])

  // ---- data ----
  const refreshFolders = useCallback(() => api("folders").then((f: Folder[]) => setFolders(sortFolders(f))).catch((e) => setErr(e.message)), [api])
  useEffect(() => { refreshFolders() }, [refreshFolders])

  const loadSeq = useRef(0)
  const load = useCallback(async (f: string, p: number, query: string, silent = false) => {
    const seq = ++loadSeq.current
    if (!silent) { setLoading(true); setErr("") }
    try {
      const d = await api("list", { folder: f, page: p, q: query })
      if (seq !== loadSeq.current) return
      setItems((prev) => (p ? [...prev, ...d.items] : d.items)); setTotal(d.total)
    } catch (e: any) { if (seq === loadSeq.current && !silent) setErr(e.message) }
    if (seq === loadSeq.current && !silent) setLoading(false)
  }, [api])
  useEffect(() => { setPage(0); setItems([]); setChecked(new Set()); load(folder, 0, q) }, [folder, q, load])

  const readSeq = useRef(0)
  useEffect(() => {
    if (sel == null) { setMsg(null); return }
    const my = ++readSeq.current
    setMsg(null)
    ;(async () => {
      try {
        const it = itemsRef.current.find((i) => i.uid === sel)
        let m: Msg = await api("read", { folder, uid: sel, images: !!it && imgOk.current.has(it.email.toLowerCase()) })
        if (m.blockedImages && imgOk.current.has(m.fromEmail.toLowerCase())) m = await api("read", { folder, uid: sel, images: true }) // deep link
        if (my !== readSeq.current) return
        setMsg(m)
        if (it && !it.seen) setFolders((fs) => fs.map((f) => (f.path === folder ? { ...f, unseen: Math.max(0, f.unseen - 1) } : f)))
        setItems((l) => l.map((i) => (i.uid === sel ? { ...i, seen: true } : i)))
      } catch (e: any) { if (my === readSeq.current) setErr(e.message) }
    })()
  }, [sel, folder, api])

  // Contacts for autocomplete: cached per browser, refreshed at most once a day.
  useEffect(() => {
    const t = setTimeout(() => {
      if (loadContacts(user).fresh) return
      api("contacts").then((c: Contact[]) => { setContacts(c); saveContacts(user, c) }).catch(() => {})
    }, 3000)
    return () => clearTimeout(t)
  }, [api, user])

  // ---- new mail: realtime (IMAP IDLE over SSE) + browser notifications ----
  const lastUid = useRef(0)
  const announce = useCallback((fresh: Item[]) => {
    const away = document.visibilityState === "hidden" || !document.hasFocus()
    if (away && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        fresh.slice(0, 3).forEach((i) => {
          const n = new Notification(i.from || "New email", { body: i.subject, tag: `mail-${user}-${i.uid}`, icon: ICON_URL })
          n.onclick = () => { window.focus(); goRef.current("INBOX", i.uid); n.close() }
        })
        if (fresh.length > 3) new Notification(`${fresh.length - 3} more new emails`, { tag: `mail-more-${user}`, icon: ICON_URL })
        return
      } catch { /* some mobile browsers only allow service-worker notifications */ }
    }
    notify(fresh.length === 1 ? `New email from ${fresh[0].from}` : `${fresh.length} new emails`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const checkNew = useCallback(async () => {
    try {
      const d = await api("list", { folder: "INBOX", page: 0, q: "" })
      const list: Item[] = d.items
      const top = list.reduce((m, i) => Math.max(m, i.uid), 0)
      const fresh = lastUid.current ? list.filter((i) => !i.seen && i.uid > lastUid.current) : [] // first run only sets the baseline
      lastUid.current = Math.max(lastUid.current, top)
      refreshFolders()
      const v = view.current
      if (v.folder === "INBOX" && v.page === 0 && !v.q) { setItems(list); setTotal(d.total) }
      if (fresh.length) announce(fresh)
    } catch { /* offline or session ended: the next event retries */ }
  }, [api, refreshFolders, announce])

  const lastExists = useRef<number | null>(null)
  useEffect(() => {
    if (typeof EventSource === "undefined") return
    const es = new EventSource(`/api/events?acct=${acct}`)
    // The stream is short-lived and reconnects on its own; only re-check when something actually changed.
    es.addEventListener("ready", (e) => {
      const n = JSON.parse((e as MessageEvent).data).exists as number
      if (lastExists.current === null || n !== lastExists.current) void checkNew()
      lastExists.current = n
    })
    es.addEventListener("new", (e) => { lastExists.current = JSON.parse((e as MessageEvent).data).exists; void checkNew() })
    es.addEventListener("change", () => void checkNew())
    return () => es.close()
  }, [acct, checkNew])

  // Slow safety net in case the stream is blocked by a proxy.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState !== "visible" || draft) return
      refreshFolders()
      if (!q && page === 0) load(folder, 0, q, true)
    }, 120000)
    return () => clearInterval(t)
  }, [refreshFolders, load, folder, q, page, draft])

  useEffect(() => {
    const unread = folders.find((f) => f.use === "\\Inbox")?.unseen ?? 0
    const f = folders.find((x) => x.path === folder)
    document.title = `${unread ? `(${unread}) ` : ""}${f ? label(f) : "Mail"} · Indoku Mail`
  }, [folders, folder])

  const enableNotif = async () => {
    if (typeof Notification === "undefined") return
    try {
      const p = await Notification.requestPermission()
      setPerm(p)
      if (p === "granted") new Notification("Notifications are on", { body: "You'll be notified of new email while Indoku Mail is open.", icon: ICON_URL })
    } catch { /* ignore */ }
  }

  // ---- single-message actions ----
  const drop = (uid: number) => { setItems((l) => l.filter((i) => i.uid !== uid)); setTotal((t) => Math.max(0, t - 1)) }
  const run = async (fn: () => Promise<void>) => { try { await fn() } catch (e: any) { setErr(e.message) } }
  const openCompose = (d: Draft) => { setComposeId((n) => n + 1); setDraft(d) }

  const del = () => run(async () => { if (sel == null) return; await api("delete", { folder, uid: sel }); drop(sel); go(folder, null, q, true); refreshFolders(); notify(kind === "\\Trash" ? "Deleted forever." : "Moved to Trash.") })
  const archive = () => run(async () => { if (sel == null) return; await api("move", { folder, uid: sel, to: "archive" }); drop(sel); go(folder, null, q, true); refreshFolders(); notify("Archived.") })
  const spam = () => run(async () => {
    if (sel == null) return
    const junk = kind === "\\Junk"
    await api("move", { folder, uid: sel, to: junk ? "inbox" : "junk" })
    drop(sel); go(folder, null, q, true); refreshFolders(); notify(junk ? "Moved to Inbox." : "Reported as spam.")
  })
  const unread = () => run(async () => {
    if (sel == null) return
    await api("flag", { folder, uid: sel, remove: ["\\Seen"] })
    setItems((l) => l.map((i) => (i.uid === sel ? { ...i, seen: false } : i)))
    setFolders((fs) => fs.map((f) => (f.path === folder ? { ...f, unseen: f.unseen + 1 } : f)))
    go(folder, null, q, true)
  })
  const star = () => run(async () => {
    if (sel == null || !msg) return
    const on = !msg.flagged
    await api("flag", { folder, uid: sel, ...(on ? { add: ["\\Flagged"] } : { remove: ["\\Flagged"] }) })
    setMsg({ ...msg, flagged: on }); setItems((l) => l.map((i) => (i.uid === sel ? { ...i, flagged: on } : i)))
  })
  const showImages = (always: boolean) => run(async () => {
    if (sel == null || !msg) return
    if (always && msg.fromEmail) { imgOk.current.add(msg.fromEmail.toLowerCase()); saveImgOk(imgOk.current) }
    setMsg(await api("read", { folder, uid: sel, images: true }))
  })

  // ---- list actions: star from the list, select several, empty trash ----
  const toggleStar = (i: Item) => run(async () => {
    const on = !i.flagged
    await api("flag", { folder, uid: i.uid, ...(on ? { add: ["\\Flagged"] } : { remove: ["\\Flagged"] }) })
    setItems((l) => l.map((x) => (x.uid === i.uid ? { ...x, flagged: on } : x)))
    if (sel === i.uid && msg) setMsg({ ...msg, flagged: on })
  })
  const toggleCheck = (uid: number) => setChecked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n })
  const allChecked = items.length > 0 && checked.size === items.length
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(items.map((i) => i.uid)))

  const dropMany = (u: number[]) => {
    const s = new Set(u)
    setItems((l) => l.filter((i) => !s.has(i.uid))); setTotal((t) => Math.max(0, t - u.length))
    if (sel != null && s.has(sel)) go(folder, null, q, true)
  }
  const bulk = (fn: (u: number[]) => Promise<void>, done: string) => run(async () => {
    const u = [...checked]
    if (!u.length) return
    await fn(u); setChecked(new Set()); refreshFolders(); notify(done)
  })
  const bulkDelete = () => bulk(async (u) => { await api("delete", { folder, uids: u }); dropMany(u) }, kind === "\\Trash" ? "Deleted forever." : "Moved to Trash.")
  const bulkArchive = () => bulk(async (u) => { await api("move", { folder, uids: u, to: "archive" }); dropMany(u) }, "Archived.")
  const bulkSpam = () => bulk(async (u) => { await api("move", { folder, uids: u, to: kind === "\\Junk" ? "inbox" : "junk" }); dropMany(u) }, kind === "\\Junk" ? "Moved to Inbox." : "Reported as spam.")
  const bulkRead = (read: boolean) => bulk(async (u) => {
    await api("flag", { folder, uids: u, ...(read ? { add: ["\\Seen"] } : { remove: ["\\Seen"] }) })
    const s = new Set(u); setItems((l) => l.map((i) => (s.has(i.uid) ? { ...i, seen: read } : i)))
  }, read ? "Marked as read." : "Marked as unread.")

  const emptyFolder = () => run(async () => {
    const k = kind === "\\Trash" ? "trash" : "junk"
    if (!confirm(`Permanently delete all ${total} messages in ${k === "trash" ? "Trash" : "Junk"}? This can't be undone.`)) return
    await api("empty", { kind: k })
    setItems([]); setTotal(0); go(folder, null, "", true); refreshFolders(); notify(`${k === "trash" ? "Trash" : "Junk"} emptied.`)
  })

  // ---- composing ----
  const sigBlock = () => { const s = getSig(user).trim(); return s ? `<div>-- <br>${textToHtml(s)}</div>` : "" }
  const quoted = (m: Msg) => `\n\n${new Date(m.date).toLocaleString("en-US")}, ${m.from} wrote:\n` + m.text.split("\n").slice(0, 40).map((l) => "> " + l).join("\n")
  const quoteHtml = (m: Msg) => `<div><br></div><div>${esc(new Date(m.date).toLocaleString("en-US"))}, ${esc(m.from)} wrote:</div><blockquote>${textToHtml(m.text.split("\n").slice(0, 40).join("\n"))}</blockquote>`
  const reSubject = (s: string) => (/^re:/i.test(s) ? s : "Re: " + s)
  const newMessage = () => openCompose({ ...blank(), html: sigBlock() ? `<div><br></div>${sigBlock()}` : undefined })
  const reply = () => msg && openCompose({ ...blank(), to: msg.replyTo, subject: reSubject(msg.subject), text: quoted(msg), html: `<div><br></div>${sigBlock()}${quoteHtml(msg)}`, inReplyTo: msg.messageId, references: msg.references })
  const replyAll = () => {
    if (!msg) return
    const me = user.toLowerCase(), first = addrOf(msg.replyTo)
    const cc = [...msg.toList, ...msg.ccList].filter((a) => addrOf(a) !== me && addrOf(a) !== first)
    openCompose({ ...blank(), to: msg.replyTo, cc: cc.join(", "), subject: reSubject(msg.subject), text: quoted(msg), html: `<div><br></div>${sigBlock()}${quoteHtml(msg)}`, inReplyTo: msg.messageId, references: msg.references })
  }
  const forward = () => {
    if (!msg) return
    const head = `---------- Forwarded message ---------\nFrom: ${msg.from}\nDate: ${new Date(msg.date).toLocaleString("en-US")}\nSubject: ${msg.subject}\nTo: ${msg.to}`
    openCompose({
      ...blank(), subject: /^fwd?:/i.test(msg.subject) ? msg.subject : "Fwd: " + msg.subject,
      text: `\n\n${head}\n\n${msg.text}`, html: `<div><br></div>${sigBlock()}<div><br></div><div>${textToHtml(head)}</div><div><br></div><div>${textToHtml(msg.text)}</div>`,
    })
  }

  // In Drafts a click opens the editor (like Gmail) instead of the reader.
  const editDraft = (uid: number) => run(async () => {
    const m: Msg = await api("read", { folder, uid })
    openCompose({ to: m.toList.join(", "), cc: m.ccList.join(", "), bcc: m.bccList.join(", "), subject: m.subject === "(no subject)" ? "" : m.subject, text: m.text, html: m.html || undefined, inReplyTo: m.inReplyTo, references: m.references, uid })
  })
  const pick = (uid: number) => (kind === "\\Drafts" ? editDraft(uid) : go(folder, uid, q))
  const closeCompose = (changed: boolean) => { setDraft(null); if (changed) { refreshFolders(); if (kind === "\\Drafts") load(folder, 0, q, true) } }
  const sent = () => { setDraft(null); notify("Message sent."); refreshFolders(); if (kind === "\\Drafts" || kind === "\\Sent") load(folder, 0, q, true) }

  const logout = (all: boolean) => run(async () => {
    const r = await api("logout", { all })
    location.href = r.remaining ? "/u/0/inbox" : "/login"
  })

  // ---- views ----
  const Nav = (
    <Flex direction="column" h="100%" w={wide ? "240px" : "280px"} bg="bg.subtle" borderRight="1px solid" borderColor="border" p="3" gap="1" flexShrink={0}>
      <Flex align="center" justify="space-between" px="2" py="2" gap="1">
        <Text fontWeight="semibold" flex="1">Indoku Mail</Text>
        <IconButton variant="ghost" size="sm" aria-label="Settings" onClick={() => { setSettingsOpen(true); setNavOpen(false) }}><LuSettings /></IconButton>
        <ColorModeButton />
      </Flex>
      <Button my="2" onClick={() => { newMessage(); setNavOpen(false) }}><LuPencil /> Compose</Button>
      <Stack gap="1" flex="1" overflowY="auto">
        {folders.map((f) => {
          const Ic = ICON[f.use] ?? LuFolder
          const count = f.use === "\\Drafts" ? f.total : f.use === "\\Inbox" || f.use === "\\Junk" ? f.unseen : 0
          return (
            <Button key={f.path} variant={f.path === folder ? "subtle" : "ghost"} justifyContent="flex-start" onClick={() => { go(f.path); setNavOpen(false) }}>
              <Ic /> <Span flex="1" textAlign="left">{label(f)}</Span>
              {count > 0 && <Span fontSize="xs" color="fg.muted">{count}</Span>}
            </Button>
          )
        })}
      </Stack>
      {acctOpen && (
        <Stack gap="1" p="1" borderWidth="1px" rounded="lg" bg="bg">
          {accounts.map((a, i) => (
            <Button key={a} size="sm" variant={i === acct ? "subtle" : "ghost"} justifyContent="flex-start" onClick={() => { location.href = `/u/${i}/inbox` }}>
              <SenderAvatar email={a} size="sm" />
              <Span flex="1" textAlign="left" overflow="hidden" textOverflow="ellipsis">{a}</Span>
            </Button>
          ))}
          {accounts.length < 5 && <Button size="sm" variant="ghost" justifyContent="flex-start" onClick={() => { location.href = "/login?add=1" }}><LuPlus /> Add another account</Button>}
          <Button size="sm" variant="ghost" justifyContent="flex-start" onClick={() => logout(false)}><LuLogOut /> Sign out</Button>
          {accounts.length > 1 && <Button size="sm" variant="ghost" justifyContent="flex-start" onClick={() => logout(true)}><LuLogOut /> Sign out of all accounts</Button>}
        </Stack>
      )}
      <Button variant="ghost" justifyContent="flex-start" onClick={() => setAcctOpen(!acctOpen)} borderTop="1px solid" borderColor="border" rounded="none" mt="2" pt="3" h="auto" pb="1">
        <SenderAvatar email={user} size="sm" />
        <Span fontSize="xs" color="fg.muted" flex="1" textAlign="left" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{user}</Span>
        <LuChevronUp style={{ transform: acctOpen ? "none" : "rotate(180deg)" }} />
      </Button>
    </Flex>
  )

  const folderName = folders.find((f) => f.path === folder)
  const sentLike = kind === "\\Sent" || kind === "\\Drafts"
  const canEmpty = (kind === "\\Trash" || kind === "\\Junk") && total > 0 && !q
  const showBanner = perm === "default" && !bannerHidden
  const tick = (extra: object = {}) => ({ type: "checkbox" as const, style: { width: 16, height: 16, flexShrink: 0, cursor: "pointer", accentColor: "currentColor" }, ...extra })

  const List = (
    <Flex direction="column" h="100%" w={wide ? "380px" : "100%"} borderRight={wide ? "1px solid" : undefined} borderColor="border" flexShrink={0} minW="0">
      {checked.size > 0 ? (
        <Flex align="center" gap="1" p="3" borderBottom="1px solid" borderColor="border" bg="bg.muted" wrap="wrap">
          <input {...tick({ checked: allChecked, onChange: toggleAll, "aria-label": "Select all" })} />
          <Text fontWeight="semibold" fontSize="sm" flex="1" pl="2" minW="80px">{checked.size} selected</Text>
          {kind !== "\\Archive" && <IconButton variant="ghost" size="sm" aria-label="Archive" title="Archive" onClick={bulkArchive}><LuArchive /></IconButton>}
          <IconButton variant="ghost" size="sm" aria-label={kind === "\\Junk" ? "Not spam" : "Report spam"} title={kind === "\\Junk" ? "Not spam" : "Report spam"} onClick={bulkSpam}>{kind === "\\Junk" ? <LuShieldCheck /> : <LuShieldAlert />}</IconButton>
          <IconButton variant="ghost" size="sm" aria-label="Mark as read" title="Mark as read" onClick={() => bulkRead(true)}><LuMailOpen /></IconButton>
          <IconButton variant="ghost" size="sm" aria-label="Mark as unread" title="Mark as unread" onClick={() => bulkRead(false)}><LuMail /></IconButton>
          <IconButton variant="ghost" size="sm" aria-label="Delete" title="Delete" onClick={bulkDelete}><LuTrash2 /></IconButton>
          <IconButton variant="ghost" size="sm" aria-label="Clear selection" title="Clear selection" onClick={() => setChecked(new Set())}><LuX /></IconButton>
        </Flex>
      ) : (
        <Flex align="center" gap="2" p="3" borderBottom="1px solid" borderColor="border">
          {!wide && <IconButton variant="ghost" size="sm" aria-label="Menu" onClick={() => setNavOpen(true)}><LuMenu /></IconButton>}
          {items.length > 0 && <input {...tick({ checked: false, onChange: toggleAll, "aria-label": "Select all" })} />}
          <Text fontWeight="semibold" flex="1" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{q ? `Search in ${folderName ? label(folderName) : "mail"}` : folderName ? label(folderName) : "Inbox"}</Text>
          <Text fontSize="xs" color="fg.muted">{total}</Text>
          {canEmpty && <Button variant="ghost" size="xs" onClick={emptyFolder}><LuTrash2 /> Empty</Button>}
          <IconButton variant="ghost" size="sm" aria-label="Refresh" onClick={() => { setPage(0); load(folder, 0, q); refreshFolders() }}><LuRefreshCw /></IconButton>
        </Flex>
      )}
      <Flex align="center" gap="1" px="3" py="2" borderBottom="1px solid" borderColor="border">
        <LuSearch />
        <Input size="sm" variant="ghost" placeholder="Search mail" aria-label="Search mail" value={qInput} onChange={(e) => setQInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(folder, null, qInput.trim()) }} />
        {(q || qInput) && <IconButton variant="ghost" size="xs" aria-label="Clear search" onClick={() => { setQInput(""); if (q) go(folder) }}><LuX /></IconButton>}
      </Flex>
      {showBanner && (
        <Flex gap="2" align="center" wrap="wrap" px="3" py="2" bg="bg.muted" borderBottom="1px solid" borderColor="border" fontSize="sm">
          <LuBell />
          <Text flex="1" minW="140px" fontSize="sm">Get notified when new email arrives?</Text>
          <Button size="xs" onClick={enableNotif}>Allow</Button>
          <Button size="xs" variant="ghost" onClick={() => { dismissNotif(); setBannerHidden(true) }}>Not now</Button>
        </Flex>
      )}
      {err && <Text px="3" py="2" fontSize="sm" color="red.500" role="alert">{err}</Text>}
      <Box flex="1" overflowY="auto">
        {loading && !items.length && [0, 1, 2, 3, 4].map((i) => <Flex key={i} p="3" gap="3"><Skeleton w="32px" h="32px" rounded="full" /><Box flex="1"><Skeleton h="14px" w="40%" mb="2" /><Skeleton h="12px" w="80%" /></Box></Flex>)}
        {!loading && !items.length && <Text p="6" textAlign="center" color="fg.muted" fontSize="sm">{q ? "No messages match your search." : "This folder is empty."}</Text>}
        {items.map((i) => (
          <Flex key={i.uid} role="button" tabIndex={0} gap="3" align="center" w="100%" textAlign="left" p="3" bg={checked.has(i.uid) ? "bg.emphasized" : sel === i.uid ? "bg.muted" : "transparent"} borderBottom="1px solid" borderColor="border" cursor="pointer" color="fg"
            onClick={() => pick(i.uid)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(i.uid) } }} _hover={{ bg: "bg.muted" }}>
            <input {...tick({ checked: checked.has(i.uid), onChange: () => toggleCheck(i.uid), onClick: (e: React.MouseEvent) => e.stopPropagation(), "aria-label": "Select message" })} />
            <SenderAvatar name={i.from} email={i.email} hash={i.avatar} size="sm" />
            <Box flex="1" minW="0">
              <Flex gap="2" align="center">
                <Text flex="1" fontSize="sm" fontWeight={i.seen ? "normal" : "bold"} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{sentLike ? (i.from ? `To: ${i.from}` : "(no recipient)") : i.from}</Text>
                <Text fontSize="xs" color="fg.muted" flexShrink={0}>{fmt(i.date)}</Text>
              </Flex>
              <Flex gap="2" align="center">
                <Text flex="1" fontSize="sm" color={i.seen ? "fg.muted" : "fg"} fontWeight={i.seen ? "normal" : "medium"} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{i.subject}</Text>
                {i.att && <LuPaperclip size={14} aria-label="Has attachment" />}
              </Flex>
            </Box>
            <IconButton variant="ghost" size="xs" aria-label={i.flagged ? "Remove star" : "Add star"} title={i.flagged ? "Remove star" : "Add star"} flexShrink={0} color={i.flagged ? "fg" : "fg.muted"}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); toggleStar(i) }}>
              <LuStar size={16} fill={i.flagged ? "currentColor" : "none"} />
            </IconButton>
          </Flex>
        ))}
        {items.length < total && <Box p="3"><Button variant="outline" w="100%" loading={loading} onClick={() => { setPage(page + 1); load(folder, page + 1, q) }}>Load more</Button></Box>}
      </Box>
    </Flex>
  )

  const Reader = sel == null ? (
    <Flex flex="1" align="center" justify="center" direction="column" gap="2" color="fg.muted"><LuInbox size={32} /><Text fontSize="sm">Select an email to read</Text></Flex>
  ) : (
    <MessageView msg={msg} uid={sel} acct={acct} folder={folder} wide={wide} isJunk={kind === "\\Junk"} onSpam={spam}
      onBack={() => go(folder, null, q)} onReply={reply} onReplyAll={replyAll} onForward={forward}
      onDelete={del} onArchive={archive} onStar={star} onUnread={unread} onImages={showImages} />
  )

  return (
    <Flex h="100dvh" bg="bg" color="fg" overflow="hidden">
      {wide ? <>{Nav}{List}{Reader}</> : sel != null ? Reader : List}
      {!wide && navOpen && (
        <Flex position="fixed" inset="0" zIndex={50}>
          {Nav}
          <Box flex="1" bg="blackAlpha.600" onClick={() => setNavOpen(false)} />
        </Flex>
      )}
      {draft && <Compose key={composeId} initial={draft} wide={wide} api={api} contacts={contacts} onClose={closeCompose} onSent={sent} />}
      {settingsOpen && <Settings user={user} perm={perm} onEnable={enableNotif} onClose={() => setSettingsOpen(false)} onSaved={() => notify("Settings saved.")} />}
      {notice && <Box position="fixed" bottom="4" left="50%" transform="translateX(-50%)" zIndex={70} px="4" py="2" rounded="lg" bg="fg" color="bg" fontSize="sm" role="status">{notice}</Box>}
    </Flex>
  )
}
