import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { AsYouType, getCountries, getCountryCallingCode, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import './PhoneInput.css';

const DEFAULT = 'IN';
const names = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const nameOf = (iso) => { try { return names?.of(iso) || iso; } catch { return iso; } };

// India first, then every other country A–Z.
const COUNTRIES = (() => {
  const all = getCountries()
    .map((iso) => ({ iso, name: nameOf(iso), code: getCountryCallingCode(iso) }))
    .filter((c) => c.name && c.name !== c.iso);
  all.sort((a, b) => a.name.localeCompare(b.name));
  const india = all.find((c) => c.iso === DEFAULT);
  return [india, ...all.filter((c) => c.iso !== DEFAULT)];
})();

const Flag = ({ iso }) => (
  <img
    className="pi-flag"
    src={`https://flagcdn.com/w40/${iso.toLowerCase()}.png`}
    srcSet={`https://flagcdn.com/w80/${iso.toLowerCase()}.png 2x`}
    width="22" height="16" alt="" loading="lazy"
    onError={(e) => { e.currentTarget.style.display = 'none'; }}
  />
);

// Group digits the way that country writes them (India: 98765 43210).
const format = (iso, digits) => {
  if (!digits) return '';
  const cc = getCountryCallingCode(iso);
  const out = new AsYouType().input(`+${cc}${digits}`);
  const national = out.replace(/^\+\d+\s*/, '').trim();
  return national || digits;
};

// Several countries share one calling code (+1, +44, +7 …) → prefer the main one.
const MAIN = new Set(['US', 'GB', 'RU', 'IT', 'AU', 'NO', 'MA', 'FI', 'IN']);
const countryForCode = (code, detected, current) => {
  if (getCountryCallingCode(current) === code) return current;
  if (detected && MAIN.has(detected)) return detected;
  const same = COUNTRIES.filter((c) => c.code === code);
  return same.find((c) => MAIN.has(c.iso))?.iso || same[0]?.iso || detected || current;
};

/**
 * PhoneInput — country picker (all countries, +91 default) + number that is
 * grouped the way each country writes it (India: 98765 43210).
 * value / onChange use the full string, e.g. "+91 98765 43210" ('' when empty).
 */
export default function PhoneInput({ id, name = 'phone', value, onChange, invalid = false }) {
  const [country, setCountry] = useState(DEFAULT);
  const [digits, setDigits] = useState('');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef(null);
  const inputRef = useRef(null);
  const searchRef = useRef(null);
  const caret = useRef(null);

  const cc = getCountryCallingCode(country);
  const shown = useMemo(() => format(country, digits), [country, digits]);
  const current = COUNTRIES.find((c) => c.iso === country);

  const emit = (iso, d) => onChange(d ? `+${getCountryCallingCode(iso)} ${format(iso, d)}` : '');

  // Parent cleared the field (after a successful send) → reset ours.
  useEffect(() => { if (value === '' && digits !== '') setDigits(''); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the caret next to the digit being edited after spaces are re-inserted.
  useLayoutEffect(() => {
    if (caret.current === null || !inputRef.current) return;
    let seen = 0, pos = shown.length;
    if (caret.current === 0) pos = 0;
    else for (let i = 0; i < shown.length; i++) { if (/\d/.test(shown[i])) seen++; if (seen === caret.current) { pos = i + 1; break; } }
    inputRef.current.setSelectionRange(pos, pos);
    caret.current = null;
  }, [shown]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away, { passive: true });
    document.addEventListener('keydown', esc);
    searchRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const handleInput = (e) => {
    const raw = e.target.value;
    const before = raw.slice(0, e.target.selectionStart ?? raw.length);
    let iso = country;
    let next;
    if (raw.trim().startsWith('+')) {            // pasted "+44 7911 123456" → switch country
      const p = new AsYouType();
      p.input(raw);
      const code = p.getCallingCode();
      if (code) { iso = countryForCode(code, p.getCountry(), country); setCountry(iso); }
      next = p.getNationalNumber() || '';
    } else {
      next = raw.replace(/\D/g, '');
    }
    next = next.slice(0, 15 - getCountryCallingCode(iso).length);
    caret.current = raw.trim().startsWith('+') ? null : before.replace(/\D/g, '').length;
    setDigits(next);
    emit(iso, next);
  };

  const pick = (iso) => {
    setCountry(iso);
    setOpen(false);
    setQuery('');
    const d = digits.slice(0, 15 - getCountryCallingCode(iso).length);
    setDigits(d);
    emit(iso, d);
    inputRef.current?.focus();
  };

  const q = query.trim().toLowerCase().replace(/^\+/, '');
  const list = q ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.startsWith(q) || c.iso.toLowerCase() === q) : COUNTRIES;

  return (
    <div className={`pi${invalid ? ' pi--error' : ''}`} ref={box}>
      <button type="button" className="pi-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Country: ${current?.name}, +${cc}. Change country`}>
        <span className="pi-code">+{cc}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        className="pi-input"
        placeholder={country === DEFAULT ? '98765 43210' : 'Phone number'}
        value={shown}
        onChange={handleInput}
      />
      {open && (
        <div className="pi-menu">
          <label className="pi-search">
            <Search size={15} aria-hidden="true" />
            <input ref={searchRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search country or code" aria-label="Search country" />
          </label>
          <ul role="listbox" aria-label="Countries">
            {list.length === 0 && <li className="pi-none">No country found</li>}
            {list.map((c) => (
              <li key={c.iso} role="option" aria-selected={c.iso === country}>
                <button type="button" className={c.iso === country ? 'is-on' : ''} onClick={() => pick(c.iso)}>
                  <Flag iso={c.iso} />
                  <span className="pi-name">{c.name}</span>
                  <span className="pi-dial">+{c.code}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** true when the number looks plausible for its country (used before sending). */
export const isPhonePossible = (full) => {
  if (!full) return true;
  const p = parsePhoneNumberFromString(full);
  return !!p && p.isPossible();
};
