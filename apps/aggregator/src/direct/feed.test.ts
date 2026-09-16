import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURSEUR_CATWALKS, FluxIndisponibleError, consommerFlux, fluxHttp, type SourceFlux } from './feed.js';
import { evenementPublie, evenementRetire, offreBrute, page } from './fixture.js';

/**
 * LE CONSOMMATEUR DU FLUX, SUR UNE VRAIE BASE (lot 6, D-423).
 *
 * Ce qu'il doit prouver : la pagination au-delà d'une page, l'idempotence
 * (rejeu, doublon), la monotonie des versions (désordre, pas de résurrection),
 * le retrait, le refus d'un contrat étranger, la panne HTTP nommée, la reprise
 * depuis le curseur. Base jetable seulement : la table des événements est
 * immuable en SQL, on la vide par TRUNCATE entre deux campagnes.
 */
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
const enabled = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /test/i.test(url.pathname);

const P = 'flux-temoin-';
type Brut = { seq: string; version: string; evenement: string; offre?: unknown; offreId?: string };

/** Une source en mémoire qui sert par séquence, comme le backend, et note ce qu'on lui demande. */
function sourceMemoire(evenements: Brut[]) {
  const lectures: [string, number][] = [];
  const source: SourceFlux = {
    async lire(depuis, limite) {
      lectures.push([depuis.toString(), limite]);
      const suite = evenements.filter((e) => BigInt(e.seq) > depuis).slice(0, limite);
      return page(suite, suite.length ? suite[suite.length - 1].seq : null);
    },
  };
  return { source, lectures };
}
const publie = (seq: number, version: number, id: string, surcharges: Record<string, unknown> = {}) =>
  evenementPublie(seq, version, offreBrute({ id, slug: `slug-${id}`, ...surcharges })) as Brut;

