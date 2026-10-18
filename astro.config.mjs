import vercel from "@astrojs/vercel"
import react from "@astrojs/react"
import { defineConfig } from "astro/config"

export default defineConfig({
  output: "server",
  adapter: vercel(),
  integrations: [react()],
  vite: { resolve: { dedupe: ["react", "react-dom"] }, ssr: { noExternal: ["@indoku/ui", "sanitize-html"] } },
})
