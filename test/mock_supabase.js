/* A stand-in for Supabase Auth: the endpoints Paru uses, with the same status codes/messages for the common failures. PKCE is really checked. */
const http = require('http'), crypto = require('crypto');
module.exports = function start(port, opts = {}) {
  const users = {}, refresh = {}, codes = {}; let n = 0;
  const b64url = b => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const tok = (u, extra = {}) => { const rt = 'rt' + (++n); refresh[rt] = u.email; return { access_token: 'at' + n, refresh_token: rt, expires_in: opts.expiresIn || 3600, user: { id: 'id-' + u.email, email: u.email, user_metadata: u.meta || {}, app_metadata: { provider: u.provider || 'email' } }, ...extra }; };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); let body = ''; req.on('data', d => body += d); req.on('end', () => {
      const send = (c, o, h = {}) => { res.writeHead(c, { 'Content-Type': 'application/json', ...h }); res.end(o ? JSON.stringify(o) : ''); };
      if (url.pathname !== '/auth/v1/authorize' && req.headers.apikey !== 'anon-key-for-tests-0123456789') return send(401, { message: 'Invalid API key' });
      const j = body ? JSON.parse(body) : {};
      if (url.pathname === '/auth/v1/signup') {
        if (users[j.email]) return send(422, { error_code: 'user_already_exists', msg: 'User already registered' });
        if ((j.password || '').length < 6) return send(422, { error_code: 'weak_password', msg: 'Password should be at least 6 characters.' });
        users[j.email] = { email: j.email, password: j.password };
        return opts.confirm ? send(200, { id: 'id-' + j.email, email: j.email, confirmation_sent_at: 'now' }) : send(200, tok(users[j.email]));
      }
      if (url.pathname === '/auth/v1/token') {
        const g = url.searchParams.get('grant_type');
        if (g === 'password') { const u = users[j.email]; if (!u || u.password !== j.password) return send(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); return send(200, tok(u)); }
        if (g === 'refresh_token') { const e = refresh[j.refresh_token]; if (!e) return send(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' }); delete refresh[j.refresh_token]; return send(200, tok(users[e] || { email: e })); }
        if (g === 'pkce') { const c = codes[j.auth_code]; if (!c) return send(400, { error: 'invalid_grant', error_description: 'invalid flow state, no valid flow state found' });
          if (b64url(crypto.createHash('sha256').update(j.code_verifier).digest()) !== c) return send(400, { error: 'invalid_grant', error_description: 'code challenge does not match previously saved code verifier' });
          delete codes[j.auth_code]; return send(200, tok({ email: 'chandru@gmail.com', provider: 'google', meta: { full_name: 'Chandru S', avatar_url: 'https://x/y.png' } })); }
      }
      if (url.pathname === '/auth/v1/authorize') {
        if (opts.noGoogle) return send(400, { msg: 'Unsupported provider: provider is not enabled' });
        const code = 'code' + (++n); codes[code] = url.searchParams.get('code_challenge');
        res.writeHead(302, { Location: url.searchParams.get('redirect_to') + '?code=' + code }); return res.end();
      }
      if (url.pathname === '/auth/v1/logout') { opts.loggedOut = (opts.loggedOut || 0) + 1; return send(204); }
      send(404, { msg: 'not found' });
    });
  });
  srv.listen(port, '127.0.0.1'); srv.stop = () => { srv.closeAllConnections(); srv.close(); }; srv.opts = opts; srv.refreshTokens = refresh; return srv;
};
