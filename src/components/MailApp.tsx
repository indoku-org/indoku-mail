import { useCallback, useEffect, useState } from "react"
import { Provider, Box, Flex, Stack, Text, Button, IconButton, Input, Textarea, Avatar, Skeleton, ColorModeButton } from "@indoku/ui"
import { LuArchive, LuArrowLeft, LuFileText, LuFolder, LuInbox, LuLogOut, LuMenu, LuPencil, LuRefreshCw, LuReply, LuSend, LuTrash2, LuX } from "react-icons/lu"

type Folder = { path: string; name: string; use: string }
type Item = { uid: number; subject: string; from: string; date: string; seen: boolean }
type Msg = { subject: string; from: string; replyTo: string; to: string; date: string; html: string; text: string; messageId?: string; references?: any }
type Draft = { to: string; subject: string; text: string; inReplyTo?: string; references?: any }

async function api(path: string, body: object = {}) {
  const r = await fetch("/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  if (r.status === 401) { location.href = "/login"; throw new Error("Session expired") }
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || "Something went wrong")
  return d
}

const fmt = (d: string) => {
  const t = new Date(d), n = new Date()
  return t.toDateString() === n.toDateString() ? t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : t.toLocaleDateString("en-US", { day: "numeric", month: "short" })
}
const ICON: Record<string, any> = { "\\Inbox": LuInbox, "\\Sent": LuSend, "\\Trash": LuTrash2, "\\Drafts": LuFileText, "\\Junk": LuArchive }
const ORDER = ["\\Inbox", "\\Drafts", "\\Sent", "\\Junk", "\\Trash"]
const iframeDoc = (h: string) => `<base target="_blank"><style>body{margin:0;padding:16px;font:14px/1.6 system-ui,sans-serif;color:#111;background:#fff;word-break:break-word}img{max-width:100%;height:auto}a{color:#2563eb}</style>${h}`

