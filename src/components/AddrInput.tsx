import { useMemo, useState } from "react"
import { Box, Stack, Text, Input } from "@indoku/ui"
import type { Contact } from "../lib/client"

// Recipient field with contact suggestions for the address being typed (the part after the last comma).
export default function AddrInput({ value, onChange, placeholder, contacts, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; contacts: Contact[]; autoFocus?: boolean }) {
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(0)
  const cut = value.lastIndexOf(",") + 1
  const token = value.slice(cut).trim().toLowerCase()
  const matches = useMemo(() => {
    if (!token) return []
    const have = value.toLowerCase()
    return contacts.filter((c) => (c.email.includes(token) || c.name.toLowerCase().includes(token)) && !have.includes(c.email)).slice(0, 6)
  }, [token, contacts, value])

  const pick = (c: Contact) => {
    const head = value.slice(0, cut).trimEnd()
    const label = c.name && !/[,;<>"]/.test(c.name) ? `${c.name} <${c.email}>` : c.email
    onChange(`${head}${head ? " " : ""}${label}, `)
    setIdx(0)
  }
  const show = open && matches.length > 0

  return (
    <Box position="relative" flex="1" minW="0">
      <Input
        placeholder={placeholder} value={value} autoFocus={autoFocus} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); setIdx(0) }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!show) return
          if (e.key === "ArrowDown") { e.preventDefault(); setIdx((idx + 1) % matches.length) }
          else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((idx - 1 + matches.length) % matches.length) }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[idx]) }
          else if (e.key === "Escape") { e.stopPropagation(); setOpen(false) }
        }}
      />
      {show && (
        <Stack position="absolute" top="100%" left="0" right="0" zIndex={80} gap="0" mt="1" bg="bg" borderWidth="1px" rounded="md" shadow="md" overflow="hidden" role="listbox">
          {matches.map((c, i) => (
            <Box key={c.email} as="button" type="button" role="option" aria-selected={i === idx} textAlign="left" px="3" py="2" cursor="pointer" color="fg" bg={i === idx ? "bg.muted" : "transparent"}
              onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); pick(c) }} onMouseEnter={() => setIdx(i)}>
              <Text fontSize="sm" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{c.name || c.email}</Text>
              {c.name && <Text fontSize="xs" color="fg.muted" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{c.email}</Text>}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}
