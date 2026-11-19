import { AL, CB, CX, LH, MB, OL, SEZ, regions, seeded } from './brain.js';

const width = 400, height = 272;
const axis = 200;
const centers = [
  [[120, 77, 27, 19], [158, 79, 23, 17], [142, 108, 13, 18], [170, 123, 19, 8]],
  [[138, 163, 26, 21]], [[62, 119, 15, 27]],
  [[105, 116, 22, 17]], [[179, 143, 20, 11]],
  [[184, 210, 14, 24]], [[119, 129, 35, 30], [159, 111, 24, 28], [158, 158, 23, 19]],
];
const paths = {
  mantle: 'M203 107 C181 100 174 65 147 55 C120 43 89 53 75 76 C55 91 60 121 73 143 C88 165 109 171 126 176 C146 186 159 184 177 172 C188 162 204 160 205 151Z',
  opticStem: 'M69 100 C84 102 98 109 101 116 C92 128 87 136 68 140 L57 130Z',
  optic: 'M62 85 C39 92 35 112 43 134 C47 147 57 152 67 150 C59 139 59 116 67 100 Q71 90 62 85Z',
  medulla: 'M73 94 C62 98 56 109 57 122 C60 138 65 144 73 142 C82 136 85 117 82 106 Q81 95 73 94Z',
  mbStalk: 'M115 85 C126 99 136 106 149 112 C150 120 150 127 157 132 C167 138 180 133 188 126 L185 116 C171 121 161 116 157 109 C156 98 154 87 150 81Z',
  calyxOuter: 'M90 79 C90 66 100 60 116 58 C135 55 148 61 148 70 C146 81 137 90 123 94 C107 95 96 90 90 79Z',
  calyxInner: 'M133 79 C134 68 145 62 158 64 C172 65 181 74 177 84 C172 94 163 98 150 96 C141 93 136 87 133 79Z',
  lateral: 'M86 113 Q93 98 112 101 C126 103 133 113 128 125 C120 137 103 137 89 127Z',
  antennalTract: 'M130 145 C137 131 143 125 157 119 C163 116 169 119 166 123 C152 133 146 141 143 153Z',
  antennalNerve: 'M118 172 C108 178 96 183 86 193 C83 198 87 200 91 197 C101 189 113 184 129 181Z',
  antennal: 'M111 157 C115 143 126 139 141 140 C156 141 167 148 167 160 C166 176 155 184 138 184 C122 185 108 174 111 157Z',
  connective: 'M174 167 C165 177 166 190 169 199 L184 203 C182 193 183 185 187 176 Q185 170 174 167Z',
  sez: 'M200 197 C188 189 171 197 170 209 C171 224 184 233 196 233 Q201 234 200 226Z',
  ventral: 'M186 224 C183 235 183 243 185 251 C186 255 190 255 191 251 L198 228Z',
  centerBridge: 'M171 136 Q182 123 199 130 Q216 123 229 136 L223 151 Q209 154 200 149 Q192 154 177 151Z',
  centerLower: 'M181 153 Q200 144 219 153 Q214 166 200 166 Q186 166 181 153Z',
};
const tissue = [
  ['mantle', CB, 132, 111, 84],
  ['opticStem', OL, 72, 116, 36], ['optic', OL, 51, 115, 37], ['medulla', OL, 71, 113, 26],
  ['connective', SEZ, 175, 184, 29], ['ventral', SEZ, 191, 238, 24], ['sez', SEZ, 188, 213, 27],
  ['lateral', LH, 106, 115, 28], ['mbStalk', MB, 155, 112, 48],
  ['antennalTract', AL, 148, 136, 33], ['antennalNerve', AL, 111, 186, 31],
  ['antennal', AL, 135, 157, 32], ['calyxOuter', MB, 117, 71, 35],
  ['calyxInner', MB, 155, 76, 28], ['centerBridge', CX, 196, 137, 32, false],
  ['centerLower', CX, 200, 151, 22, false],
];
function color(hex, scale, opacity = 1) {
  const rgb = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(rgb >> 16) * scale | 0},${((rgb >> 8) & 255) * scale | 0},${(rgb & 255) * scale | 0},${opacity})`;
}

export class BrainView {
  constructor(canvas, brain, onSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.brain = brain;
    this.onSelect = onSelect;
    this.shape = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, new Path2D(path)]));
    this.base = document.createElement('canvas');
    this.base.width = width * 2;
    this.base.height = height * 2;
    this.model = [];
    const random = seeded(424093);
    for (const [region, { start, count }] of regions.entries()) {
      const length = Math.round(170 + count / 340);
      for (let i = 0; i < length; i++) {
        const id = start + Math.floor(count / length * (i + random() * .95));
        this.model.push({ id, region, ...this.point(id) });
      }
    }
    this.settings = { region: -1, posterior: false, links: true, neuron: null };
    this.renderKey = '';
    this.refreshBase();
    canvas.addEventListener('click', event => this.selectAt(event));
    new ResizeObserver(() => {
      this.renderKey = '';
      if (canvas.clientWidth) this.draw();
    }).observe(canvas);
  }

  point(id) {
    const region = this.brain.regionOf[id];
    const { start, count } = regions[region];
    const side = id - start < count / 2 ? -1 : 1;
    const random = seeded((id + 19823) * 5471);
    const options = centers[region];
    const [cx, cy, rx, ry] = options[Math.floor(random() * options.length)];
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random());
    return { x: axis + side * (axis - (cx + Math.cos(a) * r * rx)), y: cy + Math.sin(a) * r * ry };
  }

  transform(point) {
    return this.settings.posterior ? { x: width - point.x, y: point.y } : point;
  }

  selectAt(event) {
    const bounds = this.canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * width / bounds.width;
    const y = (event.clientY - bounds.top) * height / bounds.height;
    const selected = this.settings.region;
    let best = 17 ** 2, winner = null;
    for (const node of this.model) {
      if (selected >= 0 && node.region !== selected) continue;
      const point = this.transform(node);
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < best) {
        winner = node.id;
        best = distance;
      }
    }
    this.onSelect(winner);
  }

  update(settings) {
    const changedLayers = this.settings.posterior !== settings.posterior || this.settings.region !== settings.region;
    this.settings = settings;
    if (changedLayers) this.refreshBase();
    this.renderKey = '';
    this.draw();
  }

  refreshBase() {
    const ctx = this.base.getContext('2d');
    const { posterior, region: focus } = this.settings;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const field = ctx.createRadialGradient(200, 129, 23, 200, 133, 225);
    field.addColorStop(0, '#242128');
    field.addColorStop(.63, '#17181b');
    field.addColorStop(1, '#101314');
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#c6c5d314';
    for (let x = 14; x < width; x += 13) {
      for (let y = 12; y < height; y += 13) ctx.fillRect(x, y, 1, 1);
    }

    const layers = posterior ? [
      ...tissue.filter(item => item[1] !== SEZ && item[1] !== CX),
      ...tissue.filter(item => item[1] === CX || item[1] === SEZ),
    ] : tissue;
    for (const [name, region, x, y, radius, paired = true] of layers) {
      const shade = regions[region].color;
      for (let index = 0; index < (paired ? 2 : 1); index++) {
        ctx.save();
        if (index) { ctx.translate(width, 0); ctx.scale(-1, 1); }
        const shift = index ? 7 : -6;
        const glow = ctx.createRadialGradient(x + shift, y - 9, 2, x, y, radius);
        const highlight = focus === region;
        const dim = (posterior && region === AL ? .66 : 1) * (focus < 0 || highlight ? 1 : .65);
        glow.addColorStop(0, color(shade, .79 * dim));
        glow.addColorStop(.54, color(shade, .38 * dim));
        glow.addColorStop(1, color(shade, .15 * dim));
        ctx.fillStyle = glow;
        ctx.strokeStyle = color(shade, .9, highlight ? .86 : .46);
        ctx.lineWidth = highlight ? 1.4 : .95;
        ctx.shadowColor = '#08070bdc';
        ctx.shadowBlur = 10;
        ctx.fill(this.shape[name]);
        ctx.shadowBlur = 0;
        ctx.stroke(this.shape[name]);
        ctx.restore();
      }
    }
    this.drawCalyces(ctx, posterior);
    this.drawGlomeruli(ctx, posterior);
    ctx.fillStyle = '#d4c8b2';
    ctx.globalAlpha = .64;
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('Dorsal', 14, 24);
    ctx.fillText('Ventral', 14, height - 15);
    ctx.textAlign = 'right';
    ctx.fillText(posterior ? 'Posterior' : 'Anterior', width - 14, 24);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  drawCalyces(ctx, posterior) {
    for (const [cx, cy, rx, ry] of [[119, 73, 25, 11], [156, 79, 18, 10], [281, 73, 25, 11], [244, 79, 18, 10]]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      const hollow = ctx.createRadialGradient(cx, cy + 3, 1, cx, cy, rx);
      hollow.addColorStop(0, '#32191ff5');
      hollow.addColorStop(.35, '#6e3d47');
      hollow.addColorStop(1, '#db9685');
      ctx.fillStyle = hollow;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = posterior ? '#f3ad9890' : '#f3ad98bc';
      ctx.stroke();
    }
  }

  drawGlomeruli(ctx, posterior) {
    const random = seeded(89012);
    for (let i = 0; i < 42; i++) {
      const angle = i * 2.39996;
      const radius = Math.sqrt((i + .3) / 42);
      const x = 138 + radius * 23 * Math.cos(angle), y = 163 + radius * 18 * Math.sin(angle);
      const diameter = 1.7 + random() * 2.1;
      for (const position of [x, width - x]) {
        const glow = ctx.createRadialGradient(position - .8, y - 1, .1, position, y, diameter);
        glow.addColorStop(0, posterior ? '#c9956926' : '#ffd9999c');
        glow.addColorStop(.55, '#bb784356');
        glow.addColorStop(1, '#3b231180');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(position, y, diameter, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = '#fde19165';
    ctx.lineWidth = .75;
    for (let i = 0; i < 9; i++) {
      const x = 181 + i * 4.7;
      ctx.beginPath();
      ctx.moveTo(x, 134 + Math.abs(x - 200) * .24);
      ctx.quadraticCurveTo(x + 1.5, 140, x, 148);
      ctx.stroke();
    }
  }

  draw() {
    const { canvas, ctx, brain, settings } = this;
    if (!canvas.clientWidth) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const pixels = Math.round(canvas.clientWidth * ratio);
    const key = `${brain.tick}/${pixels}`;
    if (key === this.renderKey) return;
    this.renderKey = key;
    if (canvas.width !== pixels) {
      canvas.width = pixels;
      canvas.height = Math.round(pixels * height / width);
    }
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    ctx.drawImage(this.base, 0, 0, width, height);

    if (settings.links) this.drawLinks(ctx, settings.neuron);
    for (const point of this.model) {
      const selected = settings.region < 0 || point.region === settings.region;
      const pulse = selected && brain.spikes[point.id];
      const { x, y } = this.transform(point);
      ctx.fillStyle = pulse ? '#fff4c8' : color(regions[point.region].color, 1, selected ? .34 : .10);
      const dot = pulse ? 2.35 : 1.1;
      ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    }
    if (settings.neuron !== null) {
      const { x, y } = this.transform(this.point(settings.neuron));
      ctx.strokeStyle = '#fff0c4';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawLinks(ctx, neuron) {
    const { brain, settings } = this;
    const destinations = neuron === null ? this.model : [{ id: neuron, region: brain.regionOf[neuron], ...this.point(neuron) }];
    let shown = 0;
    for (let i = 0; i < destinations.length && shown < 65; i++) {
      const target = destinations[i];
      if (neuron === null && (settings.region >= 0 && target.region !== settings.region || i % 3 !== brain.tick % 3)) continue;
      const end = this.transform(target);
      for (let j = 0; j < 3; j++) {
        const edge = target.id * 3 + j;
        const fromId = brain.sources[edge];
        const pulse = brain.previousSpikes[fromId];
        if (!pulse && neuron === null) continue;
        const from = this.transform(this.point(fromId));
        const suppresses = brain.weights[edge] < 0;
        ctx.lineWidth = neuron === null ? .66 : 1.35;
        ctx.strokeStyle = suppresses ? (pulse ? '#e5a6ffcc' : '#e5a6ff53')
          : (pulse ? '#ffe2a58e' : '#eabf7953');
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo((from.x + end.x) / 2, (from.y + end.y) / 2 - 17, end.x, end.y);
        ctx.stroke();
        if (neuron !== null) {
          ctx.fillStyle = pulse ? '#fff2be' : '#dcc796';
          ctx.fillRect(from.x - 1.8, from.y - 1.8, 3.6, 3.6);
        }
        shown++;
      }
    }
  }
}
