(function () {
  const DATA = window.LANDING_DATA;
  const meta = DATA.meta;
  const scenarios = DATA.scenarios;

  const css = getComputedStyle(document.documentElement);
  const COLOR = {
    accent: css.getPropertyValue('--accent').trim() || '#4fd1c5',
    good: css.getPropertyValue('--good').trim() || '#57d38c',
    warn: css.getPropertyValue('--warn').trim() || '#e8b34d',
    crit: css.getPropertyValue('--crit').trim() || '#e5566b',
    thrust: css.getPropertyValue('--thrust').trim() || '#ff8a5c',
    line: css.getPropertyValue('--line').trim() || '#22303f',
    lineSoft: css.getPropertyValue('--line-soft').trim() || '#1a2432',
    text: css.getPropertyValue('--text').trim() || '#dfe6ee',
    textDim: css.getPropertyValue('--text-dim').trim() || '#7c8aa0',
    textFaint: css.getPropertyValue('--text-faint').trim() || '#4d5b70',
  };

  // ---- slider <-> grid value mapping ----
  const sY0 = document.getElementById('sY0');
  const sX0 = document.getElementById('sX0');
  const sVX0 = document.getElementById('sVX0');
  sY0.max = meta.y0_values.length - 1;
  sX0.max = meta.x0_values.length - 1;
  sVX0.max = meta.vx0_values.length - 1;

  function currentIndices() {
    return {
      xi: +sX0.value,
      vi: +sVX0.value,
      yi: +sY0.value,
    };
  }

  function keyFor(xi, vi, yi) {
    return meta.x0_values[xi] + '|' + meta.vx0_values[vi] + '|' + meta.y0_values[yi];
  }

  // some extreme grid corners failed to converge (dynamically infeasible);
  // fall back to the nearest velocity index toward zero at that corner.
  function lookupScenario(xi, vi, yi) {
    let key = keyFor(xi, vi, yi);
    if (scenarios[key]) return scenarios[key];
    const centerV = Math.floor((meta.vx0_values.length - 1) / 2);
    let v = vi;
    while (v !== centerV) {
      v += v > centerV ? -1 : 1;
      key = keyFor(xi, v, yi);
      if (scenarios[key]) return scenarios[key];
    }
    return scenarios[keyFor(xi, centerV, yi)];
  }

  function fmtSigned(v, digits) {
    const s = v.toFixed(digits);
    return (v > 0 ? '+' : '') + s;
  }

  function updateLabels() {
    const { xi, vi, yi } = currentIndices();
    document.getElementById('lblY0').textContent = meta.y0_values[yi].toFixed(0) + ' m';
    document.getElementById('lblX0').textContent = fmtSigned(meta.x0_values[xi], 0) + ' m';
    document.getElementById('lblVX0').textContent = fmtSigned(meta.vx0_values[vi], 0) + ' m/s';
  }

  // ---- state ----
  let traj = null;
  let playing = false;
  let playT = 0; // 0..1 fraction along scrub range
  let lastFrameTime = null;

  const scrub = document.getElementById('scrub');
  const playBtn = document.getElementById('playBtn');
  const metLabel = document.getElementById('metLabel');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  function loadScenario() {
    const { xi, vi, yi } = currentIndices();
    traj = lookupScenario(xi, vi, yi);
    updateLabels();
    document.getElementById('rTf').textContent = traj.tf.toFixed(1) + ' s';
    document.getElementById('rFuel').textContent = (meta.M0 - traj.m[traj.m.length - 1]).toFixed(0) + ' kg of ' + meta.M_FUEL.toFixed(0) + ' kg';
    playT = 0;
    scrub.value = 0;
    render();
  }

  function sampleAt(frac) {
    const n = traj.t.length;
    const pos = frac * (n - 1);
    const i0 = Math.max(0, Math.min(n - 2, Math.floor(pos)));
    const f = pos - i0;
    const i1 = i0 + 1;
    function lerp(arr) { return arr[i0] + (arr[i1] - arr[i0]) * f; }
    return {
      idx: i0,
      frac: f,
      t: lerp(traj.t),
      x: lerp(traj.x),
      y: lerp(traj.y),
      vx: lerp(traj.vx),
      vy: lerp(traj.vy),
      m: lerp(traj.m),
      Tx: lerp(traj.Tx),
      Ty: lerp(traj.Ty),
    };
  }

  // ---- main scene canvas ----
  const scene = document.getElementById('scene');
  const sctx = scene.getContext('2d');

  const WORLD = { xMin: -1900, xMax: 1900, yMin: -60, yMax: 2200 };
  const PAD = { left: 70, right: 70, top: 30, bottom: 78 };

  function worldToScreen(wx, wy) {
    const availW = scene.width - PAD.left - PAD.right;
    const availH = scene.height - PAD.top - PAD.bottom;
    const scale = Math.min(availW / (WORLD.xMax - WORLD.xMin), availH / (WORLD.yMax - WORLD.yMin));
    const originX = PAD.left + availW / 2;
    const groundY = scene.height - PAD.bottom;
    return { x: originX + wx * scale, y: groundY - wy * scale, scale, groundY, originX };
  }

  function drawScene(sample) {
    const ctx = sctx;
    ctx.clearRect(0, 0, scene.width, scene.height);

    const { scale, groundY, originX } = worldToScreen(0, 0);

    // altitude gridlines (recessive)
    ctx.strokeStyle = COLOR.lineSoft;
    ctx.lineWidth = 1;
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillStyle = COLOR.textFaint;
    for (let alt = 0; alt <= WORLD.yMax; alt += 500) {
      const p = worldToScreen(0, alt);
      ctx.beginPath();
      ctx.moveTo(PAD.left, p.y);
      ctx.lineTo(scene.width - PAD.right, p.y);
      ctx.stroke();
      ctx.fillText(alt + ' m', PAD.left, p.y - 4);
    }

    // glide-slope cone (dashed) from pad
    const gsRad = (Math.PI / 180) * meta.GLIDE_SLOPE_DEG;
    const edgeY = (WORLD.xMax) * Math.tan(gsRad);
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = COLOR.textFaint;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const pL = worldToScreen(WORLD.xMin, Math.min(edgeY, WORLD.yMax));
    const pR = worldToScreen(WORLD.xMax, Math.min(edgeY, WORLD.yMax));
    const pad0 = worldToScreen(0, 0);
    ctx.moveTo(pL.x, pL.y);
    ctx.lineTo(pad0.x, pad0.y);
    ctx.lineTo(pR.x, pR.y);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = COLOR.textFaint;
    ctx.fillText('glide-slope limit', pL.x + 6, pL.y - 6);

    // ground
    ctx.strokeStyle = COLOR.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(PAD.left, groundY);
    ctx.lineTo(scene.width - PAD.right, groundY);
    ctx.stroke();
    // hatching
    ctx.strokeStyle = COLOR.lineSoft;
    ctx.lineWidth = 1;
    for (let gx = PAD.left; gx < scene.width - PAD.right; gx += 14) {
      ctx.beginPath();
      ctx.moveTo(gx, groundY);
      ctx.lineTo(gx - 7, groundY + 10);
      ctx.stroke();
    }

    // landing pad marker
    ctx.strokeStyle = COLOR.good;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(originX, groundY, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(originX - 14, groundY);
    ctx.lineTo(originX + 14, groundY);
    ctx.moveTo(originX, groundY - 14);
    ctx.lineTo(originX, groundY + 6);
    ctx.stroke();

    // ghost full trajectory
    ctx.strokeStyle = 'rgba(124,138,160,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < traj.x.length; i++) {
      const p = worldToScreen(traj.x[i], traj.y[i]);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // flown trail up to current sample (accent)
    ctx.strokeStyle = COLOR.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= sample.idx; i++) {
      const p = worldToScreen(traj.x[i], traj.y[i]);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    const cur = worldToScreen(sample.x, sample.y);
    ctx.lineTo(cur.x, cur.y);
    ctx.stroke();

    // lander icon
    const tiltRad = Math.atan2(sample.Tx, sample.Ty); // angle of thrust from vertical
    const throttle = Math.hypot(sample.Tx, sample.Ty) / meta.T_MAX;

    ctx.save();
    ctx.translate(cur.x, cur.y);
    ctx.rotate(tiltRad);

    // flame (opposite thrust direction => points +y in local frame, i.e. downward before rotation)
    if (throttle > 0.02) {
      const flameLen = 14 + throttle * 46;
      const grad = ctx.createLinearGradient(0, 10, 0, 10 + flameLen);
      grad.addColorStop(0, 'rgba(255,138,92,0.95)');
      grad.addColorStop(1, 'rgba(255,138,92,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-5, 10);
      ctx.lineTo(5, 10);
      ctx.lineTo(0, 10 + flameLen);
      ctx.closePath();
      ctx.fill();
    }

    // body
    ctx.fillStyle = COLOR.text;
    ctx.strokeStyle = COLOR.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(6, 6);
    ctx.lineTo(6, 10);
    ctx.lineTo(-6, 10);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // legs
    ctx.beginPath();
    ctx.moveTo(-6, 8); ctx.lineTo(-13, 15);
    ctx.moveTo(6, 8); ctx.lineTo(13, 15);
    ctx.strokeStyle = COLOR.textDim;
    ctx.stroke();

    ctx.restore();
  }

  // ---- strip charts ----
  function drawStrip(canvas, series, opts) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const padL = 4, padR = 4, padT = 10, padB = 14;
    const min = opts.min !== undefined ? opts.min : Math.min(...series);
    const max = opts.max !== undefined ? opts.max : Math.max(...series);
    const range = (max - min) || 1;
    function xy(i) {
      const x = padL + (i / (series.length - 1)) * (w - padL - padR);
      const y = padT + (1 - (series[i] - min) / range) * (h - padT - padB);
      return [x, y];
    }
    // faint reference lines
    ctx.strokeStyle = COLOR.lineSoft;
    ctx.lineWidth = 1;
    if (opts.refLines) {
      opts.refLines.forEach((v) => {
        const y = padT + (1 - (v - min) / range) * (h - padT - padB);
        ctx.beginPath();
        ctx.setLineDash([3, 4]);
        ctx.moveTo(padL, y);
        ctx.lineTo(w - padR, y);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }
    // area fill
    ctx.fillStyle = hexToRgba(opts.color, 0.28);
    ctx.beginPath();
    ctx.moveTo(padL, h - padB);
    for (let i = 0; i < series.length; i++) {
      const [x, y] = xy(i);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w - padR, h - padB);
    ctx.closePath();
    ctx.fill();
    // line
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < series.length; i++) {
      const [x, y] = xy(i);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // playhead + emphasized current point
    const frac = opts.playFrac;
    const px = padL + frac * (w - padL - padR);
    ctx.strokeStyle = COLOR.textFaint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, h - padB);
    ctx.stroke();
    const curVal = opts.currentValue;
    const curY = padT + (1 - (curVal - min) / range) * (h - padT - padB);
    ctx.fillStyle = opts.color;
    ctx.beginPath();
    ctx.arc(px, curY, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ---- telemetry text ----
  function updateTelemetry(sample) {
    const throttlePct = Math.hypot(sample.Tx, sample.Ty) / meta.T_MAX * 100;
    const tiltDeg = Math.abs(Math.atan2(sample.Tx, sample.Ty)) * 180 / Math.PI;
    const fuelUsed = meta.M0 - sample.m;
    const fuelPct = 100 * (1 - fuelUsed / meta.M_FUEL);

    document.getElementById('tAlt').innerHTML = sample.y.toFixed(0) + '<span class="unit">m</span>';
    document.getElementById('tRange').innerHTML = fmtSigned(sample.x, 0) + '<span class="unit">m</span>';
    document.getElementById('tVy').innerHTML = sample.vy.toFixed(1) + '<span class="unit">m/s</span>';
    document.getElementById('tVx').innerHTML = fmtSigned(sample.vx, 1) + '<span class="unit">m/s</span>';

    const thrEl = document.getElementById('tThrottle');
    thrEl.innerHTML = throttlePct.toFixed(0) + '<span class="unit">%</span>';
    thrEl.className = 'tele-val ' + (throttlePct > meta.THROTTLE_MAX * 100 - 1 ? 'warn' : 'good');

    const tiltEl = document.getElementById('tTilt');
    tiltEl.innerHTML = tiltDeg.toFixed(1) + '<span class="unit">&deg;</span>';
    tiltEl.className = 'tele-val ' + (tiltDeg > meta.MAX_TILT_DEG - 2 ? 'warn' : 'good');

    document.getElementById('tFuel').innerHTML = fuelPct.toFixed(0) + '<span class="unit">% remaining</span>';
    document.getElementById('fuelFill').style.width = Math.max(0, fuelPct) + '%';

    const nearGround = sample.y < 150;
    document.getElementById('phaseLabel').textContent = nearGround ? 'TERMINAL DESCENT' : 'POWERED DESCENT';

    const tiltMargin = meta.MAX_TILT_DEG - tiltDeg;
    const throttleMargin = meta.THROTTLE_MAX * 100 - throttlePct;
    let status = 'NOMINAL', statusClass = '';
    if (tiltMargin < 0 || throttleMargin < 0) {
      status = 'CONSTRAINT VIOLATED'; statusClass = 'crit';
    } else if (tiltMargin < 2 || throttleMargin < 3) {
      status = 'NEAR LIMIT'; statusClass = 'warn';
    }
    statusText.textContent = status;
    statusDot.className = 'status-dot ' + statusClass;

    metLabel.textContent = 'T+' + sample.t.toFixed(1) + 's / ' + traj.tf.toFixed(1) + 's';
  }

  function render() {
    const frac = playT;
    const sample = sampleAt(frac);
    drawScene(sample);
    updateTelemetry(sample);
    drawStrip(document.getElementById('stripAlt'), traj.y, {
      color: COLOR.accent,
      min: 0,
      max: Math.max(...traj.y) * 1.05,
      playFrac: frac,
      currentValue: sample.y,
    });
    const throttleSeries = traj.Tx.map((tx, i) => Math.hypot(tx, traj.Ty[i]) / meta.T_MAX * 100);
    drawStrip(document.getElementById('stripThr'), throttleSeries, {
      color: COLOR.thrust,
      min: 0,
      max: 100,
      refLines: [meta.THROTTLE_MIN * 100, meta.THROTTLE_MAX * 100],
      playFrac: frac,
      currentValue: Math.hypot(sample.Tx, sample.Ty) / meta.T_MAX * 100,
    });
  }

  // ---- interaction ----
  scrub.addEventListener('input', () => {
    playing = false;
    playBtn.textContent = '▶ PLAY';
    playT = (+scrub.value) / 1000;
    render();
  });

  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.textContent = playing ? '⏸ PAUSE' : '▶ PLAY';
    if (playing) {
      if (playT >= 0.999) playT = 0;
      lastFrameTime = null;
      requestAnimationFrame(tick);
    }
  });

  function tick(now) {
    if (!playing) return;
    if (lastFrameTime == null) lastFrameTime = now;
    const dt = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    const speed = 1 / traj.tf; // fraction per second, real-time playback
    playT += dt * speed;
    if (playT >= 1) {
      playT = 1;
      playing = false;
      playBtn.textContent = '▶ PLAY';
    }
    scrub.value = Math.round(playT * 1000);
    render();
    if (playing) requestAnimationFrame(tick);
  }

  [sY0, sX0, sVX0].forEach((el) => el.addEventListener('input', loadScenario));

  loadScenario();
})();
