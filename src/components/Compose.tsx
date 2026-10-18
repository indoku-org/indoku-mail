import { useCallback, useEffect, useRef, useState } from "react"
import { Box, Flex, Text, Button, IconButton, Input } from "@indoku/ui"
import { LuBold, LuItalic, LuLink, LuList, LuListOrdered, LuPaperclip, LuRemoveFormatting, LuSend, LuTrash2, LuUnderline, LuX } from "react-icons/lu"
import AddrInput from "./AddrInput"
import { fmtSize, textToHtml, type Api, type Contact, type Draft } from "../lib/client"

type Props = { initial: Draft; wide: boolean; api: Api; contacts: Contact[]; onClose: (draftsChanged: boolean) => void; onSent: () => void }
const MAX_BYTES = 3 * 1024 * 1024
type Att = { filename: string; type: string; size: number; content: string } // content = base64
const toB64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(r.error); r.readAsDataURL(f) })
const hasContent = (x: Draft) => !!(x.to.trim() || x.cc.trim() || x.bcc.trim() || x.subject.trim() || x.text.trim())

export default function Compose({ initial, wide, api, contacts, onClose, onSent }: Props) {
  const [d, setD] = useState<Draft>(initial)
  const [showCc, setShowCc] = useState(!!(initial.cc || initial.bcc))
  const [status, setStatus] = useState("")
  const [err, setErr] = useState("")
  const [sending, setSending] = useState(false)
  const [files, setFiles] = useState<Att[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const editor = useRef<HTMLDivElement>(null)
  const latest = useRef(d); latest.current = d
  const uid = useRef<number | undefined>(initial.uid) // UID of our copy in the Drafts folder
  const dirty = useRef(false)
  const touched = useRef(false) // did we write to / delete from Drafts (so the parent should refresh)
  const inflight = useRef<Promise<void> | null>(null)

  const edit = (patch: Partial<Draft>) => { dirty.current = true; setStatus(""); setD((x) => ({ ...x, ...patch })) }

  // The editor is uncontrolled (React must not re-render its contents while the person types): fill it once.
  useEffect(() => {
    const el = editor.current
    if (!el) return
    el.innerHTML = initial.html ?? textToHtml(initial.text)
    if (initial.to) { el.focus(); const r = document.createRange(); r.setStart(el, 0); r.collapse(true); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sync = () => { const el = editor.current; if (el) edit({ html: el.innerHTML, text: el.innerText }) }
  const exec = (cmd: string, val?: string) => { editor.current?.focus(); document.execCommand(cmd, false, val); sync() }
  const link = () => {
    const u = (prompt("Link URL (https://…)") || "").trim()
    if (/^(https?:\/\/|mailto:)/i.test(u)) exec("createLink", u)
  }

  // Autosave, like Gmail: only after the person edits, never for an empty message.
  const save = useCallback(async () => {
    while (inflight.current) await inflight.current
    const x = latest.current
    if (!dirty.current || !hasContent(x)) return
    dirty.current = false
    const run: Promise<void> = (async () => {
      setStatus("Saving…")
      try {
        const r = await api("draft-save", { ...x, replace: uid.current })
        if (r.uid) uid.current = r.uid
        touched.current = true
        setStatus("Saved to Drafts")
      } catch { dirty.current = true; setStatus("Couldn't save draft") }
      finally { if (inflight.current === run) inflight.current = null }
    })()
    inflight.current = run
    await run
  }, [api])

  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(save, 1500)
    return () => clearTimeout(t)
  }, [d, save])

  useEffect(() => {
    const f = () => { if (document.visibilityState === "hidden") void save() }
    document.addEventListener("visibilitychange", f)
    return () => document.removeEventListener("visibilitychange", f)
  }, [save])

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setErr("")
    const next = [...files]
    for (const f of Array.from(list)) {
      if (next.reduce((n, a) => n + a.size, 0) + f.size > MAX_BYTES) { setErr(`Attachments can be 3 MB in total. "${f.name}" was not added.`); break }
      next.push({ filename: f.name, type: f.type, size: f.size, content: await toB64(f) })
    }
    setFiles(next)
    if (fileInput.current) fileInput.current.value = ""
  }

  const close = async () => { await save(); onClose(touched.current) }
  const discard = async () => {
    while (inflight.current) await inflight.current
    if (uid.current) { try { await api("draft-delete", { uid: uid.current }); touched.current = true } catch { /* already gone */ } }
    onClose(touched.current)
  }
  const send = async () => {
    setErr("")
    while (inflight.current) await inflight.current
    setSending(true)
    try { await api("send", { ...latest.current, draftUid: uid.current, attachments: files }); onSent() } catch (e: any) { setErr(e.message); setSending(false) }
  }

  const tool = (label: string, icon: React.ReactNode, run: () => void) => (
    <IconButton variant="ghost" size="xs" aria-label={label} title={label} onMouseDown={(e: React.MouseEvent) => e.preventDefault()} onClick={run}>{icon}</IconButton>
  )

  return (
    <Flex position="fixed" inset="0" zIndex={60} align={wide ? "center" : "flex-end"} justify="center" bg="blackAlpha.600" onClick={close}>
      <style>{`.rte{min-height:200px;max-height:42dvh;overflow-y:auto;outline:none;font-size:14px;line-height:1.6;word-break:break-word}
.rte:empty:before{content:"Write your message…";opacity:.5}
.rte blockquote{margin:0 0 0 .8ex;padding-left:1ex;border-left:2px solid currentColor;opacity:.8}
.rte a{color:#2563eb;text-decoration:underline}.rte ul,.rte ol{margin:0;padding-left:24px}`}</style>
      <Flex direction="column" gap="3" bg="bg" color="fg" p="4" w="100%" maxW="680px" maxH="94dvh" overflowY="auto" roundedTop="xl" rounded={wide ? "xl" : undefined} borderWidth="1px" onClick={(e) => e.stopPropagation()}>
        <Flex align="center" gap="2">
          <Text fontWeight="semibold" flex="1" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{d.subject.trim() || "New message"}</Text>
          <Text fontSize="xs" color="fg.muted" role="status">{status}</Text>
          <IconButton variant="ghost" size="sm" aria-label="Discard draft" onClick={discard}><LuTrash2 /></IconButton>
          <IconButton variant="ghost" size="sm" aria-label="Save and close" onClick={close}><LuX /></IconButton>
        </Flex>
        <Flex gap="2" align="center">
          <AddrInput placeholder="To (comma-separated)" value={d.to} onChange={(v) => edit({ to: v })} contacts={contacts} autoFocus={!initial.to} />
          <Button variant="ghost" size="sm" onClick={() => setShowCc(!showCc)}>Cc/Bcc</Button>
        </Flex>
        {showCc && (
          <>
            <AddrInput placeholder="Cc" value={d.cc} onChange={(v) => edit({ cc: v })} contacts={contacts} />
            <AddrInput placeholder="Bcc" value={d.bcc} onChange={(v) => edit({ bcc: v })} contacts={contacts} />
          </>
        )}
        <Input placeholder="Subject" value={d.subject} onChange={(e) => edit({ subject: e.target.value })} />

        <Box borderWidth="1px" rounded="md" overflow="hidden">
          <Flex gap="0.5" p="1" borderBottomWidth="1px" wrap="wrap">
            {tool("Bold (Ctrl+B)", <LuBold />, () => exec("bold"))}
            {tool("Italic (Ctrl+I)", <LuItalic />, () => exec("italic"))}
            {tool("Underline (Ctrl+U)", <LuUnderline />, () => exec("underline"))}
            {tool("Bulleted list", <LuList />, () => exec("insertUnorderedList"))}
            {tool("Numbered list", <LuListOrdered />, () => exec("insertOrderedList"))}
            {tool("Link", <LuLink />, link)}
            {tool("Clear formatting", <LuRemoveFormatting />, () => exec("removeFormat"))}
          </Flex>
          <Box p="3">
            <div
              ref={editor} className="rte" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Message"
              onInput={sync}
              // Paste as plain text: never import foreign HTML/styles into the message.
              onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain")) }}
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void send() }}
            />
          </Box>
        </Box>

        {err && <Text color="red.500" fontSize="sm" role="alert">{err}</Text>}
        {files.length > 0 && (
          <Flex gap="2" wrap="wrap">
            {files.map((a, i) => (
              <Button key={i} size="xs" variant="outline" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${a.filename}`}>
                <LuPaperclip /> {a.filename} ({fmtSize(a.size)}) <LuX />
              </Button>
            ))}
          </Flex>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => void addFiles(e.target.files)} />
        <Flex justify="flex-end" gap="2" align="center">
          <IconButton variant="ghost" size="sm" aria-label="Attach files" onClick={() => fileInput.current?.click()}><LuPaperclip /></IconButton>
          <Text fontSize="xs" color="fg.muted" flex="1">Ctrl+Enter to send{files.length ? " · attachments are not saved in drafts" : ""}</Text>
          <Button loading={sending} onClick={send}><LuSend /> Send</Button>
        </Flex>
      </Flex>
    </Flex>
  )
}
