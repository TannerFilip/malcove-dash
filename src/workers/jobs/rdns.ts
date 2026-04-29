/**
 * Reverse DNS enrichment — looks up PTR records via Cloudflare's DNS-over-HTTPS API.
 * No external API key required; uses 1.1.1.1 which is always available from Workers.
 */

/** Data stored in the enrichments table for source = 'rdns'. */
export interface RdnsData {
  ptr: string[];
  /** Unix seconds when the lookup was performed. */
  checkedAt: number;
}

/**
 * Convert an IPv4 address to the in-addr.arpa format required for PTR lookups.
 * e.g. "1.2.3.4" → "4.3.2.1.in-addr.arpa"
 */
function toArpa(ip: string): string {
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[3]}.${parts[2]}.${parts[1]}.${parts[0]}.in-addr.arpa`;
  }
  // IPv6: strip colons and expand — simple best-effort for now
  // Full IPv6 arpa format is complex; fall back to the raw IP as the query name
  return ip;
}

const DOH_URL = 'https://1.1.1.1/dns-query';

/**
 * Run a reverse DNS lookup for a given IP.
 * Returns null if the lookup fails or no PTR record exists.
 */
export async function runRdns(ip: string): Promise<RdnsData | null> {
  const arpa = toArpa(ip);

  let res: Response;
  try {
    res = await fetch(`${DOH_URL}?name=${encodeURIComponent(arpa)}&type=PTR`, {
      headers: { Accept: 'application/dns-json' },
    });
  } catch {
    return null;
  }

  if (!res.ok) return null;

  interface DohResponse {
    Status: number;
    Answer?: Array<{ type: number; data: string }>;
  }

  const body = (await res.json()) as DohResponse;

  // Status 0 = NOERROR; type 12 = PTR
  if (body.Status !== 0 || !body.Answer) {
    return { ptr: [], checkedAt: Math.floor(Date.now() / 1000) };
  }

  const ptr = body.Answer
    .filter((a) => a.type === 12)
    .map((a) => a.data.replace(/\.$/, '')); // strip trailing dot from FQDN

  return { ptr, checkedAt: Math.floor(Date.now() / 1000) };
}
