import { loadEnv } from 'vite';

// Runs the /api/* functions inside `npm run dev`, so admin login, uploads and
// the contact form work locally without Vercel. Data is kept in .local-data/
const ROUTES = ['login', 'content', 'media', 'enquiries', 'contact', 'backups'];
// Note: backups-scheduled.mjs has no HTTP path (Vercel Cron only), so it's not proxied here.

export default function adzoneApi() {
  return {
    name: 'adzone-local-api',
    configureServer(server) {
      process.env.ADZONE_LOCAL = '1';
      const env = loadEnv(server.config.mode, server.config.root, '');
      for (const [k, v] of Object.entries(env)) if (!(k in process.env)) process.env[k] = v;

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        const name = ROUTES.find((r) => url.pathname === `/api/${r}` || url.pathname.startsWith(`/api/${r}/`));
        if (!name) return next();
        try {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (['host', 'connection', 'content-length', 'transfer-encoding'].includes(k)) continue;
            headers.set(k, Array.isArray(v) ? v.join(',') : String(v));
          }
          const init = { method: req.method, headers };
          if (!['GET', 'HEAD'].includes(req.method)) init.body = Buffer.concat(chunks);
          const mod = await server.ssrLoadModule(`/server/handlers/${name}.mjs`);
          const out = await mod.default(new Request(url.href, init), {});
          res.statusCode = out.status;
          out.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await out.arrayBuffer()));
        } catch (e) {
          console.error('[api]', e);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: `Server error: ${e.message}` }));
        }
      });
    },
  };
}
