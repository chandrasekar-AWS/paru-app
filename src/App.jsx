import { useEffect } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import SiteHeader from './components/SiteHeader';
import Footer from './components/Footer';
import HomePage from './pages/HomePage';
import ServicePage from './pages/ServicePage';
import AboutPage from './pages/AboutPage';
import GalleryPage from './pages/GalleryPage';
import ContactPage from './pages/ContactPage';
import NotFoundPage from './pages/NotFoundPage';
import ServicesHubPage from './pages/ServicesHubPage';
import AdminLogin from './admin/AdminLogin';
import AdminDashboard from './admin/AdminDashboard';
import AdminFloatBar from './admin/AdminFloatBar';
import Analytics from './components/Analytics';

function ComingSoon({ title }) {
  return (
    <div className="page">
      <SiteHeader activeHref="" />
      <main className="container" style={{ padding: '6rem var(--gutter)', minHeight: '50vh' }}>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontWeight: 600 }}>{title}</h1>
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)' }}>This page is coming soon.</p>
        <p style={{ marginTop: '1.5rem' }}><Link to="/" className="link-arrow">Back to home</Link></p>
      </main>
      <Footer />
    </div>
  );
}

function ScrollToTop() {
  const { pathname, search, hash } = useLocation();
  useEffect(() => {
    // Every page change starts at the top (a #hash is handled by useScrollToHash).
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, search]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function App() {
  return (
    <>
    <ScrollToTop />
    <AdminFloatBar />
    <Analytics />
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/careers" element={<ComingSoon title="Careers & Team Profiles" />} />
      <Route path="/service" element={<ServicesHubPage />} />
      <Route path="/services" element={<Navigate to="/service" replace />} />
      <Route path="/services/:slug" element={<ServicePage />} />
      <Route path="/design" element={<Navigate to="/service#design" replace />} />
      <Route path="/print" element={<Navigate to="/service#print" replace />} />
      <Route path="/signage" element={<Navigate to="/service#signage" replace />} />
      <Route path="/digital" element={<Navigate to="/service#digital" replace />} />
      <Route path="/gallery" element={<GalleryPage />} />
      <Route path="/projects" element={<Navigate to="/gallery" replace />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </>
  );
}
