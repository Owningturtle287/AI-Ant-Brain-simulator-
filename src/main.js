import './style.css';
import { ColonyArena } from './arena.js';
import { installBrainPanel } from './brain-panel.js';

const $ = id => document.getElementById(id);
const icons = {
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.5" fill="#1b2119"/><circle cx="15" cy="17" r="2.5" fill="#1b2119"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  pause: '<path fill="currentColor" stroke="none" d="M8 5h3v14H8zm5 0h3v14h-3z"/>',
  play: '<path fill="currentColor" stroke="none" d="M8 5l11 7-11 7z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}
for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);

function storage(key, value) {
  try {
    if (value !== undefined) localStorage.setItem(key, JSON.stringify(value));
    else return JSON.parse(localStorage.getItem(key));
  } catch {
    // Private storage may be unavailable. The colony still runs in memory.
  }
  return null;
}
const settingsKey = 'fire-ant-colony-settings-v1';
const championKey = 'fire-ant-colony-champion-v1';
const settingsInputs = [...document.querySelectorAll('[data-setting]')];
const stored = storage(settingsKey) ?? {};

function readSetting(input, candidate) {
  if (input.type === 'checkbox') return typeof candidate === 'boolean' ? candidate : input.defaultChecked;
  const value = candidate === '' || candidate === null ? NaN : Number(candidate);
  return Number.isFinite(value) ? Math.max(Number(input.min), Math.min(Number(input.max), value)) : Number(input.defaultValue);
}
const settings = Object.fromEntries(settingsInputs.map(input => {
  const key = input.dataset.setting;
  const value = readSetting(input, stored[key]);
  if (input.type === 'checkbox') input.checked = value;
  else input.value = value;
  return [key, value];
}));

let installEvent;
const install = $('install');
const apple = /iP(?:ad|hone|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (apple && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches) install.hidden = false;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installEvent = event;
  install.hidden = false;
});
window.addEventListener('appinstalled', () => { install.hidden = true; });
install.addEventListener('click', async () => {
  if (!installEvent) {
    window.alert('In Safari, use Share → Add to Home Screen.');
    return;
  }
  await installEvent.prompt();
  installEvent = null;
  install.hidden = true;
});

const text = (id, value) => {
  const item = $(id);
  const next = String(value);
  if (item.textContent !== next) item.textContent = next;
};
const percent = value => `${Math.round(value * 100)}%`;

