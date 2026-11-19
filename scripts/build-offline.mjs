import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = new URL('../dist/', import.meta.url);
const files = (await readdir(directory, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name !== 'sw.js')
  .map(entry => relative(fileURLToPath(directory), join(entry.parentPath, entry.name)))
  .sort();
const hash = createHash('sha256');
for (const path of files) {
  hash.update(path);
  hash.update(await readFile(new URL(path, directory)));
}
const version = hash.digest('hex').slice(0, 12);
await writeFile(new URL('sw.js', directory), `const scope = self.registration.scope;
const prefix = 'fire-ant-lab:' + scope + ':';
const cacheName = prefix + '${version}';
const assets = ${JSON.stringify(['./', ...files.map(path => './' + path)])};
const urls = new Set(assets.map(path => new URL(path, scope).href));
const home = new URL('index.html', scope).href;
const homePath = new URL(home).pathname;
const scopePath = new URL(scope).pathname;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(assets);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(prefix) && name !== cacheName).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && (url.pathname === scopePath || url.pathname === homePath)) {
    event.respondWith(networkPage(request));
  } else if (urls.has(request.url)) {
    event.respondWith(cacheOrFetch(request.url, request));
  }
});

async function networkPage(request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) return response;
  } catch {
    // The cached shell is used when the network is unreachable.
  }
  const cache = await caches.open(cacheName);
  return (await cache.match(home, { ignoreVary: true })) || Response.error();
}

async function cacheOrFetch(url, request) {
  const cache = await caches.open(cacheName);
  return (await cache.match(url, { ignoreVary: true })) || fetch(request);
}
`);
