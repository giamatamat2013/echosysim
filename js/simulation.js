// ---- Orchestrates the world, the population, and evolutionary stats. ----
function Simulation(world) {
  this.world = world;
  this.creatures = [];
  this.cap = 220;
  this.births = 0;
  this.deaths = 0;
  this.kills = 0;
  this.matings = 0;
  this.ticks = 0;
  this.maxGen = 0;
  this.history = []; // sampled averages for the chart
  this.selected = null;
  this.species = [];      // {id, rep(genome), hue}
  this.nextSpecies = 1;
  this.liveSpecies = 0;
  this.selectedRegion = 0; // which world.regions[] climate the panel edits
}

const PIN_TICKS = 3000; // ~ how long a manually-touched leaf slider resists auto-drift

// Called by the UI whenever the player drags a climate slider by hand, for
// the currently selected region. The dragged value is authoritative: coupled
// sliders move to match IT, never the reverse. temperature <-> seaLevel have
// a clean physical inverse, so dragging either one snaps the other into
// self-consistency immediately. foodRegen/mutation are pure effects with no
// clean inverse, so a manual edit is simply protected from auto-drift a while.
Simulation.prototype.userSetClimate = function (id, value) {
  const region = this.world.regions[this.selectedRegion];
  region[id] = value;
  if (id === 'temperature') {
    region.baseTemp = value;
  } else if (id === 'seaLevel') {
    const T = Util.clamp(0.5 + (0.46 - value) / 0.6, 0, 1);
    region.temperature = T;
    region.baseTemp = T;
  } else {
    region.pin[id] = region.climateClock + PIN_TICKS;
  }
};

// Environmental feedback: every region's climate drifts naturally on its
// own, coupled internally, instead of staying at a fixed value.
Simulation.prototype.updateClimate = function (dt) {
  for (const region of this.world.regions) this._updateRegionClimate(region, dt);
};

Simulation.prototype._updateRegionClimate = function (region, dt) {
  region.climateClock += dt;
  if (region.seasons) {
    // slow seasonal swing around the player's set-point
    region.temperature = Util.clamp(region.baseTemp + Math.sin(region.climateClock * 0.0004) * 0.13, 0, 1);
  }
  if (!region.dynamicClimate) { region.prevTemp = region.temperature; region.prevSea = region.seaLevel; return; }

  const T = region.temperature;

  // 1) Heat evaporates the sea; cold lets it rise (toward a temp-driven target).
  //    (Self-consistent after a manual seaLevel edit, so no pin needed here.)
  const seaTarget = Util.clamp(0.46 - (T - 0.5) * 0.6, 0.05, 0.72);
  region.seaLevel += (seaTarget - region.seaLevel) * 0.006 * dt;

  // 2) Productivity: richest in a temperate, moist world; barren at extremes.
  if (region.climateClock > (region.pin.foodRegen || 0)) {
    const warmth = 1 - Math.abs(T - 0.5) * 1.4;          // bell curve, peak temperate
    const moisture = 0.4 + region.seaLevel * 0.9;        // more sea -> more rain
    const foodTarget = Util.clamp(warmth * moisture * 1.1, 0.05, 1.5);
    region.foodRegen += (foodTarget - region.foodRegen) * 0.005 * dt;
  }

  // 3) Climate volatility drives mutation (stress-induced mutagenesis):
  //    rapid change accelerates adaptation, long stability calms the genome.
  const flux = Math.abs(T - region.prevTemp) + Math.abs(region.seaLevel - region.prevSea);
  region.prevTemp = T; region.prevSea = region.seaLevel;
  region.volatility = region.volatility * 0.996 + flux;
  if (region.climateClock > (region.pin.mutation || 0)) {
    const mutTarget = Util.clamp(0.05 + region.volatility * 0.7, 0.03, 0.3);
    region.mutation += (mutTarget - region.mutation) * 0.08 * dt;
  }
};

// Assign a creature to the nearest genetic cluster, or found a new species.
Simulation.prototype.classify = function (c) {
  let best = Infinity, sp = null;
  for (const s of this.species) {
    const d = Genome.distance(c.genome, s.rep);
    if (d < best) { best = d; sp = s; }
  }
  if (sp && best < 0.16) c.speciesId = sp.id;
  else {
    sp = { id: this.nextSpecies++, rep: c.genome, hue: c.hue };
    this.species.push(sp);
    c.speciesId = sp.id;
  }
};

