import { useState } from "react"
import { Flex, Stack, Text, Heading, Button, IconButton, Textarea } from "@indoku/ui"
import { LuBell, LuX } from "react-icons/lu"
import { getSig, setSig } from "../lib/client"

type Props = { user: string; perm: string; onEnable: () => void; onClose: () => void; onSaved: () => void }

export default function Settings({ user, perm, onEnable, onClose, onSaved }: Props) {
  const [sig, setSigText] = useState(() => getSig(user))
  const save = () => { setSig(user, sig.replace(/\s+$/, "")); onSaved(); onClose() }

  return (
    <Flex position="fixed" inset="0" zIndex={65} align="center" justify="center" p="3" bg="blackAlpha.600" onClick={onClose}>
      <Stack gap="5" bg="bg" color="fg" p="5" w="100%" maxW="480px" maxH="92dvh" overflowY="auto" rounded="xl" borderWidth="1px" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <Flex align="center">
          <Heading size="md" flex="1">Settings</Heading>
          <IconButton variant="ghost" size="sm" aria-label="Close" onClick={onClose}><LuX /></IconButton>
        </Flex>

        <Stack gap="2">
          <Text fontWeight="medium" fontSize="sm">Signature for {user}</Text>
          <Textarea rows={5} placeholder={"Best regards,\nYour name"} value={sig} onChange={(e) => setSigText(e.target.value)} />
          <Text fontSize="xs" color="fg.muted">Added to new messages, replies and forwards. Stored in this browser only.</Text>
        </Stack>

        <Stack gap="2">
          <Text fontWeight="medium" fontSize="sm">Desktop notifications</Text>
          {perm === "unsupported" && <Text fontSize="sm" color="fg.muted">This browser does not support notifications.</Text>}
          {perm === "granted" && <Text fontSize="sm" color="fg.muted">On. You will be notified of new email while Indoku Mail is open in a tab.</Text>}
          {perm === "denied" && <Text fontSize="sm" color="fg.muted">Blocked. Allow notifications for this site in your browser&apos;s site settings (the icon next to the address bar), then reload.</Text>}
          {perm === "default" && (
            <Flex gap="3" align="center" wrap="wrap">
              <Text fontSize="sm" color="fg.muted" flex="1" minW="180px">Get a popup when new email arrives.</Text>
              <Button size="sm" variant="outline" onClick={onEnable}><LuBell /> Enable notifications</Button>
            </Flex>
          )}
        </Stack>

        <Flex justify="flex-end" gap="2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </Flex>
      </Stack>
    </Flex>
  )
}
