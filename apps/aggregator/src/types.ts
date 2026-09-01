import type { AtsType } from '@prisma/client';

export type DiscoveredCompany = {
  name: string;
  fashionjobsUrl: string;
  fashionjobsSlug?: string;
  offerCount?: number;
};

export type AtsDetection = {
  type: AtsType;
  careersUrl: string;
  config: Record<string, unknown>;
  confidence: number;
  note?: string;
};

/**
 * The canonical job shape every adapter produces.
 *
 * One schema for nineteen vendors, so the pipeline downstream — dedup, sector
 * classification, France filtering, the front end — never needs to know which
 * ATS a row came from.
 *
 * Fields are optional because coverage genuinely varies: Pinpoint gives salary
 * bands, Phenom and Magnet give coordinates, WTTJ and TalentView give remote
 * policy and experience level, and several give none of it. An absent field
 * means "this source does not publish it", never "not fetched".
 */
export type NormalizedJob = {
  /** Stable id within a source. Falls back to the page URL when the source has none. */
  externalId: string;
  title: string;

  // --- Location -----------------------------------------------------------
  /** Human-readable location as the source wrote it: "Paris, 75008". */
  location?: string;
  /** City alone, when the source separates it. */
  city?: string;
  postalCode?: string;
  region?: string;
  /** ISO-2 code or country name; isFrance() accepts both. */
  country?: string;
  /**
   * Coordinates when the source already provides them (Phenom, Magnet).
   * These rows skip geocoding entirely.
   */
  latitude?: number;
  longitude?: number;

  // --- Terms --------------------------------------------------------------
  /** Raw contract label; normalizeContract() maps it to the canonical set. */
  contract?: string;
  /** Full-time / part-time, when stated separately from the contract. */
  workingTime?: string;
  /** Remote policy as the source words it: "no", "hybrid", "full". */
  remote?: string;
  /** Minimum experience, in years, when stated numerically. */
  experienceYears?: number;
  /** Education level as worded by the source. */
  educationLevel?: string;

  // --- Compensation -------------------------------------------------------
  salaryMin?: number;
  salaryMax?: number;
  /** ISO-4217, e.g. "EUR". */
  salaryCurrency?: string;
  /** YEAR | MONTH | HOUR, as the source states it. */
  salaryPeriod?: string;

  // --- Content ------------------------------------------------------------
  /** Full posting text, plain. Every adapter fills this. */
  description?: string;
  /** Employer as named by the source; overrides the registry name when present. */
  company?: string;
  /** Parent group, when the source distinguishes it. */
  group?: string;
  /** Function or department, e.g. "Retail", "Marketing". */
  department?: string;

  // --- Lifecycle ----------------------------------------------------------
  /** Apply URL. Canonical selection happens later, at dedup. */
  url: string;
  postedAt?: Date;
  /** Expiry when published, used by the refresh pass to close stale rows. */
  validThrough?: Date;

  /** Untouched source payload, for debugging and later field extraction. */
  raw?: unknown;
};
