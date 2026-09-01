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

export type NormalizedJob = {
  externalId: string;
  title: string;
  location?: string;
  country?: string;
  contract?: string;
  description?: string;
  url: string;
  postedAt?: Date;
  raw?: unknown;
};
