import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SESSIONS as DEFAULT_SESSIONS, TESTIMONIALS } from '../data/services';

const Ctx = createContext(null);

const defaultGallery = () =>
  DEFAULT_SESSIONS.flatMap((s) =>
    s.services.map((svc, i) => ({
      id: `default-${s.id}-${i}`,
      image: svc.images?.[0] ?? svc.image,
      title: svc.name,
      category: s.id,
    }))
  ).filter((g) => g.image);

const defaultReviews = () => TESTIMONIALS.map((t, i) => ({ id: `default-${i}`, ...t }));

/**
 * Site content = built-in defaults (src/data/services.js) overlaid with whatever
 * the admin has saved (/api/content). Pages render instantly with defaults and
 * swap in the saved content as soon as it loads.
 */
export function ContentProvider({ children }) {
  const [remote, setRemote] = useState({ gallery: null, reviews: null, services: null });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/content', { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) setRemote(await r.json());
    } catch { /* offline / local dev without functions -> defaults */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => {
    const sessions = DEFAULT_SESSIONS.map((s) =>
      Array.isArray(remote.services?.[s.id]) ? { ...s, services: remote.services[s.id] } : s
    );
    return {
      sessions,
      gallery: Array.isArray(remote.gallery) ? remote.gallery : defaultGallery(),
      reviews: Array.isArray(remote.reviews) ? remote.reviews : defaultReviews(),
      refresh,
    };
  }, [remote, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useContent = () => useContext(Ctx);