export default function MailApp({ user }: { user: string }) {
  const [wide, setWide] = useState(() => matchMedia("(min-width: 900px)").matches)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folder, setFolder] = useState("INBOX")
  const [items, setItems] = useState<Item[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sel, setSel] = useState<number | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState("")

  useEffect(() => { const m = matchMedia("(min-width: 900px)"); const f = () => setWide(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f) }, [])
  useEffect(() => { api("folders").then((f: Folder[]) => setFolders([...f].sort((a, b) => (ORDER.indexOf(a.use) + 99) % 99 - (ORDER.indexOf(b.use) + 99) % 99 || a.name.localeCompare(b.name)))).catch((e) => setErr(e.message)) }, [])

  const load = useCallback(async (f: string, p: number) => {
    setLoading(true); setErr("")
    try { const d = await api("list", { folder: f, page: p }); setItems((prev) => (p ? [...prev, ...d.items] : d.items)); setTotal(d.total) } catch (e: any) { setErr(e.message) }
    setLoading(false)
  }, [])
  useEffect(() => { setPage(0); setSel(null); setMsg(null); load(folder, 0) }, [folder, load])

  async function open(uid: number) {
    setSel(uid); setMsg(null)
    try { setMsg(await api("read", { folder, uid })); setItems((l) => l.map((i) => (i.uid === uid ? { ...i, seen: true } : i))) } catch (e: any) { setErr(e.message) }
  }
  async function del() {
    if (sel == null) return
    try { await api("delete", { folder, uid: sel }); setItems((l) => l.filter((i) => i.uid !== sel)); setSel(null); setMsg(null) } catch (e: any) { setErr(e.message) }
  }
  function reply() {
    if (!msg) return
    const quote = msg.text.split("\n").slice(0, 20).map((l) => "> " + l).join("\n")
    setDraft({ to: msg.replyTo, subject: /^re:/i.test(msg.subject) ? msg.subject : "Re: " + msg.subject, text: `\n\n${new Date(msg.date).toLocaleString("en-US")}, ${msg.from} wrote:\n${quote}`, inReplyTo: msg.messageId, references: msg.references })
  }
  async function send() {
    if (!draft) return
    setSending(true); setErr("")
    try { await api("send", draft); setDraft(null); if (/sent/i.test(folder)) load(folder, 0) } catch (e: any) { setErr(e.message) }
    setSending(false)
  }
  const logout = async () => { await api("logout").catch(() => {}); location.href = "/login" }

  const Nav = (
    <Flex direction="column" h="100%" w={wide ? "232px" : "280px"} bg="bg.subtle" borderRight="1px solid" borderColor="border" p="3" gap="1" flexShrink={0}>
      <Flex align="center" justify="space-between" px="2" py="2">
        <Text fontWeight="semibold">Indoku Mail</Text>
        <ColorModeButton />
      </Flex>
      <Button my="2" onClick={() => { setDraft({ to: "", subject: "", text: "" }); setNavOpen(false) }}><LuPencil /> Compose</Button>
      <Stack gap="1" flex="1" overflowY="auto">
        {folders.map((f) => {
          const Ic = ICON[f.use] ?? LuFolder
          const on = f.path === folder
          return (
            <Button key={f.path} variant={on ? "subtle" : "ghost"} justifyContent="flex-start" onClick={() => { setFolder(f.path); setNavOpen(false) }}>
              <Ic /> {f.use === "\\Inbox" ? "Inbox" : f.name}
            </Button>
          )
        })}
      </Stack>
      <Flex align="center" gap="2" pt="3" borderTop="1px solid" borderColor="border">
        <Avatar name={user} size="sm" />
        <Text fontSize="xs" color="fg.muted" flex="1" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{user}</Text>
        <IconButton variant="ghost" size="sm" aria-label="Sign out" onClick={logout}><LuLogOut /></IconButton>
      </Flex>
    </Flex>
  )

  const List = (
    <Flex direction="column" h="100%" w={wide ? "380px" : "100%"} borderRight={wide ? "1px solid" : undefined} borderColor="border" flexShrink={0} minW="0">
      <Flex align="center" gap="2" p="3" borderBottom="1px solid" borderColor="border">
        {!wide && <IconButton variant="ghost" size="sm" aria-label="Menu" onClick={() => setNavOpen(true)}><LuMenu /></IconButton>}
        <Text fontWeight="semibold" flex="1" textTransform="capitalize">{folders.find((f) => f.path === folder)?.name ?? "Inbox"}</Text>
        <Text fontSize="xs" color="fg.muted">{total}</Text>
        <IconButton variant="ghost" size="sm" aria-label="Refresh" onClick={() => { setPage(0); load(folder, 0) }}><LuRefreshCw /></IconButton>
      </Flex>
      {err && <Text px="3" py="2" fontSize="sm" color="red.500" role="alert">{err}</Text>}
      <Box flex="1" overflowY="auto">
        {loading && !items.length && [0, 1, 2, 3, 4].map((i) => <Box key={i} p="3"><Skeleton h="14px" w="40%" mb="2" /><Skeleton h="12px" w="80%" /></Box>)}
        {!loading && !items.length && <Text p="6" textAlign="center" color="fg.muted" fontSize="sm">This folder is empty</Text>}
        {items.map((i) => (
          <Box key={i.uid} as="button" display="block" w="100%" textAlign="left" p="3" bg={sel === i.uid ? "bg.muted" : "transparent"} borderBottom="1px solid" borderColor="border" cursor="pointer" color="fg" onClick={() => open(i.uid)} _hover={{ bg: "bg.muted" }}>
            <Flex gap="2" align="center">
              <Text flex="1" fontSize="sm" fontWeight={i.seen ? "normal" : "bold"} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{i.from}</Text>
              <Text fontSize="xs" color="fg.muted">{fmt(i.date)}</Text>
            </Flex>
            <Text fontSize="sm" color={i.seen ? "fg.muted" : "fg"} fontWeight={i.seen ? "normal" : "medium"} overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{i.subject}</Text>
          </Box>
        ))}
        {items.length < total && (
          <Box p="3"><Button variant="outline" w="100%" loading={loading} onClick={() => { setPage(page + 1); load(folder, page + 1) }}>Load more</Button></Box>
        )}
      </Box>
    </Flex>
  )

  const Reader = (
    <Flex direction="column" flex="1" minW="0" h="100%">
      {sel == null ? (
        <Flex flex="1" align="center" justify="center" direction="column" gap="2" color="fg.muted"><LuInbox size={32} /><Text fontSize="sm">Select an email to read</Text></Flex>
      ) : (
        <>
          <Flex align="center" gap="2" p="3" borderBottom="1px solid" borderColor="border">
            {!wide && <IconButton variant="ghost" size="sm" aria-label="Back" onClick={() => { setSel(null); setMsg(null) }}><LuArrowLeft /></IconButton>}
            <Box flex="1" />
            <IconButton variant="ghost" size="sm" aria-label="Reply" onClick={reply} disabled={!msg}><LuReply /></IconButton>
            <IconButton variant="ghost" size="sm" aria-label="Delete" onClick={del}><LuTrash2 /></IconButton>
          </Flex>
          <Box flex="1" overflowY="auto" p={{ base: "3", md: "5" }}>
            {!msg ? <Stack gap="3"><Skeleton h="22px" w="60%" /><Skeleton h="14px" w="40%" /><Skeleton h="200px" /></Stack> : (
              <Stack gap="4">
                <Text fontSize="xl" fontWeight="semibold">{msg.subject}</Text>
                <Flex gap="3" align="center">
                  <Avatar name={msg.from.replace(/<.*>/, "").trim() || msg.from} />
                  <Box minW="0"><Text fontSize="sm" fontWeight="medium" overflow="hidden" textOverflow="ellipsis">{msg.from}</Text><Text fontSize="xs" color="fg.muted">To: {msg.to} · {new Date(msg.date).toLocaleString("en-US")}</Text></Box>
                </Flex>
                {msg.html
                  ? <iframe title="Email body" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={iframeDoc(msg.html)} style={{ width: "100%", border: "1px solid var(--border, #e5e5e5)", borderRadius: 10, background: "#fff", minHeight: 240 }} onLoad={(e) => { const f = e.currentTarget; const h = f.contentDocument?.documentElement.scrollHeight; if (h) f.style.height = h + "px" }} />
                  : <Text whiteSpace="pre-wrap" fontSize="sm" lineHeight="1.7">{msg.text}</Text>}
              </Stack>
            )}
          </Box>
        </>
      )}
    </Flex>
  )

  return (
    <Provider defaultColorMode="system">
      <Flex h="100dvh" bg="bg" color="fg" overflow="hidden">
        {wide ? <>{Nav}{List}{Reader}</> : sel != null ? Reader : List}
        {!wide && navOpen && (
          <Flex position="fixed" inset="0" zIndex={50}>
            {Nav}
            <Box flex="1" bg="blackAlpha.600" onClick={() => setNavOpen(false)} />
          </Flex>
        )}
        {draft && (
          <Flex position="fixed" inset="0" zIndex={60} align={wide ? "center" : "flex-end"} justify="center" bg="blackAlpha.600" onClick={() => setDraft(null)}>
            <Flex direction="column" gap="3" bg="bg" p="4" w="100%" maxW="640px" maxH="92dvh" roundedTop="xl" rounded={wide ? "xl" : undefined} borderWidth="1px" onClick={(e) => e.stopPropagation()}>
              <Flex align="center"><Text fontWeight="semibold" flex="1">New message</Text><IconButton variant="ghost" size="sm" aria-label="Close" onClick={() => setDraft(null)}><LuX /></IconButton></Flex>
              <Input placeholder="To (comma-separated)" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
              <Input placeholder="Subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
              <Textarea placeholder="Write your message…" rows={10} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
              {err && <Text color="red.500" fontSize="sm" role="alert">{err}</Text>}
              <Flex justify="flex-end" gap="2"><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button><Button loading={sending} onClick={send}><LuSend /> Send</Button></Flex>
            </Flex>
          </Flex>
        )}
      </Flex>
    </Provider>
  )
}
