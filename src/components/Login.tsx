import { useState } from "react"
import { Provider, Flex, Stack, Text, Heading, Input, PasswordInput, Button, Card, CardBody, Link } from "@indoku/ui"
import { LuMail } from "react-icons/lu"

export default function Login({ add = false }: { add?: boolean }) {
  const [user, setUser] = useState("")
  const [pass, setPass] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr("")
    const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user, pass }) })
    const d = await r.json().catch(() => ({}))
    if (r.ok) { location.href = `/u/${d.index ?? 0}/inbox`; return }
    setErr(d.error || "Sign-in failed."); setBusy(false)
  }

  return (
    <Provider defaultColorMode="system">
      <Flex minH="100dvh" align="center" justify="center" p="4" bg="bg.subtle">
        <Card w="100%" maxW="400px">
          <CardBody>
            <form onSubmit={submit}>
              <Stack gap="5">
                <Stack gap="2" align="center">
                  <Flex w="44px" h="44px" align="center" justify="center" rounded="xl" bg="fg" color="bg"><LuMail size={22} /></Flex>
                  <Heading size="lg">{add ? "Add another account" : "Indoku Mail"}</Heading>
                  <Text color="fg.muted" fontSize="sm">{add ? "Sign in with another @indoku.org account" : "Sign in with your @indoku.org account"}</Text>
                </Stack>
                <Stack gap="3">
                  <Input type="email" placeholder="hello@indoku.org" autoComplete="username" required autoFocus value={user} onChange={(e) => setUser(e.target.value)} />
                  <PasswordInput placeholder="Password" autoComplete="current-password" required value={pass} onChange={(e) => setPass(e.target.value)} />
                  {err && <Text color="red.500" fontSize="sm" role="alert">{err}</Text>}
                  <Button type="submit" loading={busy}>{add ? "Add account" : "Sign in"}</Button>
                  {add && <Text fontSize="sm" textAlign="center"><Link href="/u/0/inbox">Cancel</Link></Text>}
                </Stack>
              </Stack>
            </form>
          </CardBody>
        </Card>
      </Flex>
    </Provider>
  )
}
