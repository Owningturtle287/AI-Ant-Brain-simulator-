import { BrainView } from './brain-view.js';
import { neuronCount, regions } from './brain.js';

const $ = id => document.getElementById(id);
const count = new Intl.NumberFormat().format;
const put = (element, value) => {
  if (element.textContent !== value) element.textContent = value;
};

export function installBrainPanel(arena, setPointerMode) {
  const { worker } = arena;
  const { brain } = worker;
  const panel = $('brain-panel');
  const active = $('brain-active');
  const delivered = $('food-count');
  const behavior = $('worker-state');
  const regionMenu = $('brain-region');
  const orientation = $('brain-view');
  const links = $('brain-links');
  const inspect = $('inspect-neuron');
  const clear = $('clear-neuron');
  const description = $('brain-description');
  const detail = $('neuron-detail');
  const name = $('neuron-name');
  const status = $('neuron-status');
  const sources = $('neuron-sources');

  $('brain-count').textContent = count(neuronCount);
  const rows = $('region-counts');
  for (const [id, region] of regions.entries()) {
    regionMenu.add(new Option(region.name, id));
    const row = rows.insertRow();
    row.insertCell().textContent = region.name;
    row.insertCell().textContent = count(region.count);
  }
  let selection = { region: -1, posterior: false, links: true, neuron: null };
  const view = new BrainView($('brain-canvas'), brain, neuron => configure({ neuron }));
  const trail = $('show-trail');

  function configure(changes) {
    selection = { ...selection, ...changes };
    const { region, posterior, neuron } = selection;
    orientation.setAttribute('aria-pressed', posterior);
    orientation.querySelector('span').textContent = posterior ? 'Front view' : 'Rear view';
    links.setAttribute('aria-pressed', selection.links);
    detail.hidden = neuron === null;
    clear.hidden = neuron === null;
    inspect.textContent = neuron === null ? 'Inspect neuron' : 'Next neuron';
    if (neuron !== null) {
      const area = regions[brain.regionOf[neuron]];
      name.textContent = 'Neuron ' + count(neuron + 1) + ' · ' + area.short;
      sources.replaceChildren();
      for (let i = 0; i < 3; i++) {
        const item = document.createElement('li');
        const edge = neuron * 3 + i;
        const source = brain.sources[edge];
        item.textContent = `${regions[brain.regionOf[source]].short} #${count(source + 1)}`;
        item.dataset.sign = brain.weights[edge] > 0 ? 'Excites' : 'Inhibits';
        item.dataset.source = source;
        sources.append(item);
      }
    }
    view.update(selection);
    updateText();
    if (region >= 0) description.style.setProperty('--region-color', regions[region].color);
    else description.style.removeProperty('--region-color');
  }

  function updateText() {
    put(behavior, worker.state);
    put(active, count(brain.active));
    put(delivered, count(worker.delivered));
    if (selection.region < 0) {
      put(description, 'Bright dots show firing in the displayed sample. Tap a dot to inspect its inputs.');
    } else {
      const region = regions[selection.region];
      put(description, `${count(region.count)} modeled · ${count(brain.totals[selection.region])} firing. ${region.function}`);
    }
    if (selection.neuron !== null) {
      put(status, brain.spikes[selection.neuron] ? 'Firing' : 'Quiet');
      status.dataset.firing = Boolean(brain.spikes[selection.neuron]);
      for (const item of sources.children) item.dataset.firing = Boolean(brain.previousSpikes[Number(item.dataset.source)]);
    }
  }

  regionMenu.addEventListener('change', () => configure({ region: Number(regionMenu.value), neuron: null }));
  orientation.addEventListener('click', () => configure({ posterior: !selection.posterior }));
  links.addEventListener('click', () => configure({ links: !selection.links }));
  clear.addEventListener('click', () => {
    configure({ neuron: null });
    inspect.focus();
  });
  inspect.addEventListener('click', () => {
    const candidates = view.model.filter(point => selection.region < 0 || selection.region === point.region);
    const previous = candidates.findIndex(point => point.id === selection.neuron);
    const point = previous < 0 ? candidates.find(point => brain.spikes[point.id]) ?? candidates[0]
      : candidates[(previous + 1) % candidates.length];
    configure({ neuron: point.id });
  });

  $('place-food').addEventListener('click', () => {
    const activate = !arena.flags.food;
    setPointerMode(activate ? 'food' : null);
    if (activate) $('stage').scrollIntoView({ block: 'nearest' });
  });
  arena.onFoodPlaced = () => setPointerMode(null);
  trail.addEventListener('click', () => {
    arena.flags.trail = !arena.flags.trail;
    trail.setAttribute('aria-pressed', arena.flags.trail);
    trail.querySelector('span').textContent = arena.flags.trail ? 'Hide trail' : 'Show trail';
    arena.dirty = true;
  });
  $('clear-trail').addEventListener('click', () => {
    worker.trail = [];
    worker.lastDeposit = null;
    arena.dirty = true;
  });

  arena.onFrame = () => {
    if (!panel.hidden) view.draw();
  };
  arena.onBrainStats = updateText;
  configure({});
}
