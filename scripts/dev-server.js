import http from "http";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = Number(process.env.PORT || 3000);

async function loadHandler() {
  const mod = await import(path.join(__dirname, "../api/fungies-webhook.js"));
  return mod.default;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/fungies-webhook") {
    try {
      const handler = await loadHandler();
      res.status = (code) => ({
        json: (obj) => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(obj));
        },
      });
      res.json = (obj) => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(obj));
      };
      await handler(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "server_error" }));
    }
    return;
  }
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, () => {
  // no logging of secrets
});