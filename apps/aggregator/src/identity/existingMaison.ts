import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { resolveCompany } from '../normalize/company.js';
import { normalizedEmployerName } from '../normalize/employerName.js';

type Company = Prisma.CompanyGetPayload<Record<string, never>>;
type Db = Pick<Prisma.TransactionClient, 'company' | 'companyAlias'>;

/** La clé sous laquelle la source crée la Maison d'un libellé natif (`resolve.ts`, règle `NATIVE_SOURCE_LABEL`). */
export const sourceScopedKey = (sourceKey: string, normalized: string) =>
  `SOURCE_${createHash('sha256').update(JSON.stringify([sourceKey, normalized])).digest('hex')}`;

async function root(db: Db, company: Company): Promise<Company> {
  const visited = new Set<string>();
  while (company.mergedIntoId) {
    if (visited.has(company.id)) throw new Error(`Employer identity cycle: ${company.id}`);
    visited.add(company.id);
    company = await db.company.findUniqueOrThrow({ where: { id: company.mergedIntoId } });
  }
  return company;
}

/** Deux alias relus du même nom mènent à deux Maisons : rien n'est choisi, l'offre va en revue. */
export class MaisonAliasConflict extends Error {
  constructor(public readonly label: string) { super(`Reviewed aliases disagree for ${JSON.stringify(label)}`); this.name = 'MaisonAliasConflict'; }
}

export type ExistingMaison = { company: Company; via: 'REVIEWED_ALIAS' | 'SOURCE_LABEL' | 'REGISTRY_KEY' } | { company: null; key: string; name: string };

/**
 * LA MAISON QUI EXISTE DÉJÀ SOUS CE NOM, AVANT D'EN CRÉER UNE (D-522 §6, lecture métier du 03/10/2026).
 *
 * Une marque ou un groupe que la liste relue (`groupBrands.ts`) désigne doit publier sous la Maison que le candidat voit
 * déjà : chercher la seule clé du registre (`resolved:<resolveCompany(nom)>`) créait une seconde « Aesop » à côté de celle
 * que la source porte depuis le matin sous sa clé de libellé (102 offres). Dans l'ordre, sans rien deviner :
 *  1. un alias RELU de ce nom, pour cette source ou pour toutes (deux racines : conflit, jamais un choix) ;
 *  2. la Maison que CETTE source a créée pour ce libellé natif (`SOURCE_<empreinte(source, nom)>`) ;
 *  3. la Maison du registre sous sa clé (`resolved:<resolveCompany(nom)>`).
 * Sinon : la clé et le nom sous lesquels la créer (même chemin que le propriétaire d'un portail). Lecture seule.
 */
export async function existingMaison(db: Db, sourceKey: string, name: string): Promise<ExistingMaison> {
  const normalized = normalizedEmployerName(name);
  const aliases = await db.companyAlias.findMany({ where: { sourceKey: { in: [sourceKey, '*'] }, normalizedName: normalized, reviewId: { not: null } },
    include: { company: true } });
  const roots = await Promise.all(aliases.map(alias => root(db, alias.company)));
  if (new Set(roots.map(c => c.id)).size > 1) throw new MaisonAliasConflict(name);
  if (roots.length) return { company: roots[0]!, via: 'REVIEWED_ALIAS' };
  const scoped = await db.company.findUnique({ where: { fashionjobsUrl: `resolved:${sourceScopedKey(sourceKey, normalized)}` } });
  if (scoped) return { company: await root(db, scoped), via: 'SOURCE_LABEL' };
  const key = resolveCompany(name).companyId;
  const registry = await db.company.findUnique({ where: { fashionjobsUrl: `resolved:${key}` } });
  if (registry) return { company: await root(db, registry), via: 'REGISTRY_KEY' };
  return { company: null, key, name: name.trim() };
}
