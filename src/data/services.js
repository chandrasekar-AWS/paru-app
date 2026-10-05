/**
 * Central service/session data for AD ZONEX.
 * Every session on the homepage (Design / Print / Signage / Digital) is
 * driven entirely from this file — image count, indicator segments and
 * corner-button labels all derive from these arrays, nothing is hardcoded.
 */

export const SESSIONS = [
  {
    id: 'design',
    description:
      "Every good brand starts on screen. We design logos, brand identities, social media posts, brochures, flyers, business cards and sign layouts. Each design is shared with you for approval before anything goes to print or production.",
    label: 'Design',
    accentColor: '#22EE73',
    glowColor: '144 86% 54%',
    services: [
      {
        name: 'Logo Design',
        description:
          'We start with concept sketches based on your brand story, then develop 2–3 directions into refined vector marks. Every logo ships as a full kit — primary, icon-only and monochrome versions in SVG, PNG and print-ready EPS — along with a one-page usage guide covering spacing, minimum size and color codes.',
        images: [
          '/design/logo-design.jpeg',
          '/design/Social-media-post-design.jpeg',
          '/design/Flyer-and-brochures-Design.jpeg',
        ],
      },
      {
        name: 'Social Media Post Design',
        description:
          'Custom layouts for launches, sales and events — feed posts, Stories, Reels thumbnails and ad creatives — built around a clear visual hierarchy so the offer or date reads in under three seconds. Includes photo retouching or stock sourcing, on-brand typography, and files delivered in every platform size you need.',
        images: [
          '/design/Social-media-post-design.jpeg',
          '/design/logo-design.jpeg',
          '/design/Product-Design.jpeg',
        ],
      },
      {
        name: 'Product Design',
        description:
          'Packaging layouts, label artwork and product mockups that hold up on the shelf and in a product photo. We handle die-line setup for boxes and pouches, nutrition or ingredient panel formatting where needed, and deliver print-ready files matched to your packaging vendor\'s specs.',
        images: [
          '/design/Product-Design.jpeg',
          '/design/Business-cards-and-pamphlets-Design.jpeg',
          '/design/Acp-acrylic-led-sign-board-Design.jpeg',
        ],
      },
      {
        name: 'Flyer & Brochure Design',
        description:
          'Eye-catching flyers, bi-folds and multi-page brochures designed around a clear visual hierarchy — headline, offer or date reads in under three seconds. We handle photo retouching or stock sourcing, on-brand typography, and deliver print-ready files in A4, A5, DL or any custom size your printer needs.',
        images: [
          '/design/Flyer-and-brochures-Design.jpeg',
          '/design/Social-media-post-design.jpeg',
          '/design/logo-design.jpeg',
        ],
      },
      {
        name: 'Business Card & Pamphlet Design',
        description:
          'Business cards and folded pamphlets laid out for immediate clarity — logo, contact details and QR code on the card; headline, offer and call-to-action hierarchy on the pamphlet. Delivered print-ready in standard sizes or custom dimensions, matched to premium 300–350 GSM stock finishes.',
        images: [
          '/design/Business-cards-and-pamphlets-Design.jpeg',
          '/design/Flyer-and-brochures-Design.jpeg',
          '/design/Product-Design.jpeg',
        ],
      },
      {
        name: 'Flex & Vinyl Design',
        description:
          'Large-format flex and vinyl artwork sized for banners, hoardings, shop shutters and vehicle wraps — designed for impact at distance. We optimise images for large-format resolution, apply brand-correct colours calibrated for the printing process, and deliver files ready for the press.',
        images: [
          '/design/Flex-and-vinyl-Design.jpeg',
          '/design/Acp-acrylic-led-sign-board-Design.jpeg',
          '/design/logo-design.jpeg',
        ],
      },
      {
        name: 'ACP, Acrylic & LED Sign Board Design',
        description:
          'Sign board artwork for ACP panels, acrylic face boards and LED-backlit signs — designed for high-contrast readability at night and in direct sunlight. We supply print-ready and cut-ready files, sized to your fabricator\'s exact specifications for routed or direct-print output.',
        images: [
          '/design/Acp-acrylic-led-sign-board-Design.jpeg',
          '/design/Flex-and-vinyl-Design.jpeg',
          '/design/Business-cards-and-pamphlets-Design.jpeg',
        ],
      },
    ],
    nextId: 'print',
    nextLabel: 'Print',
  },
  {
    id: 'print',
    description:
      "From a single visiting card to large flex hoardings, we print on the right material for where your work will be used. Indoor or outdoor, small run or bulk order, every job is checked for colour and finish before delivery.",
    label: 'Print',
    accentColor: '#22EE73',
    glowColor: '144 86% 54%',
    services: [
      {
        name: 'Flex & Vinyl Printing',
        description:
          'Large-format flex and vinyl output for banners, hoardings, shop shutters and vehicle graphics, printed on weatherproof material rated for outdoor sun and rain exposure. We handle eyelet and hemming finishing on request and can print single banners or bulk runs for multi-location campaigns.',
        images: [
          '/print/flex-vinyl-printing.png',
          '/print/uv-eco-printing.png',
          '/print/business-card.png',
          '/print/pamphlets.png',
        ],
      },
      {
        name: 'UV & ECO Printing',
        description:
          'UV and eco-solvent printing for sharp detail and true color on acrylic, foam board, canvas, sticker vinyl and other rigid or flexible substrates. Ink is cured on the surface for scratch and fade resistance, making it a fit for signage inserts, wall art and product labels alike.',
        images: [
          '/print/uv-eco-printing.png',
          '/print/business-card.png',
          '/print/pamphlets.png',
          '/print/flex-vinyl-printing.png',
        ],
      },
      {
        name: 'Business Card Printing',
        description:
          'Business cards in matte, glossy, textured or spot-UV finishes, printed on premium 300–350 GSM stock. We lay out your logo, contact details and QR code for a clean read at a glance, and can turn around small or bulk print runs within a few working days.',
        images: [
          '/print/business-card.png',
          '/print/pamphlets.png',
          '/print/flex-vinyl-printing.png',
          '/print/uv-eco-printing.png',
        ],
      },
      {
        name: 'Pamphlet Printing',
        description:
          'Single or multi-fold pamphlets and flyers designed to lead the eye from headline to offer to call-to-action, then printed clean at any volume from a short run to bulk distribution. Available in standard sizes or custom dimensions to match your campaign.',
        images: [
          '/print/pamphlets.png',
          '/print/flex-vinyl-printing.png',
          '/print/uv-eco-printing.png',
          '/print/business-card.png',
        ],
      },
      {
        name: 'Standee Printing',
        description:
          'Roll-up and rigid X-frame standees for events, retail counters and exhibition booths, printed on tear-resistant flex with a carry bag included for roll-up versions. Set-up takes under a minute and the same stand can be re-skinned with new artwork for future campaigns.',
        images: [
          '/print/flex-vinyl-printing.png',
          '/print/uv-eco-printing.png',
          '/print/business-card.png',
          '/print/pamphlets.png',
        ],
      },
      {
        name: 'Glow Signboard Printing',
        description:
          'LED-backlit glow sign boards printed with UV-cured inks on acrylic face panels, keeping your brand visible after dark. We handle the print panel for flat or box-type sign frames, and can deliver in bulk for multi-branch installations.',
        images: [
          '/print/uv-eco-printing.png',
          '/print/business-card.png',
          '/print/pamphlets.png',
          '/print/flex-vinyl-printing.png',
        ],
      },
      {
        name: 'Promotional Umbrella Printing',
        description:
          'Custom-printed promotional umbrellas for events, exhibitions and giveaways, with your logo and brand colours printed cleanly on all panels. Available in standard or golf sizes, supplied ready to distribute.',
        images: [
          '/print/business-card.png',
          '/print/pamphlets.png',
          '/print/flex-vinyl-printing.png',
          '/print/uv-eco-printing.png',
        ],
      },
      {
        name: 'Canopy Printing',
        description:
          'Branded canopies and awning prints for outdoor stalls, entrances and event booths, printed on weatherproof material to stay vibrant in sun and rain. Custom sizes available; eyelets and valance printing included on request.',
        images: [
          '/print/pamphlets.png',
          '/print/flex-vinyl-printing.png',
          '/print/uv-eco-printing.png',
          '/print/business-card.png',
        ],
      },
    ],
    nextId: 'signage',
    nextLabel: 'Signage',
  },
  {
    id: 'signage',
    description:
      "We design, fabricate and install signboards that make your business easy to find, from ACP boards and gold letters to LED displays and full building elevations. Our team measures the site and fixes everything in place.",
    label: 'Signage',
    accentColor: '#22EE73',
    glowColor: '144 86% 54%',
    services: [
      {
        name: 'Safety Signages',
        description:
          'Compliant safety and regulatory signage for workplaces, factories and public spaces — fire exit, hazard, no-entry and directional signs produced in rigid ACP, acrylic or self-adhesive vinyl. Sizes follow standard safety norms; we supply in single pieces or complete site kits.',
        images: [
          '/signage/standee.png',
          '/signage/acp-sign-board.png',
          '/signage/glow-sign-board.png',
        ],
      },
      {
        name: 'ACP Sign Board',
        description:
          'Aluminium composite panel (ACP) sign boards fabricated for storefronts, office facades and outdoor branding, with routed or 3D lettering and UV-printed graphics. The panels resist warping and fading in direct sun, and we handle mounting hardware for wall or pole installation.',
        images: [
          '/signage/acp-sign-board.png',
          '/signage/glow-sign-board.png',
          '/signage/standee.png',
        ],
      },
      {
        name: 'ACP Trim Cap / Acrylic Side Letter',
        description:
          'Precision-fabricated trim-cap letters using an ACP face bonded to a returns frame, or full acrylic side-lit letters for a premium branded look. Both types can be front-lit, halo-lit or non-illuminated, and are finished with powder-coat or vinyl wrap to match your brand palette.',
        images: [
          '/signage/glow-sign-board.png',
          '/signage/standee.png',
          '/signage/acp-sign-board.png',
        ],
      },
      {
        name: 'Titanium Gold Letter',
        description:
          'High-gloss titanium-finish gold letters fabricated from stainless steel or brass-coated steel, giving a premium metallic sheen to reception walls, shop entrances and office lobbies. Available in flat, raised or backlit variants to match your brand identity.',
        images: [
          '/signage/standee.png',
          '/signage/acp-sign-board.png',
          '/signage/glow-sign-board.png',
        ],
      },
      {
        name: 'SS Gold Letter',
        description:
          'Stainless steel gold letters with a brushed or mirror finish, fabricated for storefronts, hotel lobbies and corporate receptions where a lasting impression matters. We cut, bend and finish each letter in-house and deliver ready to mount.',
        images: [
          '/signage/acp-sign-board.png',
          '/signage/glow-sign-board.png',
          '/signage/standee.png',
        ],
      },
      {
        name: '2D Signage Board',
        description:
          'Flat 2D sign boards in ACP, foam board or acrylic for indoor and outdoor applications — shop identification panels, directory boards, wall-mounted nameplates and hoarding inserts. Printed with UV-cured inks for sharp detail and long-term colour stability.',
        images: [
          '/signage/glow-sign-board.png',
          '/signage/standee.png',
          '/signage/acp-sign-board.png',
        ],
      },
      {
        name: 'SS Sheet Etching Signs',
        description:
          'Stainless steel sheet etching for premium nameplates, door signs, plaques and decorative wall panels. Each design is chemically etched into the steel surface for a crisp, permanent result that won\'t fade or peel, suitable for indoor and sheltered outdoor use.',
        images: [
          '/signage/standee.png',
          '/signage/acp-sign-board.png',
          '/signage/glow-sign-board.png',
        ],
      },
      {
        name: 'Pylon ACP Boards',
        description:
          'Free-standing pylon or monolith signs built on a steel structure clad with ACP panels, used for petrol stations, commercial complexes, hospitals and multi-tenant buildings. We design, fabricate and install with foundation bolting and cable management included.',
        images: [
          '/signage/acp-sign-board.png',
          '/signage/glow-sign-board.png',
          '/signage/standee.png',
        ],
      },
      {
        name: 'Scoring LED Display Board',
        description:
          'Programmable LED score and message display boards for sports venues, auditoriums, retail counters and event stages. Supports live score updates, scrolling text and timed messages via a wireless or wired controller, with weatherproof housing available for outdoor installation.',
        images: [
          '/signage/glow-sign-board.png',
          '/signage/standee.png',
          '/signage/acp-sign-board.png',
        ],
      },
      {
        name: 'ACP Elevation',
        description:
          'Full building elevation cladding using aluminium composite panels for a modern, uniform exterior look. We survey the facade, supply panels in your brand colours or finish, and manage the installation including corner trims and window returns for a clean, weatherproof result.',
        images: [
          '/signage/standee.png',
          '/signage/acp-sign-board.png',
          '/signage/glow-sign-board.png',
        ],
      },
    ],
    nextId: 'digital',
    nextLabel: 'Digital',
  },
  {
    id: 'digital',
    description:
      "Take your brand online with digital marketing, website design and development, and ongoing branding and tech support, all matched to the same look as your print and signage.",
    label: 'Digital',
    accentColor: '#22EE73',
    glowColor: '144 86% 54%',
    services: [
      {
        name: 'Digital Marketing',
        description:
          'End-to-end digital marketing to get your brand found and followed — from ranking on search to reaching people directly on WhatsApp.',
        items: [
          'Search Engine Optimisation',
          'Search Engine Marketing',
          'Social Media Marketing',
          'WhatsApp Marketing',
        ],
        images: [
          '/digital/social-media-ads.png',
          '/digital/video-editing.png',
        ],
      },
      {
        name: 'Web Design & Development',
        description:
          'Websites and web apps built to look right and work right, from a simple brochure site to a full online store.',
        items: [
          'Website Design',
          'Web Development',
          'E-commerce',
          'Web Application',
        ],
        images: [
          '/digital/video-editing.png',
          '/digital/social-media-ads.png',
        ],
      },
      {
        name: 'Branding',
        description:
          'Video and photo content that carries your brand across every platform, shot, edited and managed by one team.',
        items: [
          'Video editing',
          'Photo editing',
          'Corporate video shoot',
          'Platform handling',
        ],
        images: [
          '/digital/video-editing.png',
          '/digital/social-media-ads.png',
        ],
      },
      {
        name: 'Tech Support',
        description:
          'The behind-the-scenes work that keeps a website and its business tools running — domain, hosting, mail, security and payments, all handled for you.',
        items: [
          'Domain Registration',
          'Hosting & Maintenance',
          'Email Solution',
          'Website AMC',
          'SSL Certification',
          'Payment Integration',
          'Server Support',
        ],
        images: [
          '/digital/social-media-ads.png',
          '/digital/video-editing.png',
        ],
      },
    ],
    nextId: 'design',
    nextLabel: 'Design',
  },
];

