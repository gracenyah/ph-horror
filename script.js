/* =========================================================
   THE LOST CITY: PORT HARCOURT — script.js
   All audio is synthesized live with the Web Audio API.
   No external assets, no samples.
   ========================================================= */
(() => {
  'use strict';

  /* ---------------- Utilities ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  let survivor = store.get('tlc_survivor', null);
  const playerName = () => (survivor && survivor.name) ? survivor.name : 'survivor';
  const visitedLevels = new Set();
  const studiedCreatures = new Set();

  /* =========================================================
     AUDIO ENGINE — original procedural horror score + SFX
     ========================================================= */
  const SND = (() => {
    let ctx = null, master, sfx, analyser, noiseBuf, drumTimer = null, step = 0, curve = null;
    let enabled = false, musicOn = false;
    const buses = {};
    const vols = { rain: .6, drone: .5, drums: .45, gen: .25 };

    const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; };
    const filt = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
    const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };

    function init() {
      if (ctx) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      analyser = ctx.createAnalyser(); analyser.fftSize = 64; analyser.connect(ctx.destination);
      master = gain(0); master.connect(analyser);
      sfx = gain(.9); sfx.connect(analyser);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      for (const k in vols) { buses[k] = gain(vols[k]); buses[k].connect(master); }

      // Rain: hiss + low rumble
      const r1 = noiseSrc(); r1.connect(filt('highpass', 500)).connect(filt('lowpass', 7000)).connect(gain(.22)).connect(buses.rain); r1.start();
      const r2 = noiseSrc(); r2.connect(filt('lowpass', 170)).connect(gain(.55)).connect(buses.rain); r2.start(ctx.currentTime + .37);

      // Drone: detuned saws through a slowly breathing filter
      const dlp = filt('lowpass', 260, 4); dlp.connect(gain(.18)).connect(buses.drone);
      [[55, 'sawtooth'], [55.7, 'sawtooth'], [41.2, 'sine'], [82.4, 'triangle']].forEach(([f, t]) => {
        const o = ctx.createOscillator(); o.type = t; o.frequency.value = f; o.connect(dlp); o.start();
      });
      const lfo = ctx.createOscillator(); lfo.frequency.value = .05; lfo.connect(gain(140)).connect(dlp.frequency); lfo.start();

      // Generator hum (50 Hz mains feel) with a mechanical tremolo
      const glp = filt('lowpass', 200); const gg = gain(.12); glp.connect(gg).connect(buses.gen);
      const g1 = ctx.createOscillator(); g1.type = 'sawtooth'; g1.frequency.value = 50; g1.connect(glp); g1.start();
      const g2 = ctx.createOscillator(); g2.type = 'square'; g2.frequency.value = 100.4; g2.connect(gain(.3)).connect(glp); g2.start();
      const trem = ctx.createOscillator(); trem.frequency.value = 6.5; trem.connect(gain(.04)).connect(gg.gain); trem.start();
      return true;
    }

    function distCurve() {
      if (curve) return curve;
      curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i * 2 / 1024 - 1; curve[i] = Math.tanh(x * 4); }
      return curve;
    }
    // Low distorted drum
    function tom(t, f = 90, vol = .9, out) {
      out = out || buses.drums;
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * .45, t + .35);
      const ws = ctx.createWaveShaper(); ws.curve = distCurve();
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + .6);
      o.connect(ws).connect(g).connect(out); o.start(t); o.stop(t + .65);
    }
    // Wooden slit-drum / bell-like knock
    function slit(t, f = 420, vol = .25, out) {
      out = out || buses.drums;
      [1, 1.48].forEach(m => {
        const o = ctx.createOscillator(); o.frequency.value = f * m;
        const g = ctx.createGain(); g.gain.setValueAtTime(vol / m, t); g.gain.exponentialRampToValueAtTime(.001, t + .14);
        o.connect(g).connect(out); o.start(t); o.stop(t + .16);
      });
    }
    function shaker(t, vol = .07) {
      const s = noiseSrc(); const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + .07);
      s.connect(filt('highpass', 6000)).connect(g).connect(buses.drums); s.start(t, Math.random()); s.stop(t + .08);
    }
    const pattern = { tom: [0, 3, 6, 10, 11], slit: [2, 7, 9, 14], shake: [1, 3, 5, 7, 9, 11, 13, 15] };
    function drumTick() {
      if (!ctx) return;
      const t = ctx.currentTime + .05, s = step % 16;
      if (pattern.tom.includes(s) && Math.random() > .1) tom(t, s === 0 ? 70 : rand(85, 110), s === 0 ? 1 : .6);
      if (pattern.slit.includes(s) && Math.random() > .25) slit(t, pick([380, 420, 470, 520]));
      if (pattern.shake.includes(s)) shaker(t);
      step++;
    }

    function ramp(param, to, secs) {
      const t = ctx.currentTime; param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(to, t + secs);
    }
    function enable() { if (!init()) return false; enabled = true; ctx.resume(); return true; }
    function startMusic() {
      if (!enable()) return;
      musicOn = true; ramp(master.gain, .8, 2);
      if (!drumTimer) drumTimer = setInterval(drumTick, 320);
    }
    function stopMusic() {
      if (!ctx) return;
      musicOn = false; ramp(master.gain, 0, 1);
      clearInterval(drumTimer); drumTimer = null;
    }
    function disable() { stopMusic(); enabled = false; }
    function setVol(k, v) { vols[k] = v; if (buses[k]) buses[k].gain.value = v; }
    // Music drops to near silence before an encounter, then returns slowly
    function silence(ms, then) {
      if (!ctx || !musicOn) { setTimeout(() => then && then(), ms); return; }
      ramp(master.gain, 0, .25); clearInterval(drumTimer); drumTimer = null;
      setTimeout(() => {
        then && then();
        if (musicOn) { ramp(master.gain, .8, 3.5); drumTimer = setInterval(drumTick, 320); }
      }, ms);
    }
    const ok = () => enabled && ctx;
    function env(g, t, a, peak, d) {
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d);
    }

    const fx = {
      thunder(delay = 0) {
        if (!ok()) return;
        const t = ctx.currentTime + delay, s = noiseSrc(), lp = filt('lowpass', 900), g = ctx.createGain();
        lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(110, t + 3);
        env(g, t, .05, 1.2, 3.5); s.connect(lp).connect(g).connect(sfx); s.start(t); s.stop(t + 4);
      },
      heartbeat(n = 1) {
        if (!ok()) return;
        for (let i = 0; i < n; i++) {
          const t = ctx.currentTime + i * 1.0;
          [0, .28].forEach((o, j) => {
            const osc = ctx.createOscillator(); osc.frequency.setValueAtTime(65, t + o); osc.frequency.exponentialRampToValueAtTime(35, t + o + .2);
            const g = ctx.createGain(); env(g, t + o, .01, j ? .6 : .9, .25);
            osc.connect(g).connect(sfx); osc.start(t + o); osc.stop(t + o + .35);
          });
        }
      },
      static(dur = .6, vol = .25) {
        if (!ok()) return;
        const t = ctx.currentTime, s = noiseSrc(), g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        for (let i = 0; i < dur * 30; i++) g.gain.setValueAtTime(Math.random() * vol, t + i / 30);
        g.gain.setValueAtTime(0, t + dur);
        s.connect(filt('bandpass', 2200, .6)).connect(g).connect(sfx); s.start(t, Math.random()); s.stop(t + dur + .05);
      },
      whisper() {
        if (!ok()) return;
        const t = ctx.currentTime, s = noiseSrc(), bp = filt('bandpass', 1800, 9), g = ctx.createGain();
        bp.frequency.setValueAtTime(rand(1400, 2200), t); bp.frequency.linearRampToValueAtTime(rand(2600, 3600), t + .5); bp.frequency.linearRampToValueAtTime(rand(1200, 2000), t + 1.1);
        env(g, t, .2, .6, 1.0); s.connect(bp).connect(g);
        if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = rand(-1, 1); g.connect(p).connect(sfx); } else g.connect(sfx);
        s.start(t, Math.random()); s.stop(t + 1.4);
      },
      stinger() {
        if (!ok()) return;
        const t = ctx.currentTime; tom(t, 60, 1.4, sfx);
        [1100, 1167, 1240, 1310].forEach(f => {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * .92, t + 1.6);
          const g = ctx.createGain(); env(g, t, .01, .06, 1.6); o.connect(g).connect(sfx); o.start(t); o.stop(t + 1.7);
        });
        fx.static(.4, .4);
      },
      gunshot() {
        if (!ok()) return;
        const t = ctx.currentTime, s = noiseSrc(), lp = filt('lowpass', 5000), g = ctx.createGain();
        lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(300, t + .3);
        env(g, t, .002, 1, .35); s.connect(lp).connect(g).connect(sfx); s.start(t, Math.random()); s.stop(t + .4);
        tom(t, 120, .8, sfx);
      },
      click() { if (ok()) slit(ctx.currentTime, 1800, .15, sfx); },
      reload() { if (!ok()) return; const t = ctx.currentTime; slit(t, 1400, .15, sfx); slit(t + .35, 900, .2, sfx); slit(t + .6, 1600, .18, sfx); },
      rotor(dur = 8) {
        if (!ok()) return;
        const t = ctx.currentTime, s = noiseSrc(), am = gain(.5), g = gain(0);
        const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11; lfo.connect(gain(.45)).connect(am.gain);
        s.connect(filt('lowpass', 380)).connect(am).connect(g).connect(sfx);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 1.5); g.gain.setValueAtTime(1, t + dur - 1.5); g.gain.linearRampToValueAtTime(0, t + dur);
        s.start(t); lfo.start(t); s.stop(t + dur); lfo.stop(t + dur);
      },
      creature(kind) {
        if (!ok()) return;
        const t = ctx.currentTime;
        switch (kind) {
          case 'buzz': { // dying sodium lamp
            const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(260, t + 2.2);
            const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
            for (let i = 0; i < 44; i++) g.gain.setValueAtTime(Math.random() > .2 ? .18 : 0, t + i * .05);
            g.gain.setValueAtTime(0, t + 2.3);
            o.connect(filt('bandpass', 900, 2)).connect(g).connect(sfx); o.start(t); o.stop(t + 2.4); break;
          }
          case 'clicks': { // counting cowries
            let tt = t; for (let i = 0; i < 26; i++) { tt += rand(.04, .14) + (i === 13 ? .6 : 0); slit(tt, rand(2500, 4200), .12, sfx); } break;
          }
          case 'dial': {
            [350, 440].forEach(f => {
              const o = ctx.createOscillator(); o.frequency.setValueAtTime(f, t); o.frequency.setValueAtTime(f, t + 1.2); o.frequency.exponentialRampToValueAtTime(f * .5, t + 2.4);
              const g = ctx.createGain(); g.gain.setValueAtTime(.12, t); g.gain.linearRampToValueAtTime(0, t + 2.5);
              o.connect(g).connect(sfx); o.start(t); o.stop(t + 2.6);
            });
            setTimeout(() => fx.static(.8, .2), 1200); setTimeout(() => fx.whisper(), 1500); break;
          }
          case 'hymn': { // underwater humming
            const lp = filt('lowpass', 420); lp.connect(sfx);
            [196, 233, 294, 311].forEach((f, i) => {
              const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
              const v = ctx.createOscillator(); v.frequency.value = 4 + i; v.connect(gain(6)).connect(o.frequency);
              const g = ctx.createGain(); env(g, t + i * .15, .6, .12, 2.4);
              o.connect(g).connect(lp); o.start(t); v.start(t); o.stop(t + 3.3); v.stop(t + 3.3);
            }); break;
          }
          case 'hum': {
            const lp = filt('lowpass', 260); lp.connect(sfx);
            [[50, 'sawtooth', .35], [100, 'sine', .25], [49.3, 'sawtooth', .3]].forEach(([f, ty, v]) => {
              const o = ctx.createOscillator(); o.type = ty; o.frequency.value = f;
              const g = ctx.createGain(); env(g, t, .4, v, 2); o.connect(g).connect(lp); o.start(t); o.stop(t + 2.6);
            }); break;
          }
          case 'metal': { // groaning pipelines
            const s = noiseSrc(), bp = filt('bandpass', 260, 18), g = ctx.createGain();
            bp.frequency.setValueAtTime(260, t); bp.frequency.linearRampToValueAtTime(520, t + 1.5); bp.frequency.linearRampToValueAtTime(180, t + 3);
            env(g, t, .3, 2.5, 2.8); s.connect(bp).connect(g).connect(sfx); s.start(t); s.stop(t + 3.3);
            const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 3);
            const g2 = ctx.createGain(); env(g2, t, .2, .5, 2.8); o.connect(filt('lowpass', 150)).connect(g2).connect(sfx); o.start(t); o.stop(t + 3.2); break;
          }
          case 'name': fx.whisper(); setTimeout(fx.whisper, 700); setTimeout(fx.whisper, 1500); break;
          case 'below': {
            const o = ctx.createOscillator(); o.frequency.value = 28; const g = ctx.createGain(); env(g, t, 1, .8, 3);
            o.connect(g).connect(sfx); o.start(t); o.stop(t + 4.2); fx.heartbeat(3); break;
          }
        }
      }
    };

    return {
      enable, disable, startMusic, stopMusic, setVol, silence, fx,
      get enabled() { return enabled; }, get musicOn() { return musicOn; },
      get analyser() { return analyser; }
    };
  })();

  function setSound(on) {
    if (on) SND.startMusic(); else SND.disable();
    $('#soundBtn').textContent = on ? '🔊' : '🔇';
    $('#mixPlay').textContent = on ? '■ Stop score' : '▶ Play score';
  }

  /* =========================================================
     ATMOSPHERE: rain, lightning, phantoms, whispers
     ========================================================= */
  let flash = 0; // read by the city canvas

  function initRain() {
    const c = $('#rainCanvas'), x = c.getContext('2d');
    let w, h, drops = [];
    const wind = -2.2;
    const mk = any => ({ x: rand(-50, w + 100), y: any ? rand(-h, h) : rand(-100, -10), l: rand(10, 26), v: rand(14, 24) });
    function size() {
      w = c.width = innerWidth; h = c.height = innerHeight;
      drops = Array.from({ length: Math.min(260, Math.floor(w * h / 7000)) }, () => mk(true));
    }
    function draw() {
      x.clearRect(0, 0, w, h);
      x.strokeStyle = 'rgba(170,195,235,.35)'; x.lineWidth = 1; x.beginPath();
      for (const d of drops) {
        x.moveTo(d.x, d.y); x.lineTo(d.x + wind * 1.5, d.y + d.l);
        d.x += wind; d.y += d.v;
        if (d.y > h) Object.assign(d, mk(false));
      }
      x.stroke();
      requestAnimationFrame(draw);
    }
    addEventListener('resize', size); size();
    if (!reduceMotion) draw();
  }

  function strike(withThunder = true) {
    const el = $('#lightning');
    el.classList.remove('strike'); void el.offsetWidth; el.classList.add('strike');
    flash = 1;
    if (withThunder) SND.fx.thunder(rand(.3, 1.8));
  }
  function lightningLoop() {
    setTimeout(() => { if (!document.hidden && !reduceMotion) strike(); lightningLoop(); }, rand(9000, 22000));
  }

  function showPhantom() {
    const p = $('#phantom');
    const left = Math.random() < .5;
    p.style.left = left ? `${rand(-20, 30)}px` : 'auto';
    p.style.right = left ? 'auto' : `${rand(-20, 30)}px`;
    p.classList.add('show');
    setTimeout(() => p.classList.remove('show'), rand(180, 420));
  }
  function whisperName() {
    const w = $('#whisper');
    w.textContent = `${playerName().toLowerCase()}…`;
    w.style.left = `${rand(10, 70)}vw`; w.style.top = `${rand(20, 75)}vh`;
    w.classList.add('show'); SND.fx.whisper();
    setTimeout(() => w.classList.remove('show'), 2200);
  }

  /* =========================================================
     HERO CITY CANVAS — skyline, gas flare, mast, stalking figure
     ========================================================= */
  function initCity() {
    const c = $('#cityCanvas'), x = c.getContext('2d');
    let w, h, H, sky, lights = [], mast, flareX, figIdx = -1;

    function size() {
      const r = c.getBoundingClientRect();
      w = c.width = Math.max(320, r.width); h = c.height = Math.max(400, r.height);
      build();
    }
    function build() {
      H = h * .68;
      sky = document.createElement('canvas'); sky.width = w; sky.height = h;
      const s = sky.getContext('2d');
      // Skyline: low-rise compounds, zinc roofs, overhead water tanks
      let px = 0;
      while (px < w) {
        const bw = rand(40, 130), bh = rand(30, h * .2) * (Math.random() < .12 ? 1.8 : 1), top = H - bh;
        s.fillStyle = '#03060c'; s.fillRect(px, top, bw, bh + 2);
        if (Math.random() < .45) { s.beginPath(); s.moveTo(px - 4, top); s.lineTo(px + bw / 2, top - rand(10, 24)); s.lineTo(px + bw + 4, top); s.fill(); }
        if (Math.random() < .3) { const tx = px + rand(5, Math.max(6, bw - 25)); s.fillRect(tx, top - 28, 20, 16); s.fillRect(tx + 2, top - 12, 2, 12); s.fillRect(tx + 16, top - 12, 2, 12); }
        for (let i = 0; i < 4; i++) if (Math.random() < .18) { s.fillStyle = `rgba(255,190,110,${rand(.06, .25)})`; s.fillRect(px + rand(6, bw - 14), top + rand(8, Math.max(9, bh - 16)), 6, 8); }
        px += bw + rand(-6, 8);
      }
      // Palms
      s.strokeStyle = '#02040a';
      for (let i = 0; i < 7; i++) {
        const pp = rand(0, w), ph = rand(70, 130);
        s.lineWidth = 4; s.beginPath(); s.moveTo(pp, H); s.quadraticCurveTo(pp + 10, H - ph / 2, pp + 4, H - ph); s.stroke();
        s.lineWidth = 3;
        for (let k = 0; k < 7; k++) {
          const a = k / 7 * Math.PI * 2;
          s.beginPath(); s.moveTo(pp + 4, H - ph);
          s.quadraticCurveTo(pp + 4 + Math.cos(a) * 20, H - ph - 12, pp + 4 + Math.cos(a) * 36, H - ph + Math.abs(Math.sin(a)) * 18 + 6); s.stroke();
        }
      }
      // Telecom mast
      mast = { x: w * .8, top: H - h * .4 };
      s.strokeStyle = '#050911'; s.lineWidth = 2; s.beginPath();
      s.moveTo(mast.x - 14, H); s.lineTo(mast.x, mast.top); s.lineTo(mast.x + 14, H);
      for (let y = mast.top + 20; y < H; y += 22) { const k = (y - mast.top) / (H - mast.top) * 14; s.moveTo(mast.x - k, y); s.lineTo(mast.x + k, y + 11); }
      s.stroke();
      // Wet road
      const rg = s.createLinearGradient(0, H, 0, h); rg.addColorStop(0, '#05080f'); rg.addColorStop(1, '#0b111b');
      s.fillStyle = rg; s.fillRect(0, H, w, h - H);
      flareX = w * .94;
      // Streetlights: index 0 = nearest
      const n = w < 700 ? 4 : 6;
      lights = [];
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        lights.push({ x: w * .45 + k * w * .45, base: H + (h - H) * .5 * (1 - k), hgt: h * .34 * (1 - k * .6), on: false, flick: 0 });
      }
    }
    function drawFigure(fx, fy, fh) {
      const u = fh * .16;
      x.fillStyle = '#000';
      x.beginPath(); x.ellipse(fx, fy - fh + u * .7, u * .55, u * .7, 0, 0, 7); x.fill();
      x.beginPath(); x.moveTo(fx - u * .6, fy - fh + u * 1.4); x.lineTo(fx + u * .6, fy - fh + u * 1.4); x.lineTo(fx + u * .8, fy); x.lineTo(fx - u * .8, fy); x.closePath(); x.fill();
    }
    function draw(now) {
      x.clearRect(0, 0, w, h);
      const g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgb(${2 + flash * 110},${4 + flash * 125},${10 + flash * 160})`); g.addColorStop(1, '#0b1626');
      x.fillStyle = g; x.fillRect(0, 0, w, H);
      // Distant gas flare
      const fl = .6 + Math.sin(now / 90) * .15 + Math.random() * .15;
      const fg = x.createRadialGradient(flareX, H - 6, 0, flareX, H - 6, 120);
      fg.addColorStop(0, `rgba(255,140,40,${.45 * fl})`); fg.addColorStop(1, 'rgba(255,90,20,0)');
      x.fillStyle = fg; x.fillRect(flareX - 130, H - 130, 260, 140);
      x.fillStyle = `rgba(255,200,90,${fl})`; x.beginPath(); x.ellipse(flareX, H - 14 - fl * 6, 3, 8 + fl * 6, 0, 0, 7); x.fill();
      x.drawImage(sky, 0, 0);
      if (Math.floor(now / 900) % 2 === 0) { x.fillStyle = 'rgba(255,40,40,.9)'; x.beginPath(); x.arc(mast.x, mast.top, 2.5, 0, 7); x.fill(); }

      lights.forEach((L, i) => {
        const lit = L.on && !(L.flick > 0 && Math.random() < .5);
        if (L.flick > 0) L.flick--;
        const sc = L.hgt / (h * .34);
        x.strokeStyle = '#02040a'; x.lineWidth = Math.max(2, 5 * sc);
        x.beginPath(); x.moveTo(L.x, L.base); x.lineTo(L.x, L.base - L.hgt); x.lineTo(L.x - L.hgt * .12, L.base - L.hgt); x.stroke();
        const hx = L.x - L.hgt * .12, hy = L.base - L.hgt + 4;
        if (lit) {
          const cone = x.createRadialGradient(hx, hy, 2, hx, L.base, L.hgt);
          cone.addColorStop(0, 'rgba(255,180,90,.28)'); cone.addColorStop(.45, 'rgba(255,160,70,.05)'); cone.addColorStop(1, 'rgba(255,150,60,0)');
          x.fillStyle = cone; x.beginPath(); x.moveTo(hx - 3, hy); x.lineTo(hx + L.hgt * .45, L.base + L.hgt * .08); x.lineTo(hx - L.hgt * .45, L.base + L.hgt * .08); x.closePath(); x.fill();
          x.fillStyle = '#ffd9a0'; x.beginPath(); x.arc(hx, hy, 3 * sc + 1.5, 0, 7); x.fill();
          const rr = x.createLinearGradient(0, L.base, 0, L.base + L.hgt * .9);
          rr.addColorStop(0, 'rgba(255,170,80,.22)'); rr.addColorStop(1, 'rgba(255,170,80,0)');
          x.fillStyle = rr; x.fillRect(hx - 3 - Math.random() * 2, L.base, 6, L.hgt * .9);
          if (i === figIdx) drawFigure(hx + L.hgt * .06, L.base, L.hgt * .42);
        }
      });
      if (flash > 0) flash = Math.max(0, flash - .03);
      requestAnimationFrame(draw);
    }
    // Lights come on one by one. A figure appears at the farthest one,
    // and every time the lights flicker, it is one light closer.
    function cycle() {
      lights.forEach(L => { L.on = false; }); figIdx = -1;
      lights.forEach((L, i) => setTimeout(() => { L.on = true; L.flick = 8; }, 600 + i * 500));
      setTimeout(() => { figIdx = lights.length - 1; stalk(); }, 600 + lights.length * 500 + 900);
    }
    function stalk() {
      setTimeout(() => {
        lights.forEach(L => { L.flick = 14; });
        setTimeout(() => {
          figIdx--;
          if (figIdx < 0) { lights.forEach(L => { L.on = false; }); setTimeout(cycle, 2600); } else stalk();
        }, 350);
      }, rand(2500, 4200));
    }
    addEventListener('resize', size); size();
    requestAnimationFrame(draw); cycle();
  }

  /* =========================================================
     OPENING CINEMATIC
     ========================================================= */
  const Intro = (() => {
    const el = $('#intro'), c = $('#introCanvas'), x = c.getContext('2d');
    let w, h, pts = [], camZ = 0, running = false, raf, timers = [], lightFlash = 0, level = 0, glow;
    function size() { w = c.width = innerWidth; h = c.height = innerHeight; }
    function build() {
      pts = [];
      for (let i = 0; i < 1500; i++) {
        let wx, wz;
        if (Math.random() < .5) { wx = Math.round(rand(-4, 4) / .35) * .35; wz = rand(1, 14); }
        else { wz = Math.round(rand(1, 14) / .6) * .6; wx = rand(-4, 4); }
        if (Math.abs(wx - (Math.sin(wz * .35) * 1.6 + .4)) < .32) continue; // the river stays dark
        pts.push({ wx, wz, th: Math.random(), s: rand(.6, 1.4), tw: rand(0, 6) });
      }
      // the very first lights to come on: near the centre of frame
      const near = pts.filter(p => p.wz > 5 && p.wz < 7 && Math.abs(p.wx) < .9);
      if (near[0]) near[0].th = 0;
      if (near[1]) near[1].th = .0001;
      glow = document.createElement('canvas'); glow.width = glow.height = 32;
      const g = glow.getContext('2d'), rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      rg.addColorStop(0, 'rgba(255,220,150,1)'); rg.addColorStop(.25, 'rgba(255,170,70,.6)'); rg.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
    }
    function draw() {
      x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
      const hor = h * .18, cx = w / 2, sc = Math.min(w, h) * .5;
      if (lightFlash > 0) { x.fillStyle = `rgba(150,170,210,${lightFlash * .3})`; x.fillRect(0, 0, w, h); }
      camZ += .006;
      const now = performance.now();
      for (const p of pts) {
        let dz = p.wz - camZ;
        while (dz < .6) { p.wz += 13; dz = p.wz - camZ; }
        const sx = cx + p.wx / dz * sc, sy = hor + (1.4 / dz) * sc;
        if (sx < -20 || sx > w + 20 || sy > h + 20) continue;
        if (lightFlash > .05) { x.fillStyle = `rgba(180,200,240,${lightFlash * .5})`; x.fillRect(sx - 1, sy - 1, 2, 2); }
        if (p.th < level) {
          const sz = (12 / dz) * p.s + 3;
          x.globalAlpha = Math.min(1, 2.5 / dz) * (.75 + .25 * Math.sin(now / 300 + p.tw));
          x.drawImage(glow, sx - sz / 2, sy - sz / 2, sz, sz); x.globalAlpha = 1;
        }
      }
      x.strokeStyle = 'rgba(180,200,240,.22)'; x.beginPath();
      for (let i = 0; i < 90; i++) { const rx = Math.random() * w, ry = Math.random() * h; x.moveTo(rx, ry); x.lineTo(rx - 6, ry + 28); }
      x.stroke();
      if (lightFlash > 0) lightFlash -= .04;
      if (running) raf = requestAnimationFrame(draw);
    }
    function typeText(str) {
      const t = $('#introText'); t.textContent = ''; t.classList.add('show');
      let i = 0; const iv = setInterval(() => { t.textContent = str.slice(0, ++i); if (i >= str.length) clearInterval(iv); }, 70);
      timers.push(iv);
    }
    const T = (ms, fn) => timers.push(setTimeout(fn, ms));
    function clearAll() { timers.forEach(id => { clearTimeout(id); clearInterval(id); }); timers = []; }

    function idle() {
      size(); build(); running = true; level = 0; draw();
      T(900, () => { lightFlash = 1; });
    }
    function play(withSound) {
      clearAll();
      el.style.display = ''; el.classList.remove('fade-out');
      document.body.classList.add('locked');
      $('#introStart').classList.add('hidden'); $('#skipRunning').classList.remove('hidden');
      $('#introText').classList.remove('show'); $('#introTitle').classList.remove('show');
      size(); build(); camZ = 0; level = 0;
      if (!running) { running = true; draw(); }
      if (withSound) { setSound(true); SND.fx.rotor(9); }

      T(1200, () => { lightFlash = 1; SND.fx.thunder(.4); });
      T(2600, () => { level = .00005; });            // one streetlight
      T(3600, () => { level = .0002; });             // then another
      T(4400, () => {                                // then hundreds
        let k = 0; const iv = setInterval(() => { k += .03; level = Math.min(1, k * k); if (k >= 1) clearInterval(iv); }, 40); timers.push(iv);
      });
      T(5600, () => { lightFlash = .8; SND.fx.thunder(.2); });
      T(7800, () => { level = 0; SND.silence(6200); }); // every light goes out
      T(8800, () => { SND.fx.static(1.6, .35); typeText('“They know you’re here.”'); });
      T(11800, () => { $('#introText').classList.remove('show'); running = false; x.fillStyle = '#000'; x.fillRect(0, 0, w, h); SND.fx.heartbeat(3); });
      T(14300, () => $('#introTitle').classList.add('show'));
      T(19500, finish);
    }
    function finish() {
      clearAll(); running = false; cancelAnimationFrame(raf);
      el.classList.add('fade-out'); document.body.classList.remove('locked');
      setTimeout(() => { el.style.display = 'none'; $('#introStart').classList.remove('hidden'); $('#skipRunning').classList.add('hidden'); }, 1400);
    }
    addEventListener('resize', () => { if (running) size(); });
    return { idle, play, finish };
  })();

  /* =========================================================
     NAV, TICKER, REVEAL
     ========================================================= */
  function initNav() {
    const nav = $('#nav'), links = $$('.nav-links a');
    const onScroll = () => {
      nav.classList.toggle('solid', scrollY > 40);
      const mid = innerHeight * .4;
      let cur = '';
      $$('main section[id]').forEach(s => { const r = s.getBoundingClientRect(); if (r.top < mid && r.bottom > mid) cur = s.id; });
      links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + cur));
    };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    $('#burger').addEventListener('click', () => $('#navLinks').classList.toggle('open'));
    $('#navLinks').addEventListener('click', e => { if (e.target.tagName === 'A') $('#navLinks').classList.remove('open'); });
  }

  function initTicker() {
    const msgs = [
      'POWER GRID: 0% OUTPUT ACROSS RIVERS STATE',
      'ABA ROAD CLOSED — VEHICLES ABANDONED IN ALL LANES',
      'MISSING PERSONS REPORTED: UNCOUNTED',
      'DO NOT ANSWER UNKNOWN CALLS',
      'GENERATORS STILL RUNNING IN 412 COMPOUNDS — OWNERS NOT FOUND',
      'WATERFRONT FLOODING CONTINUES — STAY OFF THE CREEKS',
      'IF YOU HEAR YOUR NAME, DO NOT TURN AROUND'
    ];
    const html = msgs.map(m => `<span>◉ ${m}</span>`).join('');
    $('#tickerTrack').innerHTML = html + html;
  }

  function initReveal() {
    const els = $$('.section-title, .lead, .feat, .mode, .fstage, .q, .ending, .leaderboard, .mixer, .radio, .map-box, .creator-preview');
    els.forEach(e => e.classList.add('reveal'));
    if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    const io = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .15 });
    els.forEach(e => io.observe(e));
  }

  /* =========================================================
     RADIO TUNER
     ========================================================= */
  function initRadio() {
    const stations = [
      { f: 89.4, m: () => '“If you’re hearing this… don’t come looking for us.”' },
      { f: 93.1, m: () => '…Rumuola… the generator is still on… the child isn’t— [signal lost]' },
      { f: 97.7, m: () => 'Survey Team 3. The structures go deeper than the boreholes. They are carved. Someone carved them.' },
      { f: 101.5, m: () => '…seven… nine… nine… four… seven… nine… [numbers repeat]' },
      { f: 104.8, m: () => `…${playerName()}… we can see you from here.` },
      { f: 107.2, m: () => 'Whatever you do, do not answer the phones in Diobu.' }
    ];
    const tuner = $('#tuner'), out = $('#freqVal'), msg = $('#radioMsg'), led = $('#radioLed');
    const cv = $('#radioWave'), x = cv.getContext('2d');
    let strength = 0, current = null, typer = null, lastStatic = 0;
    const garble = s => s.replace(/[A-Za-z]/g, ch => Math.random() < .55 ? pick(['#', '%', '/', '·', '▒']) : ch);

    function typeMsg(text) {
      clearInterval(typer); msg.textContent = ''; let i = 0;
      typer = setInterval(() => { msg.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typer); }, 28);
    }
    function update() {
      const f = tuner.value / 10; out.textContent = f.toFixed(1);
      let best = null, bd = 9;
      stations.forEach(s => { const d = Math.abs(s.f - f); if (d < bd) { bd = d; best = s; } });
      strength = clamp(1 - bd / .35, 0, 1);
      led.classList.toggle('on', strength > .6);
      if (strength > .6) {
        if (current !== best) { current = best; typeMsg(best.m()); addFear(3); }
      } else {
        current = null; clearInterval(typer);
        msg.textContent = strength > .2 ? garble(best.m()) : '— static —';
      }
      const now = performance.now();
      if (now - lastStatic > 120) { SND.fx.static(.12, .14 * (1 - strength) + .02); lastStatic = now; }
    }
    function wave() {
      x.clearRect(0, 0, cv.width, cv.height);
      x.strokeStyle = 'rgba(91,227,161,.85)'; x.lineWidth = 1.5; x.beginPath();
      const t = performance.now() / 200;
      for (let i = 0; i <= cv.width; i += 3) {
        const y = 30 + Math.sin(i / 14 + t) * 14 * strength + (Math.random() - .5) * 40 * (1 - strength);
        i ? x.lineTo(i, y) : x.moveTo(i, y);
      }
      x.stroke(); requestAnimationFrame(wave);
    }
    tuner.addEventListener('input', update); update(); wave();
  }

  /* =========================================================
     LEVELS + MAP
     ========================================================= */
  const LEVELS = [
    { n: 1, key: 'RUMUOLA', title: 'The Empty Streets', x: 430, y: 260, time: 'Night · Violent thunderstorm', threat: 2,
      desc: 'You enter an abandoned Rumuola neighbourhood. Cars lie scattered across the road. Somewhere inside an empty compound, a generator is still running. Then you hear a child calling for help from inside a house.',
      event: 'The house is empty. The front door slowly closes behind you. Photographs of the missing cover the walls — and a radio switches itself on: “You should not have come here.”',
      missions: ['Explore abandoned houses', 'Search compounds', 'Find your first weapon', 'Recover the field radio', 'Learn survival basics', 'First creature encounter'],
      enemies: ['The Hummers'], bg: 'radial-gradient(circle at 70% 30%, #ffb347, transparent 60%)' },
    { n: 2, key: 'SLAUGHTER', title: 'The Dead Market', x: 565, y: 375, time: 'Dusk · Heavy rain', threat: 3,
      desc: 'An abandoned market under a roof of plastic sheets snapping in the wind. Generators run with nobody to feed them fuel. Old televisions switch on. Disconnected radios start broadcasting voices.',
      event: 'Something moves between the stalls. It cannot see you — but it can hear every step, every bottle, every breath.',
      missions: ['Stealth through the stalls', 'Scavenge limited ammunition', 'Restore the market breaker (puzzle)', 'Survive the first major encounter', 'Escape sequence'],
      enemies: ['Nne Ahịa — The Market Mother'], bg: 'radial-gradient(circle at 30% 70%, #3d7fd1, transparent 60%)' },
    { n: 3, key: 'RUMUKURUSHI', title: 'The Watcher', x: 650, y: 240, time: 'Midnight · Total darkness', threat: 3,
      desc: 'Rumukurushi is almost completely dark. As you walk, streetlights turn on one by one ahead of you.',
      event: 'Every time a light comes on, a shadow is standing farther down the road. Look away. Look back. It is closer.',
      missions: ['Urban exploration', 'Avoid the Watcher’s line of sight', 'Find and fuel a working vehicle', 'Reach the pharmacy rooftop'],
      enemies: ['The Lamplighter'], bg: 'radial-gradient(circle at 50% 20%, #ffd27a, transparent 55%)' },
    { n: 4, key: 'DIOBU', title: 'The Vanished City', x: 330, y: 385, time: 'Night · Drizzle and fog', threat: 3,
      desc: 'Diobu has become a ghost town of shuttered shops and silent compounds. In the streets: hundreds of phones, left behind by the missing.',
      event: 'Some of the phones begin to ring. Answer one, and a recording plays — residents describing voices coming from beneath their floors.',
      missions: ['Investigate abandoned buildings', 'Collect voice recordings', 'Search for survivors', 'Locate underground entrances', 'Fight hostile creatures'],
      enemies: ['The Caller', 'The Hummers'], bg: 'radial-gradient(circle at 60% 60%, #7fd6ff, transparent 55%)' },
    { n: 5, key: 'RUMUOKORO', title: 'The Crossroads', x: 470, y: 115, time: 'Pre-dawn · Storm easing', threat: 4,
      desc: 'One of the largest open areas in the game. Traffic stopped mid-journey. Vehicles abandoned in every lane while creatures move between the buildings.',
      event: 'A military convoy lies attacked and overturned. Its crates hold weapons, medicine and the first official documents about The Blackout.',
      missions: ['Cross the open junction', 'Investigate the convoy', 'Recover the investigators’ documents', 'Survive coordinated ambushes', 'Claim a tactical vehicle'],
      enemies: ['The Hummers', 'The Lamplighter'], bg: 'radial-gradient(circle at 40% 30%, #b3121c, transparent 60%)' },
    { n: 6, key: 'AGIP FLYOVER', title: 'The Collapse', x: 255, y: 250, time: 'Night · Massive storm', threat: 4,
      desc: 'Abandoned vehicles choke the flyover. Lightning reveals figures standing on their roofs. Enemies below, enemies above.',
      event: 'Inside a military vehicle, a looping transmission: the structures under Port Harcourt are far older than anyone believed.',
      missions: ['Vehicle combat across the flyover', 'Long-range engagements in the lightning', 'Survive a large enemy attack', 'Escape the partial collapse'],
      enemies: ['The Hummers', 'The Drowned Congregation (below)'], bg: 'radial-gradient(circle at 50% 10%, #cfe3ff, transparent 50%)' },
    { n: 7, key: 'BOROKIRI', title: 'The Waterfront', x: 425, y: 525, time: 'Night · Flooding', threat: 4,
      desc: 'Heavy rain has flooded the streets down to the waterfront. Boats sit abandoned on the river. Something moves underneath the water.',
      event: 'Inside a flooded church hall, the water around your knees begins to hum.',
      missions: ['Explore flooded buildings', 'Swim between submerged streets', 'Pilot a boat through the creeks', 'Find the waterfront underground entrance'],
      enemies: ['The Drowned Congregation'], bg: 'radial-gradient(circle at 50% 90%, #1d5e8f, transparent 60%)' },
    { n: 8, key: 'IWOFE', title: 'The Dark Road', x: 130, y: 330, time: 'Night · Mist over the bush', threat: 4,
      desc: 'The city thins into vegetation and long, empty roads. Your radio picks up a survivor who knows the way. They give you directions.',
      event: 'The survivor knows things they couldn’t. The voice on the radio is not human — and you have been following it for hours.',
      missions: ['Long-distance driving', 'Navigate dense bush paths', 'Follow — or ignore — the radio', 'Reach the forgotten village'],
      enemies: ['The Caller', 'The Name-Speaker'], bg: 'radial-gradient(circle at 20% 50%, #2b6b3c, transparent 60%)' },
    { n: 9, key: 'ELEME JUNCTION', title: 'The Industrial Zone', x: 805, y: 365, time: 'Night · Gas flares and rain', threat: 5,
      desc: 'Pipelines, warehouses, storage tanks, abandoned trucks and security checkpoints. Evidence that a secret organisation was studying the phenomenon.',
      event: 'Something enormous begins to move through the pipe yard. It is hunting you by the sound of your engine.',
      missions: ['Infiltrate the industrial compound', 'Heavy combat at the checkpoints', 'Escape the Iron Ancestor in a vehicle chase', 'Use pressure valves against it', 'Find the secret facility entrance'],
      enemies: ['Agbara Igwe — The Iron Ancestor', 'The Hummers'], bg: 'radial-gradient(circle at 80% 70%, #ff8c28, transparent 55%)' },
    { n: 10, key: 'ETCHE', title: 'The Source', x: 825, y: 95, time: 'Unknown · Underground', threat: 5,
      desc: 'Dense forest. Forgotten villages. Ancient structures. And beneath them, a vast underground complex: surveillance rooms, laboratories, tunnels, strange symbols and the recordings of every investigator who came before you.',
      event: 'Someone intentionally opened something that should have remained buried. In the deepest chamber, it is waiting for your decision.',
      missions: ['Explore the forest villages', 'Enter the underground complex', 'Recover the last investigator logs', 'Reach the deepest chamber', 'Make the final decision'],
      enemies: ['The One Below', 'The Name-Speaker', 'Everything you left alive'], bg: 'radial-gradient(circle at 50% 50%, #b3121c, transparent 50%)' }
  ];

  function initLevels() {
    const svg = $('#mapSvg');
    const byN = n => LEVELS[n - 1];
    const roads = [[1, 5], [1, 2], [1, 4], [1, 6], [2, 3], [2, 7], [3, 5], [3, 9], [4, 7], [4, 6], [6, 8], [5, 10], [9, 10], [2, 9], [5, 6]];
    const tunnels = [[4, 7], [7, 9], [9, 10], [1, 4]];
    let s = '';
    // faint grid
    for (let i = 0; i <= 1000; i += 50) s += `<line x1="${i}" y1="0" x2="${i}" y2="640" stroke="rgba(120,160,210,.05)"/>`;
    for (let i = 0; i <= 640; i += 50) s += `<line x1="0" y1="${i}" x2="1000" y2="${i}" stroke="rgba(120,160,210,.05)"/>`;
    // water
    s += `<path d="M0,565 C150,525 250,605 400,588 C520,576 600,622 760,592 C860,572 930,602 1000,588 L1000,640 L0,640Z" fill="#0b2a45" opacity=".9"/>`;
    s += `<path d="M60,640 C90,520 40,430 110,360 C170,300 150,200 210,120 C240,80 230,30 260,0" stroke="#0e3556" stroke-width="22" fill="none"/>`;
    s += `<path d="M385,600 C365,520 300,480 250,470 C200,460 170,420 125,400" stroke="#0e3556" stroke-width="9" fill="none"/>`;
    s += `<path d="M905,640 C885,560 945,500 965,420" stroke="#0e3556" stroke-width="8" fill="none"/>`;
    // mangroves along water + Etche forest
    for (let i = 0; i < 70; i++) { const mx = rand(0, 1000), my = rand(545, 600); s += `<circle cx="${mx}" cy="${my}" r="${rand(3, 7)}" fill="#0f2a1d" opacity=".8"/>`; }
    for (let i = 0; i < 26; i++) s += `<circle cx="${rand(40, 170)}" cy="${rand(280, 480)}" r="${rand(3, 7)}" fill="#0f2a1d" opacity=".7"/>`;
    for (let i = 0; i < 50; i++) s += `<circle cx="${rand(720, 960)}" cy="${rand(20, 170)}" r="${rand(4, 10)}" fill="#0f2a1d" opacity=".75"/>`;
    // roads
    roads.forEach(([a, b]) => { const A = byN(a), B = byN(b); s += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="#4a5568" stroke-width="3" opacity=".55"/>`; });
    // tunnels
    tunnels.forEach(([a, b]) => {
      const A = byN(a), B = byN(b), mx = (A.x + B.x) / 2 + 40, my = (A.y + B.y) / 2 + 40;
      s += `<path d="M${A.x},${A.y} Q${mx},${my} ${B.x},${B.y}" stroke="#e3202b" stroke-width="1.6" stroke-dasharray="5 5" fill="none" opacity=".55"/>`;
    });
    s += `<text x="500" y="625" text-anchor="middle" fill="rgba(127,214,255,.25)" font-family="Oswald" font-size="13" letter-spacing="6">BONNY RIVER</text>`;
    s += `<text x="40" y="40" fill="rgba(201,212,227,.25)" font-family="Oswald" font-size="13" letter-spacing="5">GREATER PORT HARCOURT · FIELD MAP</text>`;
    // nodes
    LEVELS.forEach(L => {
      const right = L.x > 815;
      s += `<g class="map-node" data-n="${L.n}" tabindex="0" role="button" aria-label="Level ${L.n} ${L.key}">
        <circle class="ring" cx="${L.x}" cy="${L.y}" r="14"/>
        <circle class="dot" cx="${L.x}" cy="${L.y}" r="13"/>
        <text class="num" x="${L.x}" y="${L.y}">${L.n}</text>
        <text x="${right ? L.x - 20 : L.x + 20}" y="${L.y + 5}" text-anchor="${right ? 'end' : 'start'}">${L.key}</text>
      </g>`;
    });
    svg.innerHTML = s;

    $('#levelStrip').innerHTML = LEVELS.map(L => `<button data-n="${L.n}"><b>${String(L.n).padStart(2, '0')}</b>${L.key}</button>`).join('');

    function select(n) {
      const L = byN(n); visitedLevels.add(n);
      $$('.map-node').forEach(g => g.classList.toggle('active', +g.dataset.n === n));
      $$('#levelStrip button').forEach(b => b.classList.toggle('active', +b.dataset.n === n));
      const p = $('#levelPanel');
      p.style.setProperty('--lvl-bg', L.bg);
      p.innerHTML = `
        <div class="lp-num">LEVEL ${String(L.n).padStart(2, '0')} / 10</div>
        <h3 class="lp-title">${L.key}</h3>
        <div class="lp-sub">${L.title}</div>
        <p class="lp-desc">${L.desc}</p>
        <div class="lp-label">Horror event</div>
        <div class="lp-event">${L.event}</div>
        <div class="lp-label">Main gameplay</div>
        <ul class="lp-list">${L.missions.map(m => `<li>${m}</li>`).join('')}</ul>
        <div class="lp-label">Known entities</div>
        <ul class="lp-list">${L.enemies.map(m => `<li>${m}</li>`).join('')}</ul>
        <div class="lp-meta"><span>Conditions: <b>${L.time}</b></span><span>Threat: <b class="threat">${'■'.repeat(L.threat)}${'□'.repeat(5 - L.threat)}</b></span></div>`;
      if (n >= 8) addFear(2);
    }
    svg.addEventListener('click', e => { const g = e.target.closest('.map-node'); if (g) select(+g.dataset.n); });
    svg.addEventListener('keydown', e => { const g = e.target.closest('.map-node'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(+g.dataset.n); } });
    $('#levelStrip').addEventListener('click', e => { const b = e.target.closest('button'); if (b) select(+b.dataset.n); });
    select(1);
  }

  /* =========================================================
     CREATURES
     ========================================================= */
  function staticFigure() {
    let l = '';
    const prof = [10, 14, 15, 14, 10, 8, 20, 26, 28, 28, 27, 26, 25, 24, 24, 23, 22, 22, 20, 18, 16, 14];
    prof.forEach((wd, i) => { const y = 92 + i * 5, off = rand(-3, 3); l += `<line x1="${150 - wd + off}" y1="${y}" x2="${150 + wd + off}" y2="${y}"/>`; });
    return l;
  }
  const CREATURE_SVG = {
    lamp: `<svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="cg-lamp"><stop offset="0" stop-color="#ffb347" stop-opacity=".8"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient></defs>
      <circle cx="160" cy="55" r="110" fill="url(#cg-lamp)"/><rect x="198" y="40" width="6" height="260" fill="#05080d"/><path d="M201 44 H160" stroke="#05080d" stroke-width="6"/>
      <path d="M118 300 L124 150 Q126 120 136 112 L134 96 Q138 78 148 78 Q158 78 160 96 L158 112 Q168 120 170 150 L176 300Z" fill="#000"/>
      <circle class="eyes" cx="147" cy="92" r="8" fill="#ffd27a" opacity=".85"/></svg>`,
    market: `<svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice"><path d="M0 60 L120 40 L150 90 L20 110Z" fill="#1b2a3c" opacity=".85"/><path d="M140 30 L300 50 L290 110 L160 95Z" fill="#22344a" opacity=".75"/>
      <g stroke="#000" stroke-width="3" fill="none"><path d="M150 110 Q120 140 100 205"/><path d="M150 110 Q130 160 135 232"/><path d="M155 110 Q180 150 205 212"/><path d="M158 112 Q200 130 232 178"/><path d="M145 112 Q100 125 70 168"/><path d="M152 112 Q165 170 170 252"/></g>
      <ellipse cx="152" cy="106" rx="36" ry="22" fill="#000"/><rect x="0" y="205" width="300" height="6" fill="#0b121c"/>
      <g fill="#e8e1cf" opacity=".75"><ellipse cx="60" cy="250" rx="5" ry="3"/><ellipse cx="80" cy="262" rx="5" ry="3"/><ellipse cx="225" cy="255" rx="5" ry="3"/><ellipse cx="240" cy="240" rx="5" ry="3"/><ellipse cx="120" cy="272" rx="5" ry="3"/></g></svg>`,
    caller: () => `<svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice"><rect x="105" y="62" width="90" height="170" rx="12" fill="#0a0d12" stroke="#1f2833" stroke-width="3"/><rect x="113" y="78" width="74" height="136" fill="#9fe8ff" opacity=".12"/>
      <g stroke="#bfefff" stroke-width="2" opacity=".6">${staticFigure()}</g><g class="eyes" fill="#fff"><circle cx="144" cy="103" r="2"/><circle cx="156" cy="103" r="2"/></g></svg>`,
    drowned: `<svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="cg-w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d2c44"/><stop offset="1" stop-color="#020a12"/></linearGradient></defs>
      <path d="M215 172 L255 125 L300 172Z" fill="#05090f"/><rect y="172" width="300" height="128" fill="url(#cg-w)"/>
      <g fill="#0a0f14"><ellipse cx="80" cy="174" rx="16" ry="20"/><ellipse cx="150" cy="170" rx="18" ry="24"/><ellipse cx="220" cy="176" rx="14" ry="18"/></g>
      <g class="eyes" fill="#cfe9f0"><circle cx="74" cy="168" r="2"/><circle cx="86" cy="168" r="2"/><circle cx="143" cy="162" r="2.4"/><circle cx="157" cy="162" r="2.4"/><circle cx="215" cy="171" r="1.8"/><circle cx="225" cy="171" r="1.8"/></g>
      <g fill="none" stroke="#5f8fb3" opacity=".4"><ellipse cx="80" cy="188" rx="30" ry="5"/><ellipse cx="150" cy="188" rx="38" ry="6"/><ellipse cx="220" cy="188" rx="26" ry="4"/></g></svg>`,
    hummers: `<svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice"><rect x="196" y="200" width="78" height="54" fill="#0d1218" stroke="#202a36"/><g stroke="#202a36"><line x1="206" y1="212" x2="264" y2="212"/><line x1="206" y1="222" x2="264" y2="222"/><line x1="206" y1="232" x2="264" y2="232"/></g><circle cx="262" cy="244" r="3" fill="#ffb347"/>
      <g fill="#000"><path d="M50 300 L56 170 Q58 150 70 146 L68 128 Q72 112 80 112 Q88 112 90 128 L88 146 Q100 150 102 170 L108 300Z"/><path d="M110 300 L118 160 Q120 140 132 136 L130 116 Q134 100 142 100 Q150 100 152 116 L150 136 Q162 140 164 160 L172 300Z"/><path d="M168 300 L172 190 Q174 175 182 172 L181 160 Q184 150 189 150 Q194 150 196 160 L195 172 Q203 175 205 190 L209 300Z"/></g>
      <g stroke="#cfd7e3" stroke-width="1" opacity=".55"><path d="M74 132 h12 M76 130 v4 M80 130 v4 M84 130 v4"/><path d="M136 120 h12 M138 118 v4 M142 118 v4 M146 118 v4"/></g></svg>`,
    iron: `<svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="cg-fl"><stop offset="0" stop-color="#ff8c28" stop-opacity=".8"/><stop offset="1" stop-color="#ff8c28" stop-opacity="0"/></radialGradient></defs>
      <circle cx="265" cy="40" r="60" fill="url(#cg-fl)"/><path d="M15 300 Q25 170 105 118 Q150 92 205 108 Q275 140 288 300Z" fill="#040404"/>
      <g fill="#14181d"><rect x="0" y="230" width="300" height="14"/><rect x="40" y="160" width="12" height="140"/><rect x="230" y="150" width="12" height="150"/></g>
      <g stroke="#2b2f35" stroke-width="5" fill="none"><path d="M90 140 Q140 120 200 150"/><path d="M70 190 Q150 160 240 200"/></g>
      <g class="eyes" fill="#e3202b"><circle cx="145" cy="138" r="4"/><circle cx="170" cy="138" r="4"/><circle cx="158" cy="126" r="2.5"/></g></svg>`,
    name: () => `<svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice"><ellipse cx="150" cy="130" rx="60" ry="80" fill="none" stroke="rgba(200,210,230,.12)" stroke-width="2"/>
      <g class="eyes" fill="#e8eef8"><ellipse cx="128" cy="120" rx="4" ry="2"/><ellipse cx="172" cy="120" rx="4" ry="2"/></g>
      <path d="M135 175 Q150 168 165 175" stroke="rgba(200,210,230,.25)" fill="none"/>
      <text class="nm-text" x="150" y="250" text-anchor="middle" fill="rgba(220,230,255,.35)" font-family="Special Elite" font-size="16" letter-spacing="4">…${playerName().toLowerCase()}…</text></svg>`,
    below: `<svg viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice"><g fill="none" stroke="#b3121c"><circle cx="150" cy="140" r="40" opacity=".5"/><circle cx="150" cy="140" r="70" opacity=".3"/><circle cx="150" cy="140" r="105" opacity=".18"/><circle cx="150" cy="140" r="140" opacity=".1"/></g>
      <g stroke="#1a0a0c" stroke-width="4" fill="none"><path d="M150 180 Q120 230 60 300"/><path d="M150 180 Q170 240 240 300"/><path d="M150 180 Q150 240 150 300"/><path d="M120 150 Q60 160 0 200"/><path d="M180 150 Q240 160 300 210"/></g>
      <ellipse cx="150" cy="140" rx="34" ry="20" fill="#120406" stroke="#e3202b"/><ellipse class="eyes" cx="150" cy="140" rx="5" ry="18" fill="#e3202b"/></svg>`
  };

  const CREATURES = [
    { id: 'lamp', name: 'The Lamplighter', alias: 'Onye Ọkụ · the one under the light', rarity: 'Uncommon', svg: 'lamp', sound: 'buzz', reacts: ['Light', 'Movement'],
      look: 'Impossibly tall and thin, head bowed, a dead bulb glowing where a face should be.',
      behave: 'Stands beneath streetlights. Moves only when you are not looking. Rarely attacks — it herds you into darkness where other things wait.',
      hunt: 'Stalker', weak: 'Hold it in your flashlight beam and it cannot move. Break its streetlight and it must relocate.',
      sfx: 'The buzz of a failing sodium lamp, rising in pitch as it gets closer.', where: 'Rumukurushi, Rumuokoro' },
    { id: 'market', name: 'Nne Ahịa', alias: 'The Market Mother', rarity: 'Uncommon', svg: 'market', sound: 'clicks', reacts: ['Sound', 'Gunfire'],
      look: 'A blind, many-limbed shape wrapped in torn tarpaulin, clinging to the underside of stall roofs.',
      behave: 'Hears everything. Drops onto the loudest thing in the market. Gunfire brings it instantly.',
      hunt: 'Ambush predator', weak: 'Throw bottles and tins as decoys. Running generators mask your footsteps.',
      sfx: 'Cowries and coins being counted, faster and faster.', where: 'Slaughter market' },
    { id: 'caller', name: 'The Caller', alias: 'Voice in the wire', rarity: 'Rare', svg: 'caller', sound: 'dial', reacts: ['Sound', 'Fear'],
      look: 'No body is ever seen — only a human shape made of screen static.',
      behave: 'Lives in phones and radios. Mimics the voices of the missing and of your teammates. Gives directions that lead somewhere terrible.',
      hunt: 'Deceiver', weak: 'Silence. Switch off every device nearby or use a jammer, and it loses you.',
      sfx: 'A dial tone that slowly bends into a voice.', where: 'Diobu, Iwofe' },
    { id: 'drowned', name: 'The Drowned Congregation', alias: 'Those beneath the floodwater', rarity: 'Common', svg: 'drowned', sound: 'hymn', reacts: ['Movement', 'Vehicles'],
      look: 'Pale, still heads just below the surface of flooded streets. You only see the eyes.',
      behave: 'Feel ripples. Pull swimmers and waders down in groups. Follow boats from beneath.',
      hunt: 'Pack, from below', weak: 'Stand perfectly still on dry ground. Flares and high-revving outboard engines scatter them.',
      sfx: 'A hymn hummed underwater, slightly out of tune.', where: 'Borokiri waterfront, mangrove creeks' },
    { id: 'hummers', name: 'The Hummers', alias: 'Generator men', rarity: 'Common', svg: 'hummers', sound: 'hum', reacts: ['Sound', 'Light', 'Gunfire'],
      look: 'Gaunt figures with stitched mouths, skin grey with diesel soot.',
      behave: 'Gather around running generators in empty compounds, humming at the same pitch. The most common — and most killable — threat.',
      hunt: 'Swarm', weak: 'Cut the generator and they scatter, disoriented. Vulnerable to gunfire.',
      sfx: 'A low hum that matches the generator perfectly — until the generator stops.', where: 'Rumuola, Diobu, Rumuokoro, Eleme' },
    { id: 'iron', name: 'Agbara Igwe', alias: 'The Iron Ancestor', rarity: 'Legendary', svg: 'iron', sound: 'metal', reacts: ['Vehicles', 'Gunfire', 'Sound'],
      look: 'A colossus of rusted pipe, flesh and old stone, crawling through the industrial zone.',
      behave: 'Tracks you through the vibration of engines. Tears through fences, tanks and trucks to reach you.',
      hunt: 'Juggernaut chase', weak: 'Lure it across gas leaks and ignite the pressure valves. It cannot climb.',
      sfx: 'Groaning metal and the scream of pipeline pressure.', where: 'Eleme Junction' },
    { id: 'name', name: 'The Name-Speaker', alias: 'It knows who you are', rarity: 'Rare', svg: 'name', sound: 'name', reacts: ['Fear'],
      look: 'A face at the edge of your vision. Two pale eyes. It may not be real.',
      behave: 'Appears only when your Fear is high. Look at it and fear spikes. Ignore it and it fades… for now.',
      hunt: 'Psychological', weak: 'Calm. Hide, breathe, light a flare, find other survivors.',
      sfx: 'Your name, whispered from behind you.', where: 'Anywhere. Everywhere.' },
    { id: 'below', name: 'The One Below', alias: 'What they woke up', rarity: 'Legendary', svg: 'below', sound: 'below', reacts: ['Fear', 'Light', 'Sound', 'Movement', 'Gunfire', 'Vehicles'],
      look: 'Never fully seen. Roots, old stone and a single vertical eye, spread beneath an entire city.',
      behave: 'The Blackout was its first breath. Everything else in the city answers to it.',
      hunt: 'Unknown', weak: 'Unknown. The investigators’ notes disagree.',
      sfx: 'A heartbeat you feel through the ground.', where: 'Etche — the deepest chamber' }
  ];

  function initCreatures() {
    const grid = $('#creatureGrid');
    grid.innerHTML = CREATURES.map(c => {
      const art = typeof CREATURE_SVG[c.svg] === 'function' ? CREATURE_SVG[c.svg]() : CREATURE_SVG[c.svg];
      return `<div class="creature" data-id="${c.id}" data-reacts="${c.reacts.join(',')}" tabindex="0">
        <div class="creature-inner">
          <div class="c-face c-front">${art}
            <span class="c-rarity r-${c.rarity.toLowerCase()}">${c.rarity.toUpperCase()}</span>
            <div class="c-name">${c.name}</div><div class="c-alias">${c.alias}</div>
          </div>
          <div class="c-face c-back">
            <h4>${c.name}</h4>
            <div class="c-row"><b>Appearance</b>${c.look}</div>
            <div class="c-row"><b>Behaviour</b>${c.behave}</div>
            <div class="c-row"><b>Hunting style</b>${c.hunt}</div>
            <div class="c-row"><b>Weakness</b>${c.weak}</div>
            <div class="c-row"><b>Sound</b>${c.sfx}</div>
            <div class="c-row"><b>Found in</b>${c.where}</div>
            <div class="c-row"><b>Reacts to</b><div class="c-react">${c.reacts.map(r => `<span>${r}</span>`).join('')}</div></div>
            <button class="c-sound-btn" data-sound="${c.sound}">▶ Hear it</button>
          </div>
        </div></div>`;
    }).join('');

    grid.addEventListener('click', e => {
      const btn = e.target.closest('.c-sound-btn');
      const card = e.target.closest('.creature');
      if (btn) {
        e.stopPropagation();
        if (!SND.enabled) SND.enable();
        SND.fx.creature(btn.dataset.sound); addFear(6);
        if (btn.dataset.sound === 'name') whisperName();
        return;
      }
      if (card) { card.classList.toggle('flipped'); studiedCreatures.add(card.dataset.id); addFear(2); }
    });
    grid.addEventListener('mouseover', e => { const card = e.target.closest('.creature'); if (card) studiedCreatures.add(card.dataset.id); });
    grid.addEventListener('keydown', e => { const card = e.target.closest('.creature'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.classList.toggle('flipped'); } });

    $('#creatureFilters').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      $$('#creatureFilters .chip').forEach(c => c.classList.toggle('active', c === b));
      const f = b.dataset.f;
      $$('.creature').forEach(c => c.classList.toggle('hide-c', f !== 'all' && !c.dataset.reacts.split(',').includes(f)));
    });
  }

  /* =========================================================
     HUD DEMO
     ========================================================= */
  function initHud() {
    const st = { hp: 100, sta: 100, fear: 12, bat: 80, mag: 8, res: 16, dur: 92, med: 2, flash: false, dark: false, veh: false, fuel: 64, eng: 78, heading: 20, speed: 0, dist: 142, sprintCD: 0 };
    const scene = $('#hudScene');
    // compass
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let strip = '';
    for (let d = -360; d <= 720; d += 15) {
      const a = ((d % 360) + 360) % 360;
      const isObj = a === 60;
      strip += `<span class="${labels[a] ? 'card' : ''} ${isObj ? 'mark' : ''}">${isObj ? '◆' : (labels[a] || '·')}</span>`;
    }
    $('#compassStrip').innerHTML = strip;

    const radioLines = [
      () => '“…keep going. I’m at the junction. Hurry.”',
      () => '“Is anyone there? We’re in the school. Second floor.”',
      () => `“${playerName()}… why did you stop walking?”`,
      () => '“Don’t trust the voice on channel four.”',
      () => '“…this is channel four.”'
    ];
    let radioIdx = 0;

    function log(t) { const d = document.createElement('div'); d.textContent = t; $('#hudLog').appendChild(d); setTimeout(() => d.remove(), 2600); }
    function bar(id, v) { const el = $(id); el.style.width = clamp(v, 0, 100) + '%'; return el; }
    function render() {
      bar('#hpBar', st.hp).classList.toggle('low', st.hp < 30);
      bar('#staBar', st.sta);
      bar('#fearBar', st.fear);
      bar('#batBar', st.bat).classList.toggle('low', st.bat < 20);
      bar('#durBar', st.dur);
      $('#ammoMag').textContent = st.mag; $('#ammoRes').textContent = st.res;
      $('#hudFlash').classList.toggle('on', st.flash);
      scene.classList.toggle('dark', st.dark && !st.flash);
      scene.classList.toggle('fear-hi', st.fear >= 75);
      $('#hudShadow').classList.toggle('show', st.fear >= 45 && Math.random() < .5);
      $('#hudVehicle').classList.toggle('hidden', !st.veh);
      bar('#fuelBar', st.fuel); bar('#engBar', st.eng);
      $('#vehSpeed').textContent = Math.round(st.speed);
      $('#objDist').textContent = Math.max(0, Math.round(st.dist)) + ' m';
      const wrapW = $('.hud-compass').clientWidth;
      $('#compassStrip').style.transform = `translateX(${wrapW / 2 - 22.5 - ((st.heading + 360) / 15) * 45}px)`;
    }
    function hallucinate() {
      const f = document.createElement('div'); f.className = 'fake';
      f.style.left = rand(8, 88) + '%'; f.style.transform = `scale(${rand(.6, 1.3)})`;
      $('#hudHallu').appendChild(f); setTimeout(() => f.remove(), 1000);
    }
    const acts = {
      fire() {
        if (st.veh) return log('You can’t aim while driving.');
        if (st.mag <= 0) { SND.fx.click(); return log('Empty. Reload.'); }
        st.mag--; st.dur = Math.max(0, st.dur - 1.5);
        SND.fx.gunshot();
        const m = document.createElement('div'); m.className = 'muzzle'; scene.appendChild(m); setTimeout(() => m.remove(), 150);
        scene.classList.remove('recoil'); void scene.offsetWidth; scene.classList.add('recoil');
        if (Math.random() < .35) { log('Gunfire echoes… something answers.'); st.fear += 8; } else log('Gunfire echoes across the compounds.');
        if (st.dur < 20) log('Weapon condition critical.');
      },
      reload() {
        if (st.mag >= 8) return log('Magazine full.');
        if (st.res <= 0) return log('No ammunition left.');
        SND.fx.reload(); log('Reloading…');
        setTimeout(() => { const need = 8 - st.mag, take = Math.min(need, st.res); st.mag += take; st.res -= take; render(); }, 900);
      },
      sprint() {
        if (st.sta < 18) return log('Too exhausted to sprint.');
        st.sta -= 24; st.sprintCD = 3; st.dist -= 25; st.heading += rand(-35, 35); st.fear = Math.max(0, st.fear - 3); log('Sprinting. Your footsteps are loud.');
      },
      flash() {
        if (st.bat <= 0) return log('Battery dead.');
        st.flash = !st.flash; SND.fx.click(); log(st.flash ? 'Flashlight on — you can be seen.' : 'Flashlight off.');
      },
      dark() { st.dark = true; st.flash = false; st.fear += 16; log('You wait in the dark. Something breathes nearby.'); SND.fx.whisper(); },
      hurt() {
        st.hp -= rand(15, 30); st.fear += 8;
        scene.classList.add('hit'); setTimeout(() => scene.classList.remove('hit'), 400);
        if (st.hp <= 0) { st.hp = 0; log('You died. The city keeps your name.'); setTimeout(() => { st.hp = 100; st.fear = 12; render(); log('Checkpoint restored.'); }, 2500); }
        else if (st.hp < 30) { log('Critical condition.'); SND.fx.heartbeat(2); }
      },
      heal() {
        if (st.med <= 0) return log('No medical supplies.');
        if (st.hp >= 100) return log('You’re not injured.');
        st.med--; st.hp = Math.min(100, st.hp + 45); log(`Bandaged. ${st.med} medkit${st.med === 1 ? '' : 's'} left.`);
      },
      drive() {
        st.veh = !st.veh;
        if (st.veh) { st.speed = 0; log('Engine starts on the third try.'); }
        else { st.speed = 0; log('You leave the vehicle. The headlights stay on.'); }
      },
      radio() {
        SND.fx.static(.8, .3);
        $('#hudRadio').classList.add('live'); $('#hudRadioTxt').textContent = 'receiving';
        const line = radioLines[radioIdx++ % radioLines.length]();
        setTimeout(() => log(line), 500);
        setTimeout(() => { $('#hudRadio').classList.remove('live'); $('#hudRadioTxt').textContent = 'silent'; }, 3000);
        if (radioIdx % radioLines.length === 0) st.fear += 10;
      }
    };
    $('.hud-controls').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (!SND.enabled) SND.enable();
      const a = b.dataset.act; if (a !== 'dark') st.dark = a === 'flash' ? st.dark : false;
      acts[a](); st.fear = clamp(st.fear, 0, 100); render();
    });
    setInterval(() => {
      if (st.sprintCD > 0) st.sprintCD--; else st.sta = Math.min(100, st.sta + 4);
      if (st.flash) { st.bat = Math.max(0, st.bat - .7); if (st.bat <= 0) { st.flash = false; log('Your flashlight dies.'); } }
      if (st.dark && !st.flash) st.fear += 2.2; else if (st.flash) st.fear -= 1.2; else st.fear -= .4;
      if (st.veh) { st.fuel = Math.max(0, st.fuel - .4); st.speed = clamp(st.speed + rand(-6, 14), 0, 92); st.dist -= st.speed / 20; st.heading += rand(-6, 6); if (st.fuel <= 0) { st.veh = false; log('Out of fuel.'); } }
      st.fear = clamp(st.fear, 0, 100);
      if (st.fear >= 60 && Math.random() < .35) hallucinate();
      if (st.fear >= 85 && Math.random() < .25) {
        const o = $('#objText'), orig = 'Find the source of the child’s voice';
        o.textContent = 'THERE WAS NEVER A CHILD'; setTimeout(() => { o.textContent = orig; }, 700);
      }
      if (st.dist <= 0) { st.dist = 142; log('Objective reached. The house is empty.'); }
      render();
    }, 500);
    addEventListener('resize', render);
    render();
  }

  /* =========================================================
     VEHICLES
     ========================================================= */
  function vehSvg(type, col) {
    const wheels = `<g fill="#050505" stroke="#2a2f36" stroke-width="3"><circle cx="80" cy="80" r="15"/><circle cx="220" cy="80" r="15"/></g><g fill="#3a414b"><circle cx="80" cy="80" r="5"/><circle cx="220" cy="80" r="5"/></g>`;
    const light = `<circle cx="268" cy="58" r="4" fill="#ffe7a8"/><path d="M270 58 L300 48 L300 70Z" fill="#ffe7a8" opacity=".18"/>`;
    const win = '#0a1422';
    const bodies = {
      gwagon: `<rect x="40" y="44" width="225" height="34" rx="4" fill="${col}"/><rect x="70" y="16" width="160" height="32" rx="3" fill="${col}"/><g fill="${win}"><rect x="80" y="22" width="44" height="20"/><rect x="130" y="22" width="44" height="20"/><rect x="180" y="22" width="40" height="20"/></g><rect x="26" y="40" width="16" height="28" rx="6" fill="#111"/>`,
      suv: `<path d="M40 78 L40 52 Q42 44 60 42 L90 40 L112 20 L210 20 L235 42 L262 46 Q270 50 268 78Z" fill="${col}"/><path d="M118 25 L205 25 L225 42 L104 42Z" fill="${win}"/>`,
      sedan: `<path d="M30 78 L32 58 Q36 50 60 48 L100 46 L125 28 L195 28 L222 46 L262 50 Q272 54 270 78Z" fill="${col}"/><path d="M130 33 L190 33 L212 46 L112 46Z" fill="${win}"/>`,
      police: `<path d="M30 78 L32 58 Q36 50 60 48 L100 46 L125 28 L195 28 L222 46 L262 50 Q272 54 270 78Z" fill="#e9edf2"/><rect x="30" y="58" width="240" height="8" fill="#1e4fa3"/><path d="M130 33 L190 33 L212 46 L112 46Z" fill="${win}"/><rect x="140" y="20" width="18" height="7" fill="#e3202b"/><rect x="158" y="20" width="18" height="7" fill="#3d7fd1"/>`,
      pickup: `<path d="M30 78 L30 50 L140 50 L140 22 L200 22 L228 46 L265 50 Q272 54 270 78Z" fill="${col}"/><path d="M148 27 L196 27 L218 46 L148 46Z" fill="${win}"/>`,
      truck: `<rect x="22" y="12" width="172" height="58" fill="#3b4a2a"/><path d="M198 78 L198 26 L240 26 L270 50 L270 78Z" fill="${col}"/><path d="M206 32 L236 32 L258 50 L206 50Z" fill="${win}"/><g stroke="#2c3820"><line x1="60" y1="12" x2="60" y2="70"/><line x1="110" y1="12" x2="110" y2="70"/><line x1="160" y1="12" x2="160" y2="70"/></g>`,
      tactical: `<path d="M30 78 L30 48 L240 48 L270 56 L270 78Z" fill="${col}"/><path d="M80 48 L95 20 L185 20 L200 48" stroke="#1b1f25" stroke-width="5" fill="none"/><rect x="34" y="52" width="40" height="10" fill="#1b1f25"/>`,
      armored: `<path d="M25 78 L25 40 L60 20 L220 20 L272 44 L272 78Z" fill="${col}"/><g fill="${win}"><rect x="80" y="30" width="34" height="7"/><rect x="130" y="30" width="34" height="7"/><rect x="180" y="30" width="30" height="7"/></g>`,
      bus: `<rect x="22" y="18" width="252" height="58" rx="8" fill="#e0b11d"/><rect x="22" y="56" width="252" height="6" fill="#111"/><g fill="${win}"><rect x="40" y="26" width="34" height="22"/><rect x="80" y="26" width="34" height="22"/><rect x="120" y="26" width="34" height="22"/><rect x="160" y="26" width="34" height="22"/><rect x="200" y="26" width="30" height="22"/><rect x="236" y="26" width="30" height="28"/></g>`,
      van: `<path d="M28 78 L28 22 Q30 16 40 16 L210 16 L250 40 L270 48 L270 78Z" fill="${col}"/><path d="M212 22 L244 42 L212 42Z" fill="${win}"/>`,
      ambulance: `<path d="M28 78 L28 22 Q30 16 40 16 L210 16 L250 40 L270 48 L270 78Z" fill="#eef2f5"/><rect x="28" y="54" width="242" height="7" fill="#c8102e"/><path d="M212 22 L244 42 L212 42Z" fill="${win}"/><path d="M110 26 h12 v12 h12 v12 h-12 v12 h-12 v-12 h-12 v-12 h12z" fill="#c8102e"/>`,
      utility: `<rect x="22" y="40" width="172" height="32" fill="${col}"/><path d="M198 78 L198 26 L240 26 L270 50 L270 78Z" fill="${col}"/><path d="M206 32 L236 32 L258 50 L206 50Z" fill="${win}"/><path d="M60 40 L150 6 L170 10" stroke="#f3b23c" stroke-width="5" fill="none"/>`,
      moto: `<g fill="#050505" stroke="#2a2f36" stroke-width="3"><circle cx="95" cy="76" r="19"/><circle cx="210" cy="76" r="19"/></g><path d="M95 76 L140 50 L190 50 L210 76 M140 50 L130 34 L118 34 M178 50 L196 40" stroke="${col}" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="138" y="42" width="44" height="10" rx="4" fill="#111"/>`,
      boat: `<g stroke="#1d5e8f" opacity=".6"><path d="M0 88 Q40 82 80 88 T160 88 T240 88 T320 88" fill="none"/></g><path d="M25 58 L275 58 L245 86 L55 86Z" fill="${col}"/><rect x="40" y="52" width="220" height="6" fill="#e0b11d"/><rect x="120" y="34" width="70" height="20" fill="#2a3340"/>`,
      speedboat: `<g stroke="#1d5e8f" opacity=".6"><path d="M0 88 Q40 82 80 88 T160 88 T240 88 T320 88" fill="none"/></g><path d="M18 64 L282 54 L250 84 L50 86Z" fill="${col}"/><path d="M150 54 L180 36 L198 55Z" fill="${win}" stroke="#7fd6ff" stroke-width="1.5"/><rect x="14" y="56" width="10" height="26" fill="#111"/>`
    };
    const isLand = !['moto', 'boat', 'speedboat'].includes(type);
    return `<svg viewBox="0 0 300 100" preserveAspectRatio="xMidYMid meet"><line x1="0" y1="96" x2="300" y2="96" stroke="rgba(120,160,210,.15)"/>${bodies[type]}${isLand ? wheels + light : ''}</svg>`;
  }

  const VEHICLES = [
    { name: 'Boxline G-Series', type: 'gwagon', col: '#20262e', cat: 'Civilian', desc: 'G-Wagon-style luxury 4x4. Square, heavy and nearly unstoppable on flooded roads.', s: [70, 45, 58, 55], tags: ['Keys required', 'Rumuola estates'] },
    { name: 'Armored Escort SUV', type: 'suv', col: '#121417', cat: 'Tactical', desc: 'Reinforced panels and run-flat tyres. Left behind by a VIP convoy.', s: [64, 80, 52, 50], tags: ['Keys required'] },
    { name: 'Workhorse Pickup', type: 'pickup', col: '#5b1d1f', cat: 'Civilian', desc: 'The most common vehicle in the city. Open bed for a gunner or loot.', s: [68, 35, 64, 75], tags: ['Common'] },
    { name: 'Military Cargo Truck', type: 'truck', col: '#3b4a2a', cat: 'Tactical', desc: 'Six-wheel convoy truck from the attacked military column.', s: [48, 72, 30, 100], tags: ['Rumuokoro only', 'Repair needed'] },
    { name: 'Tactical 4x4 Patrol', type: 'tactical', col: '#2e3a2a', cat: 'Tactical', desc: 'Open-top patrol vehicle with roll cage. Fast off-road, exposed on-road.', s: [78, 50, 80, 45], tags: ['Agip Flyover'] },
    { name: 'Armored Transport', type: 'armored', col: '#2a2f35', cat: 'Tactical', desc: 'Slab-sided cash transport. Slow, loud and almost impossible to stop.', s: [42, 95, 28, 90], tags: ['Keys required', 'Rare'] },
    { name: 'Police Interceptor', type: 'police', col: '#e9edf2', cat: 'Emergency', desc: 'Found outside empty police stations. The siren still works — careful.', s: [85, 40, 72, 35], tags: ['Repair needed'] },
    { name: 'Field Ambulance', type: 'ambulance', col: '#eef2f5', cat: 'Emergency', desc: 'Stocked with medical supplies if you reach it first.', s: [60, 40, 50, 85], tags: ['Hospital zones'] },
    { name: 'Rain-Line Commuter Bus', type: 'bus', col: '#e0b11d', cat: 'Civilian', desc: 'Nigerian-style yellow commuter bus. Seats the whole co-op squad.', s: [52, 45, 35, 80], tags: ['Co-op favourite'] },
    { name: 'Family Sedan', type: 'sedan', col: '#3a4656', cat: 'Civilian', desc: 'Quiet engine — the best choice for slipping past sound-hunters.', s: [72, 25, 70, 40], tags: ['Quiet'] },
    { name: 'Okada Motorcycle', type: 'moto', col: '#b3121c', cat: 'Civilian', desc: 'The fastest way through jammed traffic. Zero protection.', s: [92, 5, 90, 10], tags: ['Loud', 'Two riders'] },
    { name: 'Delivery Van', type: 'van', col: '#4a5361', cat: 'Civilian', desc: 'Big storage, poor handling. Some still have their cargo.', s: [55, 35, 42, 92], tags: ['Loot inside'] },
    { name: 'Utility Crane Truck', type: 'utility', col: '#7a5a1c', cat: 'Civilian', desc: 'Its boom can lift debris and open blocked industrial gates.', s: [40, 60, 30, 70], tags: ['Eleme only', 'Repair needed'] },
    { name: 'Waterfront Passenger Boat', type: 'boat', col: '#1f4e6e', cat: 'Water', desc: 'Long wooden boat with an outboard engine. Steady in floodwater.', s: [45, 30, 40, 85], tags: ['Borokiri'] },
    { name: 'Creek Speedboat', type: 'speedboat', col: '#d9dde3', cat: 'Water', desc: 'Outruns anything beneath the surface — if you have the fuel.', s: [95, 20, 75, 30], tags: ['Fuel hungry', 'Rare'] }
  ];

  function initVehicles() {
    const grid = $('#vehGrid'), labels = ['SPEED', 'ARMOR', 'HANDLING', 'STORAGE'];
    grid.innerHTML = VEHICLES.map(v => `
      <div class="veh" data-cat="${v.cat}">
        ${vehSvg(v.type, v.col)}
        <div class="v-cat">${v.cat.toUpperCase()}</div>
        <h4>${v.name}</h4>
        <p>${v.desc}</p>
        ${v.s.map((n, i) => `<div class="stat"><span>${labels[i]}</span><i><b data-w="${n}"></b></i></div>`).join('')}
        <div class="v-tags">${v.tags.map(t => `<span>${t}</span>`).join('')}</div>
      </div>`).join('');
    const fill = () => $$('#vehGrid .stat b').forEach(b => { b.style.width = b.dataset.w + '%'; });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(e => { if (e[0].isIntersecting) { fill(); io.disconnect(); } }, { threshold: .1 });
      io.observe(grid);
    } else fill();
    $('#vehFilters').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      $$('#vehFilters .chip').forEach(c => c.classList.toggle('active', c === b));
      $$('.veh').forEach(v => v.classList.toggle('hide-v', b.dataset.f !== 'all' && v.dataset.cat !== b.dataset.f));
    });
  }

  /* =========================================================
     CHARACTER CREATOR
     ========================================================= */
  const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#a86b3c', '#8d5524', '#6b3e1f', '#4a2a12', '#2f1a0b'];
  const CLOTHS = ['#2c3e57', '#3b4a2a', '#5a1a1e', '#1d1d1f', '#7a5a1c', '#0f5257', '#4b2a6a'];
  const FACES = ['Oval', 'Round', 'Square', 'Long'];
  const HAIRS = ['Low cut', 'Afro', 'Dreads', 'Braids', 'Cornrows', 'Bald', 'Headwrap'];
  const OUTFITS = ['Rain Jacket', 'Tactical Vest', 'Ankara Shirt', 'Hoodie', 'Overalls', 'Scrubs'];

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function avatarSvg(o) {
    const f = o.gender === 'f', sk = o.skin, sd = shade(sk, -28), cl = o.cloth, hc = '#0b0806';
    const heads = {
      Oval: `<ellipse cx="150" cy="122" rx="46" ry="58" fill="${sk}"/>`,
      Round: `<ellipse cx="150" cy="124" rx="52" ry="54" fill="${sk}"/>`,
      Square: `<rect x="103" y="66" width="94" height="112" rx="30" fill="${sk}"/>`,
      Long: `<ellipse cx="150" cy="120" rx="42" ry="64" fill="${sk}"/>`
    };
    const body = f ? 'M72 380 Q74 256 150 240 Q226 256 228 380Z' : 'M50 380 Q52 244 150 230 Q248 244 250 380Z';
    let back = '', front = '', outfit = '';
    switch (o.hair) {
      case 'Low cut': front = `<path d="M104 106 Q106 62 150 60 Q194 62 196 106 Q186 82 150 80 Q114 82 104 106Z" fill="${hc}" opacity=".9"/>`; break;
      case 'Afro': back = `<circle cx="150" cy="96" r="${f ? 80 : 70}" fill="${hc}"/>`; break;
      case 'Dreads': back = Array.from({ length: 11 }, (_, i) => `<rect x="${96 + i * 10}" y="70" width="9" height="${f ? 180 : 130}" rx="4.5" fill="${hc}"/>`).join(''); front = `<path d="M102 108 Q104 58 150 56 Q196 58 198 108 Q186 76 150 74 Q114 76 102 108Z" fill="${hc}"/>`; break;
      case 'Braids': back = Array.from({ length: 9 }, (_, i) => `<path d="M${104 + i * 11} 80 L${100 + i * 12} ${f ? 270 : 220}" stroke="${hc}" stroke-width="6" stroke-dasharray="7 2"/>`).join(''); front = `<path d="M102 108 Q104 58 150 56 Q196 58 198 108 Q186 76 150 74 Q114 76 102 108Z" fill="${hc}"/>`; break;
      case 'Cornrows': front = `<path d="M103 106 Q105 60 150 58 Q195 60 197 106 Q186 80 150 78 Q114 80 103 106Z" fill="${hc}"/><g stroke="${shade(sk, -50)}" stroke-width="1.5" opacity=".7">${[118, 134, 150, 166, 182].map(x => `<path d="M${x} 62 Q${x + (x - 150) * .1} 80 ${x + (x - 150) * .2} 100" fill="none"/>`).join('')}</g>`; break;
      case 'Bald': front = `<ellipse cx="136" cy="84" rx="14" ry="7" fill="#fff" opacity=".12"/>`; break;
      case 'Headwrap': front = `<path d="M96 104 Q90 40 150 34 Q214 36 206 104 Q190 80 150 82 Q112 80 96 104Z" fill="${shade(cl, 40)}"/><path d="M150 36 Q190 10 214 30 Q196 44 170 46Z" fill="${shade(cl, 20)}"/><path d="M110 70 Q150 56 196 72 M104 86 Q150 72 200 88" stroke="${shade(cl, -20)}" stroke-width="2" fill="none"/>`; break;
    }
    switch (o.outfit) {
      case 'Rain Jacket': outfit = `<path d="${body}" fill="${cl}"/><path d="M118 236 Q150 262 182 236 L190 252 Q150 284 110 252Z" fill="${shade(cl, -25)}"/><line x1="150" y1="262" x2="150" y2="380" stroke="#c7ced8" stroke-width="2"/><rect x="${f ? 74 : 54}" y="320" width="${f ? 152 : 192}" height="8" fill="#d6e0a0" opacity=".55"/>`; break;
      case 'Tactical Vest': outfit = `<path d="${body}" fill="#1b1e22"/><path d="M${f ? 98 : 86} 380 L${f ? 104 : 94} 262 L130 250 L150 274 L170 250 L${f ? 196 : 206} 262 L${f ? 202 : 214} 380Z" fill="${cl}"/><g fill="${shade(cl, -25)}"><rect x="108" y="296" width="30" height="34" rx="3"/><rect x="162" y="296" width="30" height="34" rx="3"/><rect x="118" y="340" width="64" height="26" rx="3"/></g>`; break;
      case 'Ankara Shirt': outfit = `<defs><pattern id="ank" width="28" height="28" patternUnits="userSpaceOnUse"><rect width="28" height="28" fill="${cl}"/><circle cx="14" cy="14" r="7" fill="#f3b23c"/><circle cx="14" cy="14" r="3" fill="${shade(cl, -30)}"/><path d="M0 0 L7 7 M28 0 L21 7 M0 28 L7 21 M28 28 L21 21" stroke="#e3e3e3" stroke-width="2"/></pattern></defs><path d="${body}" fill="url(#ank)"/><path d="M130 236 L150 262 L170 236" stroke="${shade(cl, -30)}" stroke-width="5" fill="none"/>`; break;
      case 'Hoodie': outfit = `<path d="${body}" fill="${cl}"/><path d="M106 238 Q150 204 194 238 Q190 262 150 266 Q110 262 106 238Z" fill="${shade(cl, -20)}"/><g stroke="#ddd" stroke-width="2"><line x1="140" y1="262" x2="138" y2="300"/><line x1="160" y1="262" x2="162" y2="300"/></g><path d="M118 330 h64 v30 h-64z" fill="${shade(cl, -15)}"/>`; break;
      case 'Overalls': outfit = `<path d="${body}" fill="#2a2d33"/><path d="M110 380 L112 280 L188 280 L190 380Z" fill="${cl}"/><g stroke="${cl}" stroke-width="10"><line x1="118" y1="282" x2="112" y2="240"/><line x1="182" y1="282" x2="188" y2="240"/></g><circle cx="120" cy="286" r="4" fill="#c9a14a"/><circle cx="180" cy="286" r="4" fill="#c9a14a"/><rect x="134" y="300" width="32" height="22" fill="${shade(cl, -20)}"/>`; break;
      case 'Scrubs': outfit = `<path d="${body}" fill="${cl}"/><path d="M126 236 L150 290 L174 236" fill="${sd}"/><rect x="${f ? 182 : 186}" y="300" width="28" height="24" fill="${shade(cl, -18)}"/>`; break;
    }
    const eyeY = 120, lash = f ? `<path d="M120 ${eyeY - 5} l-4 -4 M180 ${eyeY - 5} l4 -4" stroke="#000" stroke-width="2"/>` : '';
    return `<defs><radialGradient id="avbg" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#1a2b48"/><stop offset="1" stop-color="#04070d" stop-opacity="0"/></radialGradient></defs>
      <rect width="300" height="380" fill="url(#avbg)"/>
      ${back}
      ${outfit}
      <rect x="132" y="168" width="36" height="${f ? 70 : 64}" fill="${sd}"/>
      <ellipse cx="102" cy="126" rx="8" ry="13" fill="${sd}"/><ellipse cx="198" cy="126" rx="8" ry="13" fill="${sd}"/>
      ${heads[o.face]}
      <g fill="#f4efe6"><ellipse cx="130" cy="${eyeY}" rx="10" ry="${f ? 6 : 5}"/><ellipse cx="170" cy="${eyeY}" rx="10" ry="${f ? 6 : 5}"/></g>
      <g fill="#120b06"><circle cx="131" cy="${eyeY}" r="4.5"/><circle cx="171" cy="${eyeY}" r="4.5"/></g>${lash}
      <g stroke="${hc}" stroke-width="${f ? 2.5 : 4}" stroke-linecap="round"><line x1="118" y1="${eyeY - 14}" x2="141" y2="${eyeY - 16}"/><line x1="159" y1="${eyeY - 16}" x2="182" y2="${eyeY - 14}"/></g>
      <path d="M150 124 Q146 142 140 146 Q150 152 160 146 Q154 142 150 124" fill="${sd}"/>
      <path d="M134 160 Q150 ${f ? 168 : 165} 166 160" stroke="${f ? '#5a1e1e' : shade(sk, -60)}" stroke-width="${f ? 4 : 3}" fill="none" stroke-linecap="round"/>
      ${front}
      <rect x="${f ? 94 : 76}" y="268" width="14" height="24" rx="2" fill="#22272e"/><circle cx="${f ? 101 : 83}" cy="268" r="9" fill="#ffe7a8" opacity=".35"/>`;
  }

  function initCreator() {
    const st = Object.assign({ name: '', gender: 'm', voice: 'Calm', skin: SKINS[4], face: 'Oval', hair: 'Low cut', outfit: 'Rain Jacket', cloth: CLOTHS[0] }, survivor || {});
    const svg = $('#avatar');
    const swatch = (el, list, key) => {
      el.innerHTML = list.map(c => `<button type="button" style="background:${c}" data-v="${c}" aria-label="${key} ${c}"></button>`).join('');
      el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { st[key] = b.dataset.v; draw(); } });
    };
    const opts = (el, list, key) => {
      el.innerHTML = list.map(v => `<button type="button" data-v="${v}">${v}</button>`).join('');
      el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { st[key] = b.dataset.v; draw(); } });
    };
    swatch($('#skinSw'), SKINS, 'skin'); swatch($('#clothSw'), CLOTHS, 'cloth');
    opts($('#faceOpts'), FACES, 'face'); opts($('#hairOpts'), HAIRS, 'hair'); opts($('#outfitOpts'), OUTFITS, 'outfit');
    $('#cName').value = st.name; $('#cGender').value = st.gender; $('#cVoice').value = st.voice;

    function draw() {
      svg.innerHTML = avatarSvg(st);
      $$('#skinSw button').forEach(b => b.classList.toggle('sel', b.dataset.v === st.skin));
      $$('#clothSw button').forEach(b => b.classList.toggle('sel', b.dataset.v === st.cloth));
      [['#faceOpts', 'face'], ['#hairOpts', 'hair'], ['#outfitOpts', 'outfit']].forEach(([s, k]) => $$(s + ' button').forEach(b => b.classList.toggle('sel', b.dataset.v === st[k])));
      $('#idName').textContent = (st.name || 'UNKNOWN').toUpperCase();
      $('#idVoice').textContent = st.voice;
    }
    $('#cName').addEventListener('input', e => { st.name = e.target.value.trim(); draw(); });
    $('#cGender').addEventListener('change', e => { st.gender = e.target.value; draw(); });
    $('#cVoice').addEventListener('change', e => { st.voice = e.target.value; draw(); });
    $('#randomBtn').addEventListener('click', () => {
      Object.assign(st, { gender: pick(['m', 'f']), skin: pick(SKINS), face: pick(FACES), hair: pick(HAIRS), outfit: pick(OUTFITS), cloth: pick(CLOTHS), voice: pick(['Calm', 'Gruff', 'Nervous', 'Commanding']) });
      $('#cGender').value = st.gender; $('#cVoice').value = st.voice; draw();
    });
    $('#saveOp').addEventListener('click', () => {
      if (!st.name) { $('#savedMsg').textContent = 'Every survivor needs a name.'; $('#cName').focus(); return; }
      survivor = Object.assign({}, st); store.set('tlc_survivor', survivor);
      $('#savedMsg').textContent = `Survivor saved. The city has learned the name “${st.name}”.`;
      $$('.nm-text').forEach(t => { t.textContent = `…${st.name.toLowerCase()}…`; });
      renderLeaderboard(); SND.fx.whisper();
    });
    draw();
  }

  /* =========================================================
     LEADERBOARD
     ========================================================= */
  const LB = {
    weekly: [['Ebi_Nightwalker', 'Eleme Junction', '04:12:33'], ['AdaobiK', 'Eleme Junction', '03:58:10'], ['T-Rumu', 'Iwofe', '03:41:02'], ['Owo.Kalabari', 'Iwofe', '03:20:47'], ['BonnyTide99', 'Borokiri', '02:59:15'], ['Ngozi.Runs', 'Borokiri', '02:44:09'], ['SoboTactical', 'Agip Flyover', '02:31:51'], ['Ibinabo', 'Rumuokoro', '02:02:30']],
    all: [['GRA_Ghost', 'Etche — The Source', '11:48:20'], ['Ebi_Nightwalker', 'Etche — The Source', '11:02:41'], ['Chidera.X', 'Etche — The Source', '10:37:05'], ['AdaobiK', 'Eleme Junction', '09:59:12'], ['Tamuno', 'Eleme Junction', '09:30:44'], ['Owo.Kalabari', 'Iwofe', '08:12:19'], ['T-Rumu', 'Iwofe', '07:48:00'], ['Ifeanyi_PH', 'Borokiri', '07:01:33']]
  };
  let lbTab = 'weekly';
  function renderLeaderboard() {
    const rows = LB[lbTab].map(r => ({ n: r[0], d: r[1], t: r[2], you: false }));
    if (survivor && survivor.name) rows.splice(6, 0, { n: survivor.name + ' (you)', d: 'Rumuola', t: '00:00:00', you: true });
    $('#lbList').innerHTML = rows.slice(0, 9).map(r => `<li class="${r.you ? 'you' : ''}"><span class="lb-name">${escapeHtml(r.n)}</span><span class="lb-dist">${r.d}</span><span class="lb-time">${r.t}</span></li>`).join('');
  }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function initLeaderboard() {
    $('#lbTabs').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      lbTab = b.dataset.t; $$('#lbTabs .chip').forEach(c => c.classList.toggle('active', c === b)); renderLeaderboard();
    });
    renderLeaderboard();
  }

  /* =========================================================
     ENDINGS — shaped by what the visitor explored on the page
     ========================================================= */
  function initEndings() {
    const out = $('#endingOut'); let typer = null;
    function story(kind) {
      const lv = visitedLevels.size, cr = studiedCreatures.size, nm = playerName();
      const explored = lv >= 7 ? 'You walked every district and read every log.' : lv >= 4 ? 'You saw enough of the city to understand some of it.' : 'You came straight here. You never learned what the districts were trying to tell you.';
      const knowledge = cr >= 5 ? 'You know how each of them hunts.' : 'Most of what lives here is still a stranger to you.';
      const endings = {
        destroy: `${explored} You set the charges where the old stone meets the pipelines. When the source collapses, the lights of Port Harcourt come back on — all of them, at once — and then half the waterfront goes dark forever. ${cr >= 5 ? 'The creatures fall silent. For now.' : 'Something still hums beneath the creeks.'}`,
        escape: `${explored} You run. The boat clears the creek as the sky turns grey. Behind you the city is silent, and you never find out who opened it. Months later, in another city, your phone rings at 3:00 a.m. The caller says, “${nm}… you left the door open.”`,
        truth: `${explored} ${knowledge} You stay. In the deepest chamber you find the final recording: the investigators did not discover the structures — they were invited. The Blackout was a signal. The One Below opens its eye, and for the first time, it speaks to you by name.`
      };
      return `[ENDING — ${kind.toUpperCase()}]  Districts explored: ${lv}/10 · Creatures studied: ${cr}/8\n\n${endings[kind]}`;
    }
    $$('.ending').forEach(b => b.addEventListener('click', () => {
      $$('.ending').forEach(x => x.classList.toggle('sel', x === b));
      const kind = b.dataset.e, text = story(kind);
      if (!SND.enabled) SND.enable();
      kind === 'destroy' ? (strike(), SND.fx.stinger()) : kind === 'truth' ? (SND.fx.creature('below'), addFear(15)) : (SND.fx.static(.6), addFear(-20));
      out.classList.add('show'); out.innerHTML = '<span class="tw"></span>'; const span = $('.tw', out);
      clearInterval(typer); let i = 0;
      typer = setInterval(() => { span.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typer); }, 18);
      span.style.whiteSpace = 'pre-line';
    }));
  }

  /* =========================================================
     MIXER / SOUNDTRACK
     ========================================================= */
  function initMixer() {
    $$('.mixer input[type=range]').forEach(r => r.addEventListener('input', () => SND.setVol(r.dataset.ch, r.value / 100)));
    $('#mixPlay').addEventListener('click', () => setSound(!SND.musicOn));
    $('#soundBtn').addEventListener('click', () => setSound(!SND.musicOn));
    $('#mixSilence').addEventListener('click', () => {
      if (!SND.musicOn) setSound(true);
      document.body.style.transition = 'filter 1s'; document.body.style.filter = 'brightness(.6)';
      SND.silence(2600, () => {
        document.body.style.filter = '';
        SND.fx.stinger(); strike(false); showPhantom(); addFear(15);
      });
    });
    const bars = $$('#eq i');
    const data = new Uint8Array(32);
    (function loop() {
      const an = SND.analyser;
      if (an && SND.enabled) { an.getByteFrequencyData(data); bars.forEach((b, i) => { b.style.height = Math.max(3, data[i + 1] / 255 * 60) + 'px'; }); }
      else bars.forEach(b => { b.style.height = '3px'; });
      requestAnimationFrame(loop);
    })();
  }

  /* =========================================================
     SITE-WIDE FEAR SYSTEM
     ========================================================= */
  let fear = 0, lastInput = Date.now();
  function addFear(v) { setFear(fear + v); }
  function setFear(v) {
    fear = clamp(v, 0, 100);
    $('#fearFill').style.width = fear + '%';
    $('#fearNum').textContent = Math.round(fear);
    document.documentElement.style.setProperty('--fear', (fear / 100).toFixed(3));
    const b = document.body;
    b.classList.toggle('fear-2', fear >= 30 && fear < 60);
    b.classList.toggle('fear-3', fear >= 60 && fear < 85);
    b.classList.toggle('fear-4', fear >= 85);
    $('#fearWidget').classList.toggle('high', fear >= 60);
  }
  function currentSection() {
    const mid = innerHeight / 2; let id = '';
    $$('main section[id]').forEach(s => { const r = s.getBoundingClientRect(); if (r.top < mid && r.bottom > mid) id = s.id; });
    return id;
  }
  function spawnDoor() {
    if ($('.door-link')) return;
    const a = document.createElement('a');
    a.href = '#'; a.className = 'door-link'; a.textContent = '▣ Basement'; a.style.color = 'var(--blood2)';
    a.addEventListener('click', e => {
      e.preventDefault(); a.remove(); SND.fx.stinger();
      openModal(`<p style="font-size:1.2rem">There is no basement in this house.</p><p class="muted" style="margin-top:12px">There never was.</p>`);
      addFear(8);
    });
    $('#navLinks').appendChild(a);
    setTimeout(() => a.remove(), 9000);
  }
  function initFear() {
    ['mousemove', 'scroll', 'keydown', 'touchstart'].forEach(ev => addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));
    $('#flareBtn').addEventListener('click', () => {
      setFear(0); strike(false);
      const el = $('#lightning'); el.style.background = '#ff8c28';
      setTimeout(() => { el.style.background = ''; }, 900);
    });
    setInterval(() => {
      if (document.hidden || document.body.classList.contains('locked')) return;
      const sec = currentSection();
      let d = -.4;
      if (['creatures', 'fear', 'levels'].includes(sec)) d = .35;
      if (sec === 'endings') d = 1.1;
      if (Date.now() - lastInput > 20000) d += .8; // standing still in the dark
      addFear(d);
      if (fear > 60 && Math.random() < .07) whisperName();
      if (fear > 40 && Math.random() < .05) showPhantom();
      if (fear > 85 && Math.random() < .05) spawnDoor();
    }, 1000);
    setFear(0);
  }

  /* =========================================================
     MODAL, JOIN, COUNTDOWN
     ========================================================= */
  function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function initModal() {
    $('#modalClose').addEventListener('click', () => $('#modal').classList.add('hidden'));
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); });
    addEventListener('keydown', e => { if (e.key === 'Escape') $('#modal').classList.add('hidden'); });
  }
  function initJoin() {
    $('#joinForm').addEventListener('submit', e => {
      e.preventDefault();
      const em = $('#joinEmail').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { $('#joinMsg').textContent = 'That address doesn’t look right.'; return; }
      const list = store.get('tlc_waitlist', []); list.push({ email: em, platform: $('#joinPlat').value, at: Date.now() }); store.set('tlc_waitlist', list);
      $('#joinMsg').textContent = `You’re on the list, ${playerName()}. Keep your radio on.`;
      $('#joinEmail').value = ''; SND.fx.static(.4, .2);
    });
    const target = new Date('2027-10-31T00:00:00+01:00').getTime();
    const cd = $('#countdown');
    const tick = () => {
      let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
      const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); s %= 3600; const m = Math.floor(s / 60); s %= 60;
      cd.innerHTML = [[d, 'DAYS'], [h, 'HOURS'], [m, 'MINUTES'], [s, 'SECONDS']].map(([v, l]) => `<div><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`).join('');
    };
    tick(); setInterval(tick, 1000);
  }

  /* =========================================================
     BOOT
     ========================================================= */
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('locked');
    Intro.idle();
    $('#startBtn').addEventListener('click', () => Intro.play(true));
    $('#skipBtn').addEventListener('click', () => Intro.finish());
    $('#skipRunning').addEventListener('click', () => Intro.finish());
    $('#replayIntro').addEventListener('click', () => Intro.play(true));

    initRain(); lightningLoop(); initCity(); initNav(); initTicker();
    initRadio(); initLevels(); initCreatures(); initHud(); initVehicles();
    initCreator(); initLeaderboard(); initEndings(); initMixer(); initFear();
    initModal(); initJoin(); initReveal();
  });
})();