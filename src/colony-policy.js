const actions = [
  ['eat', 'Eating', [-1.3, 3.3, 2.8, .72, .15, 0]],
  ['drink', 'Drinking', [-1.3, 3.3, 2.8, .72, .15, 0]],
  ['queenFood', 'Feeding queen', [-.89, 2.8, 2.95, .59, .15, 0]],
  ['queenWater', 'Watering queen', [-.89, 2.8, 2.95, .59, .15, 0]],
  ['broodFood', 'Feeding brood', [-.78, 3.04, 2.44, .60, .24, .14]],
  ['tend', 'Tending brood', [-1.04, 2.37, 1.74, .84, .24, .23]],
  ['rest', 'Resting and scanning', [-.84, 2.22, 1.89, .55, .48, 0]],
  ['groom', 'Grooming', [-1.21, 2.8, 2.11, .62, .46, 0]],
  ['explore', 'Scouting', [-.10, 1.06, .44, .21, .24, .05]],
  ['peerFood', 'Sharing food', [-2.45, 2.43, 2.33, .55, .15, .10]],
  ['peerWater', 'Sharing water', [-2.45, 2.43, 2.33, .55, .15, .10]],
];
export const taskNames = Object.fromEntries(actions.map(([key, label]) => [key, label]));
const width = actions[0][2].length;
export const policyWeightCount = width * actions.length;
const baseline = Float32Array.from(actions.flatMap(([, , weights]) => weights));
const indexOf = Object.fromEntries(actions.map(([key], i) => [key, i]));

export function inheritPolicy(parent, mutation, random) {
  const weights = parent?.length === policyWeightCount ? Float32Array.from(parent) : baseline.slice();
  for (let i = 0; i < weights.length; i++) {
    if (mutation) weights[i] = Math.max(-7, Math.min(7, weights[i] + (random() - random()) * mutation));
  }
  return weights;
}

function value(weights, action, features) {
  let score = 0;
  const start = indexOf[action] * width;
  for (let i = 0; i < width; i++) score += weights[start + i] * features[i];
  return score;
}

export function selectAction(weights, candidates, random, temperature) {
  let choice = null, top = -Infinity;
  for (const candidate of candidates) {
    const q = value(weights, candidate.action, candidate.features);
    const noise = temperature ? -Math.log(-Math.log(Math.max(.00001, random()))) * temperature : 0;
    if (q + noise > top) {
      choice = candidate;
      top = q + noise;
    }
  }
  return choice;
}

export function updatePolicy(weights, chosen, candidates, reward, rate) {
  if (!rate || !chosen) return;
  const current = value(weights, chosen.action, chosen.features);
  const future = Math.max(...candidates.map(item => value(weights, item.action, item.features)), 0);
  const error = Math.max(-2.5, Math.min(2.5, reward + .47 * future - current));
  const start = indexOf[chosen.action] * width;
  // Keep small temporal-difference updates bounded across long unlocked runs.
  for (let i = 0; i < width; i++) {
    const index = start + i;
    const delta = error * chosen.features[i] - .042 * (weights[index] - baseline[index]);
    weights[index] = Math.max(-7, Math.min(7, weights[index] + rate * delta));
  }
}
