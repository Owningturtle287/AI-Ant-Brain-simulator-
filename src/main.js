import './style.css';
import { ColonyArena } from './arena.js';
import { ScratchLab } from './scratch-lab.js';
import { labControls } from './lab-controls.js';
import { installBrainPanel } from './brain-panel.js';
import { groomingActions, groomZones } from './grooming.js';

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
  const labUI = labControls(arena);
  const launch = $('launch-menu');
  const choices = [...launch.querySelectorAll('[data-mode]')];
  const simulations = new Map([['colony', colony]]);
  let activeMode;
  let wasPaused = true;
  const play = $('play');
  const drawer = $('settings-panel');
  const settingsButton = $('settings-button');
  const brainDetails = $('brain-details');
  const card = $('ant-inspector');
  const dirt = $('ant-dirt');
  const indicators = {};
  for (const { key, zone } of groomingActions) {
    const row = document.createElement('li'), tag = document.createElement('span');
    const meter = document.createElement('progress'), readout = document.createElement('strong');
    tag.textContent = zone.name;
    meter.max = 1;
    meter.setAttribute('aria-label', zone.name + ' dirt');
    row.append(tag, meter, readout);
    $('dirt-list').append(row);
    indicators[key] = { meter, readout };
  }
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
    const show = activeMode === 'colony' && !drawer.hidden && brainDetails.open;
    arena.enableBrain(show);
    if (show && !brainReady) {
      installBrainPanel(arena);
      brainReady = true;
    }
  }

  function openSettings(open, returnFocus = true) {
    drawer.hidden = !open;
    settingsButton.setAttribute('aria-expanded', open);
    refreshBrain();
    if (!open && returnFocus) settingsButton.focus();
  }
  function closeCard() {
    arena.flags.selectedId = null;
    card.hidden = true;
    arena.dirty = true;
  }
  function updateCard() {
    const id = arena.flags.selectedId;
    if (id === null) { card.hidden = true; return; }
    const simulation = arena.colony;
    const agent = id === 0 ? simulation.queen : simulation.workers.find(worker => worker.id === id);
    if (!agent || agent.living === false) { closeCard(); return; }
    const queen = !!agent.queen;
    const labAnt = !!agent.body;
    text('ant-title', queen ? 'Queen' : (labAnt ? 'Ant ' : 'Worker ') + id);
    text('ant-activity', queen ? 'Nest queen' : agent.grooming ? 'Cleaning · ' + groomZones[agent.grooming.key].name
      : !labAnt && agent.lift > .15 ? 'Climbing' : agent.state);
    text('ant-food', percent(agent.food));
    text('ant-water', percent(agent.water));
    const seconds = Math.floor(queen ? colony.time : agent.age);
    text('ant-age', seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : seconds + 's');
    text('ant-generation-label', queen ? 'Eggs laid' : 'Generation');
    text('ant-generation', queen ? colony.stats.eggs : agent.generation);
    text('ant-contact-label', queen ? 'Deliveries' : 'Last contact');
    text('ant-contact', queen ? colony.stats.delivered : agent.lastTouch?.kind ?? '—');
    text('ant-groomed-label', queen ? 'Brood' : labAnt ? 'Motor trials kept' : 'Last cleaned');
    text('ant-groomed', queen ? colony.brood.length : labAnt ? agent.controller.updates : groomZones[agent.lastCleaned]?.name ?? '—');
    dirt.hidden = queen || labAnt;
    $('open-ant-brain').hidden = queen || labAnt;
    $('save-ant-weights').hidden = !labAnt;
    text('follow-ant', queen ? 'Focus nest' : labAnt ? 'Follow ant' : 'Follow worker');
    if (!dirt.hidden && dirt.open) for (const [key, { meter, readout }] of Object.entries(indicators)) {
      const value = agent.grime[key];
      meter.value = value;
      readout.textContent = percent(value);
    }
  }
  arena.onPick = () => {
    if (!drawer.hidden) openSettings(false, false);
    if (labUI.visible) labUI.open(false);
    dirt.open = false;
    updateCard();
    card.hidden = false;
  };
  dirt.addEventListener('toggle', updateCard);
  $('close-ant').addEventListener('click', closeCard);
  $('follow-ant').addEventListener('click', () => {
    arena.setView(arena.flags.selectedId === 0 ? 'nest' : 'worker');
    updateStats();
  });
  $('open-ant-brain').addEventListener('click', () => {
    if (arena.flags.selectedId > 0) arena.inspect(arena.flags.selectedId);
    closeCard();
    brainDetails.open = true;
    openSettings(true);
    brainDetails.querySelector('summary').scrollIntoView({ block: 'nearest' });
  });
  settingsButton.addEventListener('click', () => {
    if (arena.colony.mode) {
      const opening = !labUI.visible;
      if (opening) closeCard();
      labUI.open(opening);
    } else openSettings(drawer.hidden);
  });
  $('settings-close').addEventListener('click', () => openSettings(false));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || launch.open) return;
    if (arena.placeOnGround) labUI.end();
    else if (labUI.visible) labUI.open(false);
    else if (!drawer.hidden) openSettings(false);
    else if (!card.hidden) closeCard();
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
    const seconds = Math.floor(arena.colony.time);
    text('sim-time', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
    $('world').dataset.paused = arena.flags.paused;
    play.setAttribute('aria-label', arena.flags.paused ? 'Play simulation' : 'Pause simulation');
    const glyph = play.querySelector('i');
    const iconName = arena.flags.paused ? 'play' : 'pause';
    if (glyph.dataset.icon !== iconName) {
      glyph.dataset.icon = iconName;
      glyph.innerHTML = icon(iconName);
    }
    for (const view of views) view.setAttribute('aria-pressed', arena.mode === view.dataset.view);
    updateCard();
    if (arena.colony.mode) {
      text('worker-state', arena.selected?.state ?? 'Empty habitat');
      labUI.stats(text);
      return;
    }
    const { queen, stats, signals } = colony;
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
    const current = arena.selected;
    text('worker-state', current?.grooming ? 'Cleaning ' + groomZones[current.grooming.key].name.toLowerCase()
      : current?.state ?? 'Colony stopped');
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
  function showMenu() {
    wasPaused = activeMode ? arena.flags.paused : reduced.matches;
    arena.flags.paused = true;
    labUI.end();
    $('resume-mode').hidden = !activeMode;
    launch.showModal();
    updateStats();
  }

  function choose(mode) {
    if (activeMode && activeMode !== mode) simulations.get(activeMode).paused = wasPaused;
    if (!simulations.has(mode)) simulations.set(mode, new ScratchLab(mode));
    const next = simulations.get(mode);
    const changed = mode !== activeMode;
    activeMode = mode;
    if (changed) {
      openSettings(false, false);
      closeCard();
      arena.switchSimulation(next);
      labUI.configure();
      $('colony-hud').hidden = !!next.mode;
      $('lab-hud').hidden = !next.mode;
      $('failure').hidden = true;
      $('world').dataset.simulation = mode;
      text('nest-view', next.mode ? 'Center' : 'Nest');
      text('worker-view', next.mode ? 'Ant' : 'Worker');
      settingsButton.querySelector('span').textContent = next.mode ? 'Training tools' : 'Settings';
      settingsButton.setAttribute('aria-controls', next.mode ? 'lab-panel' : 'settings-panel');
      for (const choice of choices) choice.setAttribute('aria-current', String(choice.dataset.mode === mode));
    }
    arena.flags.paused = changed ? next.paused ?? reduced.matches : wasPaused;
    launch.close();
    updateStats();
    $('mode-menu').focus();
  }

  for (const choice of choices) choice.addEventListener('click', () => choose(choice.dataset.mode));
  $('mode-menu').addEventListener('click', showMenu);
  $('resume-mode').addEventListener('click', () => choose(activeMode));
  launch.addEventListener('cancel', event => {
    event.preventDefault();
    if (activeMode) choose(activeMode);
  });
  arena.onStats = updateStats;
  showMenu();
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
