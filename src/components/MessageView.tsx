import { useEffect, useMemo, useRef } from "react"
import { Box, Flex, Stack, Text, Span, Button, IconButton, Skeleton, Link, useColorMode } from "@indoku/ui"
import { LuArchive, LuArrowLeft, LuForward, LuImage, LuMail, LuPaperclip, LuReply, LuReplyAll, LuShieldAlert, LuShieldCheck, LuStar, LuTrash2 } from "react-icons/lu"
import SenderAvatar from "./SenderAvatar"
import { fmtFull, fmtSize, type Msg } from "../lib/client"

type Props = {
  msg: Msg | null; uid: number; acct: number; folder: string; wide: boolean; isJunk: boolean; onSpam: () => void
  onBack: () => void; onReply: () => void; onReplyAll: () => void; onForward: () => void
  onDelete: () => void; onArchive: () => void; onStar: () => void; onUnread: () => void; onImages: (always: boolean) => void
}

// Emails with a REAL designed background (coloured header, banner, newsletter) keep a white page, as Gmail does.
// Plain mail and Outlook/Gmail/webmail replies carry "background-color: white" boilerplate: that is not a design,
// so it must not force the white box. We ignore white / near-white / transparent backgrounds when deciding.
const plainBg = (raw: string) => {
  const v = raw.replace(/!important/gi, "").trim().toLowerCase()
  if (["", "none", "transparent", "inherit", "initial", "unset", "white", "window", "canvas"].includes(v)) return true
  if (/url\(/.test(v)) return false
  let r: number, g: number, b: number, a = 1
  const hex = v.match(/^#([0-9a-f]{3,8})$/)
  const fn = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("")
    if (h.length !== 6 && h.length !== 8) return false
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
    if (h.length === 8) a = parseInt(h.slice(6), 16) / 255
  } else if (fn) {
    r = +fn[1]; g = +fn[2]; b = +fn[3]
    if (fn[4]) a = fn[4].endsWith("%") ? parseFloat(fn[4]) / 100 : +fn[4]
  } else return false
  return a < 0.1 || (r > 235 && g > 235 && b > 235)
}
const bgValues = (html: string) => [
  ...[...html.matchAll(/background(?:-color)?\s*:\s*([^;"']+)/gi)].map((m) => m[1]),
  ...[...html.matchAll(/\bbgcolor\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]),
]
const isDesigned = (html: string) => /background-image\s*:\s*url\(/i.test(html) || bgValues(html).some((v) => !plainBg(v))
// Themed mode: drop colours baked into the mail so it follows our light/dark theme.
const stripColors = (html: string) =>
  html
    .replace(/\sbgcolor\s*=\s*(["'])[^"']*\1/gi, "")
    .replace(/style="([^"]*)"/gi, (_m, s: string) => `style="${s.replace(/(^|;)\s*(background(-color)?|color)\s*:[^;]*/gi, "$1")}"`)

const iframeDoc = (html: string, o: { dark: boolean; themed: boolean; images: boolean }) => {
  const dark = o.dark && o.themed
  const fg = o.themed ? (dark ? "#ececec" : "#171717") : "#111"
  // CSP is the second wall behind the sanitizer: nothing remote loads unless the reader allowed images.
  const csp = `default-src 'none'; img-src data:${o.images ? " https:" : ""}; style-src 'unsafe-inline'; font-src data:`
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="color-scheme" content="${dark ? "dark" : "light"}"><base target="_blank"><style>
:root{color-scheme:${dark ? "dark" : "light"}}
body{margin:0;padding:${o.themed ? "0" : "16px"};font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:${fg};background:${o.themed ? "transparent" : "#fff"};word-break:break-word;overflow-wrap:anywhere}
img{max-width:100%;height:auto}a{color:${dark ? "#7aa7ff" : "#2563eb"}}table{max-width:100%}
blockquote{margin:0 0 0 .8ex;padding-left:1ex;border-left:1px solid ${dark ? "#444" : "#ccc"}}
</style>${o.themed ? stripColors(html) : html}`
}

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g
function Linkified({ text }: { text: string }) {
  return <>{text.split(URL_RE).map((p, i) => (i % 2 ? <Link key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</Link> : p))}</>
}

export default function MessageView(p: Props) {
  const { msg, wide } = p
  const { colorMode } = useColorMode()
  const ref = useRef<HTMLIFrameElement>(null)
  const ro = useRef<ResizeObserver | null>(null)
  const themed = !!msg && !isDesigned(msg.html)
  const doc = useMemo(() => (msg?.html ? iframeDoc(msg.html, { dark: colorMode === "dark", themed, images: msg.images }) : ""), [msg?.html, msg?.images, colorMode, themed])

  const fit = () => {
    const f = ref.current, d = f?.contentDocument
    if (!f || !d?.documentElement) return
    f.style.height = "0px" // scrollHeight never shrinks below the viewport, so measure from zero
    f.style.height = d.documentElement.scrollHeight + "px"
  }
  useEffect(() => () => ro.current?.disconnect(), [])

  return (
    <Flex direction="column" flex="1" minW="0" h="100%">
      <Flex align="center" gap="1" p="3" borderBottom="1px solid" borderColor="border">
        {!wide && <IconButton variant="ghost" size="sm" aria-label="Back" onClick={p.onBack}><LuArrowLeft /></IconButton>}
        <Box flex="1" />
        <IconButton variant="ghost" size="sm" aria-label="Archive" onClick={p.onArchive}><LuArchive /></IconButton>
        <IconButton variant="ghost" size="sm" aria-label={p.isJunk ? "Not spam" : "Report spam"} title={p.isJunk ? "Not spam" : "Report spam"} onClick={p.onSpam}>{p.isJunk ? <LuShieldCheck /> : <LuShieldAlert />}</IconButton>
        <IconButton variant="ghost" size="sm" aria-label="Mark as unread" onClick={p.onUnread}><LuMail /></IconButton>
        <IconButton variant="ghost" size="sm" aria-label={msg?.flagged ? "Remove star" : "Add star"} onClick={p.onStar} disabled={!msg}><LuStar fill={msg?.flagged ? "currentColor" : "none"} /></IconButton>
        <IconButton variant="ghost" size="sm" aria-label="Reply" onClick={p.onReply} disabled={!msg}><LuReply /></IconButton>
        <IconButton variant="ghost" size="sm" aria-label="Reply all" onClick={p.onReplyAll} disabled={!msg}><LuReplyAll /></IconButton>
        <IconButton variant="ghost" size="sm" aria-label="Forward" onClick={p.onForward} disabled={!msg}><LuForward /></IconButton>
        <IconButton variant="ghost" size="sm" aria-label="Delete" onClick={p.onDelete}><LuTrash2 /></IconButton>
      </Flex>
      <Box flex="1" overflowY="auto" p={{ base: "3", md: "5" }}>
        {!msg ? (
          <Stack gap="3"><Skeleton h="22px" w="60%" /><Skeleton h="14px" w="40%" /><Skeleton h="200px" /></Stack>
        ) : (
          <Stack gap="4">
            <Text fontSize="xl" fontWeight="semibold">{msg.subject}</Text>
            <Flex gap="3" align="center">
              <SenderAvatar name={msg.fromName} email={msg.fromEmail} hash={msg.avatar} />
              <Box minW="0">
                <Text fontSize="sm" fontWeight="medium" overflow="hidden" textOverflow="ellipsis">{msg.from}</Text>
                <Text fontSize="xs" color="fg.muted">To: {msg.to}{msg.cc ? ` · Cc: ${msg.cc}` : ""} · {fmtFull(msg.date)}</Text>
              </Box>
            </Flex>

            {msg.blockedImages > 0 && (
              <Flex gap="2" align="center" wrap="wrap" p="3" rounded="lg" bg="bg.muted" fontSize="sm">
                <LuImage />
                <Text flex="1" minW="200px">Images are hidden to protect your privacy.</Text>
                <Button size="sm" variant="outline" onClick={() => p.onImages(false)}>Display images</Button>
                <Button size="sm" variant="ghost" onClick={() => p.onImages(true)}>Always display from {msg.fromEmail}</Button>
              </Flex>
            )}

            {msg.html ? (
              <iframe
                ref={ref}
                title="Email body"
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                srcDoc={doc}
                onLoad={() => {
                  fit()
                  const b = ref.current?.contentDocument?.body
                  if (b) { ro.current?.disconnect(); ro.current = new ResizeObserver(fit); ro.current.observe(b) }
                }}
                style={{ width: "100%", height: 40, border: themed ? 0 : "1px solid #e5e5e5", borderRadius: themed ? 0 : 10, background: themed ? "transparent" : "#fff" }}
              />
            ) : (
              <Text whiteSpace="pre-wrap" fontSize="sm" lineHeight="1.7" wordBreak="break-word"><Linkified text={msg.text} /></Text>
            )}

            {msg.attachments.length > 0 && (
              <Flex gap="2" wrap="wrap" pt="2" borderTop="1px solid" borderColor="border">
                {msg.attachments.map((a) => (
                  <Button key={a.i} size="sm" variant="outline" onClick={() => location.assign(`/api/attachment?acct=${p.acct}&folder=${encodeURIComponent(p.folder)}&uid=${p.uid}&i=${a.i}`)}>
                    <LuPaperclip /> {a.filename} <Span color="fg.muted">{fmtSize(a.size)}</Span>
                  </Button>
                ))}
              </Flex>
            )}
          </Stack>
        )}
      </Box>
    </Flex>
  )
}
