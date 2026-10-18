import { Avatar, AvatarFallback } from "@indoku/ui"
import { hue } from "../lib/client"

// Photo from Gravatar (via our proxy) when the sender has one, otherwise a coloured initial.
export default function SenderAvatar({ name, email, hash, size = "md" }: { name?: string; email?: string; hash?: string; size?: any }) {
  const label = name || email || "?"
  return (
    <Avatar
      size={size}
      name={label}
      src={hash ? `/api/avatar?h=${hash}` : undefined}
      fallback={<AvatarFallback name={label} bg={`hsl(${hue(email || label)} 45% 38%)`} color="white" />}
    />
  )
}