describe.skipIf(!enabled)('consommation du flux d’outbox catalogue', () => {
  const prisma = new PrismaClient();
  const nettoyer = async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "DirectOfferEvent"');
    await prisma.directOffer.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.directFeedCursor.deleteMany({ where: { id: CURSEUR_CATWALKS } });
  };
  beforeAll(nettoyer);
  afterAll(async () => {
    await nettoyer();
    await prisma.$disconnect();
  });

  const masse = Array.from({ length: 1_203 }, (_, i) => publie(i + 1, 1, `${P}o-${i + 1}`));

  it('PRÉMISSE puis preuve — 1 203 événements dépassent une page de 500 : quatre lectures, tout appliqué, curseur au bout', async () => {
    expect(masse.length).toBeGreaterThan(500);
    const { source, lectures } = sourceMemoire(masse);
    const stats = await consommerFlux(prisma, source, { taillePage: 500 });
    expect(lectures).toEqual([['0', 500], ['500', 500], ['1000', 500], ['1203', 500]]);
    expect(stats).toMatchObject({ pages: 4, evenements: 1_203, appliques: 1_203, stales: 0, inconnus: 0, dejaVus: 0, dernierSeq: BigInt(1_203) });
    expect(stats.refus).toBeUndefined();
    expect(await prisma.directOffer.count({ where: { id: { startsWith: `${P}o-` }, eligible: true } })).toBe(1_203);
    expect(await prisma.directOfferEvent.count()).toBe(1_203);
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: CURSEUR_CATWALKS } })).lastSeq).toBe(BigInt(1_203));
  }, 180_000);

  it('rejouer depuis zéro ne change rien : chaque séquence est déjà vue, aucune ligne n’est réécrite', async () => {
    const avant = await prisma.directOffer.findUniqueOrThrow({ where: { id: `${P}o-7` } });
    const stats = await consommerFlux(prisma, sourceMemoire(masse).source, { taillePage: 500, depuis: BigInt(0) });
    expect(stats).toMatchObject({ evenements: 1_203, appliques: 0, dejaVus: 1_203 });
    const apres = await prisma.directOffer.findUniqueOrThrow({ where: { id: `${P}o-7` } });
    expect(apres.updatedAt.getTime()).toBe(avant.updatedAt.getTime());
    expect(apres.version).toBe(BigInt(1));
    expect(await prisma.directOfferEvent.count()).toBe(1_203);
  }, 180_000);

  it('une version plus ancienne arrivée après la plus récente est STALE : la ligne garde la plus récente', async () => {
    const { source } = sourceMemoire([publie(2001, 3, `${P}x`, { titre: 'Version B' }), publie(2002, 2, `${P}x`, { titre: 'Version A' })]);
    const stats = await consommerFlux(prisma, source, { taillePage: 500 });
    expect(stats).toMatchObject({ appliques: 1, stales: 1 });
    const x = await prisma.directOffer.findUniqueOrThrow({ where: { id: `${P}x` } });
    expect(x).toMatchObject({ title: 'Version B', version: BigInt(3), eligible: true });
    expect((await prisma.directOfferEvent.findUniqueOrThrow({ where: { seq: BigInt(2002) } })).effet).toBe('STALE');
  });

  it('RETIRE rend l’offre inéligible en gardant sa projection ; une version antérieure ne la ressuscite pas ; une nouvelle la republie', async () => {
    const { source } = sourceMemoire([evenementRetire(2003, 4, `${P}x`) as Brut, publie(2004, 3, `${P}x`, { titre: 'Version B' })]);
    expect(await consommerFlux(prisma, source, { taillePage: 500 })).toMatchObject({ appliques: 1, stales: 1 });
    let x = await prisma.directOffer.findUniqueOrThrow({ where: { id: `${P}x` } });
    expect(x).toMatchObject({ eligible: false, version: BigInt(4), title: 'Version B', appliedSeq: BigInt(2003) });
    expect(await consommerFlux(prisma, sourceMemoire([publie(2005, 5, `${P}x`, { titre: 'Version C' })]).source)).toMatchObject({ appliques: 1 });
    x = await prisma.directOffer.findUniqueOrThrow({ where: { id: `${P}x` } });
    expect(x).toMatchObject({ eligible: true, version: BigInt(5), title: 'Version C' });
  });

  it('RETIRE d’une offre jamais vue est INCONNU : tracé, sans ligne créée', async () => {
    const stats = await consommerFlux(prisma, sourceMemoire([evenementRetire(2006, 1, `${P}jamais-vue`) as Brut]).source);
    expect(stats).toMatchObject({ inconnus: 1, appliques: 0, dernierSeq: BigInt(2006) });
    expect(await prisma.directOffer.findUnique({ where: { id: `${P}jamais-vue` } })).toBeNull();
    expect((await prisma.directOfferEvent.findUniqueOrThrow({ where: { seq: BigInt(2006) } })).effet).toBe('INCONNU');
  });

  it('un contrat d’une autre version refuse tout le flux, le note sur le curseur, et le curseur n’avance pas', async () => {
    const source: SourceFlux = { async lire() { return { version: 2, evenements: [], suivant: null }; } };
    const stats = await consommerFlux(prisma, source);
    expect(stats.refus).toMatch(/flux\.version/);
    expect(stats.evenements).toBe(0);
    const curseur = await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: CURSEUR_CATWALKS } });
    expect(curseur.lastError).toMatch(/flux\.version/);
    expect(curseur.lastSeq).toBe(BigInt(2006));
  });

  it('un événement malformé refuse SA PAGE ENTIÈRE : rien de la page n’est appliqué à moitié', async () => {
    const fautif = publie(2008, 1, `${P}fautive`, { lieu: { ...(offreBrute().lieu as object), pays: 'France' } });
    const stats = await consommerFlux(prisma, sourceMemoire([publie(2007, 1, `${P}saine`), fautif]).source);
    expect(stats.refus).toMatch(/flux\.evenements\[1\]\.offre\.lieu\.pays/);
    expect(await prisma.directOffer.findUnique({ where: { id: `${P}saine` } })).toBeNull();
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: CURSEUR_CATWALKS } })).lastSeq).toBe(BigInt(2006));
  });

  it('le flux HTTP porte la clé en Bearer et la séquence ; une panne est une erreur nommée, notée sur le curseur', async () => {
    const appels: { url: string; auth: string | null }[] = [];
    const reponse = (status: number, corps: unknown) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
    let scenario: 'panne' | 'transport' | 'ok' = 'panne';
    const fetchStub: typeof fetch = async (entree, init) => {
      const h = new Headers(init?.headers);
      appels.push({ url: String(entree), auth: h.get('authorization') });
      if (scenario === 'transport') throw new TypeError('fetch failed');
      if (scenario === 'panne') return reponse(503, { error: 'indisponible' });
      // Comme le backend : rien au-delà de la dernière séquence.
      const depuis = BigInt(new URL(String(entree)).searchParams.get('depuis') ?? '0');
      return reponse(200, depuis >= BigInt(2009) ? page([]) : page([publie(2009, 1, `${P}http`)]));
    };
    const source = fluxHttp('https://backend.example/', 'cle-de-test', fetchStub);

    await expect(consommerFlux(prisma, source, { taillePage: 50 })).rejects.toBeInstanceOf(FluxIndisponibleError);
    await expect(consommerFlux(prisma, source, { taillePage: 50 })).rejects.toMatchObject({ statut: 503 });
    expect(appels[0]).toEqual({ url: 'https://backend.example/api/catalogue/flux?depuis=2006&limite=50', auth: 'Bearer cle-de-test' });
    expect((await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: CURSEUR_CATWALKS } })).lastError).toBe('Flux catalogue indisponible : HTTP 503');

    scenario = 'transport';
    await expect(consommerFlux(prisma, source)).rejects.toMatchObject({ statut: null });

    scenario = 'ok';
    const stats = await consommerFlux(prisma, source, { taillePage: 50 });
    expect(stats).toMatchObject({ appliques: 1, dernierSeq: BigInt(2009) });
    const curseur = await prisma.directFeedCursor.findUniqueOrThrow({ where: { id: CURSEUR_CATWALKS } });
    expect(curseur.lastError).toBeNull();
    expect(curseur.lastSeq).toBe(BigInt(2009));
  });

  it('la reprise lit depuis le curseur, jamais depuis zéro', async () => {
    const { source, lectures } = sourceMemoire([...masse, publie(2010, 1, `${P}reprise`)]);
    const stats = await consommerFlux(prisma, source, { taillePage: 500 });
    expect(lectures[0]).toEqual(['2009', 500]);
    expect(stats).toMatchObject({ evenements: 1, appliques: 1, dejaVus: 0 });
  });
});
