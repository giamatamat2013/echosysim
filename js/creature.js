// ---- A living organism: phenotype decoded from DNA, brain, and gait. ----
function Creature(x, y, genome, generation) {
  this.x = x; this.y = y;
  this.vx = 0; this.vy = 0;
  this.dir = Util.rand(0, Math.PI * 2);
  this.genome = genome;
  this.generation = generation || 0;
  this.age = 0;
  this.dead = false;
  this.gait = 0;
  this.wobble = Util.rand(0, Math.PI * 2);
  this.id = Creature.nextId++;
  this._decode();
  this.energy = this.maxEnergy * 0.55;
  this.envTemp = 0.5; // local region temperature, refreshed every update()
  this._initLegs();
}
Creature.nextId = 1;

// Translate genes -> body & behaviour (the "procedural physiology").
Creature.prototype._decode = function () {
  const g = this.genome;
  this.radius = 4 + g.size * 11;
  this.maxSpeed = 0.7 + g.speed * 2.4;
  this.sense = 34 + g.sense * 120;
  this.legCount = [0, 2, 4, 6][Math.round(g.legs * 3)];
  this.limb = this.radius * (1.0 + g.limb * 1.9);
  this.hue = Math.floor(g.hue * 360);
  this.optTemp = g.optTemp;
  this.tempTol = 0.05 + g.tempTol * 0.22;
  this.diet = g.diet;
  this.carnivore = g.diet > 0.58;
  this.aquatic = g.aquatic;
  this.reproFrac = 0.55 + g.repro * 0.4;
  this.spikes = g.spikes;
  this.maxAge = 700 + g.longevity * 3200;
  this.maxEnergy = 42 + g.size * 170;
};

Creature.prototype._initLegs = function () {
  this.feet = [];
  for (let i = 0; i < this.legCount; i++)
    this.feet.push({ x: this.x, y: this.y, sx: this.x, sy: this.y, tx: this.x, ty: this.y, step: 0 });
};

