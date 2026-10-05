import SiteHeader from '../components/SiteHeader';
import Footer from '../components/Footer';
import Button from '../components/Button';
import './NotFoundPage.css';

/** Shown for any unmatched route (client-side 404). */
export default function NotFoundPage() {
  return (
    <div className="page notfound">
      <SiteHeader activeHref="" />
      <main className="container notfound__body">
        <p className="notfound__code" aria-hidden="true">404</p>
        <h1>We can't find that page</h1>
        <p>The link may be broken or the page may have moved. Try one of these instead.</p>
        <div className="notfound__actions">
          <Button to="/" variant="primary">Back to home</Button>
          <Button to="/gallery" variant="outline">See our work</Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}
