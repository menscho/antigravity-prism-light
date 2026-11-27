(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.__agCsRippleCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const M = Math;
  const RIPPLE = {
    fontSize: 10,
    cellWidth: 7,
    cellHeight: 15,
    changeRate: 2,
    digitRatio: 0.3,
    cloudScale: 100,
    cloudCoverage: 1,
    cloudSoftness: 0.1,
    cloudDrift: 8,
    idleAlphaLight: 0.172,
    idleAlphaDark: 0.13,
    speedNear: 1100,
    speedFar: 80,
    speedFalloff: 240,
    damping: 1,
    borderCells: 6,
    turbulence: 0.45,
    turbulenceScale: 180,
    sourceFrequency: 6,
    sourceRadius: 36,
    sourceAmplitude: 1.4,
    waveGain: 3.5,
    glowDecay: 1.2,
    glowAlpha: 0.3,
    waveAlpha: 0.85,
    patchScale: 60,
    patchFloor: 0.3,
    edgeFeather: 0.05,
    breathPeriod: 10.5,
    breathDepth: 0.24,
    breathScale: 280,
    calmAlpha: 0.45,
    calmFeather: 36,
    lightAlphaScale: 0.72,
    lightInkCool: [74, 90, 118],
    lightWaveCool: [37, 99, 235],
    lightCoolMix: 0.68,
    waveAlphaCap: 0.7,
    injectSoftness: 0.8,
    injectLoadDecay: 0.9,
    heightKnee: 0.9,
    heightCap: 1.6,

    auraTint: 0.48,
    auraLift: 0.78,
    prismTint: 0.68,
    prismCap: 0.74,
    prismBands: 3,
    prismSlopeScale: 60,
    prismThreshold: 0.20,
    nebulaTint: 0.58,
    nebulaLift: 1.08,
    nebulaFrameMs: 28,
    idleUploadMs: 500,
    nebulaPeriods: [8.4, 10.8, 12.8],
  };
  const WAVE_STEP = 1 / 600;
  const MAX_ADVANCE = 0.05;
  const REST_HEIGHT = 0.003;
  const DIGITS = '0123456789';
  const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const GLYPHS = DIGITS + LETTERS;
  const COVERAGE_TO_THRESHOLD = 0.39;
  const INVISIBLE_ALPHA = 0.01;
  const TAU = M.PI * 2;
  const SPECTRUM = [
    [66, 133, 244],
    [155, 114, 203],
    [234, 67, 53],
    [251, 188, 4],
  ];
  // 白昼高饱和宝石四色（Royal Cobalt #2563EB / Iris #7C3AED / Coral #EA4335 / Amber #D97706）
  const SPECTRUM_LIGHT = [
    [37, 99, 235],
    [124, 58, 237],
    [234, 67, 53],
    [217, 119, 6],
  ];
  const PRISM_LEVELS = 7;
  const HUE_LEVELS = 32;
  function hash(a, b) {
    let h = (a * 374761393 + b * 668265263) | 0;
    h = M.imul(h ^ (h >>> 13), 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function valueNoise(x, y) {
    const x0 = M.floor(x);
    const y0 = M.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = hash(x0, y0) + (hash(x0 + 1, y0) - hash(x0, y0)) * sx;
    const bottom = hash(x0, y0 + 1) + (hash(x0 + 1, y0 + 1) - hash(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
  }
  function fractalNoise(x, y) {
    return (valueNoise(x, y) * 4 + valueNoise(x * 2.1 + 7, y * 2.1 + 3) * 2 + valueNoise(x * 4.3 + 13, y * 4.3 + 11)) / 7;
  }
  function glyphIndex(column, row, tick) {
    const digit = hash(column * 7 + tick * 13, row * 11 + tick * 3) < RIPPLE.digitRatio;
    const pick = hash(column * 131 + tick, row * 197 + tick * 7);
    return digit ? M.floor(pick * DIGITS.length) : DIGITS.length + M.floor(pick * LETTERS.length);
  }
  function smooth(value) {
    const clamped = M.max(0, M.min(1, value));
    return clamped * clamped * (3 - 2 * clamped);
  }
  function cloudClear(x, y) {
    const noise = fractalNoise(x / RIPPLE.cloudScale, y / RIPPLE.cloudScale);
    const threshold = 0.5 + (RIPPLE.cloudCoverage - 0.5) * COVERAGE_TO_THRESHOLD;
    const cloud = smooth((noise - threshold + RIPPLE.cloudSoftness) / (2 * RIPPLE.cloudSoftness));
    return 0.22 + 0.78 * cloud;
  }
  function patchClear(x, y) {
    const noise = fractalNoise(x / RIPPLE.patchScale + 31, y / RIPPLE.patchScale + 17);
    return RIPPLE.patchFloor + (1 - RIPPLE.patchFloor) * smooth((noise - 0.35) / 0.3);
  }
  const GLYPH_SPECTRA_DARK = {
    0: SPECTRUM,
    1: [[148, 74, 52], [217, 119, 87], [238, 155, 122], [246, 189, 96]],
    2: [[27, 73, 178], [49, 134, 255], [92, 198, 252], [140, 224, 255]],
    3: [[91, 33, 182], [139, 92, 246], [165, 138, 248], [221, 214, 254]],
    4: [[146, 64, 14], [217, 119, 6], [242, 184, 75], [253, 230, 138]],
    5: [[100, 116, 139], [148, 163, 184], [203, 213, 225], [241, 245, 249]],
  };
  const GLYPH_SPECTRA_LIGHT = {
    0: SPECTRUM_LIGHT,
    1: [[154, 52, 18], [194, 89, 52], [217, 119, 87], [217, 119, 6]],
    2: [[29, 78, 216], [37, 99, 235], [2, 132, 199], [56, 189, 248]],
    3: [[76, 29, 149], [109, 40, 217], [124, 58, 237], [147, 51, 234]],
    4: [[120, 53, 15], [180, 83, 9], [217, 119, 6], [234, 88, 12]],
    5: [[30, 41, 59], [51, 65, 85], [71, 85, 105], [100, 116, 139]],
  };
  function spectrumRgb(t, out, dark = true, spectrumCode = 0) {
    const bank = dark === false ? GLYPH_SPECTRA_LIGHT : GLYPH_SPECTRA_DARK;
    const stops = bank[spectrumCode] || (dark === false ? SPECTRUM_LIGHT : SPECTRUM);
    let f = (t - M.floor(t)) * 4;
    const i = M.min(3, M.floor(f));
    f -= i;
    const a = stops[i];
    const b = stops[(i + 1) & 3];
    out[0] = a[0] + (b[0] - a[0]) * f;
    out[1] = a[1] + (b[1] - a[1]) * f;
    out[2] = a[2] + (b[2] - a[2]) * f;
    return out;
  }
  const HORIZON_SPECTRUM = [[15, 23, 58], [49, 134, 255], [92, 198, 252], [187, 226, 255]];
  const NEBULA_PHASES = [0.35, 2.45, 4.55], NEBULA_ANGLES = [2.85, 0.52, 4.62], NEBULA_HUES = [0.04, 0.54, 0.80];
  function computeNebulaLobes(seconds, width, height, still, out) {
    const t = still ? 2.4 : seconds;
    const w = M.max(1, width);
    const h = M.max(1, height);
    const diag = M.sqrt(w * w + h * h);
    const periods = RIPPLE.nebulaPeriods || [8.4, 10.8, 12.8];
    for (let i = 0; i < 3; i++) {
      const period = M.max(1, Number(periods[i]) || 10);
      const rawSin = 0.5 + 0.5 * M.sin((TAU * t) / period + NEBULA_PHASES[i]);
      const env = rawSin * rawSin * (3 - 2 * rawSin);
      const strength = still ? 0.28 : 0.04 + 0.96 * M.pow(env, 1.3);
      const dir = i === 1 ? -1 : 1;
      const ang = NEBULA_ANGLES[i] + 0.52 * M.sin(t * (0.13 + i * 0.023) + i * 1.7) + dir * t * (0.045 + i * 0.006);
      const ringR = 0.34 + 0.045 * M.cos(t * (0.11 + i * 0.019) + i * 1.1);
      const lobe = out[i];
      lobe.x = (0.5 + ringR * 1.06 * M.cos(ang)) * w;
      lobe.y = (0.5 + ringR * 0.92 * M.sin(ang)) * h;
      lobe.radius = diag * (0.29 + 0.06 * strength);
      lobe.strength = strength;
      const hue = NEBULA_HUES[i] + 0.14 * M.sin(t * 0.09 + i * 2.1);
      lobe.hue = hue - M.floor(hue);
    }
    return out;
  }
  function clampDim(n) { return n > 0 && Number.isFinite(n) ? M.floor(n) : 0; }
  function createWaveField(columns, rows, random = M.random) {
    columns = clampDim(columns);
    rows = clampDim(rows);
    const cells = columns * rows;
    const height = new Float32Array(cells);
    const velocity = new Float32Array(cells);
    const speedSquared = new Float32Array(cells);
    const speedFactor = new Float32Array(cells);
    const damping = new Float32Array(cells);
    const seed = random() * 1000;
    const { cellWidth, cellHeight } = RIPPLE;
    const widthSquared = cellWidth * cellWidth;
    const heightSquared = cellHeight * cellHeight;
    const invW2 = 1 / widthSquared;
    const invH2 = 1 / heightSquared;
    const loadDecay = M.exp(-WAVE_STEP / RIPPLE.injectLoadDecay);
    const wakeLoadDecay = M.exp(-WAVE_STEP / 0.2);
    const knee = RIPPLE.heightKnee;
    const span = M.max(0.01, RIPPLE.heightCap - RIPPLE.heightKnee);
    const sources = [];
    let moving = false;
    let behind = 0;
    let load = 0;
    let wakeLoad = 0;
    let baseSpeedPrimed = false;
    let actC0 = columns;
    let actC1 = -1;
    let actR0 = rows, actR1 = -1, rExp = new Float64Array(32), cExp = new Float64Array(64);
    const setCell = (cell, col, row, noise) => {
      speedFactor[cell] = M.min(1.4, M.max(0.3, 1 + RIPPLE.turbulence * (noise - 0.5) * 3.2));
      const edge = M.min(col, row, columns - 1 - col, rows - 1 - row);
      const border = M.max(0, 1 - edge / RIPPLE.borderCells);
      damping[cell] = RIPPLE.damping + border * border * 12;
    };
    if (columns >= 32 && rows >= 16) {
      const gCols = M.ceil(columns / 2) + 1;
      const gRows = M.ceil(rows / 2) + 1;
      const coarse = new Float32Array(gCols * gRows);
      for (let gr = 0; gr < gRows; gr++) {
        const r = M.min(rows - 1, gr * 2);
        const ny = (r * cellHeight) / RIPPLE.turbulenceScale + seed;
        for (let gc = 0; gc < gCols; gc++) {
          const c = M.min(columns - 1, gc * 2);
          coarse[gr * gCols + gc] = fractalNoise((c * cellWidth) / RIPPLE.turbulenceScale + seed, ny);
        }
      }
      for (let row = 0; row < rows; row++) {
        const gr = row >> 1;
        const ty = (row & 1) * 0.5;
        const rowOff0 = gr * gCols;
        const rowOff1 = M.min(gRows - 1, gr + 1) * gCols;
        for (let column = 0; column < columns; column++) {
          const gc = column >> 1;
          const gc1 = M.min(gCols - 1, gc + 1);
          const tx = (column & 1) * 0.5;
          const n0 = coarse[rowOff0 + gc] + (coarse[rowOff0 + gc1] - coarse[rowOff0 + gc]) * tx;
          const n1 = coarse[rowOff1 + gc] + (coarse[rowOff1 + gc1] - coarse[rowOff1 + gc]) * tx;
          setCell(row * columns + column, column, row, n0 + (n1 - n0) * ty);
        }
      }
    } else {
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          setCell(
            row * columns + column,
            column,
            row,
            fractalNoise((column * cellWidth) / RIPPLE.turbulenceScale + seed, (row * cellHeight) / RIPPLE.turbulenceScale + seed)
          );
        }
      }
    }
    function primeFarBaseline() {
      if (baseSpeedPrimed) return;
      const far = RIPPLE.speedFar;
      for (let i = 0; i < cells; i++) {
        const s = far * speedFactor[i];
        const sq = s * s;
        if (sq > speedSquared[i]) speedSquared[i] = sq;
      }
      baseSpeedPrimed = true;
    }
    function boostSpeeds(column, row, reachPx, boost, falloff) {
      primeFarBaseline();
      const maxSq = reachPx * reachPx, rC = M.ceil(reachPx / cellWidth), rR = M.ceil(reachPx / cellHeight);
      const r0 = M.max(0, row - rR), r1 = M.min(rows - 1, row + rR), c0 = M.max(0, column - rC), c1 = M.min(columns - 1, column + rC);
      for (let r = r0; r <= r1; r++) {
        const dy = (r - row) * cellHeight, dy2 = dy * dy, rB = r * columns;
        for (let c = c0; c <= c1; c++) {
          const dx = (c - column) * cellWidth, d2 = dx * dx + dy2;
          if (d2 > maxSq) continue;
          const cell = rB + c, sp = (RIPPLE.speedFar + boost * M.exp(-M.sqrt(d2) / falloff)) * speedFactor[cell], sq = sp * sp;
          if (sq > speedSquared[cell]) speedSquared[cell] = sq;
        }
      }
    }
    const raiseSpeeds = (c, r) => boostSpeeds(c, r, RIPPLE.speedFalloff * 4.6, RIPPLE.speedNear - RIPPLE.speedFar, RIPPLE.speedFalloff);
    const raiseWakeSpeeds = (c, r, sn) => boostSpeeds(c, r, RIPPLE.speedFalloff * 0.65, (RIPPLE.speedNear - RIPPLE.speedFar) * (0.14 + 0.14 * sn), RIPPLE.speedFalloff * 0.55);
    const softGain = (k, ld) => { const n = 1 + ld; return M.tanh(k * n) / (M.tanh(k) * n); };
    const injectGain = () => softGain(RIPPLE.injectSoftness, load);
    const skimmerGain = () => softGain(0.85, wakeLoad);
    function drive() {
      let keep = 0;
      for (let s = 0; s < sources.length; s++) {
        const source = sources[s];
        if (source.delay > 0) {
          source.delay -= WAVE_STEP;
          sources[keep++] = source;
          continue;
        }
        const freq = source.frequency || RIPPLE.sourceFrequency;
        const envelope = M.sin((M.PI * source.time) / source.duration);
        const rate = M.cos(TAU * freq * source.time) * TAU * RIPPLE.sourceFrequency;
        const radius = RIPPLE.sourceRadius * source.radiusScale;
        const inv2r2 = 1 / (2 * radius * radius);
        const gain = RIPPLE.sourceAmplitude * source.amplitudeScale * envelope * rate * WAVE_STEP;
        const reachColumns = M.ceil((radius * 3) / cellWidth);
        const reachRows = M.ceil((radius * 3) / cellHeight);
        const r0 = M.max(0, source.row - reachRows);
        const r1 = M.min(rows - 1, source.row + reachRows);
        const c0 = M.max(0, source.column - reachColumns);
        const c1 = M.min(columns - 1, source.column + reachColumns);
        if (r0 < actR0) actR0 = r0;
        if (r1 > actR1) actR1 = r1;
        if (c0 < actC0) actC0 = c0;
        if (c1 > actC1) actC1 = c1;
        const rL = r1 - r0 + 1, cL = c1 - c0 + 1;
        if (rL > rExp.length) rExp = new Float64Array(rL);
        if (cL > cExp.length) cExp = new Float64Array(cL);
        for (let r = r0; r <= r1; r++) { const dy = (r - source.row) * cellHeight; rExp[r - r0] = M.exp(-(dy * dy) * inv2r2); }
        for (let c = c0; c <= c1; c++) { const dx = (c - source.column) * cellWidth; cExp[c - c0] = M.exp(-(dx * dx) * inv2r2); }
        for (let r = r0; r <= r1; r++) {
          const rG = gain * rExp[r - r0], rB = r * columns;
          for (let c = c0; c <= c1; c++) {
            const i = rB + c; let v = height[i] + rG * cExp[c - c0], av = v < 0 ? -v : v;
            if (av > knee) v = (v < 0 ? -1 : 1) * (knee + span * M.tanh((av - knee) / span));
            height[i] = v;
          }
        }
        source.time += WAVE_STEP;
        if (source.time < source.duration) sources[keep++] = source;
      }
      sources.length = keep;
    }
    function step() {
      let peak = 0;
      if (actC0 <= actC1 && actR0 <= actR1) {
        const rStart = M.max(0, actR0 - 1);
        const rEnd = M.min(rows - 1, actR1 + 1);
        const cStart = M.max(0, actC0 - 1);
        const cEnd = M.min(columns - 1, actC1 + 1);
        const decayMul = 1 - 0.35 * WAVE_STEP;
        for (let r = rStart; r <= rEnd; r++) {
          const rowBase = r * columns;
          const hasAbove = r > 0;
          const hasBelow = r < rows - 1;
          for (let c = cStart; c <= cEnd; c++) {
            const cell = rowBase + c;
            const here = height[cell];
            const left = c > 0 ? height[cell - 1] : here;
            const right = c < columns - 1 ? height[cell + 1] : here;
            const above = hasAbove ? height[cell - columns] : here;
            const below = hasBelow ? height[cell + columns] : here;
            const laplacian = (left + right - 2 * here) * invW2 + (above + below - 2 * here) * invH2;
            velocity[cell] += (speedSquared[cell] * laplacian - damping[cell] * velocity[cell]) * WAVE_STEP;
          }
        }
        let nC0 = columns;
        let nC1 = -1;
        let nR0 = rows;
        let nR1 = -1;
        for (let r = rStart; r <= rEnd; r++) {
          const rowBase = r * columns;
          for (let c = cStart; c <= cEnd; c++) {
            const cell = rowBase + c;
            const vel = velocity[cell];
            let h = (height[cell] + vel * WAVE_STEP) * decayMul;
            const a = h < 0 ? -h : h;
            const av = vel < 0 ? -vel : vel;
            if (a > peak) peak = a;
            if (a > 1e-5 || av > 5e-5) {
              height[cell] = h;
              if (c < nC0) nC0 = c;
              if (c > nC1) nC1 = c;
              if (r < nR0) nR0 = r;
              if (r > nR1) nR1 = r;
            } else if (h !== 0 || vel !== 0) {
              height[cell] = 0;
              velocity[cell] = 0;
            }
          }
        }
        actC0 = nC0;
        actC1 = nC1;
        actR0 = nR0;
        actR1 = nR1;
      }
      drive();
      if (peak === 0 && actC0 <= actC1) {
        for (let r = actR0; r <= actR1; r++) {
          const rowBase = r * columns;
          for (let c = actC0; c <= actC1; c++) {
            const a = M.abs(height[rowBase + c]);
            if (a > peak) peak = a;
          }
        }
      }
      load *= loadDecay;
      wakeLoad *= wakeLoadDecay;
      moving = sources.length > 0 || peak > REST_HEIGHT;
      if (!moving) {
        if (actC0 <= actC1 && actR0 <= actR1) {
          for (let r = actR0; r <= actR1; r++) {
            const s = r * columns + actC0;
            const e = r * columns + actC1 + 1;
            height.fill(0, s, e);
            velocity.fill(0, s, e);
          }
        } else {
          height.fill(0);
          velocity.fill(0);
        }
        speedSquared.fill(0);
        load = 0;
        wakeLoad = 0;
        baseSpeedPrimed = false;
        actC0 = columns;
        actC1 = -1;
        actR0 = rows;
        actR1 = -1;
      }
    }
    return {
      height,
      active: () => moving,
      disturb(column, row, opts) {
        if (columns <= 0 || rows <= 0) return;
        if (!Number.isFinite(column) || !Number.isFinite(row)) return;
        const c = M.max(0, M.min(columns - 1, M.floor(column)));
        const r = M.max(0, M.min(rows - 1, M.floor(row)));
        const o = opts && typeof opts === 'object' ? opts : null;
        if (o?.wake) {
          raiseWakeSpeeds(c, r, Number.isFinite(o.speedNorm) ? M.max(0, M.min(1, o.speedNorm)) : 0.5);
        } else {
          raiseSpeeds(c, r);
        }
        const nP = (v, fb) => (Number.isFinite(v) && v > 0 ? v : fb);
        const nZ = (v, fb) => (Number.isFinite(v) ? M.max(0, v) : fb);
        const duration = nP(o?.duration, (2 + M.floor(random() * 2)) / RIPPLE.sourceFrequency);
        const radiusScale = nP(o?.radiusScale, 0.78 + random() * 0.92);
        const baseAmp = nZ(o?.amplitudeScale, 0.78 + random() * 0.72);
        const frequency = nP(o?.frequency, RIPPLE.sourceFrequency);
        const loadWeight = nZ(o?.loadWeight, 1);
        const delay = nP(o?.delay, 0);
        sources.push({
          column: c,
          row: r,
          time: 0,
          delay,
          duration,
          radiusScale,
          amplitudeScale: baseAmp * injectGain(),
          frequency,
          skimmer: false,
        });
        load += loadWeight;
        moving = true;
      },
      skimmer(column, row, speedNorm = 0.5) {
        if (columns <= 0 || rows <= 0) return;
        if (!Number.isFinite(column) || !Number.isFinite(row)) return;
        const c = M.max(0, M.min(columns - 1, M.floor(column)));
        const r = M.max(0, M.min(rows - 1, M.floor(row)));
        const s = Number.isFinite(Number(speedNorm)) ? M.max(0, M.min(1, Number(speedNorm))) : 0.5;
        raiseWakeSpeeds(c, r, s);
        const amp = (0.048 + 0.088 * s) * skimmerGain();
        const last = sources.length > 0 ? sources[sources.length - 1] : null;
        if (last && last.skimmer && M.abs(last.column - c) <= 2 && M.abs(last.row - r) <= 2 && last.time < 0.036) {
          last.column = c;
          last.row = r;
          last.amplitudeScale = M.min(0.145, M.max(last.amplitudeScale, amp));
          moving = true;
          return;
        }
        if (sources.length >= 24) {
          const dropIdx = sources.findIndex((src) => src.skimmer);
          if (dropIdx >= 0) sources.splice(dropIdx, 1);
        }
        const duration = 0.105;
        sources.push({
          column: c,
          row: r,
          time: 0,
          duration,
          radiusScale: 0.52,
          amplitudeScale: amp,
          frequency: 1.5 / duration,
          skimmer: true,
        });
        wakeLoad = M.min(2.4, wakeLoad + 0.28);
        moving = true;
      },
      advance(s, m = 0) { const d = M.min(s, MAX_ADVANCE); behind = m > 0 ? M.min(behind + d, MAX_ADVANCE * 2) : behind + d; let n = 0; while (behind >= WAVE_STEP && (!(m > 0) || n < m)) { step(); behind -= WAVE_STEP; n += 1; } },
    };
  }
  function parseCssColorToRgb(cssColor) {
    const s = String(cssColor || '').trim();
    if (!s) return null;
    if (s[0] === '#') {
      const hex = s.slice(1);
      if (hex.length === 3) {
        return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
      }
      if (hex.length >= 6) {
        return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
      }
    }
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
    if (m) return [M.round(Number(m[1])), M.round(Number(m[2])), M.round(Number(m[3]))];
    return null;
  }
  const VERTEX_SHADER = `#version 300 es
void main() {
vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

  const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D cells;
uniform sampler2D atlas;
uniform highp vec2 size;
uniform vec2 grid;
uniform highp vec2 cellPixels;
uniform highp vec2 atlasCell;
uniform float glyphCount;
uniform vec3 ink;
uniform vec3 wave;
uniform highp vec4 aura;
uniform vec4 optics;
uniform float auraLift;
uniform float auraPhase;
uniform float lightMode;
uniform highp vec4 neb0;
uniform highp vec4 neb1;
uniform highp vec4 neb2;
uniform vec4 nebOpt;
uniform float nebulaLift;
uniform float spectrumMode;
uniform vec3 uSpec0;
uniform vec3 uSpec1;
uniform vec3 uSpec2;
uniform vec3 uSpec3;
uniform highp vec4 uIdleParams;
uniform highp vec4 uIdleMetrics;
out vec4 color;
vec3 spectrum(float t) {
float f = fract(t) * 4.0;
vec3 a = mix(uSpec0, uSpec1, clamp(f, 0.0, 1.0));
vec3 b = mix(a, uSpec2, clamp(f - 1.0, 0.0, 1.0));
vec3 c = mix(b, uSpec3, clamp(f - 2.0, 0.0, 1.0));
return mix(c, uSpec0, clamp(f - 3.0, 0.0, 1.0));
}
float fastAtan2Turns(vec2 v) {
float ax = abs(v.x), ay = abs(v.y);
float mn = min(ax, ay), mx = max(ax, ay) + 1e-6;
float a = mn / mx;
float s = a * a;
float r = ((-0.04649647 * s + 0.15931422) * s - 0.32762276) * s * a + a;
if (ay > ax) r = 1.5707963 - r;
if (v.x < 0.0) r = 3.1415927 - r;
if (v.y < 0.0) r = -r;
return r * 0.15915494;
}
float hash2Gpu(highp vec2 p) {
highp vec2 q = fract(p * vec2(0.1031, 0.1030));
q += dot(q, q.yx + 33.33);
return fract((q.x + q.y) * q.x);
}
float vNoiseGpu(highp vec2 p) {
highp vec2 i = floor(p);
vec2 f = fract(p);
vec2 u = f * f * (3.0 - 2.0 * f);
return mix(mix(hash2Gpu(i), hash2Gpu(i + vec2(1.0, 0.0)), u.x),
mix(hash2Gpu(i + vec2(0.0, 1.0)), hash2Gpu(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fNoiseGpu(highp vec2 p) {
return (vNoiseGpu(p) * 4.0 + vNoiseGpu(p * 2.1 + vec2(7.0, 3.0)) * 2.0 + vNoiseGpu(p * 4.3 + vec2(13.0, 11.0))) * (1.0 / 7.0);
}
void main() {
highp vec2 position = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
highp vec2 cell = min(floor(position / cellPixels), grid - 1.0);
vec4 data = texelFetch(cells, ivec2(cell), 0);
if (data.g <= 0.0) { color = vec4(0.0); return; }
highp vec2 local = position - cell * cellPixels;
float glyph = floor(data.r * 255.0 + 0.5);
highp vec2 inAtlas = vec2(glyph * atlasCell.x + local.x * atlasCell.x / cellPixels.x, local.y * atlasCell.y / cellPixels.y);
float coverage = texture(atlas, inAtlas / vec2(glyphCount * atlasCell.x, atlasCell.y)).a;
if (coverage <= 0.001) { color = vec4(0.0); return; }
vec3 rgb = mix(ink, wave, data.b);
float alpha = data.g;
if (uIdleParams.w > 0.5 && data.b <= 0.001) {
highp vec2 cssPos = (cell + 0.5) * uIdleMetrics.xy;
float cNoise = fNoiseGpu(vec2((cssPos.x + uIdleParams.x) * uIdleMetrics.z, cssPos.y * uIdleMetrics.z));
float cCloud = 0.22 + 0.78 * smoothstep(0.595, 0.795, cNoise);
float bPhase = fNoiseGpu(cssPos * uIdleMetrics.w + vec2(53.0, 71.0)) * 10.681415;
float breath = 1.0 - 0.12 * (1.0 + uIdleParams.y * cos(bPhase) + uIdleParams.z * sin(bPhase));
alpha *= cCloud * breath;
if (alpha < 0.01) { color = vec4(0.0); return; }
}
float packed = floor(data.a * 255.0 + 0.5);
float level = floor(packed / 32.0);
float prismAmt = level / 7.0;
float hue = (packed - level * 32.0) / 32.0;
float wAura = 0.0;
vec3 auraRgb = uSpec0;
if (aura.w > 0.001) {
vec2 rel = position - aura.xy;
float ar = max(1.0, aura.z);
if (abs(rel.x) < ar && abs(rel.y) < ar) {
float d2 = dot(rel, rel);
if (d2 < ar * ar) {
float invD = inversesqrt(max(d2, 1e-6));
float rNorm = (d2 * invD) / ar;
float u = 1.0 - rNorm;
float s = u * u * (3.0 - 2.0 * u);
wAura = s * (0.35 + 0.65 * s);
float ang = fastAtan2Turns(rel) + 0.5;
auraRgb = spectrum(ang - rNorm * 0.45 + auraPhase);
}
}
}
float wNeb = 0.0;
vec3 nebAcc = vec3(0.0);
for (int i = 0; i < 3; i++) {
vec4 nb = i == 0 ? neb0 : (i == 1 ? neb1 : neb2);
float nh = i == 0 ? nebOpt.x : (i == 1 ? nebOpt.y : nebOpt.z);
if (nb.w > 0.001) {
vec2 nr = position - nb.xy;
float rad = max(1.0, nb.z);
if (abs(nr.x) < rad && abs(nr.y) < rad) {
float nd2 = dot(nr, nr);
if (nd2 < rad * rad) {
float invNd = inversesqrt(max(nd2, 1e-6));
float rn = (nd2 * invNd) / rad;
float u = 1.0 - rn;
float s = u * u * (3.0 - 2.0 * u);
float wi = s * (0.30 + 0.70 * s) * nb.w;
float nang = fastAtan2Turns(nr);
wNeb += wi;
nebAcc += spectrum(nh + nang * 0.22 - rn * 0.26) * wi;
}
}
}
}
vec3 nebRgb = wNeb > 0.0001 ? nebAcc / wNeb : uSpec0;
float wNebC = min(1.0, wNeb);
float nebT = wNebC * nebOpt.w;
float auraT = wAura * optics.x * aura.w;
float prismT = prismAmt * optics.y * optics.w * (0.88 + 0.12 * wAura);
float total = auraT + prismT + nebT;
if (lightMode > 0.5) {
alpha = min(0.88, alpha * (1.0 + (auraLift + 0.72) * wAura * aura.w + prismT * 0.62 + nebulaLift * 0.66 * wNebC));
} else if (wAura > 0.0 || wNebC > 0.0) {
alpha = min(1.0, alpha * (1.0 + auraLift * wAura * aura.w + nebulaLift * wNebC));
}
if (total > 0.0001) {
float capped = min(optics.z, total);
float mixAmt = mix(capped, min(0.96, capped * 1.36), lightMode);
vec3 tintRgb = (auraRgb * auraT + spectrum(hue) * prismT + nebRgb * nebT) / total;
rgb = mix(rgb, tintRgb, mixAmt);
}
float a = alpha * coverage;
color = vec4(rgb * a, a);
}`;
  function getGlyphSpectrumStops(dark, specCode) {
    const bank = dark === false ? GLYPH_SPECTRA_LIGHT : GLYPH_SPECTRA_DARK;
    return bank[specCode] || (dark === false ? SPECTRUM_LIGHT : SPECTRUM);
  }
  function readAura(palette) {
    const cfg = palette.aura && palette.aura.active ? palette.aura : null;
    return {
      x: cfg ? Number(cfg.x || 0) : 0,
      y: cfg ? Number(cfg.y || 0) : 0,
      radius: cfg ? M.max(1, Number(cfg.radius || 230)) : 230,
      strength: cfg ? M.max(0, M.min(1, Number(cfg.strength ?? 1))) : 0,
    };
  }
  function packFieldDrawParams(pal, rd) {
    const amb = clampFinite(pal.ambientIntensity, 1, 0, 1), sc = Number(pal.spectrumCode ?? 0);
    const st = getGlyphSpectrumStops(pal.dark, sc), au = pal.aura?.active ? pal.aura : null;
    const neb = pal.nebula, nL = pal.nebulaLiftScale ?? 1;
    const mkN = (b) => (b ? [b.x * rd, b.y * rd, b.radius * rd, b.strength * amb] : [0, 0, 1, 0]);
    const n255 = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];
    return {
      font: pal.fontFamily || 'monospace', dpr: rd, lightMode: pal.dark === false ? 1 : 0, ink: n255(pal.ink), wave: n255(pal.wave),
      aura: au ? [Number(au.x || 0) * rd, Number(au.y || 0) * rd, M.max(1, Number(au.radius || 230)) * rd, clampFinite(au.strength, 1, 0, 1) * amb] : [0, 0, 230 * rd, 0],
      optics: [RIPPLE.auraTint * (sc === 5 ? 0.55 : 1), RIPPLE.prismTint * (sc === 5 ? 0.45 : 1), RIPPLE.prismCap, pal.prismStrength],
      auraLift: RIPPLE.auraLift * amb * (pal.auraLiftScale ?? 1), auraPhase: pal.auraPhase || 0,
      sp0: n255(st[0]), sp1: n255(st[1]), sp2: n255(st[2]), sp3: n255(st[3]),
      idle: [pal.cloudDriftPx || 0, pal.breathSinW || 0, pal.breathCosW ?? 1, 1],
      n0: mkN(neb?.[0]), n1: mkN(neb?.[1]), n2: mkN(neb?.[2]),
      nOpt: [neb?.[0]?.hue || 0, neb?.[1]?.hue || 0, neb?.[2]?.hue || 0, RIPPLE.nebulaTint * amb * (sc === 5 ? 0.45 : 1) * (0.35 + 0.65 * nL)],
      nLift: RIPPLE.nebulaLift * amb * nL,
    };
  }
  function linkGlProgram(gl, vsSrc, fsSrc, uniformNames) {
    const comp = (t, s) => {
      const sh = gl.createShader(t);
      gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) { const l = gl.getShaderInfoLog(sh) || 'shader err'; gl.deleteShader?.(sh); throw new Error(l); }
      return sh;
    };
    const vs = comp(gl.VERTEX_SHADER, vsSrc), fs = comp(gl.FRAGMENT_SHADER, fsSrc), prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    gl.deleteShader?.(vs); gl.deleteShader?.(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link err');
    gl.useProgram(prog);
    const u = {};
    for (const n of uniformNames) u[n] = gl.getUniformLocation(prog, n);
    return { prog, u };
  }
  function createWebGL2Renderer(canvas, columns, rows) {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl || gl.isContextLost?.()) return null;
    const atlasCanvas = canvas.ownerDocument.createElement('canvas'), atlasContext = atlasCanvas.getContext('2d');
    if (!atlasContext) return null;
    let cols = columns, rowsN = rows, data = new Uint8Array(cols * rowsN * 4);
    let program, cellTexture, atlasTexture, uniforms, atlasKey = '';
    const createTex = (unit, filter) => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const allocCellTex = () => { if (cellTexture) gl.deleteTexture(cellTexture); cellTexture = createTex(0, gl.NEAREST); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, cols, rowsN); };
    const free = () => { if (program) gl.deleteProgram(program); if (cellTexture) gl.deleteTexture(cellTexture); if (atlasTexture) gl.deleteTexture(atlasTexture); program = cellTexture = atlasTexture = null; };
    function build() {
      free();
      const built = linkGlProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER, 'cells,atlas,size,grid,cellPixels,atlasCell,glyphCount,ink,wave,aura,optics,auraLift,auraPhase,lightMode,neb0,neb1,neb2,nebOpt,nebulaLift,uSpec0,uSpec1,uSpec2,uSpec3,uIdleParams,uIdleMetrics'.split(','));
      program = built.prog; uniforms = built.u;
      allocCellTex(); atlasTexture = createTex(1, gl.LINEAR);
      gl.uniform1i(uniforms.cells, 0); gl.uniform1i(uniforms.atlas, 1);
      if (uniforms.uIdleMetrics) gl.uniform4f(uniforms.uIdleMetrics, RIPPLE.cellWidth, RIPPLE.cellHeight, 1 / RIPPLE.cloudScale, 1 / RIPPLE.breathScale);
      atlasKey = '';
    }
    function buildAtlas(font, dpr) {
      const key = font + '|' + dpr;
      if (key === atlasKey) return;
      const w = M.ceil(RIPPLE.cellWidth * dpr), h = M.ceil(RIPPLE.cellHeight * dpr);
      atlasCanvas.width = w * GLYPHS.length; atlasCanvas.height = h;
      atlasContext.setTransform(w / RIPPLE.cellWidth, 0, 0, h / RIPPLE.cellHeight, 0, 0);
      atlasContext.clearRect(0, 0, RIPPLE.cellWidth * GLYPHS.length, RIPPLE.cellHeight);
      atlasContext.font = `${RIPPLE.fontSize}px ${font}`; atlasContext.textBaseline = 'middle'; atlasContext.textAlign = 'center'; atlasContext.fillStyle = '#fff';
      for (let i = 0; i < GLYPHS.length; i++) atlasContext.fillText(GLYPHS[i], i * RIPPLE.cellWidth + RIPPLE.cellWidth / 2, RIPPLE.cellHeight / 2);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas);
      gl.uniform2f(uniforms.atlasCell, w, h); gl.uniform1f(uniforms.glyphCount, GLYPHS.length);
      atlasKey = key;
    }
    try { build(); } catch { try { free(); } catch {} return null; }
    const u3 = (l, v) => { if (l) gl.uniform3f(l, v[0], v[1], v[2]); }, u4 = (l, v) => { if (l) gl.uniform4f(l, v[0], v[1], v[2], v[3]); };
    const api = {
      mode: 'webgl2', gpuIdleMod: true, data, build,
      resize(nc, nr) {
        if (!program || gl.isContextLost?.() || nc <= 0 || nr <= 0) return false;
        cols = nc; rowsN = nr; data = new Uint8Array(cols * rowsN * 4); api.data = data; allocCellTex(); return true;
      },
      isContextLost: () => Boolean(gl.isContextLost?.()),
      draw(palette, dpr, uploadCells = true) {
        if (!program || gl.isContextLost?.()) return;
        const p = packFieldDrawParams(palette, dpr);
        buildAtlas(p.font, dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uniforms.size, canvas.width, canvas.height);
        gl.uniform2f(uniforms.grid, cols, rowsN);
        gl.uniform2f(uniforms.cellPixels, RIPPLE.cellWidth * dpr, RIPPLE.cellHeight * dpr);
        u3(uniforms.ink, p.ink); u3(uniforms.wave, p.wave);
        u4(uniforms.aura, p.aura); u4(uniforms.optics, p.optics);
        gl.uniform1f(uniforms.auraLift, p.auraLift); gl.uniform1f(uniforms.auraPhase, p.auraPhase); gl.uniform1f(uniforms.lightMode, p.lightMode);
        u3(uniforms.uSpec0, p.sp0); u3(uniforms.uSpec1, p.sp1); u3(uniforms.uSpec2, p.sp2); u3(uniforms.uSpec3, p.sp3);
        u4(uniforms.uIdleParams, p.idle); u4(uniforms.neb0, p.n0); u4(uniforms.neb1, p.n1); u4(uniforms.neb2, p.n2);
        u4(uniforms.nebOpt, p.nOpt); gl.uniform1f(uniforms.nebulaLift, p.nLift);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cellTexture);
        if (uploadCells !== false) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rowsN, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose(keep) { free(); if (!keep) try { gl.getExtension?.('WEBGL_lose_context')?.loseContext?.(); } catch {} },
    };
    return api;
  }
  const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  function create2DRenderer(canvas, columns, rows) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const doc = canvas.ownerDocument;
    const atlas = doc && doc.createElement ? doc.createElement('canvas') : null;
    const atlasCtx = atlas ? atlas.getContext('2d', { willReadFrequently: true }) : null;
    if (!atlasCtx) return null;
    let cols = columns, rowsN = rows, data = new Uint8Array(cols * rowsN * 4);
    const auraTintRgb = [0, 0, 0], prismTintRgb = [0, 0, 0], nebSampleRgb = [0, 0, 0];
    const nebLobeScaled = [
      { x: 0, y: 0, r: 1, r2: 1, s: 0, hue: 0 },
      { x: 0, y: 0, r: 1, r2: 1, s: 0, hue: 0 },
      { x: 0, y: 0, r: 1, r2: 1, s: 0, hue: 0 },
    ];
    let mask = null, atlasKey = '', gw = 1, gh = 1, image = null, pixels = null;
    function buildAtlas(font, dpr) {
      const key = font + '|' + dpr;
      if (key === atlasKey && mask) return;
      const { cellWidth, cellHeight } = RIPPLE;
      gw = M.max(1, M.ceil(cellWidth * dpr));
      gh = M.max(1, M.ceil(cellHeight * dpr));
      atlas.width = gw * GLYPHS.length;
      atlas.height = gh;
      atlasCtx.setTransform(gw / cellWidth, 0, 0, gh / cellHeight, 0, 0);
      atlasCtx.clearRect(0, 0, cellWidth * GLYPHS.length, cellHeight);
      atlasCtx.font = `${RIPPLE.fontSize}px ${font}`;
      atlasCtx.textBaseline = 'middle';
      atlasCtx.textAlign = 'center';
      atlasCtx.fillStyle = '#fff';
      for (let i = 0; i < GLYPHS.length; i++) {
        atlasCtx.fillText(GLYPHS[i], i * cellWidth + cellWidth / 2, cellHeight / 2);
      }
      const src = atlasCtx.getImageData(0, 0, atlas.width, gh).data;
      const stride = atlas.width;
      mask = new Uint8Array(GLYPHS.length * gw * gh);
      for (let g = 0; g < GLYPHS.length; g++) {
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            mask[(g * gh + y) * gw + x] = src[(y * stride + g * gw + x) * 4 + 3];
          }
        }
      }
      atlasKey = key;
    }
    function ensureImage() {
      if (!image || image.width !== canvas.width || image.height !== canvas.height) {
        image = ctx.createImageData(M.max(1, canvas.width), M.max(1, canvas.height));
        pixels = new Uint32Array(image.data.buffer);
      }
    }
    const api2d = {
      mode: '2d',
      data,
      build() { atlasKey = ''; },
      resize(nc, nr) {
        if (nc <= 0 || nr <= 0) return false;
        cols = nc; rowsN = nr;
        data = new Uint8Array(cols * rowsN * 4);
        api2d.data = data;
        return true;
      },
      draw(palette, dpr) {
        buildAtlas(palette.fontFamily, dpr);
        ensureImage();
        pixels.fill(0);
        const W = image.width;
        const H = image.height;
        const ink = palette.ink;
        const wave = palette.wave;
        const isLight = palette.dark === false;
        const amb = Number.isFinite(Number(palette.ambientIntensity)) ? M.max(0, M.min(1, Number(palette.ambientIntensity))) : 1;
        const specCode = Number(palette.spectrumCode ?? 0);
        const aura = readAura(palette);
        const auraStrength = aura.strength * amb;
        const auraOn = auraStrength > 0.001;
        const auraPhase = palette.auraPhase || 0;
        const ax = aura.x * dpr;
        const ay = aura.y * dpr;
        const ar = aura.radius * dpr;
        const ar2 = ar * ar;
        const nebSrc = amb > 0.001 ? palette.nebula : null;
        let nebActiveCount = 0;
        for (let i = 0; i < 3; i++) {
          const srcLobe = nebSrc && nebSrc[i];
          const dstLobe = nebLobeScaled[i];
          if (srcLobe && srcLobe.strength * amb > 0.001) {
            dstLobe.x = srcLobe.x * dpr;
            dstLobe.y = srcLobe.y * dpr;
            dstLobe.r = M.max(1, srcLobe.radius * dpr);
            dstLobe.r2 = dstLobe.r * dstLobe.r;
            dstLobe.s = srcLobe.strength * amb;
            dstLobe.hue = srcLobe.hue;
            nebActiveCount++;
          } else {
            dstLobe.s = 0;
          }
        }
        const auraTintScale = RIPPLE.auraTint * (specCode === 5 ? 0.55 : 1);
        const auraLiftScale = RIPPLE.auraLift * (palette.auraLiftScale ?? 1);
        const nebL = palette.nebulaLiftScale ?? 1;
        const nebTintScale = RIPPLE.nebulaTint * amb * (specCode === 5 ? 0.45 : 1) * (0.35 + 0.65 * nebL);
        const nebLiftScale = RIPPLE.nebulaLift * amb * nebL;
        const prismGain = RIPPLE.prismTint * palette.prismStrength * (specCode === 5 ? 0.45 : 1);
        const stepX = RIPPLE.cellWidth * dpr;
        const stepY = RIPPLE.cellHeight * dpr;
        const cellArea = gw * gh;
        for (let r = 0; r < rowsN; r++) {
          const dy0 = M.round(r * stepY);
          if (dy0 >= H) break;
          const hRows = M.min(gh, H - dy0);
          const cyPx = r * stepY + stepY / 2;
          const py = cyPx - ay;
          const py2 = py * py;
          const ndy0 = cyPx - nebLobeScaled[0].y;
          const ndy1 = cyPx - nebLobeScaled[1].y;
          const ndy2 = cyPx - nebLobeScaled[2].y;
          const ndy02 = ndy0 * ndy0;
          const ndy12 = ndy1 * ndy1;
          const ndy22 = ndy2 * ndy2;
          for (let c = 0; c < cols; c++) {
            const at = (r * cols + c) * 4;
            let alpha = data[at + 1] / 255;
            if (alpha <= 0) continue;
            const mixT = data[at + 2] / 255;
            let cr = ink[0] + (wave[0] - ink[0]) * mixT;
            let cg = ink[1] + (wave[1] - ink[1]) * mixT;
            let cb = ink[2] + (wave[2] - ink[2]) * mixT;
            const packed = data[at + 3];
            const cxPx = c * stepX + stepX / 2;
            let wAura = 0;
            let auraT = 0;
            let auraHue = 0;
            if (auraOn) {
              const px = cxPx - ax;
              const d2 = px * px + py2;
              if (d2 < ar2) {
                const rNorm = M.sqrt(d2) / ar;
                const u = 1 - rNorm;
                const s = u * u * (3 - 2 * u);
                wAura = s * (0.35 + 0.65 * s);
                auraT = wAura * auraTintScale * auraStrength;
                const ang = M.atan2(py, px + 1e-5) / TAU + 0.5;
                auraHue = ang - rNorm * 0.45 + auraPhase;
              }
            }
            let wNeb = 0;
            let nebR = 0;
            let nebG = 0;
            let nebB = 0;
            if (nebActiveCount > 0) {
              for (let i = 0; i < 3; i++) {
                const lb = nebLobeScaled[i];
                if (lb.s <= 0) continue;
                const ndx = cxPx - lb.x;
                const ndy = i === 0 ? ndy0 : (i === 1 ? ndy1 : ndy2);
                const nd2 = ndx * ndx + (i === 0 ? ndy02 : (i === 1 ? ndy12 : ndy22));
                if (nd2 < lb.r2) {
                  const rn = M.sqrt(nd2) / lb.r;
                  const u = 1 - rn;
                  const s = u * u * (3 - 2 * u);
                  const wi = s * (0.30 + 0.70 * s) * lb.s;
                  const nang = M.atan2(ndy, ndx + 1e-5) / TAU;
                  spectrumRgb(lb.hue + nang * 0.22 - rn * 0.26, nebSampleRgb, !isLight, specCode);
                  wNeb += wi;
                  nebR += nebSampleRgb[0] * wi;
                  nebG += nebSampleRgb[1] * wi;
                  nebB += nebSampleRgb[2] * wi;
                }
              }
            }
            const wNebC = wNeb > 1 ? 1 : wNeb;
            const nebT = wNebC * nebTintScale;
            const prismT = packed > 31 ? ((packed >> 5) / PRISM_LEVELS) * prismGain * (0.88 + 0.12 * wAura) : 0;
            if (isLight) {
              alpha = M.min(0.88, alpha * (1 + (auraLiftScale + 0.72) * wAura * auraStrength + prismT * 0.62 + nebLiftScale * 0.66 * wNebC));
            } else if (wAura > 0 || wNebC > 0) {
              alpha = M.min(1, alpha * (1 + auraLiftScale * wAura * auraStrength + nebLiftScale * wNebC));
            }
            const total = auraT + prismT + nebT;
            if (total > 0.0001) {
              const capped = M.min(RIPPLE.prismCap, total);
              const mixAmt = isLight ? M.min(0.96, capped * 1.36) : capped;
              if (auraT > 0) spectrumRgb(auraHue, auraTintRgb, !isLight, specCode);
              if (prismT > 0) spectrumRgb((packed & 31) / HUE_LEVELS, prismTintRgb, !isLight, specCode);
              const nr = wNeb > 0.0001 ? nebR / wNeb : 0;
              const ng = wNeb > 0.0001 ? nebG / wNeb : 0;
              const nb = wNeb > 0.0001 ? nebB / wNeb : 0;
              const tr = (auraTintRgb[0] * auraT + prismTintRgb[0] * prismT + nr * nebT) / total;
              const tg = (auraTintRgb[1] * auraT + prismTintRgb[1] * prismT + ng * nebT) / total;
              const tb = (auraTintRgb[2] * auraT + prismTintRgb[2] * prismT + nb * nebT) / total;
              cr += (tr - cr) * mixAmt;
              cg += (tg - cg) * mixAmt;
              cb += (tb - cb) * mixAmt;
            }
            const a8 = M.round(alpha * 256);
            const R = M.round(cr) & 255;
            const G = M.round(cg) & 255;
            const B = M.round(cb) & 255;
            const rgb = LITTLE_ENDIAN ? (B << 16) | (G << 8) | R : (R << 24) | (G << 16) | (B << 8);
            const dx0 = M.round(c * stepX);
            if (dx0 >= W) continue;
            const wCols = M.min(gw, W - dx0);
            const m0 = (data[at] % GLYPHS.length) * cellArea;
            let o = dy0 * W + dx0;
            for (let y = 0, m = m0; y < hRows; y++, m += gw, o += W) {
              for (let x = 0; x < wCols; x++) {
                const v = mask[m + x];
                if (v === 0) continue;
                const av = (v * a8) >> 8;
                pixels[o + x] = LITTLE_ENDIAN ? ((av << 24) | rgb) >>> 0 : (rgb | av) >>> 0;
              }
            }
          }
        }
        ctx.putImageData(image, 0, 0);
      },
      dispose() {},
    };
    return api2d;
  }
  function normalizeZones(zones) {
    if (!Array.isArray(zones)) return [];
    const out = [];
    for (const z of zones) {
      if (!z) continue;
      const x = Number(z.x);
      const y = Number(z.y);
      const w = Number(z.w ?? z.width);
      const h = Number(z.h ?? z.height);
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) continue;
      out.push({
        x,
        y,
        w,
        h,
        alpha: Number.isFinite(Number(z.alpha)) ? M.max(0, M.min(1, Number(z.alpha))) : RIPPLE.calmAlpha,
        feather: Number.isFinite(Number(z.feather)) ? M.max(1, Number(z.feather)) : RIPPLE.calmFeather,
      });
    }
    return out;
  }
  function zonesKey(list) {
    let key = '';
    for (const z of list) key += `${Math.round(z.x)},${Math.round(z.y)},${Math.round(z.w)},${Math.round(z.h)},${z.alpha},${z.feather};`;
    return key;
  }
  function clampFinite(val, fallback, min, max) {
    const n = Number(val);
    return Number.isFinite(n) ? M.max(min, M.min(max, n)) : fallback;
  }
  function isCanvasDocHidden(canvas) {
    const owner = canvas && canvas.ownerDocument;
    if (owner && typeof owner.hidden === 'boolean') return owner.hidden;
    return typeof document !== 'undefined' && Boolean(document && document.hidden === true);
  }
  const readPerfMode = (m) => {
    if (typeof m === 'string') return m.trim().toLowerCase();
    const h = m?.documentElement || m?.ownerDocument?.documentElement || (typeof document !== 'undefined' ? document.documentElement : null);
    return String(h?.dataset?.agCsPerfMode || h?.getAttribute?.('data-ag-cs-perf-mode') || '').trim().toLowerCase();
  };
  const pickRen = (cv, o, glFn, c2dFn) => {
    if (o?.externalRenderer) return o.externalRenderer;
    const h2 = Boolean(o?.force2D) || (typeof globalThis !== 'undefined' && globalThis.__agRippleForce2D === true);
    const m = readPerfMode(cv);
    return (h2 || o?.prefer2D ? null : glFn()) || (!h2 && (o?.no2DFallback || m === 'performance' || m === 'eco') ? null : c2dFn());
  };
  function createGlyphField(canvas, columns, rows, waves, options) {
    columns = clampDim(columns);
    rows = clampDim(rows);
    const renderer = (columns > 0 && rows > 0)
      ? pickRen(canvas, options, () => createWebGL2Renderer(canvas, columns, rows), () => create2DRenderer(canvas, columns, rows))
      : null;
    const isGpuMod = Boolean(renderer && (renderer.gpuIdleMod || renderer.mode === 'webgl2' || renderer.mode === 'worker-webgl2'));
    const { cellWidth, cellHeight } = RIPPLE;
    let cells = 0, glow, patch, glyphs, edge, mask, breathSin, breathCos, wasLit, colClouds;
    let lastIdleRefreshMs = -Infinity, lastIdleDark = null, lastIdleAlphaScale = -1;
    const cloudColumns = new Map();
    const nebulaState = [
      { x: 0, y: 0, radius: 1, strength: 0, hue: 0 },
      { x: 0, y: 0, radius: 1, strength: 0, hue: 0 },
      { x: 0, y: 0, radius: 1, strength: 0, hue: 0 },
    ];
    const effective = { dark: true, ink: [0, 0, 0], wave: [0, 0, 0], fontFamily: 'monospace', aura: null, nebula: nebulaState, prismStrength: 1, auraPhase: 0, ambientIntensity: 1, spectrumCode: 0, alphaScale: 1, nebulaLiftScale: 1, auraLiftScale: 1, cloudDriftPx: 0, breathSinW: 0, breathCosW: 1 };
    let lastNebulaEnabled = true, instanceZones = normalizeZones(options && options.calmZones);
    let appliedKey = null, lastZonesRef = null, lastZonesNormalized = [];
    let lastTick = -1, lastDraw = -Infinity, glowing = false, prismBurst = 0, stale = true;
    function initGrid(cN, rN) {
      columns = clampDim(cN); rows = clampDim(rN); cells = columns * rows;
      glow = new Float32Array(cells); patch = new Float32Array(cells); glyphs = new Uint8Array(cells);
      edge = new Float32Array(cells); mask = new Float32Array(cells);
      breathSin = new Float32Array(cells); breathCos = new Float32Array(cells); wasLit = new Uint8Array(cells);
      colClouds = new Array(M.max(0, columns));
      cloudColumns.clear();
      appliedKey = null; lastTick = -1; lastIdleRefreshMs = -Infinity; glowing = false; stale = true;
      const featherCols = M.max(1, columns * RIPPLE.edgeFeather), featherRows = M.max(1, rows * RIPPLE.edgeFeather);
      for (let row = 0; row < rows; row++) {
        const y = row * cellHeight + cellHeight / 2;
        const ey = smooth((M.min(row, rows - 1 - row) + 0.5) / featherRows);
        const rowBase = row * columns;
        for (let column = 0; column < columns; column++) {
          const cell = rowBase + column, x = column * cellWidth + cellWidth / 2;
          patch[cell] = patchClear(x, y);
          const ex = smooth((M.min(column, columns - 1 - column) + 0.5) / featherCols);
          edge[cell] = mask[cell] = ex * ey;
          const phase = fractalNoise(x / RIPPLE.breathScale + 53, y / RIPPLE.breathScale + 71) * TAU * 1.7;
          breathSin[cell] = M.sin(phase); breathCos[cell] = M.cos(phase);
        }
      }
    }
    initGrid(columns, rows);
    function applyZones(list) {
      const key = zonesKey(list);
      if (key === appliedKey) return;
      appliedKey = key;
      for (let row = 0; row < rows; row++) {
        const y = row * cellHeight + cellHeight / 2;
        for (let column = 0; column < columns; column++) {
          const cell = row * columns + column;
          const x = column * cellWidth + cellWidth / 2;
          let calm = 1;
          for (let i = 0; i < list.length; i++) {
            const z = list[i];
            const dx = M.max(z.x - x, 0, x - (z.x + z.w));
            const dy = M.max(z.y - y, 0, y - (z.y + z.h));
            const signed = dx > 0 || dy > 0
              ? M.sqrt(dx * dx + dy * dy)
              : -M.min(x - z.x, z.x + z.w - x, y - z.y, z.y + z.h - y);
            if (signed >= z.feather) continue;
            const inset = z.feather * 0.35;
            const t = smooth((signed + inset) / (z.feather + inset));
            const f = z.alpha + (1 - z.alpha) * t;
            if (f < calm) calm = f;
          }
          mask[cell] = edge[cell] * calm;
        }
      }
      stale = true;
    }
    function resolveZones(palette) {
      const source = palette && Array.isArray(palette.calmZones) ? palette.calmZones : null;
      if (!source) return instanceZones;
      if (source !== lastZonesRef) {
        lastZonesRef = source;
        lastZonesNormalized = normalizeZones(source);
      }
      return lastZonesNormalized;
    }
    const onContextLost = (e) => { e?.preventDefault?.(); try { options?.onContextLost?.(e); } catch {} };
    const onContextRestored = () => { try { renderer?.build?.(); } catch {} stale = true; };
    const ctxEv = (m) => { if (canvas?.[m]) { canvas[m]('webglcontextlost', onContextLost); canvas[m]('webglcontextrestored', onContextRestored); } };
    ctxEv('addEventListener');
    function tickAt(now, still) {
      return still ? 0 : M.floor((now / 1000) * RIPPLE.changeRate);
    }
    function cloudColumn(absolute) {
      let col = cloudColumns.get(absolute);
      if (!col) {
        col = new Float32Array(rows);
        for (let row = 0; row < rows; row++) {
          col[row] = cloudClear(absolute * cellWidth + cellWidth / 2, row * cellHeight + cellHeight / 2);
        }
        cloudColumns.set(absolute, col);
      }
      return col;
    }
    function prepareEffective(palette, seconds, still) {
      const dark = palette.dark !== false;
      const rawSpec = palette.spectrum ?? palette.accentTone ?? palette.accent;
      const specCode =
        rawSpec !== undefined && rawSpec !== null
          ? resolveHorizonSpectrumCode(rawSpec)
          : detectHostSpectrumCode(canvas, dark);
      const cl01 = (v, d) => (v !== undefined ? clampFinite(v, 1, 0, 1) : d);
      const ambient = cl01(palette.ambientIntensity, 1);
      const ink = palette.ink || [146, 148, 156];
      const wave = palette.wave || [214, 218, 228];
      const useCoolLightMix = !dark && (specCode === 0 || specCode === 2);
      const mix = useCoolLightMix ? RIPPLE.lightCoolMix : 0;
      for (let i = 0; i < 3; i++) {
        effective.ink[i] = M.round(ink[i] + (RIPPLE.lightInkCool[i] - ink[i]) * mix);
        effective.wave[i] = M.round(wave[i] + (RIPPLE.lightWaveCool[i] - wave[i]) * mix * 0.65);
      }
      const c = palette.conv === true;
      effective.dark = dark;
      effective.fontFamily = palette.fontFamily || 'monospace';
      effective.aura = ambient <= 0.001 ? null : (palette.aura || null);
      effective.ambientIntensity = ambient;
      effective.spectrumCode = specCode;
      effective.alphaScale = cl01(palette.alphaScale, c ? (ambient <= 0.001 ? 0 : 0.85) : 1);
      effective.nebulaLiftScale = cl01(palette.nebulaLiftScale, c ? 0.75 : 1);
      effective.auraLiftScale = cl01(palette.auraLiftScale, c ? 0.75 : 1);
      if (palette.nebula === false || ambient <= 0.001) {
        effective.nebula = null;
        lastNebulaEnabled = false;
      } else {
        effective.nebula = computeNebulaLobes(seconds, columns * cellWidth, rows * cellHeight, Boolean(still), nebulaState);
        lastNebulaEnabled = true;
      }
      const ps = Number(palette.prismStrength ?? (palette.aura && palette.aura.active ? palette.aura.strength : 1));
      effective.prismStrength = (Number.isFinite(ps) ? M.max(0, M.min(1, ps)) : 1) * ambient;
      const ph = Number.isFinite(Number(palette.auraPhase)) ? Number(palette.auraPhase) : seconds * 0.12;
      effective.auraPhase = ph - M.floor(ph);
      return effective;
    }
    function isFieldBusy() {
      return Boolean(waves && waves.active()) || glowing || prismBurst > 0;
    }
    return {
      mode: renderer ? renderer.mode : 'none',
      isContextLost: () => Boolean(renderer && renderer.isContextLost && renderer.isContextLost()),
      getBufferSize: () => (renderer && renderer.getBufferSize ? renderer.getBufferSize() : { width: canvas?.width || 0, height: canvas?.height || 0 }),
      releaseBackingStore() { renderer?.releaseBackingStore?.(); },
      invalidate() { stale = true; },
      resize(nextCols, nextRows, nextWaves, nextDpr) {
        if (nextWaves) waves = nextWaves;
        const nc = clampDim(nextCols), nr = clampDim(nextRows);
        if (!renderer || typeof renderer.resize !== 'function' || nc <= 0 || nr <= 0) return false;
        if (nc === columns && nr === rows) {
          if (renderer.mode === 'worker-webgl2' && nextDpr) renderer.resize(nc, nr, nextDpr);
          stale = true;
          return true;
        }
        if (!renderer.resize(nc, nr, nextDpr)) return false;
        initGrid(nc, nr);
        return true;
      },
      setCalmZones(zones) {
        instanceZones = normalizeZones(zones);
        stale = true;
      },
      busy: isFieldBusy,
      isSettled: () => !isFieldBusy(),
      triggerLiftoffBurst(normX = 0.5, normY = 0.62) {
        if (!waves || typeof waves.disturb !== 'function' || columns <= 0 || rows <= 0) return false;
        const nx = clampFinite(normX, 0.5, 0, 1);
        const ny = clampFinite(normY, 0.62, 0, 1);
        const col = M.max(0, M.min(columns - 1, M.round(nx * (columns - 1))));
        const row = M.max(0, M.min(rows - 1, M.round(ny * (rows - 1))));
        waves.disturb(col, row, {
          amplitudeScale: 1.55,
          radiusScale: 1.45,
          duration: 0.42,
          frequency: 6.4,
          loadWeight: 0.22,
        });
        waves.disturb(col, M.max(0, row - 1), {
          amplitudeScale: 1.28,
          radiusScale: 2.35,
          duration: 0.56,
          frequency: 4.5,
          delay: 0.035,
          loadWeight: 0.22,
        });
        prismBurst = 1;
        stale = true;
        return true;
      },
      triggerTideSwell() {
        if (!waves || typeof waves.disturb !== 'function' || columns <= 0 || rows <= 0) return false;
        const baseRow = M.max(0, rows - 1 - M.min(2, M.floor(rows * 0.06)));
        for (const [nx, delay, amplitudeScale, radiusScale, duration, frequency] of [
          [0.5, 0, 0.78, 1.32, 0.62, 3.2],
          [0.22, 0.07, 0.66, 1.18, 0.6, 3.1],
          [0.78, 0.14, 0.66, 1.18, 0.6, 3.1],
        ]) {
          waves.disturb(M.max(0, M.min(columns - 1, M.round(nx * (columns - 1)))), baseRow, {
            amplitudeScale, radiusScale, duration, frequency, delay, loadWeight: 0.16,
          });
        }
        stale = true;
        return true;
      },
      needsDraw(now, still) {
        if (isCanvasDocHidden(canvas)) return false;
        if (stale || isFieldBusy() || tickAt(now, still) !== lastTick) return true;
        if (still || !lastNebulaEnabled) return false;
        return M.abs(now - lastDraw) >= RIPPLE.nebulaFrameMs;
      },
      draw(now, palette, still) {
        if (columns <= 0 || rows <= 0 || isCanvasDocHidden(canvas)) return;
        const rawDt = lastDraw > -Infinity ? M.max(0, (now - lastDraw) / 1000) : 0;
        if (!renderer) {
          // 无渲染上下文时依然准确推进尾迹与爆发增益衰减，防止 busy() 永久卡 true
          if (!waves.active()) {
            glowing = false;
            prismBurst = 0;
          } else if (prismBurst > 0) {
            prismBurst = still ? 0 : prismBurst * M.exp(-M.max(0.016, rawDt) / 0.38);
            if (prismBurst < 0.015) prismBurst = 0;
          }
          lastDraw = now;
          stale = false;
          return;
        }
        applyZones(resolveZones(palette || {}));
        const seconds = still ? 0 : now / 1000;
        const eff = prepareEffective(palette || {}, seconds, still);
        const burst = prismBurst;
        if (burst > 0) {
          eff.prismStrength = M.min(1.35, M.max(eff.prismStrength, 0.96) + 0.34 * burst);
        }
        const tick = tickAt(now, still);
        const waveActive = waves.active();
        const omega = (TAU / RIPPLE.breathPeriod) * seconds;
        const bs = M.sin(omega);
        const bc = M.cos(omega);
        eff.cloudDriftPx = seconds * RIPPLE.cloudDrift;
        eff.breathSinW = bs;
        eff.breathCosW = bc;
        const idleUploadGap = isGpuMod ? (RIPPLE.idleUploadMs || 500) : RIPPLE.nebulaFrameMs;
        const needIdleRefresh =
          stale ||
          tick !== lastTick ||
          eff.dark !== lastIdleDark ||
          eff.alphaScale !== lastIdleAlphaScale ||
          !isGpuMod ||
          M.abs(now - lastIdleRefreshMs) >= idleUploadGap;
        const curDpr = renderer.mode === 'worker-webgl2'
          ? (renderer.getBufferSize?.().dpr || 1)
          : canvas.width / (columns * cellWidth);

        if (isGpuMod && !needIdleRefresh && !waveActive && !glowing && burst <= 0) {
          renderer.draw(eff, curDpr, false);
          lastDraw = now;
          return;
        }

        if (tick !== lastTick) {
          for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
              glyphs[row * columns + column] = glyphIndex(column, row, tick);
            }
          }
        }
        const needCpuCloud = !isGpuMod || waveActive || glowing || burst > 0;
        const drift = needCpuCloud ? M.floor((seconds * RIPPLE.cloudDrift) / cellWidth) : 0;
        if (needIdleRefresh) {
          if (needCpuCloud) for (const abs of cloudColumns.keys()) if (abs < drift) cloudColumns.delete(abs);
          lastIdleRefreshMs = now;
          lastIdleDark = eff.dark;
          lastIdleAlphaScale = eff.alphaScale;
        }
        const decay = still
          ? 0
          : (rawDt > 0 ? M.exp(-rawDt / RIPPLE.glowDecay) : (waveActive ? 1 : 0.88));
        const idleAlpha = eff.dark ? RIPPLE.idleAlphaDark : RIPPLE.idleAlphaLight;
        const themeScale = (eff.dark ? 1 : RIPPLE.lightAlphaScale) * eff.alphaScale;
        const breathHalf = RIPPLE.breathDepth * 0.5;
        const cap = RIPPLE.waveAlphaCap;
        const slopeScale = RIPPLE.prismSlopeScale;
        const prismThreshold = M.min(0.95, M.max(0, RIPPLE.prismThreshold * (1 - 0.38 * burst)));
        const crestScale = 0.78 + 0.34 * burst;
        const bandScale = RIPPLE.prismBands / TAU;
        const invCap = 1 / cap;
        const inv2CellW = 1 / (2 * cellWidth);
        const inv2CellH = 1 / (2 * cellHeight);
        const invPrismSpan = 1 / M.max(1e-4, 1 - prismThreshold);
        const idleThemeScale = idleAlpha * themeScale;
        const height = waves.height;
        const { data } = renderer;
        if (needCpuCloud) {
          for (let c = 0; c < columns; c++) {
            colClouds[c] = cloudColumn(c + drift);
          }
        }
        let brightest = 0;
        const qA = (a, t) => (a < t ? 0 : a >= 1 ? 255 : (a * 255 + 0.5) | 0);
        for (let row = 0; row < rows; row++) {
          const rowBase = row * columns;
          const hasAbove = row > 0;
          const hasBelow = row < rows - 1;
          for (let column = 0; column < columns; column++) {
            const cell = rowBase + column;
            const here = height[cell];
            const prevG = glow[cell];
            if (here === 0 && prevG === 0) {
              if (!needIdleRefresh && wasLit[cell] === 0) continue;
              wasLit[cell] = 0;
              let alpha;
              if (isGpuMod) {
                alpha = idleThemeScale * mask[cell];
              } else {
                const breath = 1 - breathHalf * (1 + bs * breathCos[cell] + bc * breathSin[cell]);
                alpha = idleThemeScale * colClouds[column][row] * breath * mask[cell];
              }
              const at = cell << 2;
              data[at] = glyphs[cell];
              data[at + 1] = qA(alpha, isGpuMod ? 0.001 : INVISIBLE_ALPHA);
              data[at + 2] = 0;
              data[at + 3] = 0;
              continue;
            }
            const breath = 1 - breathHalf * (1 + bs * breathCos[cell] + bc * breathSin[cell]);
            const strength = M.tanh(RIPPLE.waveGain * (here < 0 ? -here : here));
            const decayed = prevG * decay;
            const shown = decayed > strength ? decayed : strength;
            const lit = shown < 0.01 ? 0 : shown;
            glow[cell] = lit;
            wasLit[cell] = lit > 0 ? 1 : 0;
            let alpha = isGpuMod && lit === 0 ? idleAlpha : idleAlpha * colClouds[column][row] * breath;
            let packed = 0;
            let waveMix = strength;
            if (lit > 0) {
              if (lit > brightest) brightest = lit;
              const rawRatio = (patch[cell] * (lit * RIPPLE.glowAlpha + strength * RIPPLE.waveAlpha)) * invCap;
              alpha += cap * M.tanh(rawRatio);
              const sBoost = strength * 1.15;
              const lBoost = lit * 0.42;
              const mixRaw = sBoost > lBoost ? sBoost : lBoost;
              waveMix = mixRaw > 1 ? 1 : mixRaw;
              const left = column > 0 ? height[cell - 1] : here;
              const right = column < columns - 1 ? height[cell + 1] : here;
              const above = hasAbove ? height[cell - columns] : here;
              const below = hasBelow ? height[cell + columns] : here;
              const gx = (right - left) * inv2CellW;
              const gy = (below - above) * inv2CellH;
              const slopeG = M.sqrt(gx * gx + gy * gy) * slopeScale;
              const crestG = strength * crestScale;
              const g = slopeG > crestG ? slopeG : crestG;
              if (g > prismThreshold) {
                const amt = smooth((g - prismThreshold) * invPrismSpan);
                const level = M.round(amt * PRISM_LEVELS);
                if (level > 0) {
                  let hue = M.atan2(gy, gx + 1e-6) * bandScale + M.tanh(here * 2.4) * 0.3;
                  hue -= M.floor(hue);
                  packed = (level << 5) | (M.floor(hue * HUE_LEVELS) & 31);
                }
              }
            }
            alpha *= mask[cell] * themeScale;
            const at = cell << 2;
            data[at] = glyphs[cell];
            data[at + 1] = qA(alpha, isGpuMod && lit === 0 ? 0.001 : INVISIBLE_ALPHA);
            data[at + 2] = lit > 0 ? M.max(1, (waveMix * 255 + 0.5) | 0) : 0;
            data[at + 3] = packed;
          }
        }
        renderer.draw(eff, curDpr, true);
        if (burst > 0) {
          prismBurst = still ? 0 : burst * M.exp(-M.max(0.016, rawDt) / 0.38);
          if (prismBurst < 0.015) prismBurst = 0;
        }
        glowing = brightest > 0;
        if (!glowing && !waves.active()) {
          glow.fill(0);
          prismBurst = 0;
        }
        lastTick = tick;
        lastDraw = now;
        stale = false;
      },
      dispose(keep) {
        ctxEv('removeEventListener');
        if (renderer) renderer.dispose(keep);
      },
    };
  }
  const DEFAULT_HORIZON_AURA = Object.freeze({
    reach: 0.47,
    prism: 0,
    surge: 0,
    speed: 1,
  });

  const HORIZON_SPECTRUM_MODES = Object.freeze({
    default: 0,
    follow: 0,
    warm: 1,
    alabaster: 1,
    claude: 1,
    cobalt: 2,
    iris: 3,
    amber: 4,
    mono: 5,
    graphite: 5,
    neon: 6,
  });

  const HORIZON_SEMANTIC_MODES = Object.freeze({
    none: 0,
    'awaiting-decision': 1,
    decision: 1,
    'error-halted': 2,
    error: 2,
    'long-task-complete': 3,
    'complete-jade': 3,
  });

  const resolveCode = (v, tbl, max) => {
    if (typeof v === 'number' && Number.isFinite(v)) return M.max(0, M.min(max, M.round(v)));
    const key = String(v || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(tbl, key) ? tbl[key] : 0;
  };
  const resolveHorizonSpectrumCode = (m) => resolveCode(m, HORIZON_SPECTRUM_MODES, 6);
  const resolveHorizonSemanticCode = (s) => resolveCode(s, HORIZON_SEMANTIC_MODES, 3);

  function resolveHorizonDpr(devicePixelRatio = 1, baseScale = 0.72, modeOrDoc) {
    const nRaw = Number(devicePixelRatio), raw = Number.isFinite(nRaw) && nRaw > 0 ? nRaw : 1;
    const mode = readPerfMode(modeOrDoc), r3 = (x) => +x.toFixed(3);
    if (mode === 'performance') return M.max(0.5, M.min(0.95, r3(raw * 0.55)));
    if (mode === 'quality') return M.max(0.75, M.min(2.0, r3(raw)));
    if (mode === 'balanced') return raw <= 1 ? M.max(0.5, r3(raw * 0.7)) : M.max(0.7, M.min(1.25, r3(raw * 0.63)));
    const nSc = Number(baseScale), sc = Number.isFinite(nSc) && nSc > 0 ? nSc : 0.72;
    return raw <= 1 ? M.max(0.5, r3(raw * sc)) : M.max(0.72, M.min(1.35, r3(raw * M.min(0.68, sc * 0.9))));
  }

  function detectHostSpectrumCode(canvas, dark = true) {
    try {
      const doc = (canvas && canvas.ownerDocument) || (typeof document !== 'undefined' ? document : null);
      const html = doc && doc.documentElement;
      if (!html || typeof html.getAttribute !== 'function') return 0;
      const ga = (k) => html.getAttribute(k), ac = resolveHorizonSpectrumCode(ga('data-ag-cs-accent'));
      if (ac) return ac;
      const pal = String(ga('data-ag-cs-palette') || '').trim().toLowerCase();
      if (pal === 'warm' || pal === 'claude') return 1;
      if (!dark && String(ga('data-ag-cs-light-preset') || '').trim().toLowerCase() === 'alabaster') return 1;
      if (dark && ga('data-ag-cs-dark-aura-style') === 'neon') return 6;
    } catch {}
    return 0;
  }

  const HORIZON_PRISM_STOPS = [[66, 133, 244], [155, 114, 203], [234, 67, 53], [251, 188, 4], [92, 198, 252]];
  const HORIZON_NEON_STOPS = [[86, 196, 248], [142, 108, 235], [220, 92, 224], [67, 130, 246]];
  const HORIZON_DAYLIGHT_STOPS = [[37, 99, 235], [124, 58, 237], [234, 67, 53], [217, 119, 6], [2, 132, 199]];
  const _HP_IDX = [0, 1, 2, 3, 2, 1, 4];
  function horizonPrismRgb(t, out, dark = true) {
    const stops = dark === 2 ? HORIZON_NEON_STOPS : dark === false ? HORIZON_DAYLIGHT_STOPS : HORIZON_PRISM_STOPS;
    const idx = dark && dark !== 2 ? _HP_IDX : 0;
    const n = idx ? 7 : stops.length;
    let f = (t - M.floor(t)) * n;
    const i = M.min(n - 1, M.floor(f));
    f = smooth(f - i);
    const a = stops[idx ? idx[i] : i];
    const b = stops[idx ? idx[(i + 1) % n] : (i + 1) % n];
    for (let k = 0; k < 3; k++) out[k] = a[k] + (b[k] - a[k]) * f;
    return out;
  }
  const GLOW_VERT_SHADER = `#version 300 es
void main() {
vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;
  const HORIZON_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform highp vec2 uRes;
uniform float uDpr;
uniform highp float uTime;
uniform float uDark;
uniform float uReach;
uniform float uIntensity;
uniform float uPresence;
uniform float uPrism;
uniform float uSurge;
uniform float uSpeed;
uniform float uSpectrum;
uniform float uSemantic;
uniform vec4 uPre0;
uniform vec4 uPre1;
uniform vec4 uSpecModes;
uniform vec3 uBaseA;
uniform vec3 uBaseB;
uniform vec3 uPrismA;
uniform vec3 uPrismB;
uniform vec3 uLightA;
uniform vec3 uLightB;
uniform vec3 uSurgeLead;
uniform vec3 uChimeLead;
uniform vec3 uHotAnchor;
uniform vec3 uSemA;
uniform vec3 uSemB;
out vec4 outColor;

float hash(highp vec2 p) {
p = fract(p * vec2(123.34, 456.21));
p += dot(p, p + 45.32);
return fract(p.x * p.y);
}
float ign(highp vec2 p) {
return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
float noise(highp vec2 p) {
highp vec2 i = floor(p);
vec2 f = fract(p);
vec2 u = f * f * (3.0 - 2.0 * f);
return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(highp vec2 p) {
float v = 0.0, a = 0.5;
for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
return v;
}
float fbm3(highp vec2 p) {
float v = 0.0625, a = 0.5;
for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
return v;
}
float halftone(highp vec2 px, highp vec2 res, float y, highp float t, float cell, float msk) {
float persp = 1.0 / (0.55 + y);
highp vec2 g = vec2((px.x - res.x * 0.5) * persp, res.y * log(0.55 + y));
g.y += 10.0 * sin(g.x * 0.007 + t * 0.42) + 3.2 * sin(g.x * 0.019 - t * 0.28) - t * 1.5;
vec2 c = fract(g / cell) - 0.5;
float dist = length(c);
float aa = clamp(fwidth(dist) * 1.15, 0.035, 0.14);
float r = 0.08 + 0.16 * msk;
return (1.0 - smoothstep(r - aa, r + aa * 0.35, dist)) * msk;
}
const float INV_FIELD_NORM = 1.1304178;
const vec3 DEEP_SPACE_BLUE = vec3(0.059, 0.090, 0.227);
const vec3 ZENITH_BLUE = vec3(0.192, 0.525, 1.000);
const vec3 SKY_BLUE = vec3(0.361, 0.776, 0.988);
const vec3 HAZE_BLUE = vec3(0.733, 0.886, 1.000);
const vec3 PRISM_COBALT = vec3(0.259, 0.522, 0.957);
const vec3 PRISM_IRIS = vec3(0.608, 0.447, 0.796);
const vec3 DAY_COBALT = vec3(0.145, 0.388, 0.922);
const vec3 DAY_IRIS = vec3(0.486, 0.227, 0.929);
const vec3 DAY_CORAL = vec3(0.918, 0.263, 0.208);
const vec3 DAY_AMBER = vec3(0.851, 0.467, 0.024);
const vec3 DAY_CERULEAN = vec3(0.008, 0.518, 0.780);
const vec3 DAY_TERRACOTTA = vec3(0.761, 0.349, 0.204);
const vec3 DAY_SIENNA = vec3(0.635, 0.247, 0.141);
const vec3 ICE_MIST = vec3(0.839, 0.933, 1.000);
const vec3 WARM_DARK_B = vec3(0.851, 0.467, 0.341);
const vec3 MONO_DARK_HI = vec3(0.847, 0.878, 0.929);
float sf(float t){return smoothstep(0.,1.,fract(t));}
vec3 blueLoop(float x){
float t=fract(x)*4.,f=sf(t);
vec3 i=mix(DEEP_SPACE_BLUE,ZENITH_BLUE,.84),c=mix(SKY_BLUE,HAZE_BLUE,.35);
return t<1.?mix(ZENITH_BLUE,i,f):t<2.?mix(i,SKY_BLUE,f):t<3.?mix(SKY_BLUE,c,f):mix(c,ZENITH_BLUE,f);
}
vec3 prismLoop(float x){
float t=fract(x)*7.,f=sf(t);
vec3 cr=vec3(.94,.4,.48),am=vec3(.95,.64,.32);
return t<1.?mix(PRISM_COBALT,PRISM_IRIS,f):t<2.?mix(PRISM_IRIS,cr,f):t<3.?mix(cr,am,f):t<4.?mix(am,cr,f):t<5.?mix(cr,PRISM_IRIS,f):t<6.?mix(PRISM_IRIS,SKY_BLUE,f):mix(SKY_BLUE,PRISM_COBALT,f);
}
vec3 neonLoop(float x){
float t=fract(x)*4.,f=sf(t);
vec3 m=vec3(.863,.361,.878);
return t<1.?mix(SKY_BLUE,PRISM_IRIS,f):t<2.?mix(PRISM_IRIS,m,f):t<3.?mix(m,PRISM_COBALT,f):mix(PRISM_COBALT,SKY_BLUE,f);
}
vec3 daylightInkLoop(float x){
float t=fract(x)*5.,f=sf(t);
return t<1.?mix(DAY_COBALT,DAY_IRIS,f):t<2.?mix(DAY_IRIS,DAY_CORAL,f):t<3.?mix(DAY_CORAL,DAY_AMBER,f):t<4.?mix(DAY_AMBER,DAY_CERULEAN,f):mix(DAY_CERULEAN,DAY_COBALT,f);
}
vec3 evalBaseDark(float ph){
return uSpecModes.x>.5?mix(uBaseA,uBaseB,.5+.5*sin(ph*6.2831853)):blueLoop(ph);
}
vec3 evalPrismDark(float ph){
if(uSpecModes.y>.5)return uSpecModes.y>1.5?neonLoop(ph):mix(uPrismA,uPrismB,.5+.5*sin(ph*6.2831853+1.1));
return prismLoop(ph);
}
vec3 evalInkLight(float ph,float washPh){
float m=uSpecModes.z;
if(m<.5)return daylightInkLoop(ph);
float w=.5+.5*sin(ph*6.2831853),sw=.5+.5*sin(washPh);
if(m<1.5)return mix(uLightA,uLightB,w);
if(m<2.5)return mix(DAY_TERRACOTTA,mix(DAY_AMBER,DAY_SIENNA,sw),.45+.45*w);
if(m<3.5)return mix(uLightA,uLightB,sw);
return mix(uLightA,uLightB,.5*(w+sw));
}
vec3 sm(vec3 a,float p){return uPre1.y>.001?mix(a,mix(uSemA,uSemB,.5+.5*sin(p*6.2831853)),uPre1.y):a;}
void main() {
highp vec2 uv = gl_FragCoord.xy / max(uRes, vec2(1.0));
float reach = max(uReach, 0.01);
float stretch = uPre1.w;
float surgeUp = max(uSurge, 0.0);
float y = uv.y / reach;
float yCut = y - 0.25 * stretch;
if (yCut > 1.6 + 0.22 * surgeUp) { outColor = vec4(0.0); return; }
float topFeather = 1.0 - smoothstep(1.15 + 0.14 * surgeUp, 1.58 + 0.22 * surgeUp, yCut);
highp float t = uTime;
float waveA = sin(uv.x * 5.2 - t * 0.68);
float waveB = sin(uv.x * 8.6 + t * 0.46 + 1.4);
float curtain = 0.5 + 0.32 * waveA + 0.18 * waveB;
float xEdge = mix(0.35, 1.0, smoothstep(0.0, 0.3, uv.x) * (1.0 - smoothstep(0.7, 1.0, uv.x)));
float jutWave = (waveA * 0.65 + waveB * 0.35) * 0.24;
float hMin = max(y + stretch * (0.36 * (-0.2975 + jutWave) - 0.048125), 0.0);
float glowUpper = exp(-hMin * hMin * 4.0) * (0.76 + 0.42 * curtain) * xEdge;
if (glowUpper * topFeather < 0.0008 && abs(uSurge) < 0.0001) { outColor = vec4(0.0); return; }
highp vec2 px = gl_FragCoord.xy / max(uDpr, 0.5);
highp vec2 res = uRes / max(uDpr, 0.5);
highp vec2 p = (px - res * 0.5) / max(res.y, 1.0);
highp vec2 q = p + 0.09 * vec2(fbm3(p * 2.0 + vec2(t * 0.16, 0.0)), fbm3(p * 2.0 + vec2(3.1, -t * 0.13))) - 0.045;
float jut = (fbm3(vec2(px.x / 220.0 + t * 0.18, t * 0.11)) - 0.5) * 0.68 + jutWave;
float h = max(y + stretch * (0.36 * jut + 0.11 * (fbm3(vec2(px.x / 90.0 - t * 0.21, t * 0.14 + 3.0)) - 0.5)), 0.0);
float glow = exp(-h * h * 4.0) * (0.76 + 0.42 * curtain) * xEdge;
if (glow * topFeather < 0.0008 && abs(uSurge) < 0.0001) { outColor = vec4(0.0); return; }
float basePhase = px.x / max(res.x, 1.0) * 0.9 + t * 0.15 + 0.22 * fbm3(q * 1.5);
float semW = uPre1.y;
vec3 base = sm(evalBaseDark(basePhase), basePhase);
float n = fbm(q * 3.0 + t * 0.16);
float field = (1.0 - exp(-1.8 * glow * (0.75 + 0.45 * n))) * INV_FIELD_NORM;
float effPrism = uPre1.z;
float pPhase = 0.0;
if (uDark <= 0.5 || effPrism > 0.0001 || abs(uSurge) > 0.0001) {
pPhase = uv.x * 1.18 - t * 0.18 + 0.28 * fbm3(q * 2.1 + vec2(0.0, t * 0.12)) + 0.14 * y;
}
vec3 dotPrismTint = vec3(0.0);
float dotPrismMix = 0.0, dotBoost = 0.0, surgeArc = 0.0, surgeDy = 0.0, chimeWave = 0.0, chimePhase = 0.0;
if (effPrism > 0.0001 || abs(uSurge) > 0.0001) {
vec3 pCol = sm(evalPrismDark(pPhase), pPhase);
if (effPrism > 0.0001) {
float wing=smoothstep(.04,.34,field)*(1.-.18*smoothstep(.76,.99,field)),caustics=.62+.38*smoothstep(-.24,.26,jut);
base = mix(base, pCol, clamp(effPrism * 1.45, 0.0, 1.0)) * (0.86 + 0.28 * wing * caustics);
dotPrismTint=pCol;dotPrismMix=clamp(effPrism*1.25*(.45+.55*caustics),0.,.78);
}
if (uSurge > 0.0001) {
float sp = clamp(uSurge, 0.0, 1.0), xRel = (uv.x - 0.5) * 2.0, xSpan = smoothstep(0.0, 0.22, uv.x) * (1.0 - smoothstep(0.78, 1.0, uv.x)), frontY = uPre0.y - 0.15 * xRel * xRel + 0.06 * jut, dy = y - frontY, arc = (dy >= 0.0 ? exp(-dy * dy * 24.0) : exp(-dy * dy * 5.2)) * uPre0.x * xSpan;
surgeArc = arc; surgeDy = dy - sp * 0.35;
vec3 surgeLead = sm(uSurgeLead, pPhase + 0.2), surgeTrail = sm(evalPrismDark(pPhase + surgeDy * 1.3), pPhase + surgeDy * 1.3), surgeCol = mix(surgeLead, surgeTrail, 0.62);
field = clamp(field + arc * 0.52, 0.0, 1.0);
base = mix(base, surgeCol, clamp(arc * 0.78, 0.0, 0.85));
dotBoost += arc * 0.58; dotPrismTint = mix(dotPrismTint, surgeCol, clamp(arc * 0.85, 0.0, 1.0)); dotPrismMix = max(dotPrismMix, clamp(arc * 0.82, 0.0, 0.85));
} else if (uSurge < -0.0001) {
float cp = clamp(-uSurge, 0.0, 1.0), rx = abs(uv.x - 0.5), dr = (rx - uPre0.y) / 0.135, hRip = exp(-dr * dr) + 0.32 * (1.0 - cp) * exp(-rx * rx * 18.0), dsy = y - uPre0.z, vSet = exp(-dsy * dsy * 13.5) * (1.0 - smoothstep(1.05, 1.35, y)), chime = hRip * vSet * uPre0.x;
chimeWave = chime; chimePhase = uv.x * 1.5 + rx * 2.0 - cp * 0.35;
vec3 chimeLead = sm(uChimeLead, chimePhase), chimeCol = mix(mix(chimeLead, evalPrismDark(chimePhase), 0.22), chimeLead, semW);
field = clamp(field + chime * 0.46, 0.0, 1.0);
base = mix(base, chimeCol, clamp(chime * 0.82, 0.0, 0.88));
dotBoost += chime * 0.42; dotPrismTint = mix(dotPrismTint, chimeCol, clamp(chime * 0.8, 0.0, 1.0)); dotPrismMix = max(dotPrismMix, clamp(chime * 0.75, 0.0, 0.82));
}
}
float hot = 0.75 * smoothstep(0.65, 1.0, field);
field *= topFeather;
dotBoost *= topFeather;
float band = smoothstep(0.3, 0.55, field) * (1.0 - smoothstep(0.7, 0.98, field));
float dotMsk = clamp(band * 0.8 * smoothstep(0.12, 0.32, -jut) + dotBoost, 0.0, 1.0);
float dA = dotMsk > 0.001 ? halftone(px, res, uv.y, t, 7.0, dotMsk) : 0.0;
float grain=hash(px+fract(t*7.)*91.)-.5;
vec3 c,dc;float a,da;
if(uDark>.5){
vec3 fill=base*(1.+.28*hot)*mix(.92,1.24,uIntensity);
c=fill+grain*.024;dc=min(fill*1.6,1.);
if(dotPrismMix>.0001)dc=mix(dc,min(dotPrismTint*1.22+.08,1.),dotPrismMix);
float breathMod=mix(.68,1.24,clamp(uIntensity,0.,1.));
a=clamp(field*.56*breathMod*uPresence,0.,1.);
da=clamp(dA*sqrt(a)*.78,0.,1.);
}else{
float washPh = uv.x * 3.1 + t * 0.48 + 1.3 * n;
vec3 prismInk = sm(evalInkLight(pPhase, washPh), pPhase);
vec3 washBase = sm(uSpecModes.w > 0.5 ? mix(DAY_COBALT, DAY_CERULEAN, 0.5 + 0.5 * sin(washPh)) : evalInkLight(basePhase, washPh), basePhase);
float causticsL = 0.48 + 0.52 * smoothstep(-0.24, 0.26, jut);
float dichroicW = clamp((0.48 + 0.46 * effPrism) * (0.58 + 0.42 * causticsL), 0.0, 0.94);
vec3 inkRgb = mix(washBase, prismInk, dichroicW);
if (surgeArc > 0.0001) {
vec3 surgeInk = sm(mix(washBase, evalInkLight(pPhase + surgeDy * 1.3, washPh), 0.68), pPhase + surgeDy * 1.3);
inkRgb = mix(inkRgb, surgeInk, clamp(surgeArc * 0.85, 0.0, 0.90));
} else if (chimeWave > 0.0001) {
vec3 chimeInk = sm(mix(washBase, evalInkLight(chimePhase, washPh), 0.45), chimePhase);
inkRgb = mix(inkRgb, chimeInk, clamp(chimeWave * 0.86, 0.0, 0.90));
}
vec3 hotAnchor = mix(uHotAnchor, washBase * 0.88, semW);
inkRgb = mix(inkRgb, hotAnchor, hot * 0.24);
c = clamp(inkRgb + grain * 0.022, 0.0, 1.0);
dc = clamp(mix(washBase * 0.86, prismInk * 0.92, clamp(0.26 + dotPrismMix * 0.68, 0.0, 0.90)), 0.0, 1.0);
float effPres = uPre0.w;
float washGain = mix(1.02, 1.62, clamp(uIntensity, 0.0, 1.0));
a = clamp(field * 0.66 * washGain * effPres, 0.0, 0.84);
da = clamp(dA * (0.52 + 0.44 * sqrt(a)) * effPres, 0.0, 0.88);
}
float outAlpha = clamp(a + da * (1.0 - a), 0.0, 1.0);
vec3 premulRgb = clamp(c, 0.0, 1.0) * a * (1.0 - da) + clamp(dc, 0.0, 1.0) * da;
if (outAlpha > 0.0015) {
highp vec2 dp = gl_FragCoord.xy + fract(t * 3.0) * vec2(37.0, 19.0);
float tpdf = ign(dp) - ign(dp.yx + vec2(11.3, 27.1));
premulRgb += (tpdf / 255.0) * min(1.0, outAlpha * 2.5);
outAlpha = clamp(outAlpha + tpdf * (0.5 / 255.0), 0.0, 1.0);
}
outColor = clamp(vec4(premulRgb, outAlpha), 0.0, 1.0);
}`;
  const GLOW_FRAG_SHADER = HORIZON_FRAGMENT_SHADER;
  const _H_BASE_D = [
    [0, [0, 0, 0], [0, 0, 0]],
    [1, [0.67485, 0.35195, 0.25195], [0.851, 0.467, 0.341]],
    [0, [0, 0, 0], [0, 0, 0]],
    [1, [0.44, 0.36, 0.82], [0.608, 0.447, 0.796]],
    [1, [0.82, 0.545, 0.2], [0.949, 0.722, 0.294]],
    [1, [0.62, 0.659, 0.725], [0.847, 0.878, 0.929]],
    [0, [0, 0, 0], [0, 0, 0]],
  ];
  const _H_PRISM_D = [
    [0, [0, 0, 0], [0, 0, 0]],
    [1, [0.851, 0.467, 0.341], [0.933, 0.682, 0.365]],
    [1, [0.259, 0.522, 0.957], [0.361, 0.776, 0.988]],
    [1, [0.608, 0.447, 0.796], [0.71, 0.56, 0.96]],
    [1, [0.949, 0.722, 0.294], [0.933, 0.682, 0.365]],
    [1, [0.62, 0.659, 0.725], [0.847, 0.878, 0.929]],
    [2, [0, 0, 0], [0, 0, 0]],
  ];
  const _H_LIGHT = [
    [0, [0.145, 0.388, 0.922], [0.008, 0.518, 0.78]],
    [2, [0.761, 0.349, 0.204], [0.635, 0.247, 0.141]],
    [3, [0.145, 0.388, 0.922], [0.008, 0.518, 0.78]],
    [1, [0.486, 0.227, 0.929], [0.31, 0.275, 0.898]],
    [1, [0.851, 0.467, 0.024], [0.706, 0.325, 0.035]],
    [4, [0.267, 0.318, 0.4], [0.416, 0.475, 0.569]],
    [1, [0.851, 0.467, 0.024], [0.706, 0.325, 0.035]],
  ];
  const _H_SEM_D = {
    1: [[0.949, 0.722, 0.294], [0.95985, 0.76155, 0.3591]],
    2: [[0.851, 0.345, 0.365], [0.7866, 0.301, 0.325]],
    3: [[0.314, 0.745, 0.576], [0.33186, 0.75678, 0.73256]],
  };
  const _H_SEM_L = {
    1: [[0.851, 0.467, 0.024], [0.793, 0.4102, 0.0284]],
    2: [[0.863, 0.149, 0.149], [0.77795, 0.13535, 0.13885]],
    3: [[0.02, 0.588, 0.412], [0.01496, 0.5586, 0.56656]],
  };
  const _HSL = { 0: [.361, .776, .988], 1: [.933, .682, .365], 5: [.847, .878, .929] };
  const _HCL = { 0: [.839, .933, 1], 1: _HSL[1], 5: _HSL[5] };
  const _HHA = { 0: [.19956, .36224, .92312], 1: [.635, .247, .141], 5: [.267, .318, .4] };
  const _HG3 = 'baseA,baseB,prismA,prismB,lightA,lightB,surgeLead,chimeLead,hotAnchor,semA,semB'.split(',');
  const _uCap = (k) => 'u' + k[0].toUpperCase() + k.slice(1);
  function computeHorizonUniforms(dark, presence, prism, surge, speed, spectrumCode, semanticCode) {
    const sp = surge > 1e-4 ? M.min(1, M.max(0, surge)) : 0, cp = surge < -1e-4 ? M.min(1, M.max(0, -surge)) : 0;
    const p1m = sp > 0 ? M.pow(1 - sp, 1.45) : cp > 0 ? M.pow(1 - cp, 1.35) : 1;
    const sc = M.max(0, M.min(6, M.round(Number(spectrumCode) || 0))), semId = M.floor((Number(semanticCode) || 0) + .001);
    const bd = _H_BASE_D[sc] || _H_BASE_D[0], pd = _H_PRISM_D[sc] || _H_PRISM_D[0], ld = _H_LIGHT[sc] || _H_LIGHT[0];
    const semPair = (dark ? _H_SEM_D : _H_SEM_L)[semId < 1.5 ? 1 : semId < 2.5 ? 2 : 3];
    return {
      pre0: [sp > 0 ? M.sin(sp * M.PI) * (1 - .32 * sp) : cp > 0 ? M.sin(cp * M.PI) * (1 - .28 * cp) : 0, sp > 0 ? 1.15 * (1 - p1m) : cp > 0 ? .04 + .43 * (1 - p1m) : 0, cp > 0 ? .7 * p1m + .04 : 0, M.pow(M.max(0, M.min(1, presence)), .68)],
      pre1: [semId, semId > .5 ? M.max(0, M.min(1, 1 - (semanticCode - semId) / .98)) : 0, sc === 5 ? prism * .28 : prism, .6 * (1 + .08 * (speed - 1))],
      modes: [bd[0], pd[0], ld[0], sc === 0 ? 1 : 0],
      baseA: bd[1], baseB: bd[2], prismA: pd[1], prismB: pd[2], lightA: ld[1], lightB: ld[2],
      surgeLead: _HSL[sc] || _HSL[0], chimeLead: _HCL[sc] || _HCL[0], hotAnchor: _HHA[sc] || _HHA[0],
      semA: semPair[0], semB: semPair[1],
    };
  }
  function createBrandHorizonGLRenderer(canvas) {
    const gl = canvas?.getContext?.('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false }) || null;
    if (!gl || gl.isContextLost?.()) return null;
    let prog = null, u = {};
    const free = () => { if (prog) gl.deleteProgram(prog); prog = null; };
    function build() {
      free();
      const built = linkGlProgram(gl, GLOW_VERT_SHADER, HORIZON_FRAGMENT_SHADER, 'uRes,uDpr,uTime,uDark,uReach,uIntensity,uPresence,uPrism,uSurge,uSpeed,uSpectrum,uSemantic,uPre0,uPre1,uSpecModes'.split(',').concat(_HG3.map(_uCap)));
      prog = built.prog; u = built.u;
    }
    try { build(); } catch { try { free(); } catch {} return null; }
    const u1 = (loc, v) => { if (loc) gl.uniform1f(loc, v); };
    const u3 = (loc, v) => { if (loc && typeof gl.uniform3f === 'function') gl.uniform3f(loc, v[0], v[1], v[2]); };
    const u4 = (loc, v) => { if (loc && typeof gl.uniform4f === 'function') gl.uniform4f(loc, v[0], v[1], v[2], v[3]); };
    return {
      mode: 'webgl2', build, isContextLost: () => Boolean(gl.isContextLost?.()),
      clear() { if (!prog || gl.isContextLost?.()) return; gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); },
      draw(w, h, dpr, timeSec, dark, intensity, presence, reach = DEFAULT_HORIZON_AURA.reach, prism = 0, surge = 0, speed = 1, spectrumCode = 0, semanticCode = 0) {
        if (!prog || gl.isContextLost?.()) return;
        const hu = computeHorizonUniforms(dark, presence, prism, surge, speed, spectrumCode, semanticCode);
        gl.viewport(0, 0, w, h); gl.useProgram(prog);
        gl.uniform2f(u.uRes, w, h); u1(u.uDpr, dpr); u1(u.uTime, timeSec);
        u1(u.uDark, dark ? 1 : 0); u1(u.uReach, reach); u1(u.uIntensity, intensity);
        u1(u.uPresence, presence); u1(u.uPrism, prism); u1(u.uSurge, surge);
        u1(u.uSpeed, speed); u1(u.uSpectrum, spectrumCode); u1(u.uSemantic, semanticCode);
        u4(u.uPre0, hu.pre0); u4(u.uPre1, hu.pre1); u4(u.uSpecModes, hu.modes);
        for (const k of _HG3) u3(u[_uCap(k)], hu[k]);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose(keep) { free(); if (!keep) try { gl.getExtension?.('WEBGL_lose_context')?.loseContext?.(); } catch {} },
    };
  }
  function sampleHorizonTone2D(spectrumCode, semanticCode, dark, phase, out) {
    const w = 0.5 + 0.5 * M.sin(phase * TAU);
    const s = (r, g, b) => { out[0] = r; out[1] = g; out[2] = b; return out; };
    if (semanticCode === 1) return dark ? s(242 + 8 * w, 184 + 28 * w, 75 + 47 * w) : s(217 - 37 * w, 119 - 36 * w, 6 + 3 * w);
    if (semanticCode === 2) return dark ? s(217 - 41 * w, 88 - 28 * w, 93 - 25 * w) : s(220 - 62 * w, 38 - 10 * w, 38 - 8 * w);
    if (semanticCode >= 3) return dark ? s(80 + 12 * w, 190 + 8 * w, 147 + 105 * w) : s(5 - 3 * w, 150 - 18 * w, 105 + 94 * w);
    if (spectrumCode === 6) return horizonPrismRgb(phase, out, 2);
    if (spectrumCode === 5) return dark ? s(158 + 58 * w, 168 + 56 * w, 185 + 52 * w) : s(68 + 38 * w, 81 + 40 * w, 102 + 43 * w);
    if (spectrumCode === 4) return dark ? s(209 + 33 * w, 139 + 45 * w, 51 + 24 * w) : s(217 - 37 * w, 119 - 36 * w, 6 + 3 * w);
    if (spectrumCode === 3) return dark ? s(112 + 69 * w, 92 + 51 * w, 209 + 36 * w) : s(124 - 45 * w, 58 + 12 * w, 237 - 8 * w);
    if (spectrumCode === 2) return dark ? s(49 + 43 * w, 134 + 64 * w, 255 - 3 * w) : s(37 - 35 * w, 99 + 33 * w, 235 - 36 * w);
    if (spectrumCode === 1) return dark ? s(168 + 64 * w, 86 + 72 * w, 58 + 35 * w) : s(194 - 28 * w, 89 + 16 * w, 52 - 22 * w);
    return horizonPrismRgb(phase, out, dark);
  }
  function createBrandHorizon2DRenderer(canvas) {
    const ctx = canvas?.getContext?.('2d') || null;
    if (!ctx) return null;
    let image = null, pixels = null;
    const prismRgb = [0, 0, 0], surgeRgb = [0, 0, 0], toneRgb = [0, 0, 0];
    const ensureImage = (w, h) => { if (!image || image.width !== w || image.height !== h) { image = ctx.createImageData(w, h); pixels = new Uint32Array(image.data.buffer); } };
    return {
      mode: '2d', build() {},
      clear() {
        if (typeof ctx.clearRect === 'function') ctx.clearRect(0, 0, canvas.width || 0, canvas.height || 0);
        else if (canvas.width > 0 && canvas.height > 0) { ensureImage(canvas.width, canvas.height); pixels.fill(0); ctx.putImageData(image, 0, 0); }
      },
      draw(w, h, dpr, timeSec, dark, intensity, presence, reach = DEFAULT_HORIZON_AURA.reach, prism = 0, surge = 0, speed = 1, spectrumCode = 0, semanticCode = 0) {
        if (!w || !h) return;
        ensureImage(w, h); pixels.fill(0);
        const { max, min, sin, exp, pow, round, abs, floor, sqrt, log } = M;
        const cl01 = (v) => max(0, min(1, v)), cl255 = (v) => round(min(255, max(0, v))) & 255;
        const sTone = (dk, ph, out) => sampleHorizonTone2D(spectrumCode, semanticCode, dk, ph, out);
        const rEff = max(0.01, reach), stretchScale = 1 + 0.08 * (speed - 1), surgeUp = max(0, surge);
        const effPrism = spectrumCode === 5 ? prism * 0.28 : prism, hasPrism = effPrism > 0.0001, hasSurge = abs(surge) > 0.0001, customMode = spectrumCode > 0 || semanticCode > 0;
        const dprS = max(0.5, dpr), cssW = w / dprS, cssH = h / dprS, step = max(1, round(dpr));
        const effPresL = dark ? presence : pow(cl01(presence), 0.68), washGainL = dark ? 1 : (1.02 + 0.6 * cl01(intensity)), darkBreathMod = dark ? (0.68 + 0.56 * cl01(intensity)) : 1;
        const sp0 = surge > 0.0001 ? min(1, surge) : 0, cp0 = surge < -0.0001 ? min(1, -surge) : 0;
        const sEnv = sp0 ? sin(sp0 * M.PI) * (1 - 0.32 * sp0) : 0, fY0 = sp0 ? 1.15 * (1 - pow(1 - sp0, 1.45)) : 0;
        const cEnv = cp0 ? sin(cp0 * M.PI) * (1 - 0.28 * cp0) : 0, p1c = cp0 ? pow(1 - cp0, 1.35) : 1, rR0 = 0.04 + 0.43 * (1 - p1c), sY0 = 0.7 * p1c + 0.04;
        for (let py = 0; py < h; py += step) {
          const uvY = 1 - py / h, yNorm = uvY / rEff;
          if (yNorm > 1.48 + 0.25 * surgeUp) continue;
          const persp = 1 / (0.55 + uvY), gyBase = cssH * log(0.55 + uvY);
          for (let px = 0; px < w; px += step) {
            const uvX = px / w, cssX = px / dprS, waveA = sin(uvX * 5.2 - timeSec * 0.68), waveB = sin(uvX * 8.6 + timeSec * 0.46 + 1.4);
            const curtain = 0.5 + 0.32 * waveA + 0.18 * waveB, jut = (valueNoise(cssX / 220 + timeSec * 0.18, timeSec * 0.11) - 0.5) * 0.68 + (waveA * 0.65 + waveB * 0.35) * 0.24;
            const hJut = max(0, yNorm + 0.25 * stretchScale * jut), edgeFade = uvX < 0.3 ? 0.35 + 0.65 * smooth(uvX / 0.3) : uvX > 0.7 ? 0.35 + 0.65 * smooth((1 - uvX) / 0.3) : 1;
            const gVal = exp(-hJut * hJut * 4) * (0.76 + 0.42 * curtain) * edgeFade;
            let field = dark ? min(1, gVal * 1.12 * darkBreathMod * presence) : min(1, gVal * 1.12);
            if (!hasSurge && (dark ? field < 0.008 : field * effPresL < 0.008)) continue;
            const mixSky = 0.5 + 0.5 * sin(uvX * 3.2 + timeSec * 0.48), pPhase = uvX * 1.18 - timeSec * 0.18 + 0.28 * valueNoise(uvX * 3.1 + 1.7, yNorm * 1.6 - timeSec * 0.12) + 0.14 * yNorm;
            let baseR, baseG, baseB, dotR = 0, dotG = 0, dotB = 0;
            if (dark) {
              if (customMode) { sTone(true, uvX * 0.8 + timeSec * 0.12, toneRgb); baseR = toneRgb[0]; baseG = toneRgb[1]; baseB = toneRgb[2]; }
              else { baseR = 49 + 43 * mixSky; baseG = 134 + 64 * mixSky; baseB = 255 - 3 * mixSky; }
            } else {
              if (customMode) { sTone(false, pPhase, prismRgb); sTone(false, uvX * 0.5 + timeSec * 0.08, toneRgb); }
              else { horizonPrismRgb(pPhase, prismRgb, false); toneRgb[0] = 37 - 35 * mixSky; toneRgb[1] = 99 + 33 * mixSky; toneRgb[2] = 235 - 36 * mixSky; }
              const causticsL = 0.48 + 0.52 * smooth((jut + 0.24) / 0.5), ep2 = customMode ? effPrism : prism, dW = min(0.94, (0.48 + 0.46 * ep2) * (0.58 + 0.42 * causticsL));
              baseR = toneRgb[0] + (prismRgb[0] - toneRgb[0]) * dW; baseG = toneRgb[1] + (prismRgb[1] - toneRgb[1]) * dW; baseB = toneRgb[2] + (prismRgb[2] - toneRgb[2]) * dW;
              const dm = min(0.9, 0.26 + ep2 * 0.64);
              dotR = (customMode ? toneRgb[0] * 0.86 : 32) * (1 - dm) + prismRgb[0] * 0.92 * dm;
              dotG = (customMode ? toneRgb[1] * 0.86 : 85) * (1 - dm) + prismRgb[1] * 0.92 * dm;
              dotB = (customMode ? toneRgb[2] * 0.86 : 202) * (1 - dm) + prismRgb[2] * 0.92 * dm;
            }
            let dotBoost = 0;
            if (hasPrism || hasSurge) {
              if (dark && hasPrism) {
                sTone(true, pPhase + 0.18, prismRgb);
                const wP = min(0.92, (0.35 + 0.65 * effPrism) * smooth((field - 0.04) / 0.32) * (1 - 0.18 * smooth((field - 0.72) / 0.27)) * (0.62 + 0.38 * smooth((jut + 0.24) / 0.5)));
                baseR += (prismRgb[0] - baseR) * wP; baseG += (prismRgb[1] - baseG) * wP; baseB += (prismRgb[2] - baseB) * wP;
              }
              if (sp0) {
                const xRel = (uvX - 0.5) * 2, xSpan = smooth(uvX / 0.22) * (1 - smooth((uvX - 0.78) / 0.22)), dy = yNorm - (fY0 - 0.15 * xRel * xRel + 0.06 * jut);
                const arc = (dy >= 0 ? exp(-dy * dy * 24) : exp(-dy * dy * 5.2)) * sEnv * xSpan;
                field = min(1, field + arc * 0.52 * (dark ? presence : 1));
                sTone(dark, pPhase + dy * 1.3 - sp0 * 0.35, surgeRgb);
                const wA = min(0.88, arc * 0.82);
                baseR += ((customMode ? surgeRgb[0] : dark ? 92 : 37) * 0.34 + surgeRgb[0] * 0.66 - baseR) * wA;
                baseG += ((customMode ? surgeRgb[1] : dark ? 198 : 99) * 0.34 + surgeRgb[1] * 0.66 - baseG) * wA;
                baseB += ((customMode ? surgeRgb[2] : dark ? 252 : 235) * 0.34 + surgeRgb[2] * 0.66 - baseB) * wA;
                dotBoost += arc * 0.58 * (dark ? presence : 1);
              } else if (cp0) {
                const rx = abs(uvX - 0.5), dr = (rx - rR0) / 0.135, dsy = yNorm - sY0;
                const chime = (exp(-dr * dr) + 0.32 * (1 - cp0) * expClamp(rx * rx * 18)) * exp(-dsy * dsy * 13.5) * (1 - smooth((yNorm - 1.05) / 0.3)) * cEnv;
                field = min(1, field + chime * 0.46 * (dark ? presence : 1));
                sTone(dark, uvX * 1.5 + rx * 2 - cp0 * 0.35, surgeRgb);
                const wC = min(0.88, chime * 0.84);
                baseR += ((customMode ? surgeRgb[0] : dark ? 214 * 0.78 + surgeRgb[0] * 0.22 : 2 * 0.55 + surgeRgb[0] * 0.45) - baseR) * wC;
                baseG += ((customMode ? surgeRgb[1] : dark ? 238 * 0.78 + surgeRgb[1] * 0.22 : 132 * 0.55 + surgeRgb[1] * 0.45) - baseG) * wC;
                baseB += ((customMode ? surgeRgb[2] : dark ? 255 * 0.78 + surgeRgb[2] * 0.22 : 199 * 0.55 + surgeRgb[2] * 0.45) - baseB) * wC;
                dotBoost += chime * 0.42 * (dark ? presence : 1);
              }
            }
            if (dark ? field < 0.008 : field * effPresL < 0.008) continue;
            const gx = (cssX - cssW * 0.5) * persp, gy = gyBase + 10 * sin(gx * 0.007 + timeSec * 0.42) - timeSec * 1.4;
            const cX = gx / 7 - floor(gx / 7) - 0.5, cY = gy / 7 - floor(gy / 7) - 0.5, dist = sqrt(cX * cX + cY * cY);
            const band = min(1, smooth((field - 0.25) / 0.25) * (1 - smooth((field - 0.72) / 0.26)) + dotBoost);
            let fillA, dotA, R, G, B;
            if (dark) {
              dotA = dist < 0.26 ? (1 - smooth((dist - 0.12) / 0.14)) * band * 0.65 : 0; fillA = field * 0.48;
              const dL = spectrumCode === 5 ? 36 : 56;
              R = cl255(baseR + dotA * (spectrumCode === 5 ? 36 : 72)); G = cl255(baseG + dotA * dL); B = cl255(baseB + dotA * (spectrumCode === 5 ? 38 : 24));
            } else {
              fillA = min(0.84, field * 0.66 * washGainL * effPresL);
              dotA = dist < 0.24 ? min(0.88, (1 - smooth((dist - 0.14) / 0.1)) * band * (0.52 + 0.44 * sqrt(fillA)) * effPresL) : 0;
              const hL = 0.24 * smooth((field - 0.65) / 0.35), compA = fillA + dotA * (1 - fillA);
              if (compA <= 0.002) continue;
              const wF = (fillA * (1 - dotA)) / compA, wD = dotA / compA;
              R = cl255((baseR * (1 - hL) + (customMode ? baseR * 0.85 : 46) * hL) * wF + dotR * wD);
              G = cl255((baseG * (1 - hL) + (customMode ? baseG * 0.85 : 92) * hL) * wF + dotG * wD);
              B = cl255((baseB * (1 - hL) + (customMode ? baseB * 0.85 : 235) * hL) * wF + dotB * wD);
            }
            const A = round(cl01(fillA + dotA * (1 - fillA)) * 255) & 255;
            if (A === 0) continue;
            const packed = LITTLE_ENDIAN ? ((A << 24) | (B << 16) | (G << 8) | R) >>> 0 : ((R << 24) | (G << 16) | (B << 8) | A) >>> 0;
            for (let sy = 0; sy < step && py + sy < h; sy++) for (let sx = 0, ro = (py + sy) * w + px; sx < step && px + sx < w; sx++) pixels[ro + sx] = packed;
          }
        }
        ctx.putImageData(image, 0, 0);
      },
      dispose() {},
    };
  }
  const expClamp = (v) => (v > 40 ? 0 : M.exp(-v));
  function parseAmbientScale(raw) {
    if (raw === null || raw === undefined || raw === '') return 1;
    const n = Number(raw);
    return !Number.isFinite(n) ? 1 : n <= 0 ? 0 : M.max(0, M.min(1, n > 1 ? n / 100 : n));
  }

  function mountBrandHorizonGlow(canvas, opts = {}) {
    if (!canvas) {
      return {
        mode: 'none', resize() {}, invalidate() {}, clear() {}, draw() {}, dispose() {},
        setAuraParams: () => ({ ...DEFAULT_HORIZON_AURA }), getAuraParams: () => ({ ...DEFAULT_HORIZON_AURA }),
        getExtendedState: () => ({ ...DEFAULT_HORIZON_AURA, spectrum: 'default', semantic: 'none', ambientIntensity: 1, sleeping: true }),
        drawStaticSnapshot: () => false, isSleeping: () => true, isContextLost: () => false,
      };
    }
    const extRen = opts.externalRenderer || null;
    const ren = pickRen(canvas, opts, () => createBrandHorizonGLRenderer(canvas), () => createBrandHorizon2DRenderer(canvas));
    let cssW = M.max(0, Number(opts.width ?? canvas.clientWidth ?? 0)), cssH = M.max(0, Number(opts.height ?? canvas.clientHeight ?? 0));
    const maxDpr = extRen ? 2 : 1.75;
    let dpr = M.max(0.5, M.min(maxDpr, Number(opts.dpr || 1)));
    const bAura = {
      reach: clampFinite(opts.reach, DEFAULT_HORIZON_AURA.reach, 0.05, 1),
      prism: clampFinite(opts.prism, DEFAULT_HORIZON_AURA.prism, 0, 1),
      surge: clampFinite(opts.surge, DEFAULT_HORIZON_AURA.surge, -1, 1),
      speed: clampFinite(opts.speed, DEFAULT_HORIZON_AURA.speed, 0, 3),
    };
    const aAura = { ...bAura };
    let bSpec = opts.spectrum !== undefined ? String(opts.spectrum) : (opts.accent !== undefined ? String(opts.accent) : null);
    let bSem = opts.semantic !== undefined ? String(opts.semantic) : 'none', bAmb = clampFinite(opts.ambientIntensity, 1, 0, 1);
    let aSpec = bSpec || 'default', aSem = bSem, aAmb = bAmb;
    let hasCust = Boolean(extRen) || opts.reach !== undefined || opts.prism !== undefined || opts.surge !== undefined || opts.speed !== undefined;
    let startMs = null, lastClk = null, lastRaw = null, flowSec = 0, lastDraw = -Infinity;
    let lDark = null, lStr = -1, lReach = -1, lPrism = -1, lSurge = -9, lSpeed = -1;
    let lSpec = -1, lSem = -1, semMix = 0, holdSem = 0, clrZ = false, stale = true, slp = false;
    const onCL = (e) => { e?.preventDefault?.(); try { opts?.onContextLost?.(e); } catch {} };
    const onCR = () => { try { ren?.build?.(); } catch {} stale = true; };
    if (!extRen && canvas.addEventListener) { canvas.addEventListener('webglcontextlost', onCL); canvas.addEventListener('webglcontextrestored', onCR); }
    function syncSize(w, h, ndIn) {
      const nw = M.max(0, M.round(Number(w || 0))), nh = M.max(0, M.round(Number(h || 0)));
      const nd = M.max(0.5, M.min(maxDpr, Number(ndIn || dpr || 1)));
      if (extRen) {
        if (extRen.resize(nw, nh, nd)) { cssW = nw; cssH = nh; dpr = nd; clrZ = false; stale = true; }
        return;
      }
      const pw = M.max(1, M.round(nw * nd)), ph = M.max(1, M.round(nh * nd));
      if (nw !== cssW || nh !== cssH || nd !== dpr || canvas.width !== pw || canvas.height !== ph) {
        cssW = nw; cssH = nh; dpr = nd;
        if (nw > 0 && nh > 0) { canvas.width = pw; canvas.height = ph; }
        clrZ = false; stale = true;
      }
    }
    if (!extRen && cssW > 0 && cssH > 0 && (!canvas.width || !canvas.height)) syncSize(cssW, cssH, dpr);
    function setAuraParams(ex) {
      if (!ex || typeof ex !== 'object') {
        Object.assign(bAura, DEFAULT_HORIZON_AURA);
        bSpec = null; bSem = aSem = 'none'; bAmb = aAmb = 1; aSpec = 'default'; hasCust = Boolean(extRen);
      } else {
        if (ex.reach !== undefined) bAura.reach = clampFinite(ex.reach, bAura.reach, 0.05, 1);
        if (ex.prism !== undefined) bAura.prism = clampFinite(ex.prism, bAura.prism, 0, 1);
        if (ex.surge !== undefined) bAura.surge = clampFinite(ex.surge, bAura.surge, -1, 1);
        if (ex.speed !== undefined) bAura.speed = clampFinite(ex.speed, bAura.speed, 0, 3);
        if (ex.spectrum !== undefined || ex.accent !== undefined) bSpec = aSpec = String(ex.spectrum ?? ex.accent);
        if (ex.semantic !== undefined) bSem = aSem = String(ex.semantic);
        if (ex.ambientIntensity !== undefined) bAmb = aAmb = clampFinite(ex.ambientIntensity, bAmb, 0, 1);
        hasCust = true;
      }
      Object.assign(aAura, bAura); stale = true;
      return { ...aAura };
    }
    const clearCv = () => { ren?.clear?.(); clrZ = true; slp = true; };
    function renderIn(nowIn, arg1 = {}, sArg, exArg, fStatic = false) {
      if (!ren) return false;
      if (extRen) { if (!extRen.canDraw()) return false; }
      else if (canvas.width <= 0 || canvas.height <= 0 || isCanvasDocHidden(canvas)) return false;
      if (fStatic && nowIn && typeof nowIn === 'object') { exArg = sArg; sArg = arg1; arg1 = nowIn; nowIn = 0; }
      const isObj = typeof arg1 === 'object' && arg1 !== null;
      let still = fStatic, dark = true, rawS = 1, ex = null;
      if (isObj) {
        still = fStatic || Boolean(arg1.still || arg1.staticSnapshot);
        dark = arg1.dark !== false; rawS = arg1.strength ?? arg1.prismStrength ?? 1;
        const nest = sArg && typeof sArg === 'object' ? sArg : (arg1.extra && typeof arg1.extra === 'object' ? arg1.extra : null);
        if (nest || arg1.reach !== undefined || arg1.prism !== undefined || arg1.surge !== undefined || arg1.speed !== undefined || arg1.spectrum !== undefined || arg1.accent !== undefined || arg1.semantic !== undefined || arg1.ambientIntensity !== undefined || arg1.continuous !== undefined) {
          ex = nest ? { ...arg1, ...nest } : arg1;
        }
      } else {
        dark = arg1 !== false; rawS = sArg ?? 1; ex = exArg && typeof exArg === 'object' ? exArg : null;
        still = fStatic || Boolean(ex && (ex.still || ex.staticSnapshot));
      }
      const amb = ex && ex.ambientIntensity !== undefined ? clampFinite(ex.ambientIntensity, bAmb, 0, 1) : bAmb;
      aAmb = amb;
      const str = clampFinite(rawS, 1, 0, 1) * amb;
      if (amb <= 0 || (fStatic && str <= 0)) { if (!clrZ) clearCv(); else slp = true; return false; }
      const reach = ex?.reach !== undefined ? clampFinite(ex.reach, bAura.reach, 0.05, 1) : bAura.reach;
      const prism = ex?.prism !== undefined ? clampFinite(ex.prism, bAura.prism, 0, 1) : bAura.prism;
      const surge = ex?.surge !== undefined ? clampFinite(ex.surge, bAura.surge, -1, 1) : bAura.surge;
      const speed = ex?.speed !== undefined ? clampFinite(ex.speed, bAura.speed, 0, 3) : bAura.speed;
      const rawSp = ex && (ex.spectrum !== undefined || ex.accent !== undefined) ? (ex.spectrum ?? ex.accent) : bSpec;
      const specC = rawSp != null ? resolveHorizonSpectrumCode(rawSp) : detectHostSpectrumCode(canvas, dark);
      const rawSem = ex?.semantic !== undefined ? ex.semantic : bSem, semC = resolveHorizonSemanticCode(rawSem);
      aAura.reach = reach; aAura.prism = prism; aAura.surge = surge; aAura.speed = speed;
      aSpec = rawSp || (specC === 1 ? 'warm' : 'default'); aSem = String(rawSem || 'none');

      const rawNow = Number(nowIn || 0);
      const inSec = !extRen && (Boolean(ex?.timeUnit === 'sec') || (!isObj && lastRaw !== null && rawNow > 0 && rawNow < 1e4 && M.abs(rawNow - lastRaw) > 0 && M.abs(rawNow - lastRaw) < 0.5));
      lastRaw = rawNow;
      const nowMs = inSec ? rawNow * 1000 : rawNow;
      if (startMs === null) startMs = nowMs;
      const ext = Boolean(ex) || hasCust, realSec = still ? 0 : M.max(0, (nowMs - startMs) / 1000);
      const ramp = still || fStatic || ext ? 1 : -(M.cos(M.PI * M.min(1, M.max(0, realSec / 1.4))) - 1) * 0.5;
      const baseP = M.max(0.22, ramp);
      const dirty = fStatic || dark !== lDark || specC !== lSpec || semC !== lSem || M.abs((semC > 0 ? 1 : 0) - semMix) > 0.005 || M.abs(str - lStr) >= 0.005 || M.abs(reach - lReach) >= 0.002 || M.abs(prism - lPrism) >= 0.002 || M.abs(surge - lSurge) >= 0.001 || M.abs(speed - lSpeed) >= 0.005;
      const gap = ren.mode === 'webgl2' || extRen ? 0 : ext ? 14 : baseP < 1 ? 33 : 42;
      if (!extRen && !stale && !dirty && (still || (gap > 0 && M.abs(nowMs - lastDraw) < gap))) { if (fStatic) slp = true; return false; }
      let dt = 0;
      if (fStatic) { if (flowSec === 0) flowSec = 2.4; lastClk = nowMs; slp = true; }
      else if (still) { lastClk = nowMs; slp = true; }
      else {
        slp = false;
        if (lastClk === null || nowMs < lastClk) { if (lastClk === null && !extRen) flowSec = M.min(2.4, realSec * speed); lastClk = nowMs; }
        else { dt = M.min(0.35, M.max(0, (nowMs - lastClk) / 1000)); lastClk = nowMs; flowSec += dt * speed; }
      }
      if (semC > 0) holdSem = semC;
      if (fStatic || still) semMix = semC > 0 ? 1 : 0;
      else { const tgt = semC > 0 ? 1 : 0; semMix += (tgt - semMix) * M.min(1, M.max(0.04, dt / 0.45)); if (M.abs(tgt - semMix) < 0.01) semMix = tgt; }
      const effSem = holdSem > 0 && semMix > 0.005 ? holdSem + (1 - semMix) * 0.98 : 0;
      const breath = fStatic ? 0.64 : still ? 0.58 : 0.46 + 0.24 * M.sin(flowSec * 1.15) + 0.06 * M.sin(flowSec * 2.05 + 0.9);
      const inten = !ext && str >= 0.999 ? breath * (0.2 + 0.8 * str) : breath * (0.55 + 0.45 * str);
      const pres = baseP * (str <= 0 ? 0 : str >= 0.999 ? 1 : M.pow(str, 0.78));
      ren.draw(canvas.width || 0, canvas.height || 0, dpr, 12 + flowSec, dark, inten, pres, reach, prism, surge, speed, specC, effSem, { still: Boolean(still), continuous: Boolean(ex?.continuous) });
      clrZ = stale = false;
      lastDraw = nowMs; lDark = dark; lStr = str; lReach = reach; lPrism = prism; lSurge = surge; lSpeed = speed; lSpec = specC; lSem = semC;
      return true;
    }
    return {
      mode: ren ? ren.mode : 'none', isContextLost: () => Boolean(ren?.isContextLost?.()),
      getBufferSize: () => (ren?.getBufferSize ? ren.getBufferSize() : { width: canvas.width || 0, height: canvas.height || 0, dpr }),
      releaseBackingStore() { stale = true; slp = true; ren?.releaseBackingStore?.(); },
      resize: syncSize, invalidate() { stale = true; }, clear: clearCv, setAuraParams,
      getAuraParams: () => ({ ...aAura }),
      getExtendedState: () => ({ ...aAura, spectrum: aSpec, semantic: aSem, ambientIntensity: aAmb, sleeping: slp || Boolean(ren?.isSleeping?.()) }),
      isSleeping: () => slp || Boolean(ren?.isSleeping?.()),
      draw: (n, a = {}, s, e) => renderIn(n, a, s, e, false),
      drawStaticSnapshot: (n, a = {}, s, e) => { stale = true; return renderIn(n, a, s, e, true); },
      dispose(keep) {
        slp = true;
        if (!extRen && canvas.removeEventListener) { canvas.removeEventListener('webglcontextlost', onCL); canvas.removeEventListener('webglcontextrestored', onCR); }
        ren?.dispose(keep);
      },
    };
  }
  const WORKER_SHADERS = Object.freeze({ glowVs: GLOW_VERT_SHADER, glowFs: HORIZON_FRAGMENT_SHADER, fieldVs: VERTEX_SHADER, fieldFs: FRAGMENT_SHADER });
  return {
    RIPPLE, SPECTRUM, SPECTRUM_LIGHT, HORIZON_SPECTRUM, HORIZON_PRISM_STOPS, HORIZON_DAYLIGHT_STOPS,
    HORIZON_SPECTRUM_MODES, HORIZON_SEMANTIC_MODES, HORIZON_FRAGMENT_SHADER, GLOW_VERT_SHADER, GLOW_FRAG_SHADER,
    VERTEX_SHADER, FRAGMENT_SHADER, WORKER_SHADERS, getGlyphSpectrumStops, computeHorizonUniforms, packFieldDrawParams, detectHostSpectrumCode,
    DEFAULT_HORIZON_AURA, GLYPHS, hash, valueNoise, fractalNoise, glyphIndex, cloudClear, patchClear,
    spectrumRgb, horizonPrismRgb, resolveHorizonSpectrumCode, resolveHorizonSemanticCode, resolveHorizonDpr,
    computeNebulaLobes, createWaveField, parseCssColorToRgb, parseAmbientScale, createGlyphField, mountBrandHorizonGlow,
  };
});
