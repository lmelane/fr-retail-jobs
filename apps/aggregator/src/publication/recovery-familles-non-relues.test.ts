import { describe, expect, it } from 'vitest';
import { recoverRetainedPublication, retainedPublicationIdentity } from './recovery.js';

/**
 * LE REJEU DOIT SAVOIR RELIRE eightfold ET eqwa.
 *
 * Ces deux familles conservent leur entrée native entière dans `raw`, mais étaient absentes du
 * `switch` de `recovery.ts` : elles tombaient dans `default` → READER_UNQUALIFIED. Kering
 * (1 035 offres) et Nocibé (288) ont été capturées, conservées, puis refusées à la validation sur
 * NO_QUALIFIED_PUBLICATION, faute d'avoir pu être relues.
 *
 * CHAQUE TÉMOIN AFFIRME D'ABORD SA PRÉMISSE — que le `raw` porte bien tout ce qu'il faut — avant
 * de vérifier le résultat. Un témoin dont le jeu d'essai ne remplit pas la condition du défaut
 * passe au vert sans rien tester : c'est le faux négatif rassurant que ces assertions écartent.
 */
describe('rejeu des publications retenues', () => {
  describe('eightfold', () => {
    // La forme réelle d'une position Eightfold, telle que l'adaptateur la conserve (`raw: position`).
    const position = {
      id: 12345,
      name: 'Conseiller de vente',
      locations: ['Paris, France'],
      t_create: 1757000000,




    };
    const config = { origin: 'https://careers.kering.com' };
    const contexte = {
      externalId: '12345',
      url: 'https://careers.kering.com/careers/job/12345',
      observedAt: new Date('2026-09-19T10:00:00Z'),
      config,
    };

    it('reconstruit l\'offre depuis la position conservée', () => {
      // PRÉMISSE : le raw porte bien l'identifiant et l'intitulé — sans eux, le test ne prouve rien.
      expect(position.id).toBeTruthy();
      expect(position.name).toBeTruthy();

      /*
       * `retainedPublicationIdentity` relit SANS exiger la description — et c'est bien la
       * relecture qu'on éprouve ici. Une position Eightfold réelle ne porte PAS de description
       * (elle est fusionnée après coup, hors du `raw` : limite documentée dans recovery.ts), donc
       * passer par `recoverRetainedPublication` rendrait CONTENT_MISSING et masquerait le fait
       * que la branche fonctionne.
       */
      const resultat = retainedPublicationIdentity('eightfold', position, contexte);
      expect(resultat.status).toBe('VERIFIED');
    });

    it('refuse une position sans identifiant natif, au lieu de l\'inventer', () => {
      const { id: _id, ...sansId } = position;
      const resultat = recoverRetainedPublication('eightfold', { ...sansId, name: undefined }, contexte);
      expect(resultat.status).toBe('RECOLLECT_OR_REVIEW');
    });
  });

  describe('eqwa', () => {
    // La forme réelle d'une ligne Eqwa (`raw: row`), telle qu'elle revient du stockage : la date
    // y est une CHAÎNE ISO, pas une Date — c'est précisément ce que la branche doit rattraper.
    const row = {
      externalId: '807',
      title: 'Conseiller(ère) de vente',
      url: 'https://recrutement-nocibe.fr/front-jobs-detail.html?id_job=807',
      postedAt: '2026-09-01T00:00:00.000Z',
      contract: 'CDI',
      region: 'Hauts-de-France',
      city: 'Lille',
      postalCode: '59000',
      detailHtml: '<div class="job-detail-desc">Vous accompagnez nos clients en parfumerie.</div>',
      detailUrl: 'https://recrutement-nocibe.fr/front-jobs-detail.html?id_job=807',
    };
    const contexte = {
      externalId: '807',
      url: 'https://recrutement-nocibe.fr/front-jobs-detail.html?id_job=807',
      observedAt: new Date('2026-09-19T10:00:00Z'),
      config: { origin: 'https://recrutement-nocibe.fr' },
    };

    it('reconstruit l\'offre et remet la date en Date', () => {
      // PRÉMISSE : la date arrive bien en chaîne — si elle était déjà une Date, le témoin
      // n'exercerait pas la conversion qu'il prétend vérifier.
      expect(typeof row.postedAt).toBe('string');

      const resultat = recoverRetainedPublication('eqwa', row, contexte);
      expect(resultat.status).toBe('RECOVERABLE');
      if (resultat.status !== 'RECOVERABLE') return;
      expect(resultat.job.title).toBe('Conseiller(ère) de vente');
      expect(resultat.job.city).toBe('Lille');
      expect(resultat.job.postedAt).toBeInstanceOf(Date);
    });

    it('refuse une ligne sans intitulé, au lieu de publier une offre muette', () => {
      const resultat = recoverRetainedPublication('eqwa', { ...row, title: '  ' }, contexte);
      expect(resultat.status).toBe('RECOLLECT_OR_REVIEW');
    });
  });

  describe('avature', () => {
    /*
     * Le RAW tel que l'adaptateur le conserve DEPUIS le 19/09/2026 : les champs lus, plus la
     * fiche de détail. Avant ce jour il valait `{source, url}` — rien à relire.
     */
    const carte = {
      source: 'avature-portal',
      externalId: '253399',
      title: 'Regional Activation Manager',
      url: 'https://careers.loreal.com/fr_FR/careers/JobDetail/253399',
      location: 'Paris',
      description: 'Vous pilotez les activations régionales.',
      reference: 'REF-253399',
      department: 'Marketing',
    };
    const contexte = {
      externalId: '253399',
      url: 'https://careers.loreal.com/fr_FR/careers/JobDetail/253399',
      observedAt: new Date('2026-09-19T10:00:00Z'),
      config: { origin: 'https://careers.loreal.com' },
    };

    it('reconstruit l\'offre depuis les champs conservés', () => {
      // PRÉMISSE : le raw porte bien l'intitulé — c'est précisément ce qui manquait avant.
      expect(carte.title).toBeTruthy();
      expect(carte.description).toBeTruthy();

      const resultat = recoverRetainedPublication('avature', carte, contexte);
      expect(resultat.status).toBe('RECOVERABLE');
      if (resultat.status !== 'RECOVERABLE') return;
      expect(resultat.job.title).toBe('Regional Activation Manager');
    });

    it('refuse un RAW de l\'ancienne forme au lieu de publier une offre muette', () => {
      // PRÉMISSE : l'ancienne forme ne porte NI intitulé NI identifiant — le défaut d'origine.
      const ancien = { source: 'avature', url: contexte.url };
      expect('title' in ancien).toBe(false);

      const resultat = recoverRetainedPublication('avature', ancien, contexte);
      expect(resultat.status).toBe('RECOLLECT_OR_REVIEW');
    });
  });

  describe('swatchgroup', () => {
    const page = {
      source: 'swatchgroup',
      title: 'Horloger',
      url: 'https://www.swatchgroup.com/fr/carrieres/12345',
      language: 'fr',
      location: 'Bienne',
      city: 'Bienne',
      country: 'CH',
      company: 'Omega',
      description: 'Vous assemblez des mouvements mécaniques.',
    };
    const contexte = {
      externalId: '12345',
      url: 'https://www.swatchgroup.com/fr/carrieres/12345',
      observedAt: new Date('2026-09-19T10:00:00Z'),
      config: {},
    };

    it('reconstruit l\'offre depuis les champs conservés', () => {
      expect(page.title).toBeTruthy();
      const resultat = recoverRetainedPublication('swatchgroup', page, contexte);
      expect(resultat.status).toBe('RECOVERABLE');
      if (resultat.status !== 'RECOVERABLE') return;
      expect(resultat.job.title).toBe('Horloger');
      expect(resultat.job.city).toBe('Bienne');
    });

    it('refuse un RAW de l\'ancienne forme', () => {
      const ancien = { source: 'swatchgroup', legalEntity: 'Omega SA', logo: 'x.png' };
      expect('title' in ancien).toBe(false);
      const resultat = recoverRetainedPublication('swatchgroup', ancien, contexte);
      expect(resultat.status).toBe('RECOLLECT_OR_REVIEW');
    });
  });

  /**
   * LE TÉMOIN DU DÉFAUT LUI-MÊME : une famille absente du `switch` doit rendre
   * READER_UNQUALIFIED. Il prouve que le verdict observé sur Kering et Nocibé venait bien de
   * l'absence de branche — et il repasserait au rouge si quelqu'un ajoutait un repli silencieux
   * qui accepte n'importe quel format.
   */
  it('rend READER_UNQUALIFIED pour une famille qu\'aucune branche ne lit', () => {
    const resultat = recoverRetainedPublication('famille-inexistante', { id: 1, title: 'x' }, {
      externalId: '1', url: 'https://example.com/1', observedAt: new Date(), config: {},
    });
    expect(resultat).toEqual({ status: 'RECOLLECT_OR_REVIEW', reason: 'READER_UNQUALIFIED' });
  });
});
