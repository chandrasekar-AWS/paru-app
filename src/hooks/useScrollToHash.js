import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * React Router doesn't scroll to `#anchor` targets on client-side
 * navigation the way a full page load does. This nudges the browser
 * to the matching element once the page (and its images) has settled.
 */
export function useScrollToHash() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return undefined;
    const id = decodeURIComponent(hash.slice(1));

    const timer = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);

    return () => clearTimeout(timer);
  }, [hash]);
}
