import { describe, it, expect } from 'vitest';
import { withHardDeadline, HardDeadlineError } from '../lib/hardDeadline.js';

/**
 * L'ÉCHÉANCE FERME — celle qui coupe, par opposition à celle qu'on demande poliment.
 *
 * Défaut mesuré le 2026-09-13 pendant la vague 1 de P9 : `validate-candidate.mts` passe `deadlineMs` DANS la
 * configuration de l'adaptateur (`fetchAtsJobs(ats, { ...config, deadlineMs })`). C'est une échéance
 * COOPÉRATIVE : elle ne vaut que si l'adaptateur la lit. `avature.ts` ne la lit pas.
 *
 * Conséquence réelle : sur `ralph-lauren-avature`, l'amorçage WAF a réussi en 7,5 s puis le processus est
 * resté bloqué **64 minutes** sans produire une ligne, avec `--deadline-ms=300000` sur la ligne de commande.
 * La chaîne entière était figée derrière lui — et rien ne l'aurait jamais débloquée.
 *
 * Une échéance qu'un appelé peut ignorer n'est pas une échéance : c'est une suggestion. Ce module la rend
 * ferme du côté de l'APPELANT, donc indépendante du bon vouloir de chaque adaptateur.
 */
describe('échéance ferme — elle coupe même si l\'appelé l\'ignore', () => {
  it('rend la valeur quand le travail finit à temps', async () => {
    await expect(withHardDeadline(50_000, async () => 'fini', 'test')).resolves.toBe('fini');
  });

  it('COUPE un travail qui ignore complètement l\'échéance', async () => {
    // Le cas réel : une promesse qui ne se résout jamais, exactement ce qu'a fait l'adaptateur Avature.
    const jamais = new Promise<string>(() => { /* ne se résout jamais */ });
    await expect(withHardDeadline(60, () => jamais, 'avature')).rejects.toBeInstanceOf(HardDeadlineError);
  });

  it('nomme la source et le délai dans l\'erreur — un blocage doit se diagnostiquer, pas se deviner', async () => {
    const jamais = new Promise<string>(() => {});
    await expect(withHardDeadline(40, () => jamais, 'ralph-lauren-avature'))
      .rejects.toThrow(/ralph-lauren-avature.*40/);
  });

  it('laisse remonter une VRAIE erreur sans la convertir en dépassement', async () => {
    // Confondre « l'adaptateur a échoué » et « l'adaptateur est trop lent » enverrait chercher le mauvais défaut.
    const boom = async () => { throw new Error('robots 403'); };
    await expect(withHardDeadline(50_000, boom, 'x')).rejects.toThrow(/robots 403/);
    await expect(withHardDeadline(50_000, boom, 'x')).rejects.not.toBeInstanceOf(HardDeadlineError);
  });

  it('ne retient pas le processus après une réussite rapide', async () => {
    // Un `setTimeout` non annulé garderait la boucle d'événements vivante : le programme finirait par
    // « ne pas rendre la main », un défaut plus discret que le blocage qu'on corrige.
    const t0 = Date.now();
    await withHardDeadline(30_000, async () => 'vite', 'x');
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it('refuse une échéance absurde plutôt que de ne jamais couper', async () => {
    await expect(withHardDeadline(0, async () => 'x', 'x')).rejects.toThrow(/échéance/i);
    await expect(withHardDeadline(-1, async () => 'x', 'x')).rejects.toThrow(/échéance/i);
  });
});
