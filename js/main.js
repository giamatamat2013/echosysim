// ---- Bootstrap: build the world, seed life, run the render/sim loop. ----
(function () {
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const stage = document.getElementById('stage');
  const TILE = 18;
  let world, sim, ui, cols, rows;

  function fit() {
    const w = stage.clientWidth, h = stage.clientHeight;
    canvas.width = w; canvas.height = h;
    cols = Math.max(20, Math.ceil(w / TILE));
    rows = Math.max(15, Math.ceil(h / TILE));
  }

  function build() {
    fit();
    world = new World(cols, rows, TILE);
    sim = new Simulation(world);
    sim.spawnRandom(2);
    ui = new UI(sim, world, canvas);
  }

  // Redraw terrain onto an offscreen buffer only when it changes.
  let terrainDirty = true;
  const buf = document.createElement('canvas');
  const bctx = buf.getContext('2d');
  function drawTerrain() {
    buf.width = canvas.width; buf.height = canvas.height;
    for (let y = 0; y < world.rows; y++) for (let x = 0; x < world.cols; x++) {
      const i = world.idx(x, y);
      bctx.fillStyle = world.color(i);
      bctx.fillRect(x * TILE, y * TILE, TILE + 1, TILE + 1);
    }
  }

  function drawFood() {
    for (let y = 0; y < world.rows; y++) for (let x = 0; x < world.cols; x++) {
      const i = world.idx(x, y), f = world.food[i];
      if (f < 0.06) continue;
      const water = world.elev[i] < world.regionAt(x, y).seaLevel;
      ctx.fillStyle = water ? `rgba(120,230,190,${0.25 + f * 0.5})`
                            : `rgba(150,230,90,${0.3 + f * 0.6})`;
      const s = 2 + f * TILE * 0.4;
      ctx.beginPath();
      ctx.arc(x * TILE + TILE / 2, y * TILE + TILE / 2, s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Tint painted climate-region tiles so their hand-drawn shape is visible;
  // the region currently selected for editing shows brighter than the rest.
  function drawRegions() {
    if (world.regions.length <= 1) return; // nothing painted yet
    ctx.save();
    for (let y = 0; y < world.rows; y++) for (let x = 0; x < world.cols; x++) {
      const id = world.regionId[world.idx(x, y)];
      if (id === 0) continue;
      const hue = (id * 67) % 360;
      const alpha = id === sim.selectedRegion ? 0.32 : 0.14;
      ctx.fillStyle = `hsla(${hue},80%,60%,${alpha})`;
      ctx.fillRect(x * TILE, y * TILE, TILE + 1, TILE + 1);
    }
    ctx.restore();
  }

  let acc = 0, lastSample = 0;
  function frame(t) {
    // terrain gets rebuilt every frame cheaply (fillRects); climate edits show live
    drawTerrain();
    ctx.drawImage(buf, 0, 0);
    drawFood();
    drawRegions();

    if (!Params.paused) {
      for (let s = 0; s < Params.simSpeed; s++) sim.step(1);
    }
    for (const c of sim.creatures) c.draw(ctx);

    // highlight the inspected creature
    if (sim.selected && !sim.selected.dead) {
      ctx.strokeStyle = 'rgba(77,214,166,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sim.selected.x, sim.selected.y, sim.selected.radius * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (t - lastSample > 200) { ui.updateReadout(); lastSample = t; }
    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { fit(); });
  build();
  requestAnimationFrame(frame);
})();
