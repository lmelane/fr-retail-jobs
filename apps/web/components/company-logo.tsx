'use client';

import { useState } from 'react';

/**
 * A company logo, best-effort (decision D9).
 *
 * The brand domain is derived from the company name and handed to Clearbit's
 * free logo endpoint. It works well for well-known houses (dior.com, chanel.com)
 * and simply fails for the long tail — so a failed load falls back to a coloured
 * initial. The tile is NEVER broken: no domain, no logo, or a dead endpoint all
 * render the initial instead.
 */

/** A stable colour per name, so a Maison always gets the same tile. */
function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue} 45% 42%)`;
}

/**
 * Guess a brand domain from a display name: "Christian Dior Couture" -> a few
 * candidates, best first. Deliberately simple — Clearbit resolves common shapes,
 * and anything it cannot resolve falls back to the initial.
 */
function guessDomain(name: string): string | null {
  const cleaned = name
    .normalize('NFKD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    // Drop legal/qualifier noise and anything in parentheses ("Cartier +3").
    .replace(/\([^)]*\)/g, '')
    .replace(/\+\d+/g, '')
    .replace(/\b(group|groupe|sas|sasu|sarl|sa|couture|paris|france|the)\b/g, '')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  if (cleaned.length < 2) return null;
  return `${cleaned}.com`;
}

export function CompanyLogo({ name, size = 40 }: { name: string; size?: number }) {
  const domain = guessDomain(name);
  const [failed, setFailed] = useState(false);
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  if (!domain || failed) {
    return (
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-xl font-semibold text-white"
        style={{ width: size, height: size, background: colorFor(name), fontSize: size * 0.42 }}
      >
        {initial}
      </span>
    );
  }

  return (
    // DuckDuckGo's icon service: free, no key, privacy-respecting (unlike
    // Clearbit, which is dead), and answers 200 directly. Plain <img> because
    // the host is external and per-company; next/image would need whitelisting.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-xl bg-white object-contain p-1 ring-1 ring-border"
      style={{ width: size, height: size }}
    />
  );
}