// --- per-step update: metabolism, senses, steering, feeding, reproduction ---
Creature.prototype.update = function (dt, world, sim) {
  this.age += dt;
  const g = this.genome;

  // Metabolism: basal cost, cheaper for efficient creatures.
  const eff = 1 - g.metabolism * 0.45;
  let cost = (0.05 + this.radius * 0.006) * eff * dt;
  this.energy -= cost;

  // Medium survival: a body must match its surroundings or it dies.
  //  - a land-dweller out of its depth in the sea DROWNS (worse when deep / less aquatic)
  //  - a fully-aquatic body stranded on dry land suffocates
  const depth = world.waterDepthAt(this.x, this.y); // 0 land .. 1 deep sea
  const over = depth - this.aquatic;                // >0 => beyond what its DNA can handle
  const landOver = depth === 0 ? this.aquatic - 0.6 : -1; // >0 => gills stranded on dry land
  this.drowning = 0; this.stranded = false;
  if (over > 0) {
    this.energy -= (0.35 + over * 2.8) * dt;         // rapid, depth-scaled drowning
    this.drowning = over;
  } else if (landOver > 0) {
    this.energy -= (0.35 + landOver * 2.8) * dt;      // equally rapid stranding
    this.stranded = true;
  }

  // Climate fit: anything living outside its thermal tolerance dies, fast if
  // the mismatch is severe. Deep water buffers the body from air extremes
  // (real oceans have thermal inertia), so submerging is a valid escape.
  this.envTemp = world.regionAtPixel(this.x, this.y).temperature;
  const buffer = depth * 0.6;
  const effectiveTemp = Util.lerp(this.envTemp, 0.5, buffer);
  const tdiff = Math.abs(effectiveTemp - this.optTemp);
  const excess = Math.max(0, tdiff - this.tempTol);
  this.exposure = excess;
  if (excess > 0) this.energy -= (excess * 1.1 + excess * excess * 9) * dt;

  // How dangerous is a point for THIS body? (used for steering below)
  const danger = (px, py) => {
    const d = world.waterDepthAt(px, py);
    let bad = Math.max(0, d - this.aquatic);
    if (d === 0) bad += Math.max(0, this.aquatic - 0.6);
    return bad;
  };
  const hereBad = Math.max(this.drowning, this.stranded ? landOver : 0);

  // ---- Perception & target selection ----
  let tx = null, ty = null; this.prey = null;
  if (this.carnivore) {
    let best = this.sense * this.sense, bt = null;
    for (const o of sim.creatures) {
      if (o === this || o.dead) continue;
      if (o.radius > this.radius * 1.15 || o.spikes > this.spikes + 0.35) continue;
      const d = Util.dist2(this.x, this.y, o.x, o.y);
      if (d < best) { best = d; bt = o; }
    }
    if (bt) { tx = bt.x; ty = bt.y; this.prey = bt; }
  }
  if (tx === null) {
    const f = world.nearestFood(this.x, this.y, this.sense, this.aquatic);
    if (f) { tx = f.x; ty = f.y; }
  }

  // ---- Steering ----
  let hungry = this.energy < this.maxEnergy * 0.85;
  if (tx !== null && hungry) {
    this.dir = Util.turn(this.dir, Math.atan2(ty - this.y, tx - this.x), 0.16 * dt);
  } else {
    this.dir += Util.rand(-0.25, 0.25) * dt;
  }
  // Survival instinct: steer toward whichever side is safer (flee the sea /
  // scramble back to water) when the current or upcoming ground is lethal.
  if (hereBad > 0 || this.aquatic > 0.6) {
    const probe = 30;
    const F = danger(this.x + Math.cos(this.dir) * probe, this.y + Math.sin(this.dir) * probe);
    const L = danger(this.x + Math.cos(this.dir - 0.7) * probe, this.y + Math.sin(this.dir - 0.7) * probe);
    const R = danger(this.x + Math.cos(this.dir + 0.7) * probe, this.y + Math.sin(this.dir + 0.7) * probe);
    if (F > hereBad || F > 0.02) this.dir += (L < R ? -1 : 1) * (0.6 + F * 1.5) * dt;
  }

  const drive = this.maxSpeed * (hungry && tx !== null ? 1 : 0.55) * (hereBad > 0 ? 0.5 : 1);
  const step = drive * 1.7 * dt;
  let nx = this.x + Math.cos(this.dir) * step;
  let ny = this.y + Math.sin(this.dir) * step;

  // Obstacle / edge avoidance.
  if (world.isRockAt(nx, ny)) { this.dir += Math.PI * 0.5 + Util.rand(-0.4, 0.4); }
  else { this.x = nx; this.y = ny; }
  this.x = Util.clamp(this.x, 1, world.cols * world.tile - 1);
  this.y = Util.clamp(this.y, 1, world.rows * world.tile - 1);
  this.vx = Math.cos(this.dir) * drive;
  this.vy = Math.sin(this.dir) * drive;

  // ---- Feeding ----
  if (this.prey && !this.prey.dead) {
    const reach = this.radius + this.prey.radius;
    if (Util.dist2(this.x, this.y, this.prey.x, this.prey.y) < reach * reach) {
      this.energy += Math.min(this.maxEnergy - this.energy, this.prey.energy * 0.75 + this.prey.radius * 4);
      this.prey.dead = true; this.prey.energy = 0;
      sim.kills++;
    }
  }
  if (this.diet < 0.72) { // herbivores & omnivores graze, but only in a medium their body suits
    const landHere = depth === 0 ? 1 : 0;
    const grazeEff = Util.clamp(1 - Math.abs(landHere - this.aquatic) * 1.4, 0, 1);
    if (grazeEff > 0) {
      const got = world.eatAt(this.x, this.y, 0.03 * dt * (1 + this.radius * 0.04) * grazeEff);
      this.energy += got * 60;
    }
  }
  if (this.energy > this.maxEnergy) this.energy = this.maxEnergy;

  // ---- Reproduction: sexual if a compatible mate is near, else budding ----
  if (this.energy > this.maxEnergy * this.reproFrac &&
      this.age > this.maxAge * 0.08 && sim.creatures.length < sim.cap) {
    let mate = null, best = (this.radius * 5) * (this.radius * 5);
    for (const o of sim.creatures) {
      if (o === this || o.dead) continue;
      if (o.energy < o.maxEnergy * o.reproFrac || o.age < o.maxAge * 0.08) continue;
      const d = Util.dist2(this.x, this.y, o.x, o.y);
      if (d < best && Genome.distance(this.genome, o.genome) < 0.2) { best = d; mate = o; }
    }
    if (mate) {
      sim.spawnSexual(this, mate);
      this.energy *= 0.6; mate.energy *= 0.6;
    } else {
      sim.spawnChild(this);
      this.energy *= 0.5;
    }
  }

  // ---- Death ----
  if (this.energy <= 0 || this.age > this.maxAge) this.dead = true;

  // ---- Procedural animation state ----
  this.gait += Math.hypot(this.vx, this.vy) * 0.3 + 0.02;
  this.wobble += 0.18;
  this._updateFeet();
};

// IK-style walk cycle: each foot plants, then re-steps ahead when overreached.
Creature.prototype._updateFeet = function () {
  if (this.legCount === 0) return;
  const reach = this.limb * 0.95;
  const half = (this.legCount / 2 - 1) / 2;
  for (let i = 0; i < this.legCount; i++) {
    const side = (i % 2 === 0) ? 1 : -1;
    const along = (Math.floor(i / 2) - half);
    const perp = this.dir + Math.PI / 2 * side;
    const sx = this.x + Math.cos(this.dir) * along * this.radius * 0.95 + Math.cos(perp) * this.radius * 0.85;
    const sy = this.y + Math.sin(this.dir) * along * this.radius * 0.95 + Math.sin(perp) * this.radius * 0.85;
    const foot = this.feet[i];
    foot.sx = sx; foot.sy = sy;
    // desired planting spot, projected ahead in the direction of travel
    const dfx = sx + Math.cos(this.dir) * this.limb * 0.55 + Math.cos(perp) * this.limb * 0.35;
    const dfy = sy + Math.sin(this.dir) * this.limb * 0.55 + Math.sin(perp) * this.limb * 0.35;
    const d = Math.hypot(foot.x - dfx, foot.y - dfy);
    // stagger gaits so legs don't all lift together (diagonal gait)
    const canStep = Math.sin(this.gait + i * (Math.PI * 2 / this.legCount) + side * 0.6) > 0.2;
    if ((d > reach && canStep) || d > reach * 1.9) { foot.tx = dfx; foot.ty = dfy; foot.step = 1; }
    if (foot.step > 0) {
      foot.x = Util.lerp(foot.x, foot.tx, 0.45);
      foot.y = Util.lerp(foot.y, foot.ty, 0.45);
      if (Math.hypot(foot.x - foot.tx, foot.y - foot.ty) < 1.2) foot.step = 0;
    }
  }
};

