import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
const url = 'http://127.0.0.1:4173/';
let browser;
const deadline = setTimeout(() => {
  console.error('Browser checks exceeded the two-minute deadline.');
  process.exit(1);
}, 145_000);
try {
  browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  console.log('Starting desktop WebGL check');
  const desktop = await browser.newPage({ viewport: { width: 1040, height: 740 }, reducedMotion: 'reduce' });
  desktop.setDefaultTimeout(25_000);
  const errors = [];
  desktop.on('pageerror', error => errors.push(error.message));
  await desktop.goto(url, { waitUntil: 'commit' });
  const canvas = desktop.locator('#canvas-host canvas');
  await canvas.waitFor();
  assert.equal(await desktop.locator('#render-mode').isVisible(), false, 'WebGL renderer should be active');
  assert.equal(await canvas.evaluate(canvas => Boolean(canvas.getContext('webgl2'))), true);
  await mkdir('browser-results', { recursive: true });
  await desktop.screenshot({ path: 'browser-results/desktop.png', timeout: 25_000 });
  console.log('Desktop WebGL rendered');
  assert.equal(await desktop.locator('#brain-count').textContent(), '250,000');
  await desktop.getByRole('combobox', { name: 'Region', exact: true }).selectOption({ label: 'Antennal lobes' });
  await desktop.getByRole('button', { name: 'Inspect neuron' }).click();
  assert.equal(await desktop.locator('#neuron-sources li').count(), 3);
  await desktop.getByRole('button', { name: 'Rear view' }).click();
  assert.equal(await desktop.getByRole('button', { name: 'Front view' }).getAttribute('aria-pressed'), 'true');
  await desktop.getByRole('button', { name: 'Connections' }).click();
  assert.equal(await desktop.getByRole('button', { name: 'Connections' }).getAttribute('aria-pressed'), 'false');
  await desktop.getByRole('button', { name: 'Connections' }).click();
  await desktop.getByRole('button', { name: 'Show trail' }).click();
  await desktop.getByRole('button', { name: 'Place food' }).click();
  const position = await canvas.boundingBox();
  await canvas.click({ position: { x: position.width * .57, y: position.height * .57 } });
  assert.equal(await desktop.getByRole('button', { name: 'Place food' }).getAttribute('aria-pressed'), 'false');
  await desktop.getByRole('tab', { name: 'Specimen' }).click();
  const side = desktop.getByRole('button', { name: 'Side', exact: true });
  await side.click();
  assert.equal(await side.getAttribute('aria-pressed'), 'true');
  await desktop.getByRole('switch', { name: /Extend sting/ }).check();
  await desktop.screenshot({ path: 'browser-results/profile.png' });
  await desktop.getByRole('button', { name: 'Top', exact: true }).click();
  await desktop.getByRole('switch', { name: /Joint markers/ }).check();
  await desktop.getByRole('switch', { name: /Foot contacts/ }).check();
  await desktop.getByRole('tab', { name: 'Terrain' }).click();
  await desktop.getByRole('button', { name: /Open tunnel/ }).click();
  await desktop.getByRole('button', { name: 'Guide ant' }).click();
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * .62, y: box.height * .5 } });
  await desktop.getByRole('button', { name: 'Play simulation' }).click();
  await desktop.waitForFunction(() => document.getElementById('sim-time').textContent !== '00:00', null, { timeout: 20_000 });
  await desktop.getByRole('button', { name: 'Pause simulation' }).click();
  await desktop.getByRole('button', { name: 'Reset simulation' }).click();
  await desktop.waitForFunction(() => document.getElementById('sim-time').textContent === '00:00');

  await desktop.close();
  console.log('Desktop controls passed, checking the phone layout and offline compatibility');
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
  await mobile.locator('#canvas-host canvas').waitFor();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(await mobile.locator('#render-mode').isVisible(), true, 'The compatibility renderer should be labeled');
  await mobile.screenshot({ path: 'browser-results/phone.png', fullPage: true });
  await mobile.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await phone.setOffline(true);
  const failedOfflineRequests = [];
  mobile.on('requestfailed', request => failedOfflineRequests.push([request.url(), request.failure()?.errorText]));
  try {
    await mobile.reload({ waitUntil: 'commit' });
    await mobile.locator('#canvas-host canvas').waitFor();
  } catch (error) {
    console.error('Offline state:', await mobile.locator('body').innerText(), failedOfflineRequests, errors);
    throw error;
  }
  assert.equal(await mobile.getByRole('heading', { name: 'Fire ant simulator' }).isVisible(), true);
  await mobile.getByRole('button', { name: 'Zoom in' }).click();
  await mobile.getByRole('button', { name: 'Play simulation' }).click();
  await mobile.waitForFunction(() => document.getElementById('sim-time').textContent !== '00:00');
  await mobile.waitForFunction(() => document.getElementById('brain-active').textContent !== '0');
  await mobile.getByRole('button', { name: 'Pause simulation' }).click();
  await mobile.getByRole('button', { name: 'Inspect neuron' }).click();
  assert.equal(await mobile.locator('#neuron-detail').isVisible(), true);
  await mobile.screenshot({ path: 'browser-results/neural-activity.png', fullPage: true });
  await phone.close();
  assert.deepEqual(errors, [], 'Browser pages must have no uncaught errors');
  console.log('WebGL, narrow viewport, offline reload and compatibility rendering passed.');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => {
    server.httpServer.close(error => error ? reject(error) : resolve());
    server.httpServer.closeAllConnections();
  });
  clearTimeout(deadline);
}
