/* Orb + speech bubble component, shared by the desktop overlay and the phone app. */
const ParuOrb = (() => {
  const OSZ = { small: '64px', medium: '92px', large: '124px' };
  function mount(orbEl, bubEl) {
    orbEl.innerHTML = '<div class="p"></div><div class="p"></div><div class="p"></div><div class="p"></div><div class="core"></div>';
    let st = 'idle', lv = 0, tm = null;
    (function f() { orbEl.style.setProperty('--s', st === 'listening' ? 1 + Math.min(lv * 3, .25) : 1); requestAnimationFrame(f); })();
    const api = {
      state(s) { st = s; orbEl.classList.remove('thinking', 'speaking', 'off', 'listening', 'idle'); orbEl.classList.add(s); document.body.classList.remove('off'); if (s === 'off') document.body.classList.add('off'); },
      level(v) { lv = v; },
      say(me, t) {
        clearTimeout(tm); bubEl.classList.remove('hide'); bubEl.innerHTML = '';
        const a = document.createElement('div'); a.className = 'me'; a.textContent = me || ''; bubEl.append(a);
        const d = document.createElement('div'); d.className = 't'; d.textContent = t || ''; bubEl.append(d);
        return x => { d.textContent = x; bubEl.scrollTop = bubEl.scrollHeight; };
      },
      hideBubble() { bubEl.classList.add('hide'); },
      applyCfg(c) {
        document.documentElement.style.setProperty('--osz', OSZ[c.orbSize] || OSZ.small);
        if (c.accent) document.documentElement.style.setProperty('--acc', c.accent);
        bubEl.classList.toggle('light', c.theme === 'light');
      }
    };
    return api;
  }
  return { mount };
})();