// --- Rendering: everything drawn from the phenotype, no sprites. ---
Creature.prototype.draw = function (ctx) {
  const bodyL = `hsl(${this.hue},58%,${Util.clamp(56 - this.spikes * 12, 30, 60)}%)`;
  const darkL = `hsl(${this.hue},48%,26%)`;

  // Legs (drawn behind body) with a lifted knee while stepping.
  if (this.legCount > 0) {
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.2, this.radius * 0.2);
    ctx.strokeStyle = darkL;
    for (const f of this.feet) {
      const lift = f.step > 0 ? this.limb * 0.28 : 0;
      const mx = (f.sx + f.x) / 2 + Math.cos(this.dir) * lift;
      const my = (f.sy + f.y) / 2 - lift;
      ctx.beginPath();
      ctx.moveTo(f.sx, f.sy);
      ctx.quadraticCurveTo(mx, my, f.x, f.y);
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.translate(this.x, this.y);
  ctx.rotate(this.dir);

  // Swimmers: undulating tail + side fins.
  if (this.legCount === 0) {
    ctx.strokeStyle = darkL;
    ctx.lineWidth = Math.max(1.5, this.radius * 0.35);
    ctx.lineCap = 'round';
    const sway = Math.sin(this.wobble) * this.radius * 0.9;
    ctx.beginPath();
    ctx.moveTo(-this.radius * 0.6, 0);
    ctx.quadraticCurveTo(-this.radius * 1.4, sway, -this.radius * 2.2, sway * 1.3);
    ctx.stroke();
    ctx.fillStyle = darkL;
    const fin = Math.sin(this.wobble) * 0.4;
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(0, s * this.radius * 0.4);
      ctx.lineTo(-this.radius * 0.9, s * (this.radius * 1.2 + fin * this.radius));
      ctx.lineTo(-this.radius * 0.2, s * this.radius * 0.5);
      ctx.closePath(); ctx.fill();
    }
  }

  // Body.
  const breathe = 1 + Math.sin(this.wobble) * 0.05;
  ctx.fillStyle = bodyL;
  ctx.beginPath();
  ctx.ellipse(0, 0, this.radius * 1.25 * breathe, this.radius * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  // Armour spikes along the back.
  if (this.spikes > 0.5) {
    ctx.fillStyle = darkL;
    const count = Math.round(this.spikes * 5);
    for (let s = 0; s < count; s++) {
      const px = Util.lerp(-this.radius, this.radius, s / Math.max(1, count - 1));
      ctx.beginPath();
      ctx.moveTo(px, -this.radius * 0.7);
      ctx.lineTo(px + this.radius * 0.18, -this.radius * (0.7 + this.spikes * 0.8));
      ctx.lineTo(px + this.radius * 0.36, -this.radius * 0.7);
      ctx.closePath(); ctx.fill();
    }
  }

  // Eye (points forward).
  ctx.fillStyle = '#0b0b0b';
  ctx.beginPath();
  ctx.arc(this.radius * 0.8, -this.radius * 0.22, Math.max(1.4, this.radius * 0.18), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Drowning / stranding distress: bubbles + coloured ring.
  if (this.drowning > 0 || this.stranded) {
    const col = this.drowning > 0 ? 'rgba(120,190,255,' : 'rgba(255,170,90,';
    ctx.strokeStyle = col + '.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 1.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col + '.7)';
    for (let b = 0; b < 3; b++) {
      const ph = (this.wobble * 0.5 + b * 2) % 3;
      ctx.beginPath();
      ctx.arc(this.x + (b - 1) * this.radius * 0.5, this.y - this.radius - ph * 6, 1.5 + b * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Climate-exposure distress: red shimmer for heatstroke, cyan frost for cold.
  if (this.exposure > 0.01) {
    const tooHot = this.envTemp > this.optTemp;
    ctx.strokeStyle = tooHot ? 'rgba(255,90,60,.8)' : 'rgba(160,225,255,.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 2.2, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Low-energy indicator ring.
  if (this.energy < this.maxEnergy * 0.22) {
    ctx.strokeStyle = 'rgba(255,120,80,.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 1.7, 0, Math.PI * 2);
    ctx.stroke();
  }
};
