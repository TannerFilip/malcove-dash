/**
 * Shodan full-host enrichment — fetches complete host details from the Shodan API.
 *
 * Unlike the search endpoint used during runs, /shodan/host/:ip returns all open
 * ports, full service banners, historical data, and additional metadata.
 * Host lookups do NOT consume query credits.
 */

/**
 * Fetch the full Shodan host record for a given IP.
 * Returns the raw Shodan JSON blob (stored as-is in enrichments.data).
 * Returns null on any error so the caller can decide whether to retry.
 */
export async function runShodanHost(
  ip: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  const url = new URL(`https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}`);
  url.searchParams.set('key', apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch {
    return null;
  }

  if (!res.ok) return null;

  const data: unknown = await res.json();
  return data as Record<string, unknown>;
}
