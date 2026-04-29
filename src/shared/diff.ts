/**
 * Banner diffing utilities — shared between server (Pages Functions) and
 * client (React UI). All functions are pure, standard-JS-only.
 */

/**
 * Recursively sort all object keys so that objects with identical data but
 * different key-insertion order produce identical JSON.
 * Shodan occasionally reorders keys between responses — this normalises that.
 */
export function sortKeysDeep(value: unknown): unknown {
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
 * Field-level diff of two banner objects.
 * Returns only fields that changed, were added, or were removed.
 * Top-level only — nested objects are compared via JSON serialisation.
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
