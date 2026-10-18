import vercel from "@astrojs/vercel"
import react from "@astrojs/react"
import { defineConfig } from "astro/config"

export default defineConfig({
  output: "server",
  adapter: vercel({ maxDuration: 60 }), // mail IDLE streams stay open ~25 s; lower this if your Vercel plan caps functions below 60 s
  integrations: [react()],
  vite: { resolve: { dedupe: ["react", "react-dom"] }, ssr: { noExternal: ["@indoku/ui"] } },
})
