import { labCapacity } from './scratch-lab.js';
import { readGenome, snapshot } from './lab-policy.js';

const $ = id => document.getElementById(id);
const bankKey = 'fire-ant-lab-weights-v1';
const toolNames = { food: 'food', water: 'water', spawn: 'ants', erase: 'a resource to remove' };

function loadBank() {
  try {
    const parsed = JSON.parse(localStorage.getItem(bankKey) ?? '[]');
    return parsed.slice(0, 100).flatMap(item => {
      try {
        if (typeof item.id !== 'string' || typeof item.name !== 'string') return [];
        return [{ id: item.id, name: item.name.slice(0, 75), genome: readGenome(item.genome) }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function labControls(arena) {
  const panel = $('lab-panel');
  const tool = $('placement-tool');
  const count = $('placement-quantity');
  const selector = $('placement-genome');
  const bankSelect = $('weights-bank');
  const bank = loadBank();
  const lab = () => arena.colony;
  let notificationTimer;
  let roster = '';

  function message(value) {
    const notice = $('lab-notice');
    clearTimeout(notificationTimer);
    notice.textContent = value;
    notice.hidden = !value;
    if (value) notificationTimer = setTimeout(() => { notice.hidden = true; }, 5000);
  }

  function populateBank(selected = selector.value, current = bankSelect.value) {
    const options = bank.map(entry => new Option(entry.name, entry.id));
    selector.replaceChildren(new Option('Fresh · zero weights', ''), ...options);
    bankSelect.replaceChildren(...bank.map(entry => new Option(entry.name, entry.id)));
    if (bank.some(item => item.id === selected)) selector.value = selected;
    if (bank.some(item => item.id === current)) bankSelect.value = current;
    $('export-genome').disabled = $('delete-genome').disabled = bank.length === 0;
    bankSelect.disabled = bank.length === 0;
    if (!bank.length) bankSelect.add(new Option('No saved weights', ''));
  }

  function persist() {
    try {
      localStorage.setItem(bankKey, JSON.stringify(bank));
      return true;
    } catch {
      return false;
    }
  }

  function save(name, genome) {
    if (bank.length >= 100) {
      message('Saved weights are full. Download and remove an entry before saving another.');
      return;
    }
    const id = crypto.randomUUID?.() ?? String(Date.now()) + Math.random();
    bank.push({ id, name, genome });
    populateBank(id, id);
    message(persist() ? 'Weights saved. Use them for your next spawn.' : 'Weights saved for this session. Download a copy to keep them.');
  }

  function updateTool() {
    const spawn = tool.value === 'spawn';
    const individual = lab().mode === 'individual';
    tool.querySelector('[value="spawn"]').disabled = individual && lab().workers.length > 0;
    if (tool.selectedOptions[0].disabled) tool.value = 'food';
    const antTool = tool.value === 'spawn';
    count.hidden = $('quantity-label').hidden = tool.value === 'erase';
    selector.hidden = $('genome-label').hidden = !antTool;
    count.max = antTool ? (individual ? 1 : labCapacity) : 1000;
    if (antTool !== spawn) count.value = 25;
    else if (Number(count.value) > Number(count.max)) count.value = count.max;
    $('quantity-label').textContent = antTool ? 'Ants per placement' : 'Resource units per pile';
  }

  function end() {
    arena.placeOnGround = null;
    $('world').dataset.placing = 'false';
    $('lab-placement').hidden = true;
  }

  function open(visible) {
    panel.hidden = !visible;
    if (visible) {
      end();
      updateTool();
      message('');
    }
    $('settings-button').setAttribute('aria-expanded', visible);
    if (!visible) $('settings-button').focus();
  }

  function place(point) {
    const world = lab();
    const quantity = Math.max(1, Math.min(Number(count.max), Math.floor(Number(count.value)) || 1));
    if (tool.value === 'spawn') {
      let made = 0;
      const genome = bank.find(item => item.id === selector.value)?.genome;
      for (let i = 0; i < quantity && world.workers.length < world.limits; i++) {
        const angle = i * 2.399963, radius = 1.3 * Math.sqrt(i);
        if (world.spawn(point.x + Math.cos(angle) * radius, point.z + Math.sin(angle) * radius, genome)) made++;
      }
      if (made) {
        message(`Added ${made} ${made === 1 ? 'ant' : 'ants'}${genome ? ' with saved weights' : ''}.`);
        if (world.mode === 'individual') {
          arena.inspect(world.workers[0].id);
          arena.setView('worker');
          end();
        }
      } else message(world.workers.length >= world.limits ? 'This habitat is at its ant limit.' : 'There’s no room here. Try another spot.');
    } else if (tool.value === 'erase') {
      message(world.eraseResource(point.x, point.z) ? 'Resource removed.' : 'No resource at that spot.');
    } else {
      world.addResource(tool.value, point.x, point.z, quantity);
      message(tool.value === 'food' ? 'Food placed.' : 'Water placed.');
    }
    arena.dirty = true;
    arena.onStats?.();
  }

  $('close-lab').addEventListener('click', () => open(false));
  $('end-placement').addEventListener('click', end);
  $('begin-placement').addEventListener('click', () => {
    open(false);
    arena.placeOnGround = place;
    $('world').dataset.placing = 'true';
    $('lab-placement').hidden = false;
    $('placement-label').textContent = 'Tap the ground · ' + toolNames[tool.value];
  });
  $('place-center').addEventListener('click', () => place(arena.orbit.target));
  tool.addEventListener('change', () => {
    count.value = tool.value === 'spawn' ? 1 : 25;
    updateTool();
  });
  $('lab-ant-picker').addEventListener('change', event => {
    const id = Number(event.target.value);
    if (!lab().workers.some(ant => ant.id === id)) return;
    arena.flags.selectedId = id;
    arena.inspect(id);
    arena.onPick?.(id);
    event.target.value = '';
  });
  const settings = { 'lab-learning': 'learning', 'lab-needs': 'whichNeeds', 'lab-reproduce': 'reproduction' };
  for (const [id, key] of Object.entries(settings)) $(id).addEventListener('change', event => {
    lab().settings[key] = event.target.checked;
  });
  $('lab-renewal').addEventListener('change', event => {
    const input = event.target;
    const now = lab();
    for (const tile of now.map.chunks.values()) for (const patch of tile.resources) now.map.refill(patch, now.time);
    input.value = now.settings.resourceRenewal = Math.min(5, Math.max(0, Number(input.value) || 0));
  });
  for (const [id, key] of [['lab-joints', 'joints'], ['lab-feet', 'contacts']]) $(id).addEventListener('change', event => {
    arena.flags[key] = event.target.checked;
    arena.dirty = true;
  });
  $('reset-lab').addEventListener('click', () => {
    if (!window.confirm('Reset this habitat and lose its current ants and resources? Saved weights are kept.')) return;
    end();
    arena.restart();
    updateTool();
  });
  $('save-ant-weights').addEventListener('click', () => {
    const ant = lab().workers.find(worker => worker.id === arena.flags.selectedId);
    if (!ant?.body) return;
    save(`Ant ${ant.id} · gen ${ant.generation} · ${Math.round(ant.age)}s`, snapshot(ant));
  });
  $('import-genome').addEventListener('click', () => $('genome-file').click());
  $('genome-file').addEventListener('change', async event => {
    const input = event.target;
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('Weight files must be smaller than 64 KB.');
      save(file.name.replace(/\.json$/i, '').slice(0, 75), readGenome(JSON.parse(await file.text())));
    } catch (error) {
      message(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message);
    }
  });
  $('export-genome').addEventListener('click', () => {
    const entry = bank.find(item => item.id === bankSelect.value);
    if (!entry) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(entry.genome)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `fire-ant-weights-${entry.genome.generation}-${entry.id.slice(0, 8)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('delete-genome').addEventListener('click', () => {
    const index = bank.findIndex(item => item.id === bankSelect.value);
    if (index < 0 || !window.confirm('Remove these saved weights from this device?')) return;
    bank.splice(index, 1);
    populateBank();
    if (!persist()) message('Storage is unavailable. Changes apply to this session.');
  });
  populateBank();

  return {
    open,
    end,
    get visible() { return !panel.hidden; },
    configure() {
      panel.hidden = true;
      end();
      message('');
      if (!lab().mode) return;
      $('lab-reproduce').disabled = lab().mode === 'individual';
      for (const [id, key] of Object.entries(settings)) $(id).checked = lab().settings[key];
      $('lab-renewal').value = lab().settings.resourceRenewal;
      $('lab-joints').checked = arena.flags.joints;
      $('lab-feet').checked = arena.flags.contacts;
      updateTool();
    },
    stats(update) {
      const world = lab();
      update('lab-ants', world.workers.length);
      update('lab-updates', world.stats.updates);
      update('lab-born', world.stats.born);
      update('lab-fed', world.stats.food.toFixed(2));
      update('lab-drank', world.stats.water.toFixed(2));
      update('lab-contact-count', world.stats.contacts);
      update('lab-shared', world.stats.shared.toFixed(2));
      update('lab-population-note', world.workers.length >= world.limits && world.mode === 'scratch' ? 'Habitat limit reached'
        : world.workers.length ? '' : 'Add ants from Training tools');
      if (!panel.hidden) updateTool();
      const key = world.workers.map(ant => ant.id).join(',');
      if (key !== roster) {
        roster = key;
        const placeholder = new Option('Select an ant', '');
        placeholder.disabled = true;
        placeholder.selected = true;
        $('lab-ant-picker').replaceChildren(placeholder, ...world.workers.map(ant => new Option('Ant ' + ant.id, ant.id)));
      }
      $('lab-ant-picker').disabled = !world.workers.length;
    },
  };
}
