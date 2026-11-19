import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
const url = 'http://127.0.0.1:4173/';
let browser;
const deadline = setTimeout(() => {
  console.error('Browser checks exceeded the deadline.');
  process.exit(1);
}, 148_000);
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  await mkdir('browser-results', { recursive: true });
  const errors = [];
  const desktop = await browser.newPage({ viewport: { width: 1040, height: 740 }, reducedMotion: 'reduce' });
  desktop.setDefaultTimeout(25_000);
  desktop.on('pageerror', error => errors.push(error.message));
  await desktop.goto(url, { waitUntil: 'commit' });
  const canvas = desktop.locator('#canvas-host canvas');
  await canvas.waitFor();
  assert.ok(await canvas.evaluate(element => Boolean(element.getContext('webgl2'))));
  assert.ok((await canvas.boundingBox()).height >= 738);
  assert.equal(await desktop.locator('#settings-panel').isVisible(), false);
  await desktop.screenshot({ path: 'browser-results/open-world.png' });
  console.log('Desktop world rendered');
  const crop = await canvas.boundingBox();
  await canvas.click({ position: { x: crop.width * .506, y: crop.height * .443 } });
  assert.equal(await desktop.locator('#ant-title').textContent(), 'Queen');
  assert.ok(await desktop.locator('#ant-inspector').isVisible());
  await desktop.getByRole('button', { name: 'Close ant details' }).click();

  await desktop.getByRole('button', { name: 'Explore', exact: true }).click();
  assert.equal(await desktop.locator('#explore-view').getAttribute('aria-pressed'), 'true');
  await desktop.getByRole('button', { name: 'Worker', exact: true }).click();
  assert.equal(await desktop.locator('#worker-view').getAttribute('aria-pressed'), 'true');
  await canvas.click({ position: { x: crop.width * .512, y: crop.height * .451 } });
  assert.match(await desktop.locator('#ant-title').textContent(), /^Worker 1$/);
  assert.ok(await desktop.locator('#ant-inspector').isVisible());
  await desktop.locator('#ant-dirt summary').click();
  assert.equal(await desktop.locator('#dirt-list li:visible').count(), 11);
  await desktop.getByRole('button', { name: 'Close ant details' }).click();
  await desktop.getByRole('button', { name: 'Settings', exact: true }).click();
  await desktop.locator('#egg-seconds').fill('2');
  await desktop.locator('#egg-seconds').press('Tab');
  await desktop.locator('#stage-seconds').fill('3');
  await desktop.locator('#stage-seconds').press('Tab');
  await desktop.locator('#settings-close').click();
  await desktop.locator('#speed').selectOption('32');
  await desktop.locator('#play').click();
  await desktop.waitForFunction(() => Number(document.querySelector('#adults').textContent) > 5, null, { timeout: 30_000 });
  await desktop.locator('#play').click();
  await desktop.screenshot({ path: 'browser-results/colony-workers.png' });
  await desktop.locator('#settings-button').click();
  await desktop.locator('#training-summary').click();
  assert.ok(Number(await desktop.locator('#hatched').textContent()) > 0);
  await desktop.locator('#restart').click();
  assert.equal(await desktop.locator('#run-label').textContent(), 'Run 2');
  assert.equal(await desktop.locator('#adults').textContent(), '1');
  await desktop.close();
  console.log('Desktop growth and run controls passed');

  const phone = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1, reducedMotion: 'reduce' });
  phone.setDefaultTimeout(25_000);
  await phone.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (backend, options) {
      return backend.startsWith('webgl') ? null : original.call(this, backend, options);
    };
  });
  const mobile = await phone.newPage();
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(url, { waitUntil: 'commit' });
  const mobileCanvas = mobile.locator('#canvas-host canvas');
  await mobileCanvas.waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.ok(await mobile.locator('#render-mode').isVisible());
  await mobile.screenshot({ path: 'browser-results/phone.png' });
  await mobile.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await phone.setOffline(true);
  await mobile.reload({ waitUntil: 'commit' });
  await mobileCanvas.waitFor();
  await mobile.locator('#settings-button').click();
  await mobile.locator('#brain-details summary').click();
  const region = mobile.getByRole('combobox', { name: 'Brain region' });
  await region.selectOption({ label: 'Antennal lobes' });
  await mobile.getByRole('button', { name: 'Rear view' }).click();
  assert.equal(await mobile.getByRole('button', { name: 'Front view' }).getAttribute('aria-pressed'), 'true');
  await mobile.locator('#play').click();
  await mobile.waitForFunction(() => document.querySelector('#brain-active').textContent !== '0');
  await mobile.screenshot({ path: 'browser-results/phone-brain.png' });
  await phone.close();
  assert.deepEqual(errors, [], 'Browser pages must have no uncaught errors');
  console.log('WebGL, procedural colony, phone layout, brain viewer, and offline reload passed.');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => {
    server.httpServer.close(error => error ? reject(error) : resolve());
    server.httpServer.closeAllConnections();
  });
  clearTimeout(deadline);
}
