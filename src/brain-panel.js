import { BrainView } from './brain-view.js';
import { neuronCount, regions } from './brain.js';

const $ = id => document.getElementById(id);
const format = new Intl.NumberFormat('en-US').format;

export function installBrainPanel(arena) {
  const { brain } = arena;
  const regionMenu = $('brain-region');
  const orientation = $('brain-view');
  const links = $('brain-links');
  const detail = $('neuron-detail');
  for (const [id, region] of regions.entries()) regionMenu.add(new Option(region.name, id));
  $('brain-count').textContent = format(neuronCount);
  let selection = { region: -1, posterior: false, links: true, neuron: null };
  const view = new BrainView($('brain-canvas'), brain, neuron => configure({ neuron }));

  function render() {
    $('brain-active').textContent = format(brain.active);
    const { region, neuron } = selection;
    $('brain-description').textContent = region < 0 ? 'Bright dots show firing in the displayed sample. Tap a dot to inspect its inputs.'
      : `${format(regions[region].count)} modeled · ${format(brain.totals[region])} firing. ${regions[region].function}`;
    if (neuron !== null) $('neuron-status').textContent = brain.spikes[neuron] ? '· Firing' : '· Quiet';
    view.draw();
  }

  function configure(changes) {
    selection = { ...selection, ...changes };
    const { posterior, neuron } = selection;
    orientation.setAttribute('aria-pressed', posterior);
    orientation.textContent = posterior ? 'Front view' : 'Rear view';
    links.setAttribute('aria-pressed', selection.links);
    detail.hidden = neuron === null;
    if (neuron !== null) {
      $('neuron-name').textContent = 'Neuron ' + format(neuron + 1) + ' · ' + regions[brain.regionOf[neuron]].short;
      const items = Array.from({ length: 3 }, (_, i) => {
        const item = document.createElement('li');
        const edge = neuron * 3 + i, source = brain.sources[edge];
        const sign = brain.weights[edge] > 0 ? 'Excites' : 'Inhibits';
        item.textContent = `${regions[brain.regionOf[source]].short} #${format(source + 1)} · ${sign}`;
        return item;
      });
      $('neuron-sources').replaceChildren(...items);
    }
    view.update(selection);
    render();
  }
  regionMenu.addEventListener('change', () => configure({ region: Number(regionMenu.value), neuron: null }));
  orientation.addEventListener('click', () => configure({ posterior: !selection.posterior }));
  links.addEventListener('click', () => configure({ links: !selection.links }));
  arena.onBrain = render;
  configure({});
}
