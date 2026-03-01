import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function claudeProxy(apiKey) {
  return {
    name: "claude-proxy",
    configureServer(server) {
      server.middlewares.use("/api/claude", async (req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const upstream = await fetch(
              "https://api.anthropic.com/v1/messages",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": apiKey,
                  "anthropic-version": "2023-06-01",
                },
                body,
              }
            );
            res.statusCode = upstream.status;
            res.setHeader("Content-Type", "application/json");
            res.end(await upstream.text());
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: { message: e.message } }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.ANTHROPIC_API_KEY || "";
  console.log(
    "[vite] ANTHROPIC_API_KEY:",
    apiKey ? `loaded (${apiKey.length} chars)` : "MISSING"
  );

  return {
    plugins: [react(), claudeProxy(apiKey)],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
  };
});
