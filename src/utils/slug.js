/**
 * Turns a service name into a URL-safe anchor id, e.g.
 * "Business cards & pamphlets Design" -> "business-cards-pamphlets-design"
 */
export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
