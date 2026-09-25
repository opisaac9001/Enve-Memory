import type { Intent } from './types.ts';

const WATCH_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'tiktok.com', 'dailymotion.com', 'netflix.com', 'nebula.tv', 'loom.com'];
const BUY_HOSTS = ['amazon.', 'ebay.', 'etsy.com', 'bestbuy.com', 'walmart.com', 'target.com', 'aliexpress.com', 'newegg.com', 'bhphotovideo.com', 'ikea.com', 'costco.com', 'homedepot.com', 'lowes.com'];

/** A first guess at why a link was saved, from its address and (once archived) its Open Graph type. The user can change it. */
export function detectIntent(url: string, ogType?: string): Intent {
  const type = ogType?.toLowerCase() ?? '';
  if (type.startsWith('video') || type.startsWith('music.video')) return 'watch';
  if (type === 'product' || type.startsWith('product.') || type === 'og:product') return 'buy';
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, '');
    path = parsed.pathname.toLowerCase();
  } catch {
    return 'read';
  }
  if (WATCH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return 'watch';
  if (host === 'instagram.com' && /^\/(reels?|tv)\//.test(path)) return 'watch';
  if (BUY_HOSTS.some((h) => (h.endsWith('.') ? host.includes(h) : host === h || host.endsWith(`.${h}`)))) return 'buy';
  if (/\/(dp|gp\/product|product|products|item|itm|p)\//.test(path)) return 'buy';
  return 'read';
}
