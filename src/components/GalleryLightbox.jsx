import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import './GalleryLightbox.css';

const keyOf = (it) => it?.id ?? it?.image;
const SWIPE_PX = 60;      // drag distance that switches the image
const SWIPE_SPEED = 0.45; // px/ms — a quick flick also switches

/**
 * GalleryLightbox — shows the clicked image full screen (no caption).
 * Browse with the Previous/Next buttons, the arrow keys, or by holding the
 * image and dragging/swiping left or right. Close: X button or Escape.
 */
export default function GalleryLightbox({ item, items = null, onSelect, onClose }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dir, setDir] = useState(0); // direction of the last switch, for the slide-in
  const drag = useRef({ active: false, id: null, startX: 0, startY: 0, t0: 0, locked: false });

  const index = item && items ? items.findIndex((it) => keyOf(it) === keyOf(item)) : -1;
  const canNavigate = !!onSelect && !!items && items.length > 1 && index >= 0;

  const go = useCallback((d) => {
    if (!canNavigate) return;
    setDir(d);
    onSelect(items[(index + d + items.length) % items.length]);
  }, [canNavigate, items, index, onSelect]);

  // Keyboard + body scroll lock
  useEffect(() => {
    if (!item) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [item, onClose, go]);

  // Preload the neighbours so switching feels instant.
  useEffect(() => {
    if (!canNavigate) return;
    [-1, 1].forEach((d) => {
      const n = items[(index + d + items.length) % items.length];
      if (n?.image) { const im = new Image(); im.src = n.image; }
    });
  }, [canNavigate, items, index]);

  useEffect(() => { setDx(0); }, [item]);

  const onDown = (e) => {
    if (!canNavigate || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { active: true, id: e.pointerId, startX: e.clientX, startY: e.clientY, t0: performance.now(), locked: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.id) return;
    const mx = e.clientX - d.startX;
    // Ignore mostly-vertical gestures
    if (!d.locked && Math.abs(e.clientY - d.startY) > Math.abs(mx) && Math.abs(e.clientY - d.startY) > 10) {
      d.active = false; setDragging(false); setDx(0); return;
    }
    d.locked = true;
    setDx(mx);
  };
  const finish = (e) => {
    const d = drag.current;
    if (!d.active || (e && e.pointerId !== d.id)) return;
    d.active = false;
    setDragging(false);
    const moved = (e?.clientX ?? d.startX) - d.startX;
    const speed = Math.abs(moved) / Math.max(1, performance.now() - d.t0);
    setDx(0);
    if (Math.abs(moved) >= SWIPE_PX || (speed > SWIPE_SPEED && Math.abs(moved) > 20)) go(moved < 0 ? 1 : -1);
  };

  if (!item) return null;

  return (
    <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label={item.title}>
      <button type="button" className="gallery-lightbox-close" onClick={onClose} aria-label="Close">
        <X size={22} strokeWidth={2.4} />
      </button>

      {canNavigate && (
        <>
          <span className="gl-counter" aria-live="polite">{index + 1} / {items.length}</span>
          <button type="button" className="gl-nav gl-nav--prev" onClick={() => go(-1)} aria-label="Previous image">
            <ChevronLeft size={26} strokeWidth={2.2} />
          </button>
          <button type="button" className="gl-nav gl-nav--next" onClick={() => go(1)} aria-label="Next image">
            <ChevronRight size={26} strokeWidth={2.2} />
          </button>
        </>
      )}

      <div
        className={`gl-stage${dragging ? ' gl-stage--dragging' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <img
          key={keyOf(item)}
          className={`gl-img${dir ? (dir > 0 ? ' gl-img--from-right' : ' gl-img--from-left') : ''}`}
          style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : undefined }}
          src={item.image}
          alt={item.title}
          draggable={false}
        />
      </div>
    </div>
  );
}
