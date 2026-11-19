import './style.css';
import { Arena } from './arena.js';

const icons = {
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8.9c0 1.8-2.9 2.25-2.9 4M12 17h.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9"/>',
  top: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 12h6m-3-3v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  pointer: '<path d="m5 4 14 8-7 1-2 7L5 4Z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  pause: '<path fill="currentColor" stroke="none" d="M8 5h3v14H8zm5 0h3v14h-3z"/>',
  play: '<path fill="currentColor" stroke="none" d="M8 5l11 7-11 7z"/>',
  reset: '<path d="M4 11a8 8 0 1 1 2 6m-2-6V5m0 6h6"/>',
  ant: '<path d="M10 6 8 3m6 3 2-3M5 8l3 2m8 0 3-2M4 13h4m8 0h4M6 18l2-2m8 0 2 2"/><ellipse cx="12" cy="7.5" rx="3" ry="2.5"/><ellipse cx="12" cy="12" rx="3.5" ry="2.5"/><ellipse cx="12" cy="17.5" rx="3.2" ry="3"/>',
  terrain: '<path d="m3 17 6-9 4 6 3-4 5 7H3Zm5-8 1-2m7-2h.01"/>',
  joints: '<circle cx="6" cy="17" r="2"/><circle cx="12" cy="7" r="2"/><circle cx="19" cy="14" r="2"/><path d="m7 15 4-6m3-1 4 4"/>',
  steps: '<path d="M7 12c-2 0-3 2-3 4s1 3 2 3c2 0 3-2 3-4s-1-3-2-3Zm9-7c-2 0-3 2-3 4s1 3 2 3c2 0 3-2 3-4s-1-3-2-3Z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};

const $ = id => document.getElementById(id);
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);

const tabs = [$('specimen-tab'), $('terrain-tab')];
function selectTab(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', selected);
    item.tabIndex = selected ? 0 : -1;
    $(item.getAttribute('aria-controls')).hidden = !selected;
  }
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs.find(item => item !== tab);
    selectTab(next);
    next.focus();
  });
}

const help = $('help');
$('open-help').addEventListener('click', () => help.showModal());
$('close-help').addEventListener('click', () => help.close());

let installEvent;
const install = $('install');
const appleMobile = /iP(?:ad|hone|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (appleMobile && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches) install.hidden = false;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installEvent = event;
  install.hidden = false;
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  install.hidden = true;
});
install.addEventListener('click', async () => {
  if (!installEvent) return help.showModal();
  await installEvent.prompt();
  installEvent = null;
  install.hidden = true;
});

function updateStats(seconds, planted) {
  const elapsed = Math.floor(seconds);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const remainder = String(elapsed % 60).padStart(2, '0');
  $('sim-time').textContent = `${minutes}:${remainder}`;
  $('foot-count').firstChild.nodeValue = `${planted} `;
}

function setPaused(arena, paused) {
  arena.flags.paused = paused;
  const play = $('play');
  play.setAttribute('aria-label', paused ? 'Play simulation' : 'Pause simulation');
  play.querySelector('span').textContent = paused ? 'Play' : 'Pause';
  play.querySelector('i').innerHTML = icon(paused ? 'play' : 'pause');
  const status = $('sim-status');
  status.dataset.paused = paused;
  status.querySelector('strong').textContent = paused ? 'Paused' : 'Running';
}

function controls(arena) {
  const play = $('play');
  play.addEventListener('click', () => setPaused(arena, !arena.flags.paused));
  $('reset').addEventListener('click', () => arena.reset());
  $('speed').addEventListener('change', event => { arena.flags.rate = Number(event.target.value); });
  for (const [id, camera] of [['orbit', 'orbit'], ['overhead', 'top']]) {
    $(id).addEventListener('click', () => {
      arena.setView(camera);
      $('orbit').setAttribute('aria-pressed', camera === 'orbit');
      $('overhead').setAttribute('aria-pressed', camera === 'top');
    });
  }
  $('zoom-in').addEventListener('click', () => arena.zoom(.78));
  $('zoom-out').addEventListener('click', () => arena.zoom(1.28));
  for (const flag of ['joints', 'contacts']) {
    $(flag).addEventListener('change', event => {
      arena.flags[flag] = event.target.checked;
      arena.dirty = true;
    });
  }
  const guide = $('guide');
  guide.addEventListener('click', () => {
    arena.flags.guide = !arena.flags.guide;
    const active = arena.flags.guide;
    guide.setAttribute('aria-pressed', active);
    $('arena-hint').querySelector('span').textContent = active ? 'Tap ground to guide the ant' : 'Drag to orbit · Pinch or scroll to zoom';
    if (!active) {
      arena.motion.destination = null;
      arena.compass.visible = false;
      arena.dirty = true;
    }
  });
  const terrains = document.querySelectorAll('[data-terrain]');
  for (const button of terrains) {
    button.addEventListener('click', () => {
      if (arena.motion.terrain === button.dataset.terrain) return;
      arena.setTerrain(button.dataset.terrain);
      for (const item of terrains) item.setAttribute('aria-pressed', item === button);
    });
  }
  $('quality').addEventListener('change', event => arena.setQuality(event.target.value));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  setPaused(arena, reduced.matches);
  reduced.addEventListener('change', event => {
    if (event.matches) setPaused(arena, true);
  });
}

const host = $('canvas-host');
try {
  const arena = new Arena(host, updateStats);
  controls(arena);
  arena.renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    setPaused(arena, true);
  });
  arena.renderer.domElement.addEventListener('webglcontextrestored', () => requestAnimationFrame(() => {
    arena.renderer.shadowMap.needsUpdate = true;
    arena.dirty = true;
  }));
} catch (error) {
  console.error(error);
  const warning = document.createElement('p');
  warning.id = 'render-message';
  warning.textContent = 'The 3D arena needs WebGL 2. Try a current browser with hardware acceleration enabled.';
  host.replaceChildren(warning);
  $('sim-status').dataset.paused = true;
  $('sim-status').querySelector('strong').textContent = '3D unavailable';
  for (const button of document.querySelectorAll('.view-tools button, .transport button, .transport select, .guide-tools button, [data-terrain], #quality, .toggle-row input')) button.disabled = true;
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Offline setup failed.', error));
  });
}
