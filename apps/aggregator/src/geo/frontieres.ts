import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

/**
 * LE PAYS D'UN POINT, PAR LE TRACÉ DES FRONTIÈRES (D-444, abstention de D-435).
 *
 * Le tracé est celui de Natural Earth au 1:10 000 000 (`data/reference/frontieres-ne10m.json.gz`, produit et vérifié par
 * `scripts/generate-frontieres.mts` depuis l'archive officielle épinglée). Un point reçoit le code pays de l'unique
 * entité qui le contient ; il s'abstient quand le doute existe :
 *   - COORDONNEES_ABSENTES  : latitude ou longitude manquante ;
 *   - COORDONNEES_INVALIDES : valeur non finie ou hors des bornes du globe ;
 *   - HORS_TRACE            : aucune entité ne le contient (en mer, ou hors de la précision du tracé) ;
 *   - TRACE_AMBIGU          : plusieurs entités de codes différents le contiennent ;
 *   - TERRITOIRE_SANS_CODE  : l'entité n'a pas de code pays (Chypre du Nord, Somaliland, zones disputées).
 * Aucune distance à la frontière n'est une cause d'abstention : Monaco, Saint-Tropez ou Cannes sont à quelques centaines
 * de mètres d'un bord du tracé, et c'est précisément la précision au 1:10 000 000 qui les classe (D-444).
 *
 * Le contenu est vérifié à la lecture : un fichier qui n'est pas exactement celui que la revue a épinglé n'est jamais
 * utilisé pour classer une offre.
 */
export const FRONTIERES_CONTENU_SHA256 = '0c851136ba82469998b2cbf5b2da6e41678fc4e6d18bd458e651e725d2ec113d';
const CHEMIN = fileURLToPath(new URL('../../data/reference/frontieres-ne10m.json.gz', import.meta.url));

export type MotifAbstentionPays = 'COORDONNEES_ABSENTES' | 'COORDONNEES_INVALIDES' | 'HORS_TRACE' | 'TRACE_AMBIGU' | 'TERRITOIRE_SANS_CODE';
export type VerdictPays =
  | { pays: string; entite: string }
  | { pays: null; motif: MotifAbstentionPays; entites?: string[] };

type Boite = { minX: number; minY: number; maxX: number; maxY: number };
type Anneau = { points: Float64Array; boite: Boite };
type Entite = { pays: string | null; nom: string; anneaux: Anneau[]; boite: Boite };
export type Frontieres = { version: string; entites: readonly Entite[] };

type Document = {
  format: number;
  source: { version: string };
  champPays: string;
  quantification: number;
  entites: [string | null, string, number[][]][];
};

const boiteVide = (): Boite => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

function decoder(delta: number[], q: number): Anneau {
  const points = new Float64Array(delta.length);
  const boite = boiteVide();
  let x = 0, y = 0;
  for (let i = 0; i < delta.length; i += 2) {
    x += delta[i]; y += delta[i + 1];
    const lon = x / q, lat = y / q;
    points[i] = lon; points[i + 1] = lat;
    if (lon < boite.minX) boite.minX = lon;
    if (lon > boite.maxX) boite.maxX = lon;
    if (lat < boite.minY) boite.minY = lat;
    if (lat > boite.maxY) boite.maxY = lat;
  }
  return { points, boite };
}

/** Lit et vérifie un tracé ; exporté pour les témoins, qui lui soumettent un contenu falsifié. */
export function lireFrontieres(octets: Buffer, empreinteAttendue = FRONTIERES_CONTENU_SHA256): Frontieres {
  const contenu = gunzipSync(octets);
  const empreinte = createHash('sha256').update(contenu).digest('hex');
  if (empreinte !== empreinteAttendue) throw new Error(`Tracé des frontières non revu (empreinte ${empreinte})`);
  const document = JSON.parse(contenu.toString('utf8')) as Document;
  if (document.format !== 1 || document.champPays !== 'ISO_A2_EH' || !Number.isInteger(document.quantification) || !Array.isArray(document.entites))
    throw new Error('Tracé des frontières : format inattendu');
  const entites = document.entites.map(([pays, nom, anneaux]) => {
    if (pays !== null && !/^[A-Z]{2}$/.test(pays)) throw new Error(`Tracé des frontières : code ${String(pays)} invalide`);
    const decodes = anneaux.map((a) => decoder(a, document.quantification));
    const boite = boiteVide();
    for (const a of decodes) {
      boite.minX = Math.min(boite.minX, a.boite.minX); boite.maxX = Math.max(boite.maxX, a.boite.maxX);
      boite.minY = Math.min(boite.minY, a.boite.minY); boite.maxY = Math.max(boite.maxY, a.boite.maxY);
    }
    return { pays, nom, anneaux: decodes, boite };
  });
  return { version: document.source.version, entites };
}

let charge: Frontieres | undefined;
/** Le tracé versionné, lu une fois par processus. */
export function chargerFrontieres(): Frontieres {
  charge ??= lireFrontieres(readFileSync(CHEMIN));
  return charge;
}

const dans = (b: Boite, x: number, y: number) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;

/** Règle pair-impair sur un anneau : un point dans un trou (Lesotho dans l'Afrique du Sud) croise deux bords. */
function croisements(anneau: Anneau, x: number, y: number): boolean {
  if (!dans(anneau.boite, x, y)) return false;
  const p = anneau.points;
  let dedans = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

function contient(entite: Entite, x: number, y: number): boolean {
  if (!dans(entite.boite, x, y)) return false;
  let dedans = false;
  for (const anneau of entite.anneaux) if (croisements(anneau, x, y)) dedans = !dedans;
  return dedans;
}

export function paysDesCoordonnees(latitude: number | null | undefined, longitude: number | null | undefined,
  frontieres: Frontieres = chargerFrontieres()): VerdictPays {
  if (latitude === null || latitude === undefined || longitude === null || longitude === undefined) return { pays: null, motif: 'COORDONNEES_ABSENTES' };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
    return { pays: null, motif: 'COORDONNEES_INVALIDES' };
  const touchees = frontieres.entites.filter((e) => contient(e, longitude, latitude));
  if (!touchees.length) return { pays: null, motif: 'HORS_TRACE' };
  const codes = new Set(touchees.map((e) => e.pays));
  if (codes.size > 1) return { pays: null, motif: 'TRACE_AMBIGU', entites: touchees.map((e) => e.nom) };
  const [entite] = touchees;
  if (entite.pays === null) return { pays: null, motif: 'TERRITOIRE_SANS_CODE', entites: [entite.nom] };
  return { pays: entite.pays, entite: entite.nom };
}
