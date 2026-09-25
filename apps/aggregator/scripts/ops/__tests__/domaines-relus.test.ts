import { describe, expect, it } from 'vitest';
import { ecrire, empreinte, planifier, validerFichier, type ClientEcriture, type DomaineRelu, type EtatSociete, type FichierRelu } from '../domaines-relus.js';

/**
 * Le plan des domaines relus (logos manquants, 25/09/2026). Ce qui doit rester impossible : écraser un
 * domaine que la relecture n'a pas vu, écrire sur une société renommée ou fusionnée, poser un hôte d'ATS
 * (son logo s'afficherait sur toutes les Maisons du tenant), écrire une ligne douteuse.
 */
const ligne = (d: Partial<DomaineRelu> = {}): DomaineRelu => ({
  id: 'c1', nom: 'Courir', domaine: 'courir.com', ancienDomaine: null, preuve: 'https://www.courir.com/', confiance: 'HAUTE', ...d,
});
const fichier = (...domaines: DomaineRelu[]): FichierRelu => ({ lot: 'logos-relu-2026-09-25', relecteur: 'témoin', reluLe: '2026-09-25', domaines });
const etats = (...xs: Array<Partial<EtatSociete> & { id: string }>) =>
  new Map(xs.map((x) => [x.id, { name: 'Courir', domain: null, mergedIntoId: null, ...x } as EtatSociete]));
const etat = (f: FichierRelu, e: ReturnType<typeof etats>) => planifier(f, e).map((a) => a.etat);

describe('planifier les domaines relus', () => {
  it('complète le domaine vide de la société relue, sous son nom relu', () => {
    expect(etat(fichier(ligne()), etats({ id: 'c1' }))).toEqual(['ECRIRE']);
  });

  it("n'écrase jamais un domaine que la relecture n'a pas désigné", () => {
    const [a] = planifier(fichier(ligne()), etats({ id: 'c1', domain: 'groupe-courir.fr' }));
    expect(a.etat).toBe('REFUS');
    expect(a.motif).toContain('groupe-courir.fr');
  });

  it('corrige une valeur fausse seulement si elle est encore celle qui a été relue', () => {
    const correction = ligne({ nom: 'Talbots', domaine: 'talbots.com', ancienDomaine: 'talbots.co.jp' });
    expect(etat(fichier(correction), etats({ id: 'c1', name: 'Talbots', domain: 'talbots.co.jp' }))).toEqual(['ECRIRE']);
    expect(etat(fichier(correction), etats({ id: 'c1', name: 'Talbots', domain: 'talbots.fr' }))).toEqual(['REFUS']);
    expect(etat(fichier(correction), etats({ id: 'c1', name: 'Talbots', domain: null }))).toEqual(['REFUS']);
  });

  it("retire un domaine faux (logo d'une autre entreprise) seulement s'il est encore celui qui a été relu", () => {
    const retrait = ligne({ nom: 'Donzé-Baume', domaine: null, ancienDomaine: 'swatchgroup.com' });
    expect(etat(fichier(retrait), etats({ id: 'c1', name: 'Donzé-Baume', domain: 'swatchgroup.com' }))).toEqual(['ECRIRE']);
    expect(etat(fichier(retrait), etats({ id: 'c1', name: 'Donzé-Baume', domain: null }))).toEqual(['DEJA_POSE']);
    expect(etat(fichier(retrait), etats({ id: 'c1', name: 'Donzé-Baume', domain: 'richemont.com' }))).toEqual(['REFUS']);
  });

  it('refuse un retrait qui ne nomme pas la valeur qu’il ôte', () => {
    expect(etat(fichier(ligne({ domaine: null, ancienDomaine: null })), etats({ id: 'c1' }))).toEqual(['REFUS']);
  });

  it('laisse tel quel un domaine déjà posé à la même valeur (idempotent)', () => {
    expect(etat(fichier(ligne()), etats({ id: 'c1', domain: 'courir.com' }))).toEqual(['DEJA_POSE']);
  });

  it('refuse une société renommée, fusionnée ou absente', () => {
    expect(etat(fichier(ligne()), etats({ id: 'c1', name: 'Groupe Courir' }))).toEqual(['REFUS']);
    expect(etat(fichier(ligne()), etats({ id: 'c1', mergedIntoId: 'c9' }))).toEqual(['REFUS']);
    expect(etat(fichier(ligne()), etats())).toEqual(['REFUS']);
  });

  it("refuse un sous-domaine, un hôte d'éditeur d'ATS ou une forme invalide", () => {
    for (const domaine of ['careers.lovisa.com', 'puma.wd3.myworkdayjobs.com', 'Courir.com', 'courir', 'https://courir.com']) {
      expect(etat(fichier(ligne({ domaine })), etats({ id: 'c1' }))).toEqual(['REFUS']);
    }
  });

  it('refuse une ligne sans preuve https ou de confiance non haute, et un doublon', () => {
    expect(etat(fichier(ligne({ preuve: 'http://www.courir.com/' })), etats({ id: 'c1' }))).toEqual(['REFUS']);
    expect(etat(fichier(ligne({ confiance: 'MOYENNE' as 'HAUTE' })), etats({ id: 'c1' }))).toEqual(['REFUS']);
    expect(etat(fichier(ligne(), ligne()), etats({ id: 'c1' }))).toEqual(['ECRIRE', 'REFUS']);
  });

  it("change d'empreinte quand la base change entre l'inspection et l'écriture", () => {
    const f = fichier(ligne());
    const avant = empreinte(f.lot, planifier(f, etats({ id: 'c1' })));
    expect(empreinte(f.lot, planifier(f, etats({ id: 'c1' })))).toBe(avant);
    expect(empreinte(f.lot, planifier(f, etats({ id: 'c1', domain: 'courir.com' })))).not.toBe(avant);
  });
});

