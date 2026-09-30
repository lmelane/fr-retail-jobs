/**
 * Les deux bornes d'un examen d'alerte (R-130 §3) : `entreeApres`, le filigrane de l'alerte, et `publieeApres`,
 * « publiée il y a moins de 30 jours » calculé par le backend à l'instant de l'examen (D-465). Toutes deux
 * obligatoires, en ISO 8601 : une borne absente ou illisible ferait annoncer tout le stock comme nouveau.
 */
export type BornesExamen =
  | { ok: true; entreeApres: Date; publieeApres: Date }
  | { ok: false; erreur: string };

/** Une date plus ancienne ne sert à rien (un filigrane a au plus quelques mois) et signale une erreur d'appel. */
const PLUS_ANCIENNE = Date.UTC(2020, 0, 1);

function lireDate(v: string | null): Date | null {
  if (!v || v.length > 40 || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getTime() < PLUS_ANCIENNE ? null : d;
}

export function lireBornesExamen(params: URLSearchParams, maintenant: Date = new Date()): BornesExamen {
  const entreeApres = lireDate(params.get('entreeApres'));
  const publieeApres = lireDate(params.get('publieeApres'));
  if (!entreeApres) return { ok: false, erreur: 'entreeApres : date ISO 8601 attendue.' };
  if (!publieeApres) return { ok: false, erreur: 'publieeApres : date ISO 8601 attendue.' };
  // Un filigrane dans le futur annoncerait rien pour toujours sans que personne ne le voie.
  if (entreeApres.getTime() > maintenant.getTime() + 60_000) return { ok: false, erreur: 'entreeApres : date future.' };
  return { ok: true, entreeApres, publieeApres };
}
