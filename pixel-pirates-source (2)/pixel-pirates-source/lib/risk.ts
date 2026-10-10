/**
 * Pixel Pirates risk engine.
 *
 * Compares a candidate (profile, page, domain or app) against a registered brand's
 * official assets and produces an explainable 0–100 risk score. Every point added or
 * removed is recorded as a "signal" so analysts can see exactly why a verdict was given.
 */

export type Signal = { label: string; detail: string; weight: number; category: "name" | "domain" | "handle" | "app" | "content" | "trust" };

export type BrandAssets = { name: string; domain: string; socialHandle: string; appPublisher: string };

export type Candidate = {
  candidateName: string;
  candidateDomain?: string;
  candidateHandle?: string;
  candidatePlatform?: string;
  candidateAppPublisher?: string;
  candidateDescription?: string;
};

export type RiskResult = { riskScore: number; riskLevel: "low" | "medium" | "high" | "critical"; verdict: string; signals: Signal[] };

const SUSPICIOUS_TLDS = new Set(["xyz", "top", "click", "zip", "mov", "tk", "ml", "ga", "cf", "gq", "buzz", "icu", "live", "online", "site", "rest", "cam", "monster", "support", "help", "loan", "work", "country", "kim", "fit", "gdn", "lol", "quest", "sbs", "cfd"]);
const PHISH_KEYWORDS = ["login", "signin", "verify", "verification", "secure", "security", "account", "update", "support", "help", "billing", "wallet", "gift", "free", "bonus", "promo", "reward", "claim", "refund", "auth", "unlock", "recovery", "official", "customer", "service", "care"];
const HANDLE_BAIT = ["official", "real", "support", "help", "care", "team", "hq", "service", "desk", "admin", "giveaway", "promo", "rewards", "global", "india", "us", "verified", "app"];
const SCAM_PHRASES: [RegExp, string][] = [
  [/giveaway|free\s+(iphone|money|gift)|win\s+(a|an|big)/i, "Giveaway / prize bait"],
  [/crypto|bitcoin|btc|usdt|eth\b|wallet\s+address|seed\s+phrase/i, "Cryptocurrency request"],
  [/double\s+your|guaranteed\s+(return|profit)|investment\s+plan|\d+%\s+(profit|return)/i, "Investment fraud language"],
  [/verify\s+your\s+account|account\s+(suspended|locked|disabled)|confirm\s+your\s+(identity|details)/i, "Account-takeover pretext"],
  [/\b(otp|one[-\s]?time\s+password|pin|password|cvv)\b/i, "Requests credentials or OTP"],
  [/whats\s?app|telegram|dm\s+(us|me)|message\s+us\s+privately|contact\s+us\s+on/i, "Moves conversation off-platform"],
  [/urgent|immediately|within\s+24\s+hours|last\s+chance|act\s+now/i, "Urgency pressure"],
  [/refund|customer\s+care\s+number|helpline|toll[-\s]?free/i, "Fake support / refund lure"],
  [/gift\s*card|upi|paytm|western\s+union|money\s*gram|wire\s+transfer/i, "Untraceable payment method"],
  [/apk|download\s+(the\s+)?app\s+(here|from)|sideload|mod\s+app/i, "Off-store app download"],
];

// Characters attackers commonly swap in to fool the eye.
const HOMOGLYPHS: [RegExp, string][] = [
  [/rn/g, "m"], [/vv/g, "w"], [/cl/g, "d"], [/0/g, "o"], [/1/g, "l"], [/3/g, "e"], [/4/g, "a"], [/5/g, "s"], [/7/g, "t"], [/8/g, "b"], [/\$/g, "s"], [/@/g, "a"], [/i/g, "l"],
];

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const skeleton = (s: string) => HOMOGLYPHS.reduce((acc, [re, to]) => acc.replace(re, to), s.toLowerCase()).replace(/[^a-z]/g, "");

function splitDomain(domain: string) {
  const parts = domain.split(".");
  // Handles common two-part public suffixes like co.uk / com.au / co.in.
  const twoPart = parts.length > 2 && /^(co|com|net|org|gov|ac|edu)$/.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2;
  const tldParts = twoPart ? 2 : 1;
  const tld = parts.slice(-tldParts).join(".");
  const label = parts[parts.length - tldParts - 1] ?? "";
  const subdomains = parts.slice(0, Math.max(0, parts.length - tldParts - 1));
  return { label, tld, subdomains, registrable: `${label}.${tld}` };
}

