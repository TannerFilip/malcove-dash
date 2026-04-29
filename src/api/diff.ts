/**
 * Banner hashing (server-side only — uses SubtleCrypto async digest).
 * Pure diff utilities live in src/shared/diff.ts and are re-exported here
 * for callers that only import from this module.
 */

import { sortKeysDeep } from '../shared/diff';

export { sortKeysDeep, diffBanners } from '../shared/diff';

/**
 * Compute a SHA-256 hex digest of the canonicalized banner object.
 * SubtleCrypto is available in Cloudflare Workers and modern browsers.
 */
export async function bannerHash(banner: unknown): Promise<string> {
  const canonical = JSON.stringify(sortKeysDeep(banner));
  const encoded = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
