import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Google Analytics 4. Does nothing unless VITE_GA_ID is set (see SETUP.md).
const GA_ID = import.meta.env.VITE_GA_ID;

export default function Analytics() {
  const { pathname } = useLocation();
  const loaded = useRef(false);

  useEffect(() => {
    if (!GA_ID || loaded.current) return;
    loaded.current = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { send_page_view: false });
  }, []);

  // One page-view per route change (this is a single-page app).
  useEffect(() => {
    if (GA_ID && window.gtag) window.gtag('event', 'page_view', { page_path: pathname });
  }, [pathname]);

  return null;
}
