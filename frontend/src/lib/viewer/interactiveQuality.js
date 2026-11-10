// Adaptive quality while the user turns or zooms the 3D view. Pure logic: the
// viewer feeds it frame times and applies the level it reports. Quality only
// drops during an interaction and is earned back one step per interaction, so
// the picture never flickers between sharp and coarse mid-drag.

export const LEVELS = [
  { stepScale: 1, tractFraction: 1, canvasScale: 1 },
  { stepScale: 1.5, tractFraction: 0.5, canvasScale: 1 },
  { stepScale: 2, tractFraction: 0.25, canvasScale: 0.75 },
  { stepScale: 2, tractFraction: 0.1, canvasScale: 0.5 },
];

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function createQualityController({
  budgetMs = 1000 / 30, tolerance = 1.4, windowMs = 250, minLevel = 0,
} = {}) {
  const maxLevel = LEVELS.length - 1;
  let learned = minLevel;
  let level = minLevel;
  let samples = [];
  let windowStart = null;
  let allFast = true; // every evaluated window this interaction was well under budget
  let evaluated = 0;

  const resetWindow = () => { samples = []; windowStart = null; };

  return {
    get level() { return level; },
    start() {
      level = Math.max(minLevel, learned);
      resetWindow();
      allFast = true;
      evaluated = 0;
      return level;
    },
    // Returns the (possibly new) level.
    frame(ms, now) {
      if (windowStart === null) windowStart = now;
      samples.push(ms);
      if (now - windowStart >= windowMs && samples.length >= 3) {
        const med = median(samples);
        evaluated++;
        if (med >= budgetMs * 0.6) allFast = false;
        if (med > budgetMs * tolerance && level < maxLevel) level++;
        resetWindow();
      }
      return level;
    },
    end() {
      if (evaluated > 0 && allFast) learned = Math.max(minLevel, level - 1);
      else learned = level;
      resetWindow();
    },
    // Tab hidden: frame times are meaningless, forget the open window.
    reset() { resetWindow(); },
  };
}
