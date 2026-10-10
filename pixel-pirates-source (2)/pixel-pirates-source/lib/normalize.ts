/** Strips protocol, credentials, "www.", port, path and query from a domain/URL. */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.replace(/^[^@/]*@/, "");
  d = d.split(/[/?#]/)[0];
  d = d.replace(/:\d+$/, "");
  d = d.replace(/^www\./, "");
  return d.replace(/\.$/, "");
}

const DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

export function isValidDomain(domain: string): boolean {
  return DOMAIN_RE.test(domain);
}

/** Strips "@", profile URLs (e.g. instagram.com/acme) and whitespace from a social handle. */
export function normalizeHandle(input: string): string {
  let h = input.trim().toLowerCase();
  h = h.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  if (h.includes("/")) {
    const parts = h.split(/[/?#]/).filter(Boolean);
    h = parts[parts.length - 1] ?? h;
  }
  return h.replace(/^@+/, "").replace(/\s+/g, "");
}

export const HANDLE_RE = /^[a-z0-9._-]{2,50}$/;