/**
 * Une base en mémoire aux règles de Prisma pour ce que `ecrire` utilise : `updateMany` compte les lignes dont
 * TOUS les champs du filtre sont égaux (`null` = IS NULL), et une transaction qui lève n'écrit rien.
 */
type Ligne = { id: string; name: string; domain: string | null; domainSource: string | null; mergedIntoId: string | null };
function baseEnMemoire(lignes: Ligne[], runsOuverts = 0) {
  let table = lignes.map((l) => ({ ...l }));
  const appels = { updateMany: 0, filtreRun: undefined as unknown };
  const correspond = (l: Ligne, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => l[k as keyof Ligne] === v);
  const company = (lignesVisibles: () => Ligne[], ecrireLignes: (t: Ligne[]) => void) => ({
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Ligne> }) => {
      appels.updateMany++;
      const t = lignesVisibles();
      let count = 0;
      ecrireLignes(t.map((l) => (correspond(l, where) ? (count++, { ...l, ...data }) : l)));
      return { count };
    },
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => lignesVisibles().filter((l) => where.id.in.includes(l.id)),
  });
  const client = {
    company: company(() => table, (t) => { table = t; }),
    pipelineRun: { count: async ({ where }: { where: unknown }) => { appels.filtreRun = where; return runsOuverts; } },
    $transaction: async <T>(travail: (tx: unknown) => Promise<T>) => {
      let copie = table.map((l) => ({ ...l }));
      const resultat = await travail({ company: company(() => copie, (t) => { copie = t; }) });
      table = copie; // validée seulement si le travail n'a pas levé
      return resultat;
    },
  };
  return { client: client as unknown as ClientEcriture, table: () => table, appels, modifier: (id: string, patch: Partial<Ligne>) => {
    table = table.map((l) => (l.id === id ? { ...l, ...patch } : l));
  } };
}

