import { Prisma } from '@prisma/client';

/** The same employer selector powers counts, results and the directory. */
export function companyIdentityWhere(value: string, match: 'equals' | 'contains' = 'equals'): Prisma.CompanyWhereInput {
  const name = { [match]: value, mode: 'insensitive' as const };
  return { OR: [
    { name },
    { aliases: { some: { displayName: name, reviewId: { not: null } } } },
    { mergedFrom: { some: { name } } },
  ] };
}

/** Equivalent SQL selector for the indexed results/aggregation query. */
export function companyIdentitySql(value: string, match: 'equals' | 'contains' = 'equals'): Prisma.Sql {
  const test = (column: Prisma.Sql) => match === 'equals'
    ? Prisma.sql`lower(${column}) = lower(${value})`
    : Prisma.sql`${column} ILIKE ${`%${value}%`}`;
  return Prisma.sql`(${test(Prisma.sql`c.name`)} OR ${companyAliasSql(value, match)})`;
}

export function companyAliasSql(value: string, match: 'equals' | 'contains' = 'equals'): Prisma.Sql {
  const test = (column: Prisma.Sql) => match === 'equals'
    ? Prisma.sql`lower(${column}) = lower(${value})`
    : Prisma.sql`${column} ILIKE ${`%${value}%`}`;
  return Prisma.sql`c.id IN (
    SELECT a."companyId" FROM "CompanyAlias" a WHERE a."reviewId" IS NOT NULL AND ${test(Prisma.sql`a."displayName"`)}
    UNION SELECT old."mergedIntoId" FROM "Company" old WHERE old."mergedIntoId" IS NOT NULL AND ${test(Prisma.sql`old.name`)}
  )`;
}