Simulation.prototype.spawn = function (x, y, genome, generation) {
  if (this.creatures.length >= this.cap) return;
  const c = new Creature(x, y, genome || Genome.random(), generation || 0);
  this.classify(c);
  this.creatures.push(c);
};

Simulation.prototype.spawnRandom = function (count) {
  const W = this.world.cols * this.world.tile, H = this.world.rows * this.world.tile;
  for (let i = 0; i < count; i++) {
    let x, y, tries = 0;
    do { x = Util.rand(0, W); y = Util.rand(0, H); tries++; }
    while (this.world.isRockAt(x, y) && tries < 30);
    this.spawn(x, y, Genome.random(), 0);
  }
};

Simulation.prototype.spawnChild = function (parent) {
  const mutation = this.world.regionAtPixel(parent.x, parent.y).mutation;
  const child = Genome.mutate(parent.genome, mutation);
  const a = Util.rand(0, Math.PI * 2), r = parent.radius * 2;
  const x = Util.clamp(parent.x + Math.cos(a) * r, 1, this.world.cols * this.world.tile - 1);
  const y = Util.clamp(parent.y + Math.sin(a) * r, 1, this.world.rows * this.world.tile - 1);
  const c = new Creature(x, y, child, parent.generation + 1);
  c.energy = parent.energy * 0.5;
  this.classify(c);
  this.creatures.push(c);
  this.births++;
  if (c.generation > this.maxGen) this.maxGen = c.generation;
};

// Sexual reproduction: recombine two parents' genomes, then mutate.
Simulation.prototype.spawnSexual = function (a, b) {
  const mutation = this.world.regionAtPixel(a.x, a.y).mutation;
  const g = Genome.mutate(Genome.crossover(a.genome, b.genome), mutation);
  const ang = Util.rand(0, Math.PI * 2), r = a.radius * 2;
  const x = Util.clamp(a.x + Math.cos(ang) * r, 1, this.world.cols * this.world.tile - 1);
  const y = Util.clamp(a.y + Math.sin(ang) * r, 1, this.world.rows * this.world.tile - 1);
  const c = new Creature(x, y, g, Math.max(a.generation, b.generation) + 1);
  c.energy = (a.energy + b.energy) * 0.25;
  this.classify(c);
  this.creatures.push(c);
  this.births++; this.matings++;
  if (c.generation > this.maxGen) this.maxGen = c.generation;
};

Simulation.prototype.step = function (dt) {
  this.updateClimate(dt);
  this.world.grow(dt);
  const list = this.creatures;
  for (let i = 0; i < list.length; i++) list[i].update(dt, this.world, this);
  // reap the dead
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i].dead) { this.deaths++; if (list[i] === this.selected) this.selected = null; }
    else list[w++] = list[i];
  }
  list.length = w;

  this.ticks += dt;
  if (this.ticks % 12 < dt) this._sample();
};

// Snapshot population-wide gene averages for the evolution chart.
Simulation.prototype._sample = function () {
  const n = this.creatures.length;
  const avg = { pop: n, optTemp: 0, aquatic: 0, size: 0, diet: 0 };
  for (const c of this.creatures) {
    avg.optTemp += c.genome.optTemp; avg.aquatic += c.genome.aquatic;
    avg.size += c.genome.size; avg.diet += c.genome.diet;
  }
  if (n) { avg.optTemp /= n; avg.aquatic /= n; avg.size /= n; avg.diet /= n; }
  this.history.push(avg);
  if (this.history.length > 240) this.history.shift();

  // retire species with no living members; count surviving diversity
  const live = new Set();
  for (const c of this.creatures) live.add(c.speciesId);
  this.species = this.species.filter(s => live.has(s.id));
  this.liveSpecies = this.species.length;
};

Simulation.prototype.creatureAt = function (px, py) {
  let best = 1e9, hit = null;
  for (const c of this.creatures) {
    const d = Util.dist2(px, py, c.x, c.y), rr = (c.radius + 8) * (c.radius + 8);
    if (d < rr && d < best) { best = d; hit = c; }
  }
  return hit;
};