function analyzeDomain(brand: BrandAssets, domain: string, signals: Signal[]) {
  const official = splitDomain(brand.domain);
  const cand = splitDomain(domain);
  const brandKey = compact(official.label);
  const candKey = compact(cand.label);

  if (domain === brand.domain || cand.registrable === official.registrable) {
    signals.push({ category: "trust", label: "Official domain match", detail: `${domain} belongs to the registered domain ${brand.domain}.`, weight: -45 });
    return;
  }

  if (domain.includes("xn--")) {
    signals.push({ category: "domain", label: "Punycode / IDN domain", detail: "Internationalised domains can render lookalike characters (e.g. Cyrillic 'а' for Latin 'a').", weight: 22 });
  }

  // Brand appears as a subdomain of someone else's domain: acme.com.secure-login.net
  if (cand.subdomains.some((s) => compact(s).includes(brandKey)) && candKey !== brandKey) {
    signals.push({ category: "domain", label: "Brand used as subdomain", detail: `"${official.label}" sits in front of an unrelated domain (${cand.registrable}) — a classic phishing pattern.`, weight: 30 });
  }

  if (candKey === brandKey) {
    signals.push({ category: "domain", label: "Same name, different TLD", detail: `${cand.registrable} copies the brand name on a different extension (official: .${official.tld}).`, weight: 24 });
  } else if (skeleton(cand.label) === skeleton(official.label)) {
    signals.push({ category: "domain", label: "Homoglyph lookalike domain", detail: `"${cand.label}" visually mimics "${official.label}" using swapped characters.`, weight: 38 });
  } else {
    const sim = similarity(candKey, brandKey);
    if (sim >= 0.7 && brandKey.length >= 3) {
      signals.push({ category: "domain", label: "Typosquatted domain", detail: `"${cand.label}" is ${Math.round(sim * 100)}% similar to "${official.label}" (edit distance ${levenshtein(candKey, brandKey)}).`, weight: Math.round(18 + sim * 16) });
    } else if (candKey.includes(brandKey) && brandKey.length >= 3) {
      const extra = cand.label.replace(new RegExp(official.label.replace(/[^a-z0-9]/g, ""), "i"), "").replace(/^-|-$/g, "");
      signals.push({ category: "domain", label: "Combosquatted domain", detail: `Brand name combined with extra words${extra ? ` ("${extra}")` : ""} — e.g. brand-support.com.`, weight: 26 });
    }
  }

  const hits = PHISH_KEYWORDS.filter((k) => domain.includes(k));
  if (hits.length) {
    signals.push({ category: "domain", label: "Phishing keywords in domain", detail: `Contains: ${hits.slice(0, 4).join(", ")}.`, weight: Math.min(18, 8 + hits.length * 4) });
  }

  const tldLast = cand.tld.split(".").pop() ?? "";
  if (SUSPICIOUS_TLDS.has(tldLast)) {
    signals.push({ category: "domain", label: "High-abuse TLD", detail: `.${tldLast} is frequently used for throwaway phishing and scam sites.`, weight: 10 });
  }

  if ((cand.label.match(/-/g) ?? []).length >= 2 || /\d{3,}/.test(cand.label)) {
    signals.push({ category: "domain", label: "Machine-generated pattern", detail: "Multiple hyphens or long digit runs are typical of bulk-registered scam domains.", weight: 6 });
  }

  if (cand.subdomains.length >= 3) {
    signals.push({ category: "domain", label: "Deep subdomain nesting", detail: `${cand.subdomains.length} subdomain levels can hide the real destination on mobile screens.`, weight: 6 });
  }
}

function analyzeHandle(brand: BrandAssets, handle: string, signals: Signal[]) {
  const official = compact(brand.socialHandle);
  const cand = compact(handle);
  if (handle === brand.socialHandle || cand === official) {
    signals.push({ category: "trust", label: "Official handle match", detail: `@${handle} is the registered official account.`, weight: -40 });
    return;
  }

  const brandKey = official.length >= 3 ? official : compact(brand.name);
  if (skeleton(handle) === skeleton(brand.socialHandle)) {
    signals.push({ category: "handle", label: "Homoglyph lookalike handle", detail: `@${handle} visually mimics @${brand.socialHandle}.`, weight: 34 });
  } else if (cand.includes(brandKey)) {
    const bait = HANDLE_BAIT.filter((b) => cand.replace(brandKey, "").includes(b));
    signals.push({
      category: "handle",
      label: bait.length ? "Impersonation-style handle" : "Handle contains brand name",
      detail: bait.length ? `@${handle} adds authority bait (${bait.join(", ")}) to the brand name.` : `@${handle} embeds the brand name but is not the official @${brand.socialHandle}.`,
      weight: bait.length ? 28 : 18,
    });
  } else {
    const sim = similarity(cand, brandKey);
    if (sim >= 0.7) {
      signals.push({ category: "handle", label: "Lookalike handle", detail: `@${handle} is ${Math.round(sim * 100)}% similar to @${brand.socialHandle}.`, weight: Math.round(14 + sim * 16) });
    }
  }

  if (/[._-]{2,}|[._]$|\d{2,}$/.test(handle)) {
    signals.push({ category: "handle", label: "Padding characters", detail: "Trailing digits, dots or underscores are used to grab a near-identical handle.", weight: 6 });
  }
}

