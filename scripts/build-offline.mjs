import { generateSW } from "workbox-build";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const { version } = JSON.parse(await readFile("package.json", "utf8"));
let html = await readFile("dist/client/index.html", "utf8");
const buildId = createHash("sha256").update(html).digest("hex").slice(0, 16);
const navigationCache = `shici-navigation-${buildId}`;
html = html.replace(
  "</head>",
  `<meta name="shici-build" content="${buildId}" /><meta name="shici-version" content="${version}" /></head>`,
);
await writeFile("dist/client/index.html", html);
await writeFile(
  "dist/client/version.json",
  JSON.stringify({ version, buildId }),
);
const result = await generateSW({
  globDirectory: "dist/client",
  globPatterns: ["**/*.{html,js,css,png,svg,woff,woff2,webmanifest}"],
  globIgnores: ["sw.js", "workbox-*.js"],
  swDest: "dist/client/sw.js",
  // Online navigations fetch the current document; offline navigations use the
  // cached page/precache. API and recovery URLs never fall back to app HTML.
  directoryIndex: null,
  runtimeCaching: [
    {
      urlPattern: ({ url }) =>
        url.origin === self.location.origin &&
        url.pathname.startsWith("/audio/") &&
        !url.searchParams.has("full"),
      handler: "CacheFirst",
      options: {
        cacheName: "baiwan-natural-audio-v1",
        rangeRequests: true,
        cacheableResponse: { statuses: [200] },
      },
    },
    {
      urlPattern: ({ request, url }) =>
        request.mode === "navigate" &&
        url.origin === self.location.origin &&
        !/^\/api(?:\/|$)/.test(url.pathname),
      handler: "NetworkFirst",
      options: {
        cacheName: navigationCache,
        networkTimeoutSeconds: 8,
        precacheFallback: { fallbackURL: "/index.html" },
      },
    },
    {
      urlPattern: ({ url }) =>
        url.origin === self.location.origin &&
        url.pathname.startsWith("/assets/"),
      handler: "CacheFirst",
      options: {
        cacheName: "shici-runtime-assets",
        expiration: { maxEntries: 100, maxAgeSeconds: 30 * 86400 },
        cacheableResponse: { statuses: [200] },
      },
    },
  ],
  cacheId: "shici",
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
  inlineWorkboxRuntime: true,
  sourcemap: false,
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
});
if (result.warnings.length) throw new Error(result.warnings.join("\n"));
// A previously cached root document must not bring an older app back on the next
// offline launch. Only HTML navigation caches are retired; learning storage and
// account cookies are untouched. The new worker can fall back to its own precache.
await writeFile(
  "dist/client/sw.js",
  (await readFile("dist/client/sw.js", "utf8")) +
    `\nself.addEventListener("activate", event => event.waitUntil(caches.keys().then(names => Promise.allSettled(names.filter(name => name.startsWith("shici-navigation") && name !== ${JSON.stringify(navigationCache)}).map(name => caches.delete(name))))));\n`,
);
console.log(
  `Offline cache ready: ${result.count} resources, ${result.size} bytes.`,
);