export const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'About us', href: '/about' },
  { label: 'Service', href: '/service', isServiceMenu: true },
  { label: 'Gallery', href: '/gallery' },
  { label: 'Contact', href: '/contact' },
];

// ---------------------------------------------------------------------------
// Homepage / About copy. One source of truth so the numbers never disagree
// between pages. Update these with your latest real figures.
// ---------------------------------------------------------------------------

export const PHILOSOPHY = {
  eyebrow: 'About AD ZONEX',
  heading: 'A brand is built in the details',
  body: "A strong brand isn't just a logo. It's the signboard above your door, the banner on the road, the card in your customer's hand. We design and make every one of them for businesses across Coimbatore, so your brand looks the same wherever people find it.",
};

export const STATS = [
  { value: '16+', label: 'Years in business' },
  { value: '2500+', label: 'Projects completed' },
  { value: '1800+', label: 'Business clients' },
];

// Quotes that still read as template text are hidden automatically (see Testimonials).
// Add real client quotes in the admin panel or here: { quote, name, role }.
export const TESTIMONIALS = [
  { quote: 'Excellent service and professional quality work. Highly recommended!', name: 'Adzonea', role: 'Business Owner' },
];

export const SOCIALS = [
  { name: 'Instagram', url: 'https://www.instagram.com/ad_zonex/', glowColor: '330 75% 55%' },
  { name: 'WhatsApp', url: 'https://wa.me/919342307860', glowColor: '142 70% 49%' },
  { name: 'Facebook', url: 'https://www.facebook.com/profile.php?id=61593101445101', glowColor: '214 89% 52%' },
  { name: 'YouTube', url: 'https://youtube.com', glowColor: '0 100% 50%' },
  { name: 'LinkedIn', url: 'https://linkedin.com', glowColor: '210 90% 40%' },
  { name: 'X', url: 'https://x.com', glowColor: '0 0% 100%' },
];