export function assessRisk(brand: BrandAssets, c: Candidate): RiskResult {
  const signals: Signal[] = [];
  const brandName = compact(brand.name);
  const candName = compact(c.candidateName);

  // Display-name resemblance is what end users actually see first.
  let nameResembles = false;
  if (candName === brandName) {
    nameResembles = true;
    signals.push({ category: "name", label: "Identical display name", detail: `"${c.candidateName}" uses the exact brand name.`, weight: 18 });
  } else if (brandName.length >= 3 && candName.includes(brandName)) {
    nameResembles = true;
    signals.push({ category: "name", label: "Brand name in display name", detail: `"${c.candidateName}" contains "${brand.name}".`, weight: 14 });
  } else if (skeleton(brand.name).length >= 3 && skeleton(c.candidateName).includes(skeleton(brand.name))) {
    nameResembles = true;
    signals.push({ category: "name", label: "Homoglyph display name", detail: `"${c.candidateName}" mimics "${brand.name}" with lookalike characters.`, weight: 22 });
  } else {
    const sim = similarity(candName, brandName);
    if (sim >= 0.7) {
      nameResembles = true;
      signals.push({ category: "name", label: "Similar display name", detail: `"${c.candidateName}" is ${Math.round(sim * 100)}% similar to "${brand.name}".`, weight: Math.round(8 + sim * 10) });
    }
  }

  if (c.candidateDomain) analyzeDomain(brand, c.candidateDomain, signals);
  if (c.candidateHandle) analyzeHandle(brand, c.candidateHandle, signals);

  if (c.candidateAppPublisher) {
    const pubSim = similarity(compact(c.candidateAppPublisher), compact(brand.appPublisher));
    if (compact(c.candidateAppPublisher) === compact(brand.appPublisher)) {
      signals.push({ category: "trust", label: "Verified app publisher", detail: `Published by the official developer account "${brand.appPublisher}".`, weight: -30 });
    } else if (pubSim >= 0.7) {
      signals.push({ category: "app", label: "Lookalike app publisher", detail: `"${c.candidateAppPublisher}" closely imitates the official publisher "${brand.appPublisher}".`, weight: 30 });
    } else if (nameResembles) {
      signals.push({ category: "app", label: "Publisher mismatch", detail: `App uses the brand's identity but is published by "${c.candidateAppPublisher}", not "${brand.appPublisher}".`, weight: 26 });
    }
  }

  if (c.candidateDescription) {
    const matches = SCAM_PHRASES.filter(([re]) => re.test(c.candidateDescription!)).map(([, label]) => label);
    if (matches.length) {
      signals.push({ category: "content", label: "Scam language detected", detail: matches.join(" · "), weight: Math.min(30, matches.length * 8) });
    }
    if (/https?:\/\/(bit\.ly|tinyurl|t\.co|cutt\.ly|rb\.gy|is\.gd|shorturl)/i.test(c.candidateDescription)) {
      signals.push({ category: "content", label: "Shortened link", detail: "URL shorteners hide the real destination of a link.", weight: 8 });
    }
  }

  const raw = signals.reduce((sum, s) => sum + s.weight, 0);
  const impersonating = signals.some((s) => s.weight > 0 && s.category !== "content") && nameResembles;
  // Brand resemblance + an unofficial asset compounds risk; scam content alone on an unrelated profile is weaker.
  const riskScore = Math.max(0, Math.min(100, Math.round(raw + (impersonating ? 8 : 0))));
  const riskLevel = riskScore >= 75 ? "critical" : riskScore >= 50 ? "high" : riskScore >= 25 ? "medium" : "low";

  const isOfficial = signals.some((s) => s.category === "trust") && !signals.some((s) => s.weight > 0 && s.category !== "name");
  const verdict = isOfficial
    ? "Verified official asset"
    : riskLevel === "critical"
      ? "Confirmed impersonation pattern — recommend takedown"
      : riskLevel === "high"
        ? "Likely impersonation — investigate"
        : riskLevel === "medium"
          ? "Suspicious — monitor and review"
          : "Low risk — no strong impersonation signals";

  if (!signals.length) {
    signals.push({ category: "trust", label: "No impersonation signals", detail: "Candidate does not resemble the brand's registered assets.", weight: 0 });
  }

  signals.sort((a, b) => b.weight - a.weight);
  return { riskScore, riskLevel, verdict, signals };
}
