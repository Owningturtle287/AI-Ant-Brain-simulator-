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
await writeFile(new URL('sw.js', directory), `const prefix = 'fire-ant-lab:' + self.registration.scope + ':';
const cacheName = prefix + '${version}';
const assets = ${JSON.stringify(['./', ...files.map(path => './' + path)])};
const urls = new Set(assets.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
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
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(cacheName);
      return cache.match('./');
    }));
  } else if (urls.has(request.url)) {
    event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(request)) || fetch(request)));
  }
});
`);
