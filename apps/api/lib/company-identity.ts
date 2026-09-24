import type { Prisma } from '@prisma/client';

/** The same employer selector powers counts, results and the directory. */
export function companyIdentityWhere(value: string, match: 'equals' | 'contains' = 'equals'): Prisma.CompanyWhereInput {
  const name = { [match]: value, mode: 'insensitive' as const };
  return { OR: [
    { name },
    { aliases: { some: { displayName: name, reviewId: { not: null } } } },
    { mergedFrom: { some: { name } } },
  ] };
}
