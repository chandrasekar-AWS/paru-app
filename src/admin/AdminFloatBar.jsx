import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck, LogOut } from 'lucide-react';
import { getToken, goToLogin, tokenExpiry } from '../utils/api';

/**
 * Shown on the PUBLIC pages only, and only while an admin session is active
 * (e.g. after clicking "View website" from the admin dashboard), so you can
 * always get back to Admin or log out without hunting for a hidden link.
 */
export default function AdminFloatBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const check = () => setVisible(!!getToken() && tokenExpiry() > Date.now());
    check();
    const id = setInterval(check, 15000);
    window.addEventListener('storage', check);
    return () => { clearInterval(id); window.removeEventListener('storage', check); };
  }, [pathname]);

  if (!visible || pathname.startsWith('/admin')) return null;

  return (
    <div className="adm-floatbar">
      <ShieldCheck size={16} color="#22EE73" />
      <span>Admin session active</span>
      <button type="button" className="adm-btn adm-btn--primary" onClick={() => navigate('/admin')}>Back to Admin</button>
      <button type="button" className="adm-btn" onClick={() => goToLogin(false)}><LogOut size={13} /> Log out</button>
    </div>
  );
}
