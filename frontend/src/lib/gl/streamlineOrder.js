// Streamline order for level-of-detail drawing. The tube/point renderer draws
// the first N instances, so if streamlines are laid out in a shuffled order,
// every prefix is a fair, nested sample of the whole bundle (not "the first
// tracts in the file").

// Small seeded PRNG (mulberry32): same seed, same sequence.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic Fisher-Yates permutation of 0..n-1.
export function shuffledOrder(n, seed) {
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  const rand = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  return order;
}

// How many of n instances to draw at a given fraction (always at least one).
export function lodInstanceCount(n, fraction) {
  if (n <= 0) return 0;
  if (!(fraction < 1)) return n;
  return Math.max(1, Math.ceil(n * fraction));
}
