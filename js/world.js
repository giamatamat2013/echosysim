// ---- The environment: a tile grid of elevation, food and rock. ----
function World(cols, rows, tile) {
  this.cols = cols; this.rows = rows; this.tile = tile;
  const n = cols * rows;
  this.elev = new Float32Array(n); // 0..1 terrain height
  this.food = new Float32Array(n); // 0..1 plant/plankton biomass
  this.rock = new Uint8Array(n);   // impassable obstacle
  this.fert = new Float32Array(n); // 0..1 permanent local fertility boost (from the food tool)
  this.regionId = new Uint8Array(n); // 0 = default climate; else index into this.regions, painted by hand
  this.regions = [makeClimate()];    // index 0: the default climate, covering everything unpainted
  this.generate();
}

World.prototype.idx = function (cx, cy) { return cy * this.cols + cx; };
World.prototype.inBounds = function (cx, cy) {
  return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
};

// Which climate region a tile / world point belongs to (0 = default).
World.prototype.regionAt = function (cx, cy) {
  if (!this.inBounds(cx, cy)) return this.regions[0];
  return this.regions[this.regionId[this.idx(cx, cy)]];
};
World.prototype.regionAtPixel = function (px, py) {
  return this.regionAt((px / this.tile) | 0, (py / this.tile) | 0);
};
// Start a new, independently-tunable climate region (paint its extent with paintRegion).
World.prototype.addRegion = function () {
  this.regions.push(makeClimate());
  return this.regions.length - 1;
};
// Brush-paint a region id onto tiles (id 0 clears them back to the default climate).
World.prototype.paintRegion = function (px, py, regionIdx, radius) {
  const t = this.tile;
  const cx = (px / t) | 0, cy = (py / t) | 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (dx * dx + dy * dy > radius * radius) continue;
    const nx = cx + dx, ny = cy + dy;
    if (!this.inBounds(nx, ny)) continue;
    this.regionId[this.idx(nx, ny)] = regionIdx;
  }
};

// Smooth value-noise terrain: random field softened by repeated box blur.
World.prototype.generate = function () {
  const n = this.cols * this.rows;
  for (let i = 0; i < n; i++) this.elev[i] = Math.random();
  for (let pass = 0; pass < 5; pass++) this._blur();
  // normalise to full 0..1 range
  let lo = 1, hi = 0;
  for (let i = 0; i < n; i++) { lo = Math.min(lo, this.elev[i]); hi = Math.max(hi, this.elev[i]); }
  const span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < n; i++) this.elev[i] = (this.elev[i] - lo) / span;
  this.food.fill(0);
  this.rock.fill(0);
  if (this.fert) this.fert.fill(0);
  if (this.regionId) this.regionId.fill(0);   // new world: drop painted region shapes...
  if (this.regions) this.regions.length = 1;  // ...but keep the tuned default climate
};

World.prototype._blur = function () {
  const { cols, rows } = this, src = this.elev, out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      s += src[ny * cols + nx]; c++;
    }
    out[y * cols + x] = s / c;
  }
  this.elev = out;
};

World.prototype.isWaterAt = function (px, py) {
  const cx = (px / this.tile) | 0, cy = (py / this.tile) | 0;
  if (!this.inBounds(cx, cy)) return false;
  return this.elev[this.idx(cx, cy)] < this.regionAt(cx, cy).seaLevel;
};
// 0 on land, up to 1 in the deepest sea (relative to current sea level).
World.prototype.waterDepthAt = function (px, py) {
  const cx = (px / this.tile) | 0, cy = (py / this.tile) | 0;
  if (!this.inBounds(cx, cy)) return 0;
  const e = this.elev[this.idx(cx, cy)];
  const seaLevel = this.regionAt(cx, cy).seaLevel;
  if (e >= seaLevel) return 0;
  return Util.clamp((seaLevel - e) / Math.max(0.01, seaLevel), 0, 1);
};

World.prototype.isRockAt = function (px, py) {
  const cx = (px / this.tile) | 0, cy = (py / this.tile) | 0;
  if (!this.inBounds(cx, cy)) return true; // treat OOB as solid wall
  return this.rock[this.idx(cx, cy)] === 1;
};

// Fertility of a land/water tile given its region's current climate.
World.prototype.fertility = function (i) {
  if (this.rock[i]) return 0;
  const cx = i % this.cols, cy = (i / this.cols) | 0;
  const region = this.regionAt(cx, cy);
  const e = this.elev[i];
  const water = e < region.seaLevel;
  const boost = this.fert[i]; // permanent local enrichment from the food tool
  // temperate & moist ground is richest; extremes are barren
  const tempComfort = 1 - Math.abs(region.temperature - 0.5) * 1.6;
  if (water) {
    // plankton: shallow water near shore is best, cold water a bit richer
    const depth = (region.seaLevel - e) / Math.max(0.01, region.seaLevel);
    return Util.clamp((1 - depth) * 0.8 * (1.1 - region.temperature * 0.4) + boost, 0, 1);
  }
  const moisture = 1 - (e - region.seaLevel); // lower land = wetter
  return Util.clamp(tempComfort * moisture * 1.2 + boost, 0, 1);
};

