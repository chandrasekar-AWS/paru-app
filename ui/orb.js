/* Paru orb: a glass sphere with folded, translucent ribbons made of fine hairlines (canvas 2D).
 * Voice makes it move: the ribbons swell with the microphone level (you) or the speech level (Paru),
 * and rings of waves ripple out of the sphere. API: ParuOrb.mount(orbEl, bubbleEl) -> {state, level, say, hideBubble, applyCfg, run}. */
const ParuOrb = (() => {
  const OSZ = { small: 64, medium: 92, large: 124 }, TAU = Math.PI * 2, PAD = 1.5;           // canvas reaches 1.5 radii beyond the sphere for the waves
  // Each ribbon: a bright tip S that wanders, and two end-curves A and B that fan out from it. The hairlines are blends between A and B.
  const RIB = [
    { c: [38, 196, 190], f: .30, s: [-.30, -.05, .30, .26, .7, .9], A: [.3, .97, 0, .60, 1.1, .8], B: [-1.0, .92, 0, .50, .9, 1.3] },
    { c: [70, 170, 255], f: .22, s: [.15, -.30, .25, .3, .8, 1.1], A: [-.4, .98, 0, .55, 1.0, .7], B: [.7, .92, 0, .55, 1.3, .9] },
    { c: [255, 142, 72], f: .20, s: [-.45, .30, .22, .2, 1.1, .6], A: [-2.7, .92, 0, .50, .8, 1.2], B: [-1.9, .97, 0, .45, 1.0, .8] },
    { c: [226, 52, 84], f: .17, s: [.35, .35, .2, .22, .6, 1.0], A: [.9, .96, 0, .55, 1.2, .7], B: [2.0, .90, 0, .60, .7, 1.1] },
    { c: [24, 150, 156], f: .30, s: [0, .1, .35, .3, .9, .7], A: [2.7, .98, 0, .55, .6, 1.0], B: [3.6, .93, 0, .55, 1.1, .6] },
    { c: [120, 205, 255], f: .20, s: [.1, -.1, .28, .24, 1.3, 1.2], A: [-1.2, .93, 0, .55, .9, 1.4], B: [-.3, .88, 0, .50, 1.2, .5] }
  ];
  const SPEED = { idle: .55, listening: .8, thinking: 2.4, speaking: 1.15, off: .2 };

  function mount(orbEl, bubEl) {
    orbEl.innerHTML = ''; const cv = document.createElement('canvas'); cv.className = 'orb-cv'; orbEl.append(cv); const ctx = cv.getContext('2d');
    let st = 'idle', lvRaw = 0, lvS = 0, lvStamp = 0, T = 0, last = performance.now(), running = true, raf = 0, size = 64, rings = [], lastRing = 0, tm = null, dpr = 1;
    function fit() {
      const css = parseFloat(getComputedStyle(orbEl).getPropertyValue('--osz')) || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--osz')) || 64;
      const w = orbEl.getBoundingClientRect().width || css; size = w; dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = Math.round(size * (1 + PAD * 2)); cv.width = Math.round(px * dpr); cv.height = Math.round(px * dpr);
      cv.style.width = px + 'px'; cv.style.height = px + 'px'; cv.style.left = -(px - size) / 2 + 'px'; cv.style.top = -(px - size) / 2 + 'px';
    }
    const P = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
    function curve(S, prm, t, amp) {                                    // end-curve k (A or B): returns [E, C1, C2] in unit-circle space
      const [th, re, , bow, w, ph] = prm, th2 = th + Math.sin(t * .45 * w + ph) * .75 * amp, r2 = Math.min(1.02, re * (.9 + .12 * Math.sin(t * .6 * w + ph * 2)) * (.92 + .1 * amp));
      const E = P(r2, th2), d = [E[0] - S[0], E[1] - S[1]], n = [-d[1], d[0]], b1 = bow * Math.sin(t * .8 * w + ph) * (.8 + .9 * amp), b2 = bow * Math.cos(t * .65 * w + ph * 1.7) * (.8 + .9 * amp);
      return [E, [S[0] + d[0] * .30 + n[0] * b1, S[1] + d[1] * .30 + n[1] * b1], [S[0] + d[0] * .68 + n[0] * b2, S[1] + d[1] * .68 + n[1] * b2]];
    }
    function frame(now) {
      raf = 0; if (!running) return; raf = requestAnimationFrame(frame);
      const dt = Math.min(.05, (now - last) / 1000); last = now;
      let lv = lvRaw; if (st === 'speaking' && now - lvStamp > 250) lv = .32 + .22 * Math.sin(T * 6.5) + .14 * Math.sin(T * 11.7 + 1);     // no real level (system voice): imitate speech
      if (st === 'thinking') lv = Math.max(lv, .25); if (st === 'off') lv = 0;
      lvS += (lv - lvS) * Math.min(1, dt * (lv > lvS ? 14 : 5));
      T += dt * (SPEED[st] || .6) * (1 + 2.2 * lvS);
      const amp = .55 + 1.05 * lvS, R = size / 2, C = cv.width / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.translate(C, C); ctx.scale(dpr * R, dpr * R);   // 1 unit = sphere radius
      // --- waves rippling out of the sphere
      if (lvS > .16 && now - lastRing > 300 / (.6 + lvS)) { lastRing = now; rings.push({ r: 1.03, a: Math.min(.75, .25 + lvS * .7) }); }
      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i]; g.r += dt * (.5 + .5 * g.a); g.a -= dt * .5; if (g.a <= 0 || g.r > 1 + PAD) { rings.splice(i, 1); continue; }
        ctx.lineWidth = 1.6 / R * (1 + 1.5 * (1 - g.a)); ctx.strokeStyle = `rgba(120,215,255,${g.a * .75})`; ctx.beginPath(); ctx.arc(0, 0, g.r, 0, TAU); ctx.stroke();
        ctx.lineWidth = 1.1 / R; ctx.strokeStyle = `rgba(230,70,150,${g.a * .5})`; ctx.beginPath(); ctx.arc(0, 0, g.r * .965, 0, TAU); ctx.stroke();
      }
      // --- glass body
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, .985, 0, TAU); ctx.clip();
      const body = ctx.createRadialGradient(-.15, -.2, .05, 0, 0, 1); body.addColorStop(0, 'rgba(14,26,40,.55)'); body.addColorStop(.7, 'rgba(6,10,22,.7)'); body.addColorStop(1, 'rgba(10,30,50,.55)');
      ctx.fillStyle = body; ctx.fillRect(-1.1, -1.1, 2.2, 2.2);
      // --- ribbons
      const K = Math.max(22, Math.min(64, Math.round(R * .9))), lw = Math.max(.55 / R, .0065);
      for (let ri = 0; ri < RIB.length; ri++) {
        const rb = RIB[ri], [sx, sy, ax, ay, w, ph] = rb.s;
        const S = [sx + ax * Math.sin(T * .5 * w + ph + ri) * amp * .8, sy + ay * Math.cos(T * .42 * w + ri * 1.9) * amp * .8];
        const A = curve(S, rb.A, T + ri * 1.3, amp), B = curve(S, rb.B, T + ri * 1.3, amp), col = rb.c;
        ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${rb.f * (.8 + .5 * lvS)})`;
        ctx.beginPath(); ctx.moveTo(S[0], S[1]); ctx.bezierCurveTo(A[1][0], A[1][1], A[2][0], A[2][1], A[0][0], A[0][1]);
        ctx.lineTo(B[0][0], B[0][1]); ctx.bezierCurveTo(B[2][0], B[2][1], B[1][0], B[1][1], S[0], S[1]); ctx.fill();
        ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = lw;
        for (let i = 0; i <= K; i++) {
          const u = i / K, m = (a, b) => a + (b - a) * u; ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${(.16 + .26 * Math.pow(Math.abs(u - .5) * 2, 1.5)) * (.85 + .6 * lvS)})`;
          ctx.beginPath(); ctx.moveTo(S[0], S[1]);
          ctx.bezierCurveTo(m(A[1][0], B[1][0]), m(A[1][1], B[1][1]), m(A[2][0], B[2][0]), m(A[2][1], B[2][1]), m(A[0][0], B[0][0]), m(A[0][1], B[0][1])); ctx.stroke();
        }
        const g = ctx.createRadialGradient(S[0], S[1], 0, S[0], S[1], .09); g.addColorStop(0, `rgba(255,245,250,${.7 + .25 * lvS})`); g.addColorStop(1, 'rgba(255,240,250,0)');   // the bright tip
        ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(S[0] - .12, S[1] - .12, .24, .24);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.restore();
      // --- glass rim: magenta on one side, teal on the other
      const rim = ctx.createConicGradient(-2.4 + T * .06, 0, 0);
      [[0, 'rgba(210,45,115,.85)'], [.18, 'rgba(120,30,90,.45)'], [.36, 'rgba(30,70,110,.35)'], [.55, 'rgba(40,175,195,.75)'], [.72, 'rgba(25,80,120,.4)'], [.88, 'rgba(180,40,110,.6)'], [1, 'rgba(210,45,115,.85)']].forEach(([o, c]) => rim.addColorStop(o, c));
      ctx.lineWidth = .045; ctx.strokeStyle = rim; ctx.shadowColor = 'rgba(200,60,140,.55)'; ctx.shadowBlur = 10 * dpr; ctx.beginPath(); ctx.arc(0, 0, .975, 0, TAU); ctx.stroke(); ctx.shadowBlur = 0;
      ctx.lineWidth = .012; ctx.strokeStyle = 'rgba(190,230,255,.28)'; ctx.beginPath(); ctx.arc(0, 0, .95, 0, TAU); ctx.stroke();
      const hl = ctx.createLinearGradient(-.6, -.9, .2, -.2); hl.addColorStop(0, 'rgba(255,255,255,.22)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.lineWidth = .03; ctx.strokeStyle = hl; ctx.beginPath(); ctx.arc(0, 0, .9, 3.7, 4.6); ctx.stroke();
    }
    function run(on) { running = !!on; if (running && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } if (!running && raf) { cancelAnimationFrame(raf); raf = 0; } }
    fit(); window.addEventListener('resize', fit); new ResizeObserver(fit).observe(orbEl); run(true);
    return {
      run, fit,
      state(s) { st = s; orbEl.classList.remove('thinking', 'speaking', 'off', 'listening', 'idle'); orbEl.classList.add(s); cv.style.filter = s === 'off' ? 'grayscale(1) brightness(.55)' : ''; document.body.classList.toggle('off', s === 'off'); },
      level(v) { lvRaw = Math.min(1, v * 6); lvStamp = performance.now(); },
      say(me, t) {
        clearTimeout(tm); bubEl.classList.remove('hide'); bubEl.innerHTML = '';
        const a = document.createElement('div'); a.className = 'me'; a.textContent = me || ''; bubEl.append(a);
        const d = document.createElement('div'); d.className = 't'; d.textContent = t || ''; bubEl.append(d);
        return x => { d.textContent = x; bubEl.scrollTop = bubEl.scrollHeight; };
      },
      hideBubble() { bubEl.classList.add('hide'); },
      ask(q, cb) {                                                      // "May I open WhatsApp?"  [Allow once] [Always allow] [Don't allow]
        clearTimeout(tm); bubEl.classList.remove('hide'); bubEl.innerHTML = '';
        const a = document.createElement('div'); a.className = 'me'; a.textContent = 'Permission'; const d = document.createElement('div'); d.className = 't'; d.textContent = 'May I ' + q.what + '?';
        const row = document.createElement('div'); row.className = 'btns';
        [['Allow once', 'once', ''], ['Always allow', 'always', 'pri'], ["Don't allow", 'no', 'no']].forEach(([l, v, c]) => { const b = document.createElement('button'); b.textContent = l; b.className = c; b.onclick = e => { e.stopPropagation(); cb(v); }; row.append(b); });
        const h = document.createElement('div'); h.className = 'hint'; h.textContent = 'or just say yes, always, or no'; bubEl.append(a, d, row, h);
      },
      applyCfg(c) { document.documentElement.style.setProperty('--osz', (OSZ[c.orbSize] || OSZ.small) + 'px'); if (c.accent) document.documentElement.style.setProperty('--acc', c.accent); bubEl.classList.toggle('light', c.theme === 'light'); setTimeout(fit, 0); }
    };
  }
  return { mount };
})();
