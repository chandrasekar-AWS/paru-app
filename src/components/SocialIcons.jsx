import './SocialIcons.css';

/**
 * Social icons — clean white OUTLINE icons (stroke = currentColor, so they
 * follow the button's text colour, white by default). No brand-coloured logos.
 * Props: size (px).
 */
const Svg = ({ size = 22, children, ...p }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...p}
  >
    {children}
  </svg>
);

export const InstagramIcon = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
  </Svg>
);

export const WhatsAppIcon = (p) => (
  <Svg {...p}>
    <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" />
    <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
  </Svg>
);

export const FacebookIcon = (p) => (
  <Svg {...p}>
    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
  </Svg>
);

export const YouTubeIcon = (p) => (
  <Svg {...p}>
    <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
    <path d="m10 15 5-3-5-3z" />
  </Svg>
);

export const LinkedInIcon = (p) => (
  <Svg {...p}>
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  </Svg>
);

export const XIcon = (p) => (
  <Svg {...p}>
    <path d="M4 4l11.733 16H20L8.267 4z" />
    <path d="M4 20l6.768-6.768m2.46-2.46L20 4" />
  </Svg>
);

export const SOCIAL_ICONS = {
  Instagram: InstagramIcon,
  WhatsApp: WhatsAppIcon,
  Facebook: FacebookIcon,
  YouTube: YouTubeIcon,
  LinkedIn: LinkedInIcon,
  X: XIcon,
};

/**
 * SocialLink — round icon button with a white outline icon.
 * On hover it lifts and glows.
 */
export function SocialLink({ name, url, className = '' }) {
  const Icon = SOCIAL_ICONS[name];
  if (!Icon) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={name}
      title={name}
      className={`social-btn ${className}`.trim()}
      data-brand={name.toLowerCase()}
    >
      <Icon size={22} />
    </a>
  );
}