describe('écrire le plan inspecté', () => {
  const courir = ligne({ id: 'c1' });
  const donze = ligne({ id: 'c2', nom: 'Donzé-Baume', domaine: null, ancienDomaine: 'swatchgroup.com', preuve: 'https://www.richemont.com/' });
  const etatInitial = (): Ligne[] => [
    { id: 'c1', name: 'Courir', domain: null, domainSource: null, mergedIntoId: null },
    { id: 'c2', name: 'Donzé-Baume', domain: 'swatchgroup.com', domainSource: 'manual', mergedIntoId: null },
  ];
  const plan = (lignes: Ligne[]) => planifier(fichier(courir, donze), new Map(lignes.map((l) => [l.id, l])));

  it('écrit exactement le plan, sous le lot relu, et relit la base conforme', async () => {
    const base = baseEnMemoire(etatInitial());
    const actions = plan(base.table());
    const r = await ecrire(base.client, fichier(courir, donze), actions, empreinte('logos-relu-2026-09-25', actions), new Date('2026-09-25T20:00:00Z'));
    expect(r).toEqual({ ecrites: 2, conformes: 2, attendues: 2 });
    expect(base.table()).toEqual([
      { id: 'c1', name: 'Courir', domain: 'courir.com', domainSource: 'logos-relu-2026-09-25', mergedIntoId: null },
      { id: 'c2', name: 'Donzé-Baume', domain: null, domainSource: 'logos-relu-2026-09-25', mergedIntoId: null },
    ]);
    // Le RUN cherché est celui des 12 dernières heures, encore ouvert.
    expect(base.appels.filtreRun).toEqual({ status: 'RUNNING', finishedAt: null, startedAt: { gt: new Date('2026-09-25T08:00:00Z') } });
  });

  it("refuse une empreinte qui n'est pas celle du plan, sans rien écrire", async () => {
    const base = baseEnMemoire(etatInitial());
    const actions = plan(base.table());
    const perimee = empreinte('logos-relu-2026-09-25', plan([{ ...etatInitial()[0], domain: 'courir.com' }, etatInitial()[1]]));
    expect(await ecrire(base.client, fichier(courir, donze), actions, perimee)).toHaveProperty('refus');
    expect(base.appels.updateMany).toBe(0);
    expect(base.table()).toEqual(etatInitial());
  });

  it('refuse pendant un RUN, sans rien écrire', async () => {
    const base = baseEnMemoire(etatInitial(), 1);
    const actions = plan(base.table());
    expect(await ecrire(base.client, fichier(courir, donze), actions, empreinte('logos-relu-2026-09-25', actions))).toHaveProperty('refus');
    expect(base.appels.updateMany).toBe(0);
  });

  it("n'écrit rien si une société a changé entre le plan et l'écriture (tout ou rien)", async () => {
    const base = baseEnMemoire(etatInitial());
    const actions = plan(base.table());
    base.modifier('c2', { domain: 'richemont.com' }); // une écriture concurrente après la lecture
    await expect(ecrire(base.client, fichier(courir, donze), actions, empreinte('logos-relu-2026-09-25', actions))).rejects.toThrow(/Donzé-Baume/);
    // Courir, pourtant applicable et traité le premier, n'a pas été écrit.
    expect(base.table()[0]).toEqual(etatInitial()[0]);
    expect(base.table()[1].domain).toBe('richemont.com');
  });
});

describe('valider le fichier relu', () => {
  it('exige un lot nommé sur la convention des lots relus, un relecteur, une date et des lignes complètes', () => {
    expect(() => validerFichier({ ...fichier(ligne()), lot: 'manual' })).toThrow();
    expect(() => validerFichier({ ...fichier(ligne()), relecteur: ' ' })).toThrow();
    expect(() => validerFichier({ ...fichier(ligne()), reluLe: 'hier' })).toThrow();
    expect(() => validerFichier({ ...fichier(), domaines: [] })).toThrow();
    expect(() => validerFichier({ ...fichier(ligne()), domaines: [{ id: 'c1' }] })).toThrow();
    expect(validerFichier(fichier(ligne())).lot).toBe('logos-relu-2026-09-25');
  });
});