function controls(arena) {
  const { colony } = arena;
  const play = $('play');
  const drawer = $('settings-panel');
  const settingsButton = $('settings-button');
  const brainDetails = $('brain-details');
  const picker = $('worker-picker');
  const views = [...document.querySelectorAll('[data-view]')];
  let brainReady = false;
  let lastBest = null;
  let previousOptions = '';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  arena.flags.paused = reduced.matches;
  $('render-mode').hidden = !arena.software;
  $('quality').disabled = arena.software;

  function refreshBrain() {
    const show = !drawer.hidden && brainDetails.open;
    arena.enableBrain(show);
    if (show && !brainReady) {
      installBrainPanel(arena);
      brainReady = true;
    }
  }

  function openSettings(open) {
    drawer.hidden = !open;
    settingsButton.setAttribute('aria-expanded', open);
    refreshBrain();
    if (!open) settingsButton.focus();
  }
  settingsButton.addEventListener('click', () => openSettings(drawer.hidden));
  $('settings-close').addEventListener('click', () => openSettings(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !drawer.hidden) openSettings(false);
  });
  brainDetails.addEventListener('toggle', refreshBrain);
  picker.addEventListener('change', () => {
    arena.inspect(Number(picker.value));
    updateStats();
  });
  for (const input of settingsInputs) {
    input.addEventListener('change', () => {
      const value = readSetting(input, input.type === 'checkbox' ? input.checked : input.value);
      colony.settings[input.dataset.setting] = value;
      if (input.type !== 'checkbox') input.value = value;
      storage(settingsKey, colony.settings);
    });
  }
  for (const input of document.querySelectorAll('[data-visual]')) {
    input.addEventListener('change', () => {
      arena.flags[input.dataset.visual] = input.checked;
      arena.dirty = true;
    });
  }
  play.addEventListener('click', () => {
    arena.flags.paused = !arena.flags.paused;
    updateStats();
  });
  reduced.addEventListener('change', event => {
    if (event.matches) arena.flags.paused = true;
    updateStats();
  });
  $('speed').addEventListener('change', event => { arena.flags.rate = Number(event.target.value); });
  $('quality').addEventListener('change', event => arena.setQuality(event.target.value));
  $('restart').addEventListener('click', () => arena.restart());
  $('zoom-in').addEventListener('click', () => arena.zoom(.78));
  $('zoom-out').addEventListener('click', () => arena.zoom(1.28));
  for (const view of views) view.addEventListener('click', () => { arena.setView(view.dataset.view); updateStats(); });

  function updateStats() {
    const { queen, stats, signals } = colony;
    const seconds = Math.floor(colony.time);
    text('sim-time', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    text('run-label', `Run ${colony.run}`);
    text('adults', colony.workers.length);
    text('brood-total', colony.brood.length);
    const brood = [0, 0, 0];
    for (const item of colony.brood) brood[item.stage]++;
    for (const [stage, id] of ['egg-count', 'larva-count', 'pupa-count'].entries()) text(id, brood[stage]);
    for (const kind of ['food', 'water']) {
      $(`queen-${kind}`).value = queen[kind];
      text(`queen-${kind}-value`, percent(queen[kind]));
    }
    text('worker-state', arena.selected?.state ?? 'Colony stopped');
    $('world').dataset.paused = arena.flags.paused;
    play.setAttribute('aria-label', arena.flags.paused ? 'Play simulation' : 'Pause simulation');
    const glyph = play.querySelector('i');
    const iconName = arena.flags.paused ? 'play' : 'pause';
    if (glyph.dataset.icon !== iconName) {
      glyph.dataset.icon = iconName;
      glyph.innerHTML = icon(iconName);
    }
    for (const view of views) view.setAttribute('aria-pressed', arena.mode === view.dataset.view);
    const failure = $('failure');
    failure.hidden = !colony.failed;
    text('failure', colony.failed ? `${colony.failed} · ${colony.settings.restart ? 'Restarting' : 'Run ended'}` : '');
    text('hatched', stats.hatched);
    text('policy-updates', stats.updates);
    text('care-visits', stats.care);
    text('deliveries', stats.delivered);
    text('shared', stats.shared);
    text('exchanges', stats.exchanges);
    text('best-score', colony.best?.score.toFixed(1) ?? '—');
    text('world-seed', colony.seed);
    $('queen-food').title = `Need signal ${percent(signals.food)}`;
    $('queen-water').title = `Need signal ${percent(signals.water)}`;
    const selected = arena.selected;
    const optionKey = colony.workers.map(worker => worker.id).join(',');
    if (previousOptions !== optionKey) {
      previousOptions = optionKey;
      picker.replaceChildren(...colony.workers.map(worker => new Option(`Worker ${worker.id}`, worker.id)));
    }
    if (selected) {
      if (picker.value !== String(selected.id)) picker.value = selected.id;
      text('generation', selected.generation);
      text('worker-reserves', `${percent(selected.food)} · ${percent(selected.water)}`);
      text('weight-count', selected.weights.length);
      text('worker-reward', selected.reward.toFixed(1));
      const touched = selected.lastTouch?.kind;
      text('last-touch', touched ? touched[0].toUpperCase() + touched.slice(1) : '—');
    } else {
      for (const id of ['generation', 'worker-reserves', 'weight-count', 'worker-reward', 'last-touch']) text(id, '—');
    }
    if (colony.best && lastBest !== colony.best) {
      lastBest = colony.best;
      storage(championKey, colony.best);
    }
  }
  arena.onStats = updateStats;
  updateStats();
}

const host = $('canvas-host');
try {
  const arena = new ColonyArena(host, settings, 8241, storage(championKey));
  controls(arena);
} catch (error) {
  console.error(error);
  const message = document.createElement('p');
  message.textContent = 'The colony could not start. Reload Fire Ant Lab to try again.';
  host.replaceChildren(message);
  for (const control of document.querySelectorAll('main button, main select')) control.disabled = true;
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      if (navigator.onLine) await registration.update();
    } catch (error) {
      if (navigator.onLine) console.warn('Offline setup failed.', error);
    }
  });
}
