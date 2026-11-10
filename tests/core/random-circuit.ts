import {
  currentSource,
  ground,
  resistor,
  voltageSource,
  type Circuit,
  type CircuitElement,
} from '../../src/core';

/** Small seeded generator, so a failure can be reproduced from its seed. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
  };
}

/** Every node hangs on a resistor tree from ground, so the circuit always has one solution. */
export function randomCircuit(seed: number): Circuit {
  const random = createRandom(seed);
  const nodeCount = random.int(2, 8);
  const name = (index: number): string => `n${index}`;
  const pickPair = (): [number, number] => {
    const a = random.int(0, nodeCount - 1);
    let b = random.int(0, nodeCount - 2);
    if (b >= a) b++;
    return [a, b];
  };

  const elements: CircuitElement[] = [ground('G', name(0))];
  for (let i = 1; i < nodeCount; i++) {
    elements.push(resistor(`Rt${i}`, name(i), name(random.int(0, i - 1)), random.int(1, 100)));
  }

  const extraResistors = random.int(0, nodeCount);
  for (let i = 0; i < extraResistors; i++) {
    const [a, b] = pickPair();
    elements.push(resistor(`Rx${i}`, name(a), name(b), random.int(1, 100)));
  }

  // Tracks which nodes voltage sources already tie together, so that no loop of sources forms.
  const group = Array.from({ length: nodeCount }, (_, index) => index);
  const voltageSources = random.int(0, Math.min(3, nodeCount - 1));
  for (let i = 0; i < voltageSources; i++) {
    const [a, b] = pickPair();
    const groupA = group[a]!;
    const groupB = group[b]!;
    if (groupA === groupB) continue;
    group.forEach((value, index) => {
      if (value === groupB) group[index] = groupA;
    });
    elements.push(voltageSource(`V${i}`, name(a), name(b), random.int(-50, 50)));
  }

  const currentSources = random.int(0, 3);
  for (let i = 0; i < currentSources; i++) {
    const [a, b] = pickPair();
    elements.push(currentSource(`I${i}`, name(a), name(b), random.int(-20, 20)));
  }

  return { elements };
}
