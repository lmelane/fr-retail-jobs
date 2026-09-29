import { beforeEach, describe, expect, it } from 'vitest';
import { INTERVALLE_ALERTE_MS, INTERVALLE_VERIFICATION_MS, reinitialiserSurveillance, surveillerFileRecherche } from './search-alert';

/** La surveillance de la file de recherche (D-475, plan §3.2) : seuil de 60 s, une alerte par heure au plus. */
describe('surveillance de la file de recherche', () => {
  beforeEach(reinitialiserSurveillance);
  const statut = (oldestSeconds: number | null) => async () => ({ version: 'search-5-test', pending: 12, oldestSeconds });
  const boite = () => { const envois: { sujet: string; html: string }[] = []; return { envois, envoyer: async (sujet: string, html: string) => { envois.push({ sujet, html }); return true; } }; };

  it('ne signale rien sous le seuil, ni file vide', async () => {
    const b = boite();
    expect(await surveillerFileRecherche({ maintenant: 1e12, statut: statut(60), envoyer: b.envoyer })).toBe('ok');
    expect(await surveillerFileRecherche({ maintenant: 1e12 + INTERVALLE_VERIFICATION_MS, statut: statut(null), envoyer: b.envoyer })).toBe('ok');
    expect(b.envois).toEqual([]);
  });

  it('alerte au-delà de 60 s, une fois par heure, et sans tiret cadratin (D-319)', async () => {
    const b = boite(), t = 1e12;
    expect(await surveillerFileRecherche({ maintenant: t, statut: statut(61), envoyer: b.envoyer })).toBe('alerte');
    expect(await surveillerFileRecherche({ maintenant: t + 1, statut: statut(400), envoyer: b.envoyer })).toBe('attente');
    expect(await surveillerFileRecherche({ maintenant: t + INTERVALLE_VERIFICATION_MS, statut: statut(400), envoyer: b.envoyer })).toBe('deja-signalee');
    expect(await surveillerFileRecherche({ maintenant: t + INTERVALLE_ALERTE_MS, statut: statut(400), envoyer: b.envoyer })).toBe('alerte');
    expect(b.envois).toHaveLength(2);
    expect(b.envois[0].sujet).toContain('12 offre(s)');
    expect(b.envois.every((e) => !`${e.sujet}${e.html}`.includes('—'))).toBe(true);
  });

  it('un envoi manqué (clé absente, Brevo en panne) se retente à la vérification suivante', async () => {
    const t = 1e12;
    expect(await surveillerFileRecherche({ maintenant: t, statut: statut(120), envoyer: async () => false })).toBe('non-envoyee');
    const b = boite();
    expect(await surveillerFileRecherche({ maintenant: t + INTERVALLE_VERIFICATION_MS, statut: statut(120), envoyer: b.envoyer })).toBe('alerte');
    expect(b.envois).toHaveLength(1);
  });

  it('ne lève jamais : une panne de lecture n’arrête pas l’indexeur', async () => {
    await expect(surveillerFileRecherche({ maintenant: 1e12, statut: async () => { throw new Error('base indisponible'); } })).resolves.toBe('non-envoyee');
  });

  it('sans clé Brevo, rien ne part et rien ne lève', async () => {
    const avant = { cle: process.env.BREVO_API_KEY, expediteur: process.env.BREVO_SENDER_EMAIL };
    delete process.env.BREVO_API_KEY; delete process.env.BREVO_SENDER_EMAIL;
    try { expect(await surveillerFileRecherche({ maintenant: 1e12, statut: statut(500) })).toBe('non-envoyee'); }
    finally { if (avant.cle) process.env.BREVO_API_KEY = avant.cle; if (avant.expediteur) process.env.BREVO_SENDER_EMAIL = avant.expediteur; }
  });
});
