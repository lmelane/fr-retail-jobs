/**
 * D-520 §4 a — LA RÉPARATION D'UNE FAUSSE PREUVE D'ABSENCE, partie pure (témoins : `__tests__/reouverture.test.ts`).
 *
 * Une collecte s'est déclarée « liste complète » sans l'être (knitwell-us-retail, 23-30/09 : 2 000 offres lues sur 3 515,
 * plafond Workday). Sur cette fausse preuve, le refresh a pu fermer des représentations (`publisherClosedAt`) et la revue
 * de disponibilité en retenir (`NOT_RECONFIRMED`). Une représentation fermée ou retenue à tort qui figure dans la liste
 * COMPLÈTE (prouvée par la facette couvrante) se rouvre par le mécanisme existant, et lui seul : la collecte native, qui
 * la revoit (`dedup/upsert.ts` : `reactivateJob`, événement REOPENED, `publisherClosedAt` et retenue effacés). Un plan de
 * réparation ne peut pas réactiver une représentation (`remediation/plan.ts` : « Publication content and membership
 * require native ingestion »). Ce module calcule l'aperçu relu et vérifie, après la collecte, que chaque ligne du plan a
 * bien été rouverte.
 */
import { createHash } from 'node:crypto';

export type Representation = {
  jobSourceId: string; jobId: string | null; externalId: string;
  /** FERMEE : `isActive = false` posé par un refresh (`publisherClosedAt`) ; RETENUE : retenue de disponibilité. */
  etat: 'FERMEE' | 'RETENUE';
  /** La date de la fermeture (`publisherClosedAt`) ou de la retenue (`availabilityHoldAt`), ISO. */
  depuis: string;
  /** Pour une retenue : sa règle (`MISSED_BY_CREDIBLE_COLLECTION`, `CEILING_72H`). */
  regle: string | null;
};

export type ListProof = { at: string; complete: boolean; termination: string | null; declaredTotal: number | null; listed: string[] };

export type ReopeningPlan = {
  version: 1; sourceKey: string; since: string;
  preuve: { at: string; termination: string; declaredTotal: number | null; listed: number; listHash: string };
  /** Fermées ou retenues depuis `since` et présentes dans la liste complète : la collecte native doit les rouvrir. */
  aRouvrir: Representation[];
  /** Fermées ou retenues depuis `since` et absentes de la liste complète : rien à rouvrir. */
  resteFermees: Representation[];
  /** L'empreinte des représentations fermées ou retenues lues en base : l'application refuse si elle a changé. */
  empreinte: string;
  /** L'empreinte du partage (à rouvrir, restent fermées) sous cette liste : un plan retouché sans recalcul est refusé (garde de saisie, pas de sécurité). */
  partage: string;
};

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const order = (a: Representation, b: Representation) => a.externalId.localeCompare(b.externalId) || a.jobSourceId.localeCompare(b.jobSourceId);

/** L'empreinte de ce que la base dit des représentations fermées ou retenues : triée, sans dépendre de l'ordre de lecture. */
export function representationsHash(rows: readonly Representation[]): string {
  return sha([...rows].sort(order));
}

/**
 * L'aperçu. Refusé sans liste prouvée complète : sans elle, rien ne dit qu'une représentation fermée est encore en ligne.
 * Pure.
 */
export function planReopening(input: { sourceKey: string; since: string; rows: readonly Representation[]; proof: ListProof }): ReopeningPlan {
  const { proof } = input;
  if (!proof.complete) throw new Error(`PREUVE_ABSENTE: la liste lue n'est pas prouvée complète (terminaison ${proof.termination ?? 'absente'})`);
  const listed = new Set(proof.listed);
  if (listed.size !== proof.listed.length) throw new Error('PREUVE_INVALIDE: un identifiant est répété dans la liste');
  const rows = [...input.rows].sort(order);
  const preuve = { at: proof.at, termination: proof.termination!, declaredTotal: proof.declaredTotal, listed: listed.size, listHash: sha([...listed].sort()) };
  const aRouvrir = rows.filter(row => listed.has(row.externalId)), resteFermees = rows.filter(row => !listed.has(row.externalId));
  return { version: 1, sourceKey: input.sourceKey, since: input.since, preuve, aRouvrir, resteFermees,
    empreinte: representationsHash(rows), partage: partitionHash(preuve, aRouvrir, resteFermees) };
}

const partitionHash = (preuve: ReopeningPlan['preuve'], aRouvrir: readonly Representation[], resteFermees: readonly Representation[]) =>
  sha({ preuve, aRouvrir: [...aRouvrir].sort(order), resteFermees: [...resteFermees].sort(order) });

/** Le plan relu est-il encore celui de la base ? Pure. */
export function planStillHolds(plan: ReopeningPlan, rows: readonly Representation[]): boolean {
  return plan.version === 1 && plan.empreinte === representationsHash(rows)
    && representationsHash([...plan.aRouvrir, ...plan.resteFermees]) === plan.empreinte
    && partitionHash(plan.preuve, plan.aRouvrir, plan.resteFermees) === plan.partage;
}

export type AfterState = { jobSourceId: string; isActive: boolean; publisherClosedAt: string | null; availabilityHold: string | null;
  lastSeenAt: string; jobActive: boolean | null };
export type ReopeningCheck = { rouvertes: string[]; nonRevues: string[]; nonRouvertes: Array<{ externalId: string; etat: AfterState | null }> };

/**
 * Après la collecte native : chaque ligne du plan revue par la collecte (`lastSeenAt` après son début) doit être rouverte
 * (représentation active, sans fermeture ni retenue, offre active). Une ligne que la collecte n'a pas revue (`nonRevues`)
 * a quitté la liste entre l'aperçu et l'application, ou a été retenue à la publication (identité, périmètre) : elle reste
 * fermée par les règles de la collecte, jamais forcée ; elle est nommée pour être relue. Pure.
 */
export function checkReopening(plan: ReopeningPlan, after: ReadonlyMap<string, AfterState>, collectionStartedAt: Date): ReopeningCheck {
  const check: ReopeningCheck = { rouvertes: [], nonRevues: [], nonRouvertes: [] };
  for (const row of plan.aRouvrir) {
    const state = after.get(row.jobSourceId) ?? null;
    const seen = !!state && new Date(state.lastSeenAt).getTime() >= collectionStartedAt.getTime();
    if (state && seen && state.isActive && !state.publisherClosedAt && !state.availabilityHold && state.jobActive === true) check.rouvertes.push(row.externalId);
    else if (state && !seen) check.nonRevues.push(row.externalId);
    else check.nonRouvertes.push({ externalId: row.externalId, etat: state });
  }
  return check;
}
