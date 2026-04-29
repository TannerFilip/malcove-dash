/**
 * Banner hashing for change detection.
 *
 * Keys are recursively sorted before serialisation so that objects with
 * identical data but different key insertion order produce the same hash.
 * This is critical — Shodan occasionally reorders keys between responses.
 */

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Compute a SHA-256 hex digest of the canonicalized banner object.
 * Uses SubtleCrypto — available in all Workers / modern browsers.
 */
export async function bannerHash(banner: unknown): Promise<string> {
  const canonical = JSON.stringify(sortKeysDeep(banner));
  const encoded = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Diff two banner objects field-by-field.
 * Returns an array of { field, before, after } for changed fields only.
 * Operates on the top level only — deep diffing is done in the UI.
 */
export function diffBanners(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Array<{ field: string; before: unknown; after: unknown }> {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

  for (const key of allKeys) {
    const bVal = JSON.stringify(sortKeysDeep(before[key]));
    const aVal = JSON.stringify(sortKeysDeep(after[key]));
    if (bVal !== aVal) {
      changes.push({ field: key, before: before[key], after: after[key] });
    }
  }

  return changes;
}
