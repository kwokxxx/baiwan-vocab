import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const port = Number(process.env.PORT ?? 4180);
process.env.BETTER_AUTH_URL = `http://localhost:${port}`;
const { handleRequest } = await import("../server/handler.ts");
const root = path.resolve("dist/client");
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
};
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, process.env.BETTER_AUTH_URL);
    // Local-only regression fixture; this script is excluded from deployment.
    if (
      process.env.SHICI_QA_VERSION_HTML === "1" &&
      url.pathname === "/version.json"
    ) {
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-store");
      res.end("<html><body>Legacy cached page</body></html>");
      return;
    }
    if (url.pathname === "/api/update") {
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-store");
      res.end(await readFile(path.join(root, "index.html")));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 3_000_000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const response = await handleRequest(
        new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") res.setHeader(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) res.setHeader("Set-Cookie", cookies);
      res.writeHead(response.status);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    let body;
    try {
      body = await readFile(file);
    } catch {
      file = path.join(root, "index.html");
      body = await readFile(file);
    }
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] ?? "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-cache");
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end("Request failed");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Cloud preview: http://localhost:${port}`),
);
