import { describe, expect, it } from 'vitest';
import { parseAvatureListing, titleFromCard } from './avature.js';

describe('titleFromCard — le bouton n’est pas un intitulé de poste', () => {
  /**
   * Mesuré le 2026-09-05 sur careers.loreal.com : 20 des 40 cartes de la
   * première page rendaient « Apply Now », et 189 offres actives en base
   * portaient ce titre. Le candidat voyait 189 annonces identiques.
   */
  const url =
    'https://careers.loreal.com/en_US/jobs/JobDetail/Regional-Activation-Manager-m-f-d-for-the-Consumer-Products-Division-Romandie/253399';

  it('remplace un libellé de bouton par le titre porté par l’URL', () => {
    expect(titleFromCard('Apply Now', url)).toBe(
      'Regional Activation Manager m f d for the Consumer Products Division Romandie',
    );
  });

  it.each(['Apply', 'Postuler', 'Bewerben', 'View Job', 'En savoir plus', 'Read more'])(
    '« %s » est reconnu comme un bouton',
    (label) => {
      expect(titleFromCard(label, url)).not.toBe(label);
    },
  );

  it('garde un vrai titre tel quel', () => {
    expect(titleFromCard('Nordic Data & Analytics Manager', url)).toBe('Nordic Data & Analytics Manager');
  });

  it('ne fabrique rien quand l’URL ne porte pas de slug', () => {
    expect(titleFromCard('Apply Now', 'https://careers.loreal.com/en_US/jobs/')).toBeUndefined();
  });

  it('un titre qui CONTIENT le mot n’est pas confondu avec le bouton', () => {
    expect(titleFromCard('Apply Engineering Manager', url)).toBe('Apply Engineering Manager');
  });
});

describe('parseAvatureListing — le marqueur de date dépend de la langue', () => {
  /**
   * Le code ne connaissait que « Publié ». careers.loreal.com, servi en
   * anglais, écrit « Posted 01-Oct-2026 » : l'index restait introuvable et la
   * ville, pourtant juste avant, était perdue — 20 cartes sur 20 sans lieu.
   */
  const card = (marker: string) =>
    `<a href="/en_US/jobs/JobDetail/Nordic-Data-Analytics-Manager/9">Nordic Data & Analytics Manager</a>` +
    `<span>Copenhagen</span><span>${marker} 01-Oct-2026</span><p>A day in the role...</p>`;

  it.each(['Posted', 'Publié', 'Veröffentlicht', 'Publicado'])('« %s » situe la ville', (marker) => {
    const [job] = parseAvatureListing(card(marker));
    expect(job.location).toBe('Copenhagen');
  });

  it('lit aussi la date de publication', () => {
    const [job] = parseAvatureListing(card('Posted'));
    expect(job.postedAt?.getUTCFullYear()).toBe(2026);
  });
});
