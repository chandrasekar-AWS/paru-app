# AD ZONEX website

React + Vite. Run it with `npm install` then `npm run dev`. Content lives in `src/data/services.js` and the admin panel.

## Design system (`src/index.css`)
- Palette from the logo: ink `#12151a` (header, footer, hero) + brand lime `#afcc39`. Page background is warm off-white; text on light uses `--lime-deep` (5.5:1 contrast).
- Type: Poppins (headings) + Open Sans (body), loaded in `index.html`.
- 8px spacing scale, one container width, one button component (`components/Button.jsx`: `primary | lime | outline`).
- Motion is limited to short fades and hovers, and is switched off for `prefers-reduced-motion`.

## Before going live
- Replace the green placeholder tiles in `img/print`, `img/signage`, `img/digital` with photos of your real work (same filenames).
- The 7 images in `img/design` are stock-style pictures with other brand names in them. Real project photos will do more for the site than any layout change.
- Add real client quotes (the homepage hides the section until there are some).
