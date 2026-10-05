import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import useImageRatios from '../hooks/useImageRatios';
import './ServiceSlider.css';

const SWIPE_THRESHOLD = 40;

/**
 * ServiceSlider — photo slider used on the Services page, service pages and the
 * Contact intro. Arrows, dots, swipe/drag and arrow keys.
 */
export default function ServiceSlider({ images = [], alt = '', className = '' }) {
  const [idx, setIdx] = useState(0);
  const drag = useRef({ active: false, startX: 0, moved: 0 });
  const key = images.join('|');
  useEffect(() => { setIdx(0); }, [key]);

  const ratios = useImageRatios(images);
  const count = images.length;
  const cur = Math.min(idx, Math.max(0, count - 1));
  const prev = useCallback(() => setIdx((i) => (i - 1 + count) % count), [count]);
  const next = useCallback(() => setIdx((i) => (i + 1) % count), [count]);

  const down = (e) => {
    if (count < 2) return;
    drag.current = { active: true, startX: e.clientX, moved: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => { if (drag.current.active) drag.current.moved = e.clientX - drag.current.startX; };
  const up = () => {
    if (!drag.current.active) return;
    const { moved } = drag.current;
    drag.current.active = false;
    if (moved <= -SWIPE_THRESHOLD) next();
    else if (moved >= SWIPE_THRESHOLD) prev();
  };

  if (!count) return null;
  const ratio = Math.min(Math.max(ratios[images[cur]] || 3 / 2, 1), 1.6);

  return (
    <div className={`ssl ${className}`.trim()}>
      <div className="ssl-frame" style={{ aspectRatio: String(ratio) }}>
        <div
          className="ssl-panel"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
          role="group" tabIndex={0} aria-roledescription="carousel" aria-label={`${alt} images, use the arrow keys to browse`}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') prev(); else if (e.key === 'ArrowRight') next(); }}
        >
          {images.map((src, i) => (
            <img key={src + i} src={src} alt={i === cur ? `${alt}, image ${i + 1} of ${count}` : ''} loading={i === 0 ? 'eager' : 'lazy'}
              className={`ssl-img${i === cur ? ' ssl-img--active' : ''}`} draggable={false} />
          ))}
        </div>
        {count > 1 && (
          <>
            <button type="button" className="ssl-nav ssl-nav--prev" onClick={prev} aria-label="Previous image"><ChevronLeft size={20} aria-hidden="true" /></button>
            <button type="button" className="ssl-nav ssl-nav--next" onClick={next} aria-label="Next image"><ChevronRight size={20} aria-hidden="true" /></button>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="ssl-dots" role="tablist" aria-label="Image selector">
          {images.map((_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === cur} aria-label={`Image ${i + 1}`}
              className={`ssl-dot${i === cur ? ' ssl-dot--active' : ''}`} onClick={() => setIdx(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
