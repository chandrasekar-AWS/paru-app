/* Sign-in with Supabase (Google, or email + password), written against Supabase's plain REST API so there is no SDK to ship.
 * Works in Electron's main process (require) and in the phone app (window.ParuAuth).
 * Only the sign-in itself uses Supabase. Chats, keys, settings and your voice stay on this device.
 *
 * deps: { fetch, config(): {url, anonKey}, load(): session|null, save(session), clear(), now(): ms }  */
(function (root) {
  const b64url = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const rand = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
  async function pkce() {
    const verifier = rand(48), digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    return { verifier, challenge: b64url(digest) };
  }
  const nice = (j, status) => {
    const m = String((j && (j.msg || j.error_description || j.message || j.error)) || '');
    if (/invalid login credentials|invalid_credentials/i.test(m + (j && j.error_code))) return 'Wrong email or password.';
    if (/email not confirmed/i.test(m)) return 'Please confirm your email first (check your inbox), then sign in.';
    if (/already registered|user_already_exists/i.test(m + (j && j.error_code))) return 'This email already has an account. Use Sign in.';
    if (/password should be at least|weak_password/i.test(m + (j && j.error_code))) return m.length ? m : 'Choose a longer password (at least 6 characters).';
    if (/rate limit|over_email_send_rate_limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
    if (/provider is not enabled|unsupported provider/i.test(m)) return 'Google sign-in is not turned on in Supabase yet (Authentication, Providers, Google).';
    return m || ('Sign-in failed (' + status + ').');
  };

  class Auth {
    constructor(d) { this.d = d; this.s = null; }
    cfg() { const c = this.d.config() || {}; return { url: String(c.url || '').replace(/\/$/, ''), key: String(c.anonKey || '') }; }
    configured() { const c = this.cfg(); return /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$|^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(c.url) && c.key.length > 20; }
    async _call(path, body, method = 'POST', bearer) {
      const c = this.cfg(); let r;
      try {
        r = await this.d.fetch(c.url + path, { method, headers: { apikey: c.key, 'Content-Type': 'application/json', ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
      } catch (e) { return { ok: false, network: true, error: 'Could not reach the sign-in service. Check your internet.' }; }
      let j = {}; try { j = await r.json(); } catch { }
      return r.ok ? { ok: true, j } : { ok: false, status: r.status, error: nice(j, r.status), j };
    }
    _session(j) {                                                      // Supabase token response -> what we keep
      const u = j.user || {}, md = u.user_metadata || {};
      this.s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(this.d.now() / 1000) + (j.expires_in || 3600),
        user: { id: u.id, email: u.email, name: md.full_name || md.name || (u.email || '').split('@')[0], avatar: md.avatar_url || md.picture || '', provider: (u.app_metadata || {}).provider || 'email' } };
      this.d.save(this.s); return this.s;
    }
    session() { if (!this.s) this.s = this.d.load(); return this.s; }
    state() { const s = this.session(); return { configured: this.configured(), signedIn: !!(s && s.refresh_token), user: s ? s.user : null }; }

    async signUp(email, password) {
      if (!this.configured()) return { ok: false, error: 'Sign-in is not set up yet.' };
      const e = String(email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: 'Enter a valid email address.' };
      if (String(password || '').length < 6) return { ok: false, error: 'Choose a password with at least 6 characters.' };
      const r = await this._call('/auth/v1/signup', { email: e, password });
      if (!r.ok) return r;
      if (r.j.access_token) { this._session(r.j); return { ok: true }; }
      return { ok: true, confirm: true };                              // Supabase sent a confirmation email first
    }
    async signIn(email, password) {
      if (!this.configured()) return { ok: false, error: 'Sign-in is not set up yet.' };
      const r = await this._call('/auth/v1/token?grant_type=password', { email: String(email || '').trim().toLowerCase(), password });
      if (!r.ok) return r; this._session(r.j); return { ok: true };
    }
    async googleStart(redirect) {                                      // -> {url, verifier}: open url in the browser, Google sends the person back to `redirect?code=...`
      const { verifier, challenge } = await pkce(), c = this.cfg();
      return { verifier, url: `${c.url}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=s256` };
    }
    async googleFinish(code, verifier) {
      const r = await this._call('/auth/v1/token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
      if (!r.ok) return r; this._session(r.j); return { ok: true };
    }
    /* Keep the session fresh. Offline? Stay signed in; only a refused refresh token signs you out. */
    async refresh(force) {
      const s = this.session(); if (!s || !this.configured()) return { ok: !!s };
      if (!force && s.expires_at - this.d.now() / 1000 > 120) return { ok: true };
      const r = await this._call('/auth/v1/token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      if (r.ok) { this._session(r.j); return { ok: true }; }
      if (r.network) return { ok: true, offline: true };
      if (r.status === 400 || r.status === 401 || r.status === 403) { this.s = null; this.d.clear(); return { ok: false, signedOut: true, error: 'Your sign-in expired. Please sign in again.' }; }
      return { ok: true };
    }
    async signOut() {
      const s = this.session(); this.s = null; this.d.clear();
      if (s && this.configured()) { try { await this._call('/auth/v1/logout', null, 'POST', s.access_token); } catch { } }
      return { ok: true };
    }
  }
  const api = { Auth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ParuAuth = api;
})(typeof window !== 'undefined' ? window : globalThis);
