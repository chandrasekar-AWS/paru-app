import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, Menu, X } from 'lucide-react';
import Button from './Button';
import { NAV_ITEMS, slugOf, servicePath } from '../data/services';
import { useContent } from '../context/ContentContext';
import './SiteHeader.css';

/**
 * SiteHeader — sticky dark header on every page.
 * Desktop: logo · links (Services opens a four-column menu) · quote button.
 * Mobile: logo · menu button that opens a full-width panel.
 */
export default function SiteHeader({ activeHref = '/' }) {
  const { sessions } = useContent();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);      // services mega menu (desktop)
  const [mobileOpen, setMobileOpen] = useState(false);  // whole mobile panel
  const closeTimer = useRef(null);

  // Close everything whenever the page changes.
  useEffect(() => { setMenuOpen(false); setMobileOpen(false); }, [pathname]);

  // Escape closes menus; lock page scroll while the mobile panel is open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { setMenuOpen(false); setMobileOpen(false); } };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const open = () => { clearTimeout(closeTimer.current); setMenuOpen(true); };
  const closeSoon = () => { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setMenuOpen(false), 140); };

  const isActive = (href) => (href === '/' ? activeHref === '/' : activeHref.startsWith(href));

  return (
    <header className="site-header">
      <div className="container site-header__bar">
        <Link to="/" className="site-header__logo" aria-label="AD ZONEX — Home">
          <img src="/logo/logo.png" alt="AD ZONEX" width="160" height="43" />
        </Link>

        <nav className="site-nav" aria-label="Main">
          <ul>
            {NAV_ITEMS.map((item) =>
              item.isServiceMenu ? (
                <li key={item.href} className="site-nav__has-menu" onMouseEnter={open} onMouseLeave={closeSoon}>
                  <Link to={item.href} className={`site-nav__link${isActive(item.href) ? ' is-active' : ''}`}>{item.label}</Link>
                  <button
                    type="button" className="site-nav__chev" aria-label="Show services menu"
                    aria-expanded={menuOpen} aria-controls="services-menu"
                    onClick={() => setMenuOpen((v) => !v)}
                  >
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  {menuOpen && (
                    <div id="services-menu" className="mega" onMouseEnter={open} onMouseLeave={closeSoon}>
                      <div className="mega__grid">
                        {sessions.map((s) => (
                          <div key={s.id} className="mega__col">
                            <Link to={`/service#${s.id}`} className="mega__head">{s.label}</Link>
                            <ul>
                              {s.services.map((svc) => (
                                <li key={svc.name}><Link to={servicePath(slugOf(svc.name))}>{svc.name}</Link></li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              ) : (
                <li key={item.href}>
                  <Link to={item.href} className={`site-nav__link${isActive(item.href) ? ' is-active' : ''}`} aria-current={isActive(item.href) ? 'page' : undefined}>
                    {item.label}
                  </Link>
                </li>
              )
            )}
          </ul>
        </nav>

        <div className="site-header__cta">
          <Button to="/contact" variant="lime" size="sm">Get a free quote</Button>
        </div>

        <button
          type="button" className="site-header__toggle" aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen} aria-controls="mobile-panel" onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
        </button>
      </div>

      {mobileOpen && (
        <div id="mobile-panel" className="mobile-panel">
          <nav aria-label="Mobile">
            <ul>
              {NAV_ITEMS.map((item) => (
                <li key={item.href}><Link to={item.href} className={isActive(item.href) ? 'is-active' : ''}>{item.label}</Link></li>
              ))}
            </ul>
            <p className="mobile-panel__label">Services</p>
            <ul className="mobile-panel__sub">
              {sessions.map((s) => (<li key={s.id}><Link to={`/service#${s.id}`}>{s.label}</Link></li>))}
            </ul>
            <Button to="/contact" variant="lime" className="mobile-panel__cta">Get a free quote</Button>
          </nav>
        </div>
      )}
    </header>
  );
}