// Where enquiries go. Design services -> design mailbox only; everything else -> main mailbox only.
export const ENQUIRY_MAIL = { design: 'designadzonex@gmail.com', other: 'adzonecbe@outlook.com' };

export const CONTACT_INFO = {
  phone: '+91 93423 07860',
  whatsapp: 'https://wa.me/919342307860',
  email: 'adzonecbe@outlook.com',
};

// ---------------------------------------------------------------------------
// Shared helpers — ONE source of truth for the Services page, the individual
// service pages and the Contact page. A service's URL slug is derived from its
// title, so renaming a service (here or in the admin panel) never breaks links.
// ---------------------------------------------------------------------------
export function slugOf(name) {
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Flat list of every service: { slug, category, categoryLabel, title, description, images, items }. */
export function flattenServices(sessions) {
  return sessions.flatMap((s) =>
    s.services.map((sv) => ({
      slug: slugOf(sv.name),
      category: s.id,
      categoryLabel: s.label,
      title: sv.name,
      description: sv.description || '',
      images: sv.images ?? (sv.image ? [sv.image] : []),
      items: sv.items ?? [],
      accentColor: s.accentColor,
      glowColor: s.glowColor,
    }))
  );
}

export const findService = (sessions, slug) =>
  flattenServices(sessions).find((x) => x.slug === slugOf(slug || ''));

export const servicePath = (slug) => `/services/${slug}`;
export const contactPath = (slug) => `/contact?service=${encodeURIComponent(slug)}`;
export const worksPath = (category, title) =>
  `/gallery?category=${encodeURIComponent(category)}${title ? `&title=${encodeURIComponent(title)}` : ''}`;
