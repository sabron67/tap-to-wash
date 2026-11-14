// Search-engine optimisation: canonical URL, social tags, keywords and schema.org data so that searches such as
// "wash laundry", "laundry service near me", "dry cleaning", "wash my clothes", "duvet / carpet / shoe cleaning" can find the site.
const { esc } = require('./html');

const siteUrl = () => String(process.env.APP_URL || '').replace(/\/+$/, '');
const abs = (path) => (siteUrl() ? siteUrl() + path : '');

const BASE_KEYWORDS = [
  'laundry', 'laundry service', 'wash laundry', 'washing', 'wash clothes', 'washing service', 'wash and fold', 'dry cleaning',
  'ironing', 'laundry pick up and delivery', 'laundry near me', 'online laundry', 'duvet cleaning', 'blanket washing',
  'carpet cleaning', 'shoe cleaning', 'laundromat', 'clothes cleaning', 'stain removal',
];

function homeSeo(s, categories = []) {
  const names = categories.map((c) => c.name).filter(Boolean);
  const place = s.address ? ` in ${String(s.address).split(',').slice(-2).join(',').trim()}` : '';
  const title = `Laundry & Washing Service${place} – Pick-up and Delivery · ${s.business_name}`;
  const description = `${s.business_name}: wash, dry, iron and fold${names.length ? ` – ${names.slice(0, 6).join(', ')}` : ''}. Book online, we collect your laundry from your door and deliver it fresh and clean. ${s.about || ''}`.replace(/\s+/g, ' ').trim().slice(0, 300);
  const keywords = [...new Set([...BASE_KEYWORDS, ...names.map((n) => n.toLowerCase())])].join(', ');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'LaundryService',
    name: s.business_name,
    description,
    url: abs('/') || undefined,
    telephone: s.phone || undefined,
    email: s.email || undefined,
    address: s.address ? { '@type': 'PostalAddress', streetAddress: s.address } : undefined,
    openingHours: s.opening_hours || undefined,
    priceRange: '$$',
    areaServed: s.address || undefined,
    hasOfferCatalog: names.length
      ? { '@type': 'OfferCatalog', name: 'Laundry services', itemListElement: names.map((n) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: n } })) }
      : undefined,
  };
  return { title, description, keywords, canonical: abs('/'), jsonLd: ld, fullTitle: true };
}

// robots.txt and sitemap.xml
const robotsTxt = () =>
  ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /staff', 'Disallow: /account', 'Disallow: /api/', 'Disallow: /track', 'Disallow: /pay',
    ...(siteUrl() ? [`Sitemap: ${siteUrl()}/sitemap.xml`] : [])].join('\n') + '\n';

function sitemapXml(lastmod) {
  const urls = [['/', '1.0', 'weekly'], ['/terms', '0.3', 'yearly'], ['/privacy', '0.3', 'yearly']];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(([p, pr, cf]) => `  <url><loc>${esc(abs(p) || p)}</loc><lastmod>${lastmod}</lastmod><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`)
    .join('\n')}\n</urlset>\n`;
}

module.exports = { homeSeo, robotsTxt, sitemapXml, siteUrl, abs };
