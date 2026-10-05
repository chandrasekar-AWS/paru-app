import { Link } from 'react-router-dom';

/**
 * Button — the one button used across the site.
 * Renders <Link> when `to` is set, <a> when `href` is set, otherwise <button>.
 * variant: 'primary' (ink) | 'lime' | 'outline'      size: 'md' | 'sm'
 */
export default function Button({
  children, to, href, onClick, type = 'button', variant = 'primary', size = 'md',
  className = '', ...rest
}) {
  const cls = `btn btn--${variant}${size === 'sm' ? ' btn--sm' : ''} ${className}`.trim();
  if (to) return <Link to={to} className={cls} {...rest}>{children}</Link>;
  if (href) return <a href={href} className={cls} {...rest}>{children}</a>;
  return <button type={type} onClick={onClick} className={cls} {...rest}>{children}</button>;
}
