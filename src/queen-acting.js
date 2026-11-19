const durations = { egg: 1.03, food: .91, water: .88 };
const clamp = value => Math.min(1, Math.max(0, value));
const wave = (progress, count) => .5 + .5 * Math.sin(progress * Math.PI * 2 * count);
const smooth = value => value ** 2 * (3 - 2 * value);

export class QueenActing {
  constructor() {
    this.reset();
  }

  reset() {
    this.seen = null;
    this.active = null;
    this.elapsed = 0;
  }

  step(events, dt, time) {
    if (!this.active && events.at(-1) !== this.seen) {
      const start = events.indexOf(this.seen) + 1;
      const next = events.find((event, index) => index >= start && event.time + 2.5 >= time);
      if (!next) return null;
      this.active = next;
      this.seen = next;
      this.elapsed = 0;
    }
    if (!this.active) return null;
    this.elapsed += dt;
    const { kind } = this.active;
    const progress = this.elapsed / durations[kind];
    if (progress >= 1) {
      this.active = null;
      return null;
    }
    const strength = Math.sin(Math.PI * progress) ** 1.2;
    if (kind === 'egg') {
      return { curl: .245 * strength, nod: -.08 * strength, event: this.active,
        deposit: smooth(clamp((progress - .27) / .65)), visible: progress > .24 };
    }
    const drinking = kind === 'water';
    return {
      nod: -(drinking ? .25 : .15) * strength + .055 * strength * wave(progress, drinking ? 4 : 3),
      yaw: clamp((this.active.z + .5) * .44) * .32 - .08,
      jaw: (drinking ? .07 : .22) * strength * wave(progress, drinking ? 5 : 4),
      event: this.active, transfer: smooth(clamp((progress - .12) / .53)),
      visible: progress > .10 && progress < .67,
      probes: [{ aim: this.active }, { aim: this.active }],
    };
  }
}
