import { useEffect } from 'react';
import SiteHeader from '../components/SiteHeader';
import Footer from '../components/Footer';
import Button from '../components/Button';
import useReveal from '../hooks/useReveal';
import { CONTACT_INFO, STATS } from '../data/services';
import './AboutPage.css';

const WHY = [
  ['Everything in one place', 'Design, printing, signage and digital marketing are handled by one team, so your brand looks the same on every piece.'],
  ['We start with your business', 'Before we open any software, we ask what you sell, who buys it and where customers will see it.'],
  ['Design before you commit', 'You see the layout and approve it before anything goes to print or production.'],
  ['Marketing that matches your brand', 'Your social media, ads and website follow the same look as your print and signage, so customers see one brand online and offline.'],
  ['Right material for the job', 'We advise on flex, vinyl, ACP, acrylic, steel or LED based on your location, budget and how long you need it to last.'],
  ['Installation included', "We measure the site, fabricate the work and install it, so you don't have to coordinate with anyone else."],
  ['Clear quotes, on-time delivery', 'You get a written quote up front and a delivery date we stick to.'],
];

const STEPS = [
  ['Understand', 'We learn about your business, your customers and what you want the work to achieve.'],
  ['Design', 'We prepare layouts and share them for your feedback until you are happy.'],
  ['Produce', 'Your approved design goes to print or fabrication, using the material we agreed on.'],
  ['Install', 'Our team delivers and installs on site, and checks that everything is fixed properly.'],
  ['Promote', 'We take your brand online through social media, Google and digital campaigns, using the same look as your print and signage.'],
  ['Support', 'If something needs a touch-up or a change later, you know exactly who to call.'],
];

const VALUES = [
  ['Quality', 'We check every job before it leaves our shop, because small mistakes are the ones customers notice.'],
  ['Honesty', 'We tell you what a job will cost and how long it will take, even if that is not the answer you hoped for.'],
  ['Consistency', 'Your brand should look the same on a card, a banner, a board and an Instagram post. We make sure it does.'],
  ['Responsibility', 'If something goes wrong on our side, we fix it.'],
  ['Respect for your time', "We keep to deadlines, because your business can't wait for your signboard or your campaign."],
];

/** /about — About Us page. */
export default function AboutPage() {
  useEffect(() => { document.title = 'About Us | AD ZONEX'; }, []);
  useReveal();
  const tel = `tel:${CONTACT_INFO.phone.replace(/\s+/g, '')}`;

  return (
    <div className="page about">
      <SiteHeader activeHref="/about" />

      <main>
        <section className="page-hero">
          <div className="container">
            <span className="eyebrow">About us</span>
            <h1>Design that gets built, printed, installed and promoted</h1>
            <p>
              AD ZONEX is a graphic design, printing, signage and digital marketing studio in Coimbatore. For over 16
              years we have worked with shops, clinics, schools, showrooms and growing businesses to give them a look
              that is clear, consistent and easy to recognise. We handle the design on screen, the finished work on the
              street and the marketing online, so what you approve is what your customers see.
            </p>
          </div>
        </section>

        <section className="about-numbers">
          <div className="container">
            <ul>
              {STATS.map((s) => (<li key={s.label}><strong>{s.value}</strong><span>{s.label}</span></li>))}
            </ul>
          </div>
        </section>

        <section className="section">
          <div className="container about-founder">
            <h2 className="reveal">A brand is what people see every day</h2>
            <div className="about-founder__text reveal">
              <p>Most businesses don't lose customers because their product is weak. They lose them because nobody notices the shop & businesses, or the signboard says one thing while the visiting card and the Instagram page say another.</p>
              <p>I started AD ZONEX to fix that. I wanted one place where a business owner could get the logo, the flex, the board, the social media posts and the digital marketing done properly, without running between different vendors and explaining the same thing again and again.</p>
              <p>Every job we take, whether it is a small visiting card, a full shopfront or an online campaign, gets the same attention. If it carries your name, it carries ours too.</p>
              <p className="about-founder__sign"><strong>Mrs. Nafeeza Basha</strong><span>Founder, AD ZONEX</span></p>
            </div>
          </div>
        </section>

        <section className="section section--white">
          <div className="container about-duo">
            <article className="reveal">
              <span className="eyebrow">Our mission</span>
              <p>To give businesses a professional, consistent brand identity at fair prices, delivered by a team that handles design, printing, installation and digital marketing from start to finish.</p>
            </article>
            <article className="reveal">
              <span className="eyebrow">Our vision</span>
              <p>To become the first name business owners in Coimbatore think of when they need their brand designed, put in front of customers and promoted online.</p>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="section-head reveal"><span className="eyebrow">Why AD ZONEX</span><h2>What you get when you work with us</h2></div>
            <div className="about-grid about-grid--3">
              {WHY.map(([t, d]) => (<article className="about-card reveal" key={t}><h3>{t}</h3><p>{d}</p></article>))}
            </div>
          </div>
        </section>

        <section className="section section--ink">
          <div className="container">
            <div className="section-head reveal"><span className="eyebrow">How we work</span><h2>Six steps, one point of contact</h2></div>
            <ol className="about-steps">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="reveal"><span>{String(i + 1).padStart(2, '0')}</span><h3>{t}</h3><p>{d}</p></li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <div className="section-head reveal"><span className="eyebrow">Our values</span><h2>How we run the shop</h2></div>
            <div className="about-grid about-grid--values">
              {VALUES.map(([t, d]) => (<article className="about-card reveal" key={t}><h3>{t}</h3><p>{d}</p></article>))}
            </div>
          </div>
        </section>

        <section className="section section--white">
          <div className="container about-closing reveal">
            <h2>Let's build your brand</h2>
            <p>
              Whether you are opening a new shop, refreshing an old look or planning a full branding and marketing
              project, tell us what you have in mind. We will visit, advise and give you a clear quote.
            </p>
            <div className="about-closing__actions">
              <Button to="/contact" variant="primary">Get a free quote</Button>
              <Button href={tel} variant="outline">Call {CONTACT_INFO.phone}</Button>
            </div>
            <p className="about-closing__mail">Or write to <a href={`mailto:${CONTACT_INFO.email}`}>{CONTACT_INFO.email}</a></p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
