import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import SiteHeader from '../components/SiteHeader';
import Footer from '../components/Footer';
import GalleryLightbox from '../components/GalleryLightbox';
import { useContent } from '../context/ContentContext';
import './GalleryPage.css';

export default function GalleryPage() {
  const { sessions: SESSIONS, gallery } = useContent();
  const CATEGORIES = useMemo(
    () => [{ id: 'all', label: 'All' }, ...SESSIONS.map((s) => ({ id: s.id, label: s.label, accent: s.accentColor }))],
    [SESSIONS]
  );
  const CATEGORY_IDS = useMemo(() => new Set(SESSIONS.map((s) => s.id)), [SESSIONS]);
  const [searchParams] = useSearchParams();
  const categoryParam = searchParams.get('category');
  const titleParam = searchParams.get('title');

  const [active, setActive] = useState(
    categoryParam && CATEGORY_IDS.has(categoryParam) ? categoryParam : 'all'
  );
  const [lightboxItem, setLightboxItem] = useState(null);
  const [query, setQuery] = useState('');

  const allItems = useMemo(
    () => gallery.map((g) => ({
      ...g,
      accent: SESSIONS.find((x) => x.id === g.category)?.accentColor,
    })).filter((it) => it.image),
    [gallery, SESSIONS]
  );

  // Deep link from a service page's "Projects" button: jump to that
  // category's tab and open the matching image straight away.
  useEffect(() => {
    if (!titleParam) return;
    const match = allItems.find(
      (it) => it.title === titleParam && (!categoryParam || it.category === categoryParam)
    );
    if (match) setLightboxItem(match);
    // Only run once on load — deliberately not re-running on allItems identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleParam, categoryParam]);

  const q = query.trim().toLowerCase();
  const items = allItems.filter((it) => {
    if (active !== 'all' && it.category !== active) return false;
    if (!q) return true;
    const catLabel = SESSIONS.find((x) => x.id === it.category)?.label ?? '';
    return `${it.title} ${catLabel}`.toLowerCase().includes(q);
  });

  return (
    <div className="page gallery-page">
      <SiteHeader activeHref="/gallery" />

      <main>
        <section className="page-hero">
          <div className="container gallery-hero">
            <div>
              <span className="eyebrow">Gallery</span>
              <h1>Our work</h1>
              <p>A selection of design, print, signage and digital projects.</p>
            </div>
            <div className="gallery-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects" aria-label="Search gallery"
              />
              {query && (<button type="button" onClick={() => setQuery('')} aria-label="Clear search"><X size={16} /></button>)}
            </div>
          </div>
        </section>

        <section className="section section--tight">
          <div className="container">
            <div className="gallery-tabs" role="tablist" aria-label="Filter by category">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id} id={`gallery-tab-${c.id}`} role="tab" aria-selected={active === c.id}
                  className={`gallery-tab${active === c.id ? ' gallery-tab--active' : ''}`}
                  onClick={() => setActive(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {items.length === 0 ? (
              <p className="gallery-empty">No projects found{query ? ` for “${query}”` : ''}. Try another word or pick a different category.</p>
            ) : (
              <ul className="gallery-results">
                {items.map((it) => (
                  <li key={it.id ?? it.title}>
                    <button type="button" className="gallery-result" onClick={() => setLightboxItem(it)}>
                      <img src={it.image} alt={it.title} loading="lazy" />
                      <span>{it.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      <Footer />

      <GalleryLightbox
        item={lightboxItem}
        items={items}
        onSelect={setLightboxItem}
        onClose={() => setLightboxItem(null)}
      />
    </div>
  );
}
