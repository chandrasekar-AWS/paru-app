import { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Globe, MessageCircle, Megaphone, PenTool, Phone, Printer, Signpost } from 'lucide-react';
import SiteHeader from '../components/SiteHeader';
import Footer from '../components/Footer';
import Button from '../components/Button';
import { useContent } from '../context/ContentContext';
import { useScrollToHash } from '../hooks/useScrollToHash';
import useReveal from '../hooks/useReveal';
import { PHILOSOPHY, STATS, CONTACT_INFO, slugOf, servicePath } from '../data/services';
import './HomePage.css';

const CATEGORY_ICON = { design: PenTool, print: Printer, signage: Signpost, digital: Globe };

const PROCESS = [
  ['Understand', 'We learn about your business, your customers and what the work needs to achieve.'],
  ['Design', 'We prepare layouts and share them with you. Nothing goes to print until you approve it.'],
  ['Produce', 'Your approved design goes to print or fabrication, in the material we agreed on.'],
  ['Install', 'Our team delivers and fixes everything on site, and checks that it is done properly.'],
];

// Template text that was never replaced shouldn't appear on a live website.
const isPlaceholder = (t) => /add your client|client name|lorem ipsum/i.test(`${t.quote} ${t.name}`);

export default function HomePage() {
  const { sessions, gallery, reviews } = useContent();
  useEffect(() => { document.title = 'AD ZONEX | Graphic Design, Printing & Signage in Coimbatore'; }, []);
  useScrollToHash();

  const work = useMemo(() => {
    const uploaded = gallery.filter((g) => g.image && !String(g.id ?? '').startsWith('default-'));
    const pool = uploaded.length >= 3 ? uploaded : gallery.filter((g) => g.image && g.category === 'design');
    return pool.slice(0, 6);
  }, [gallery]);

  const quotes = useMemo(() => reviews.filter((t) => t.quote && !isPlaceholder(t)).slice(0, 3), [reviews]);
  const tel = `tel:${CONTACT_INFO.phone.replace(/[\s()-]/g, '')}`;

  useReveal([sessions.length, work.length, quotes.length]);

  return (
    <div className="page home">
      <SiteHeader activeHref="/" />

      <main>
        {/* ---------- Hero ---------- */}
        <section className="hero dark">
          <div className="container hero__grid">
            <div className="hero__copy">
              <span className="eyebrow">Coimbatore · 16+ years in business</span>
              <h1>Graphic design, printing &amp; signage in Coimbatore</h1>
              <p className="hero__lead">
                From the first sketch to the final installation, one team looks after your logo, printed
                material, signboards and online marketing.
              </p>
              <div className="hero__actions">
                <Button to="/contact" variant="lime">Get a free quote</Button>
                <Button to="/gallery" variant="outline">See our work</Button>
              </div>
              <dl className="hero__stats">
                {STATS.map((s) => (
                  <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>
                ))}
              </dl>
            </div>

            <figure className="hero__media">
              <img
                src="/design/logo-design.jpeg" width="1600" height="893" fetchpriority="high"
                alt="Designer sketching logo concepts on a tablet beside colour swatches"
              />
              <figcaption>
                {sessions.map((s) => (<Link key={s.id} to={`/service#${s.id}`}>{s.label}</Link>))}
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ---------- Services ---------- */}
        <section className="section" id="services">
          <div className="container">
            <div className="section-head reveal">
              <span className="eyebrow">What we do</span>
              <h2>Four services, one team</h2>
              <p>Design, print, signage and digital work are all handled in-house, so you explain your business once.</p>
            </div>

            <div className="svc-grid">
              {sessions.map((s, i) => {
                const Icon = CATEGORY_ICON[s.id] ?? Megaphone;
                return (
                  <article key={s.id} className="svc-card reveal" style={{ transitionDelay: `${i * 60}ms` }}>
                    <span className="svc-card__icon" aria-hidden="true"><Icon size={24} /></span>
                    <h3><Link to={`/service#${s.id}`}>{s.label}</Link></h3>
                    <ul>
                      {s.services.slice(0, 5).map((sv) => (
                        <li key={sv.name}><Link to={servicePath(slugOf(sv.name))}>{sv.name}</Link></li>
                      ))}
                    </ul>
                    <Link to={`/service#${s.id}`} className="link-arrow">All {s.label.toLowerCase()} services <ArrowRight size={16} aria-hidden="true" /></Link>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------- About strip ---------- */}
        <section className="section section--white" id="about">
          <div className="container about-strip">
            <div className="reveal">
              <span className="eyebrow">{PHILOSOPHY.eyebrow}</span>
              <h2>{PHILOSOPHY.heading}</h2>
            </div>
            <div className="reveal">
              <p>{PHILOSOPHY.body}</p>
              <Button to="/about" variant="outline" className="about-strip__btn">More about us</Button>
            </div>
          </div>
        </section>

        {/* ---------- Process ---------- */}
        <section className="section">
          <div className="container">
            <div className="section-head reveal">
              <span className="eyebrow">How we work</span>
              <h2>From brief to installation</h2>
            </div>
            <ol className="steps">
              {PROCESS.map(([t, d], i) => (
                <li key={t} className="reveal" style={{ transitionDelay: `${i * 60}ms` }}>
                  <span className="steps__n">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Recent work ---------- */}
        {work.length > 0 && (
          <section className="section section--white">
            <div className="container">
              <div className="section-head section-head--row reveal">
                <div>
                  <span className="eyebrow">Our work</span>
                  <h2>Recent projects</h2>
                </div>
                <Link to="/gallery" className="link-arrow">View full gallery <ArrowUpRight size={16} aria-hidden="true" /></Link>
              </div>
              <ul className="work-grid">
                {work.map((w, i) => (
                  <li key={w.id ?? w.image} className="reveal" style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
                    <Link to={`/gallery?category=${w.category}&title=${encodeURIComponent(w.title)}`}>
                      <img src={w.image} alt={w.title} loading="lazy" width="1600" height="893" />
                      <span>{w.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* ---------- Testimonials (hidden until there are real quotes) ---------- */}
        {quotes.length > 0 && (
          <section className="section" id="testimonials">
            <div className="container">
              <div className="section-head reveal">
                <span className="eyebrow">Client feedback</span>
                <h2>What our clients say</h2>
              </div>
              <div className={`quotes quotes--${quotes.length}`}>
                {quotes.map((t, i) => (
                  <figure key={t.id ?? i} className="quote reveal">
                    <blockquote>{t.quote}</blockquote>
                    <figcaption><strong>{t.name}</strong>{t.role && <span>{t.role}</span>}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ---------- Closing CTA ---------- */}
        <section className="cta section--ink">
          <div className="container cta__inner">
            <div>
              <h2>Planning a new shop, signboard or campaign?</h2>
              <p>Tell us what you have in mind. We will visit, advise and send you a clear written quote.</p>
            </div>
            <div className="cta__actions">
              <Button to="/contact" variant="lime">Get a free quote</Button>
              <Button href={tel} variant="outline"><Phone size={18} aria-hidden="true" /> {CONTACT_INFO.phone}</Button>
              <Button href={CONTACT_INFO.whatsapp} variant="outline" target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> WhatsApp</Button>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
