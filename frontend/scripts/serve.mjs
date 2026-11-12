import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};
// Mirror Nginx routing during local frontend development.
// Forward an API request to its local service.
function proxyApi(req, res, upstreamPort) {
  const headers = {};
  for (const key of [
    "accept",
    "authorization",
    "content-type",
    "content-length",
  ]) {
    if (req.headers[key]) headers[key] = req.headers[key];
  }
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      path: req.url,
      method: req.method,
      headers,
      timeout: 15000,
    },
    /* Relay the upstream response to the browser. */ (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
      response.on(
        "error",
        /* Close the browser response if the upstream stream fails. */ () =>
          res.destroy(),
      );
    },
  );
  upstream.on(
    "timeout",
    /* Abort the request when the service times out. */ () =>
      upstream.destroy(),
  );
  upstream.on(
    "error",
    /* Return a JSON error if the service cannot respond. */ () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(
        JSON.stringify({
          message: "The API is unavailable. Start the services and try again.",
        }),
      );
    },
  );
  res.on(
    "close",
    /* Abort the upstream request when the browser disconnects. */ () =>
      upstream.destroy(),
  );
  req.pipe(upstream);
}

// Start the local server for built pages and API requests.
export function serve({
  port = Number(process.env.PORT || 4173),
  accountPort = Number(process.env.ACCOUNT_PORT || 3001),
  roomPort = Number(process.env.ROOM_PORT || 3002),
  bookingPort = Number(process.env.BOOKING_PORT || 3003),
} = {}) {
  const apiRoutes = [
    [/^\/api\/(auth|users|pets|admin)(\/|$)/, accountPort],
    [/^\/api\/(room-types|rooms)(\/|$)/, roomPort],
    [/^\/api\/(availability|bookings|cancellations)(\/|$)/, bookingPort],
  ];
  const server = http.createServer(
    /* Route the request to an API or a static file. */ async (req, res) => {
      try {
        let pathname = decodeURIComponent(
          new URL(req.url, "http://localhost").pathname,
        );
        if (pathname.startsWith("/api/")) {
          const [, upstreamPort] =
            apiRoutes.find(
              /* Match the request path against a service prefix. */ ([
                pattern,
              ]) => pattern.test(pathname),
            ) ?? [];
          if (upstreamPort) proxyApi(req, res, upstreamPort);
          else
            res
              .writeHead(404, { "Content-Type": "application/json" })
              .end(JSON.stringify({ message: "Endpoint not found." }));
          return;
        }
        if (pathname.endsWith("/")) pathname += "index.html";
        const file = path.resolve(root, `.${pathname}`);
        if (!file.startsWith(root + path.sep) && file !== root) {
          res.writeHead(403).end("Forbidden");
          return;
        }
        if (!(await stat(file)).isFile()) throw new Error("Not a file");
        res.writeHead(200, {
          "Content-Type":
            types[path.extname(file)] || "application/octet-stream",
          "Cache-Control":
            path.extname(file) === ".html" ? "no-store" : "no-cache",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(await readFile(file));
      } catch {
        res
          .writeHead(404, { "Content-Type": "text/plain" })
          .end("Page not found");
      }
    },
  );
  server.listen(
    port,
    "127.0.0.1",
    /* Log the preview URL after the server starts. */ () =>
      console.log(`PawInn preview: http://127.0.0.1:${server.address().port}`),
  );
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) serve();
