import { useEffect, useState } from 'react';

/** Loads each image once and returns { [src]: naturalWidth / naturalHeight }. */
export default function useImageRatios(srcs) {
  const [ratios, setRatios] = useState({});
  const key = (srcs || []).join('|');
  useEffect(() => {
    let alive = true;
    (srcs || []).forEach((src) => {
      if (!src) return;
      const im = new Image();
      im.onload = () => {
        if (alive && im.naturalWidth && im.naturalHeight) {
          setRatios((r) => (r[src] ? r : { ...r, [src]: im.naturalWidth / im.naturalHeight }));
        }
      };
      im.src = src;
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ratios;
}