// Plant/plankton growth each simulation step. foodRegen scales the ceiling
// itself (not just the growth rate) so 0% abundance means zero food, full
// stop — standing food actually dies off instead of freezing near capacity.
World.prototype.grow = function (dt) {
  const k = 0.012 * dt;
  for (let cy = 0; cy < this.rows; cy++) for (let cx = 0; cx < this.cols; cx++) {
    const i = this.idx(cx, cy);
    if (this.rock[i]) { this.food[i] = 0; continue; }
    const cap = this.fertility(i) * this.regionAt(cx, cy).foodRegen;
    if (this.food[i] < cap) this.food[i] = Math.min(cap, this.food[i] + k * (0.2 + cap));
    else this.food[i] += (cap - this.food[i]) * 0.02 * dt;
  }
};

// Nearest edible tile to (px,py); prefers tiles matching the creature's medium.
World.prototype.nearestFood = function (px, py, radius, aquaticPref) {
  const t = this.tile;
  const cx = (px / t) | 0, cy = (py / t) | 0;
  const r = Math.ceil(radius / t);
  let best = Infinity, bx = null, by = null;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = cx + dx, ny = cy + dy;
    if (!this.inBounds(nx, ny)) continue;
    const i = this.idx(nx, ny);
    if (this.food[i] < 0.06 || this.rock[i]) continue;
    const water = this.elev[i] < this.regionAt(nx, ny).seaLevel;
    const mediumPenalty = Math.abs((water ? 1 : 0) - aquaticPref) * radius * 0.7;
    const wx = nx * t + t / 2, wy = ny * t + t / 2;
    const d = Math.hypot(wx - px, wy - py) + mediumPenalty - this.food[i] * radius * 0.4;
    if (d < best && Math.hypot(wx - px, wy - py) < radius) { best = d; bx = wx; by = wy; }
  }
  return bx === null ? null : { x: bx, y: by };
};

World.prototype.eatAt = function (px, py, amount) {
  const cx = (px / this.tile) | 0, cy = (py / this.tile) | 0;
  if (!this.inBounds(cx, cy)) return 0;
  const i = this.idx(cx, cy);
  const got = Math.min(this.food[i], amount);
  this.food[i] -= got;
  return got;
};

// Circular brush edit used by the terrain tools.
World.prototype.paint = function (px, py, tool, radius) {
  const t = this.tile;
  const cx = (px / t) | 0, cy = (py / t) | 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (dx * dx + dy * dy > radius * radius) continue;
    const nx = cx + dx, ny = cy + dy;
    if (!this.inBounds(nx, ny)) continue;
    const i = this.idx(nx, ny);
    const fall = 1 - Math.hypot(dx, dy) / (radius + 1);
    if (tool === 'water') { this.elev[i] = Math.max(0, this.elev[i] - 0.06 * fall); this.rock[i] = 0; }
    else if (tool === 'land') { this.elev[i] = Math.min(1, this.elev[i] + 0.06 * fall); }
    else if (tool === 'food') { this.fert[i] = Math.min(1, this.fert[i] + 0.12 * fall); }
    else if (tool === 'rock') { this.rock[i] = 1; this.food[i] = 0; this.fert[i] = 0; }
  }
};

// Biome colour for a tile under its region's current climate.
World.prototype.color = function (i) {
  if (this.rock[i]) return '#3a3f47';
  const cx = i % this.cols, cy = (i / this.cols) | 0;
  const region = this.regionAt(cx, cy);
  const e = this.elev[i], T = region.temperature;
  if (e < region.seaLevel) {
    const depth = (region.seaLevel - e) / Math.max(0.01, region.seaLevel); // 0 shore .. 1 deep
    const l = 42 - depth * 26;
    const h = 205 - T * 25; // warmer seas shift teal
    return `hsl(${h},70%,${l}%)`;
  }
  const h = e - region.seaLevel; // height above sea
  if (T < 0.28) { // cold: tundra / snow
    const l = 60 + h * 30; return `hsl(200,12%,${Util.clamp(l, 55, 92)}%)`;
  }
  if (T > 0.72) { // hot: desert / rock
    const hue = 42 - h * 12; return `hsl(${hue},${45 - h * 20}%,${Util.clamp(60 - h * 18, 30, 66)}%)`;
  }
  // temperate: green lowlands to brown highlands
  const hue = 105 - h * 55;
  const l = 42 - h * 14;
  return `hsl(${Util.clamp(hue, 40, 120)},42%,${Util.clamp(l, 24, 46)}%)`;
};
