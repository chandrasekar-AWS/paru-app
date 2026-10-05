import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import SiteHeader from '../components/SiteHeader';
import Footer from '../components/Footer';
import Button from '../components/Button';
import ServiceSlider from '../components/ServiceSlider';
import NotFoundPage from './NotFoundPage';
import { useContent } from '../context/ContentContext';
import { findService, contactPath, worksPath } from '../data/services';
import './ServicePage.css';

/** /services/:slug — one page per individual service (same template for all). */
export default function ServicePage() {
  const { slug } = useParams();
  const { sessions } = useContent();
  const svc = useMemo(() => findService(sessions, slug), [sessions, slug]);

  useEffect(() => {
    document.title = svc ? `${svc.title} | AD ZONEX` : 'Page not found | AD ZONEX';
  }, [svc]);

  if (!svc) return <NotFoundPage />;

  return (
    <div className="page sp-page">
      <SiteHeader activeHref="/service" />
      <main className="section sp-main">
        <div className="container">
          <Link to={`/service#${svc.category}`} className="sp-back"><ArrowLeft size={16} aria-hidden="true" /> All {svc.categoryLabel.toLowerCase()} services</Link>
          <div className="sp-grid">
            <div className="sp-media">
              <ServiceSlider images={svc.images} alt={svc.title} />
            </div>
            <div className="sp-text">
              <span className="eyebrow">{svc.categoryLabel}</span>
              <h1>{svc.title}</h1>
              {svc.description && <p className="sp-desc">{svc.description}</p>}
              {svc.items.length > 0 && (
                <>
                  <h2 className="sp-sub">What's included</h2>
                  <ul className="sp-items">{svc.items.map((it) => <li key={it}>{it}</li>)}</ul>
                </>
              )}
              <div className="sp-actions">
                <Button to={contactPath(svc.slug)} variant="primary">Enquire about this</Button>
                <Button to={worksPath(svc.category)} variant="outline">See our work</Button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
