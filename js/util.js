// ---- tiny shared helpers (classic script, global scope) ----
const Util = {
  rand(a = 1, b) { if (b === undefined) { b = a; a = 0; } return a + Math.random() * (b - a); },
  randInt(a, b) { return Math.floor(Util.rand(a, b + 1)); },
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
  choice(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
  // shortest angular turn from a toward b, capped by maxStep
  turn(a, b, maxStep) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + Util.clamp(d, -maxStep, maxStep);
  },
};

// Global tunable parameters, mutated by the UI. Climate itself now lives
// per-region on World.regions (see makeClimate below) so each area of the
// map can be tuned independently; these are the engine-wide leftovers.
const Params = {
  simSpeed: 1,      // simulation sub-steps per frame
  brush: 3,         // terrain edit radius (tiles)
  paused: false,
};

// One region's independent environment settings, with the same defaults the
// sliders used to carry globally.
function makeClimate() {
  return {
    temperature: 0.5, // 0 frozen .. 1 scorching
    seaLevel: 0.34,   // elevation threshold below which tiles are water
    foodRegen: 0.6,   // plant growth multiplier
    mutation: 0.09,   // per-gene mutation probability
    dynamicClimate: true, // heat evaporates the sea; cold lets it rise
    seasons: false,       // slow temperature oscillation over time
    baseTemp: 0.5,     // seasonal set-point
    climateClock: 0,
    pin: {},           // paramName -> sim-clock tick until which auto-drift is suppressed
    volatility: 0,      // smoothed measure of how fast the climate is shifting
    prevTemp: 0.5,
    prevSea: 0.34,
  };
}
