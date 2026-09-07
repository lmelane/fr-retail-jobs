import type { Metadata } from 'next';
import Link from 'next/link';
import { Block, Coverage, IntelPage, JsonLd, LevelTag, PageHead } from '@/components/intelligence/chrome';
import { BarList } from '@/components/intelligence/charts/bar-list';
import { getMethodology } from '@/lib/intelligence/queries/methodology';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { fmtDate, fmtInt, fmtPct, MIN_SAMPLE, MIN_SNAPSHOT_DAYS, OBSERVATION_START } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, DATA_LICENSE_NAME, DATA_LICENSE_URL, intelMetadata, webPageLd } from '@/lib/intelligence/seo';
import { siteUrl } from '@/lib/site-url';
import { FAMILY_LABELS, JOB_FUNCTIONS, SENIORITIES, SENIORITY_LABELS } from '@/lib/intelligence/taxonomy';

export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Méthodologie Catwalks Intelligence : couverture des sources, fréquence, déduplication (1 offre canonique + N sources), normalisation, taxonomie des 25 métiers, snapshots quotidiens, seuils, définitions fait / dérivé / lecture, limites.';

export async function generateMetadata(): Promise<Metadata> {
  return intelMetadata({ subject: 'Méthodologie de l’observatoire', description: DESCRIPTION, path: intelPaths.methodology });
}

/** Libellé lisible d'une famille d'adaptateur (clé `Source.kind`), sans URL. */
const KIND_LABELS: Record<string, string> = {
  teamtailor: 'Teamtailor', greenhouse: 'Greenhouse', 'smartrecruiters-whitelabel': 'SmartRecruiters', wttj: 'Welcome to the Jungle',
  personio: 'Personio', lever: 'Lever', recruitee: 'Recruitee', successfactors: 'SAP SuccessFactors', workday: 'Workday',
  'generic-listing': 'Site carrière (générique)', talentsoft: 'Talentsoft', talentview: 'TalentView', workable: 'Workable',
  digitalrecruiters: 'DigitalRecruiters', magnet: 'Magnet', eightfold: 'Eightfold', fashionjobs: 'FashionJobs', radancy: 'Radancy',
  lvmh_algolia: 'LVMH (Algolia)', avature: 'Avature', wordpress: 'WordPress', ashby: 'Ashby', phenom: 'Phenom', icims: 'iCIMS',
  'oracle-hcm': 'Oracle HCM', taleo: 'Taleo', altamira: 'Altamira', jobylon: 'Jobylon', jibe: 'Jibe', volcanic: 'Volcanic',
  'talent-funnel': 'Talent Funnel', eqwa: 'Eqwa', geodirectory: 'GeoDirectory', typesense: 'Typesense', rituals: 'Rituals', bash: 'Ba&sh',
  'swatch-group': 'Swatch Group', pinpoint: 'Pinpoint',
};

export default async function Page() {
  const [data, coverage] = await Promise.all([getMethodology(), getCoverage()]);
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: 'Méthodologie', path: intelPaths.methodology }];
  const fnCoverage = data.active > 0 ? 1 - data.unclassifiedFunction / data.active : 0;
  const senCoverage = data.active > 0 ? 1 - data.unclassifiedSeniority / data.active : 0;

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: 'Méthodologie Catwalks Intelligence', description: DESCRIPTION, path: intelPaths.methodology, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead crumbs={crumbs} title="Méthodologie." lede={<p>Ce que l'observatoire mesure, d'où viennent les chiffres, ce qu'ils ne disent pas. Chaque nombre affiché vient de la base ; rien n'est estimé ni extrapolé.</p>} />

      <section className="container" style={{ paddingTop: 48 }}>
        <div className="igrid">
          <div className="i6">
            <Block id="sources" title="Couverture des sources." level="fact">
              <p className="t-body soft mb-5 max-w-[60ch]">{fmtInt(data.sourcesTotal)} sources actives dans le catalogue, par famille d'ATS ou de portail. Deux flux de rang égal : les sites carrière et ATS des Maisons, et les jobboards spécialisés.</p>
              <BarList compact rows={data.sourcesByKind.map((k) => ({ label: KIND_LABELS[k.key] ?? k.key, value: k.count }))} />
            </Block>
          </div>
          <div className="i6">
            <Block id="chaine" title="Fréquence, déduplication, normalisation." level="fact">
              <dl className="defs">
                <dt>Fréquence</dt>
                <dd>Chaque source est relue quotidiennement. Une offre reste vivante tant qu'au moins une source la liste ; elle est fermée quand plus aucune ne la re-liste pendant 48 h, et ré-ouverte si une source la re-publie.</dd>
                <dt>Déduplication</dt>
                <dd>Une même offre vue par le site carrière, le portail du groupe et un jobboard est stockée une seule fois : 1 offre canonique + N sources. Les comptes ne comptent jamais deux fois le même poste.</dd>
                <dt>Employeur et groupe</dt>
                <dd>L'offre est créditée à la Maison qui la publie (Cartier, pas Richemont) ; le groupe est lu dans le référentiel des Maisons. Les suffixes juridiques et les entités locales sont retirés du nom.</dd>
                <dt>Lieu</dt>
                <dd>Pays normalisé ISO ; ville canonique (segments, exonymes, casse) partagée par la déduplication et l'affichage. Une offre sans pays identifiable est comptée « sans pays ».</dd>
                <dt>Contrat</dt>
                <dd>Vocabulaire fermé : CDI, CDD, Stage, Alternance, VIE, Intérim, Freelance, Graduate. Une source qui ne le dit pas donne « non précisé », jamais une valeur devinée.</dd>
              </dl>
            </Block>
          </div>
        </div>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="taxonomie" title="Taxonomie des métiers." level="fact">
          <p className="t-body soft mb-5 max-w-[66ch]">
            Classification par règles, à l'écriture, depuis le titre, le département et le texte de l'offre ; re-classée à chaque passage quand la version de la taxonomie avance. Couverture actuelle : métier renseigné sur {fmtPct(fnCoverage, 0)} des offres actives, séniorité sur {fmtPct(senCoverage, 0)}. Le reste est « non classé » et affiché comme tel.
          </p>
          <div className="igrid">
            <div className="i8">
              <div className="itable-wrap">
                <table className="itable">
                  <thead>
                    <tr><th>Fonction</th><th>Famille</th><th>Règle en une phrase</th></tr>
                  </thead>
                  <tbody>
                    {JOB_FUNCTIONS.map((f) => (
                      <tr key={f.key}>
                        <td><Link href={intelPaths.fn(f.key)}>{f.label}</Link></td>
                        <td className="muted">{FAMILY_LABELS[f.family]}</td>
                        <td className="muted">{RULES[f.key]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="i4">
              <p className="t-caption mb-3">Séniorité</p>
              <ul className="grid gap-2">
                {SENIORITIES.map((s) => (
                  <li key={s} className="t-body"><span className="muted">{s}</span> — {SENIORITY_LABELS[s]}</li>
                ))}
              </ul>
              <p className="t-body2 muted mt-4">« Early careers » = Stage + Alternance + Jeune diplômé. « Executive » = Directeur + Dirigeant. Famille Retail = les six fonctions de boutique ; Atelier = savoir-faire et production ; Corporate = le reste.</p>
            </div>
          </div>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <div className="igrid">
          <div className="i6">
            <Block id="snapshots" title="Snapshots quotidiens." level="fact">
              <p className="t-body soft max-w-[60ch]">
                Chaque jour, le pipeline photographie le marché : offres actives, nouvelles, fermées, Maisons qui recrutent, durée médiane, ré-ouvertures — pour le monde, chaque pays, ville, Maison, groupe, secteur, métier, séniorité, contrat, famille, et les croisements pays × métier et pays × secteur. Les comparaisons dans le temps lisent ces photographies, jamais la liste des offres du jour. L'historique commence le {fmtDate(coverage.historyStart)}{coverage.hasSnapshots ? '' : ' (premier snapshot à venir)'}. Les jours antérieurs au 6 septembre 2026 existent en base sous forme reconstruite (depuis les dates d'observation des offres) mais ne servent à aucun indice ni à aucune comparaison : seules les photographies prises en direct comptent, et un jour pris en direct n'est jamais ré-écrit.
              </p>
            </Block>
          </div>
          <div className="i6">
            <Block id="seuils" title="Seuils minimaux." level="fact">
              <p className="t-body soft max-w-[60ch]">
                Une métrique dérivée n'est affichée qu'à partir de {MIN_SAMPLE} offres dans le périmètre et de {MIN_SNAPSHOT_DAYS} jours de snapshot. En dessous : « n/d — échantillon insuffisant ». Une comparaison à J−n n'est affichée que si le snapshot daté exactement J−n existe : « disponible à partir du … » sinon. Aucune interpolation.
              </p>
            </Block>
          </div>
        </div>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="niveaux" title="Trois niveaux, séparés partout." level="fact">
          <div className="igrid">
            <div className="i4">
              <LevelTag level="fact" />
              <p className="t-body mt-2 max-w-[40ch]">Un compte observé : offres actives, nouvelles, fermées, Maisons, pays, villes. Toujours affiché, quel que soit le volume.</p>
            </div>
            <div className="i4">
              <LevelTag level="derived" />
              <p className="t-body mt-2 max-w-[40ch]">Un calcul sur des faits : part, variation, médiane, indice base 100, momentum, concentration, taux de repost, intensité. Seuillé.</p>
            </div>
            <div className="i4">
              <LevelTag level="insight" />
              <p className="t-body mt-2 max-w-[40ch]">Une phrase construite sur les chiffres affichés à côté d'elle — jamais une opinion sans nombre.</p>
            </div>
          </div>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="formules" title="Indices et formules." level="derived">
          <dl className="defs">
            <dt>Catwalks Global Hiring Index (CGHI)</dt>
            <dd>Base 100 au premier snapshot global. Valeur du jour = offres actives du jour / offres actives de la base × 100. Sous-indices : même formule sur chaque secteur, sur la famille retail, sur les early careers et sur les offres liées à l'IA.</dd>
            <dt>Hiring momentum (0-100)</dt>
            <dd>50 + 20·m7 + 15·m30 + 10·flux + 5·largeur, borné à [0, 100]. m7 = variation 7 j des actives / 10 %, bornée ±1 ; m30 = variation 30 j / 20 %, bornée ±1, neutre (0) tant que J−30 n'existe pas ; flux = (nouvelles − fermées) / (nouvelles + fermées) sur 7 j ; largeur = variation 7 j des entités qui recrutent / 10 %, bornée ±1. 50 = marché stable. Rien sous 2 snapshots ni sans point J−7.</dd>
            <dt>Part de marché du recrutement</dt>
            <dd>Offres actives du périmètre / offres actives monde.</dd>
            <dt>Concentration</dt>
            <dd>Part des 10 premiers employeurs dans les offres actives du périmètre.</dd>
            <dt>Durée médiane de publication</dt>
            <dd>Médiane de (date de fermeture − première observation) sur les offres fermées des 30 derniers jours. Ce n'est PAS un time-to-fill : une offre retirée n'est pas nécessairement pourvue.</dd>
            <dt>Taux de repost</dt>
            <dd>Offres actives ré-ouvertes au moins une fois / offres actives.</dd>
            <dt>Intensité vs référence</dt>
            <dd>Offres actives d'une Maison / moyenne de ses snapshots sur 90 jours. n/d sans historique.</dd>
          </dl>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="reutilisation" title="Réutilisation des données." level="fact">
          <div className="grid gap-3 max-w-[66ch] t-body soft">
            <p>
              Les chiffres, graphiques et classements publiés par Catwalks Intelligence sont réutilisables librement —
              y compris à des fins commerciales, et y compris modifiés — sous licence{' '}
              <a href={DATA_LICENSE_URL} rel="license noopener" target="_blank" className="u-line text-ink">{DATA_LICENSE_NAME}</a>,
              à une seule condition : <strong>citer Mode Careers avec un lien vers la page d'où vient le chiffre</strong>.
            </p>
            <p>
              Exemple de citation : « Source : Mode Careers — Catwalks Intelligence
              {coverage.updatedAt ? `, ${fmtDate(coverage.updatedAt)}` : ''} », avec un lien vers{' '}
              {siteUrl()}{intelPaths.home}.
            </p>
            <p>
              Cette licence couvre les <em>données publiées ici</em>. Le texte des offres appartient aux employeurs qui
              les publient : il est affiché avec un lien vers leur site, et n'entre pas dans cette autorisation.
            </p>
          </div>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="limites" title="Limites." level="fact">
          <ul className="grid gap-3 max-w-[66ch] t-body soft">
            <li>Durée de publication ≠ time-to-fill.</li>
            <li>L'observation fiable des offres commence le {fmtDate(OBSERVATION_START)} : avant, la base était reconstruite à chaque passage. Une fenêtre (7 j, 30 j, 90 j…) ne s'affiche que lorsque l'observation la couvre entièrement ; sinon « disponible à partir du … ».</li>
            <li>L'historique des snapshots commence le {fmtDate(coverage.historyStart)} ; avant cette date, aucune comparaison n'est possible et aucune n'est affichée.</li>
            <li>L'indice IA ne compte que les offres dont le texte, hors clauses de recrutement et de présentation d'entreprise, parle d'intelligence artificielle ; une société dont plus de 80 % des offres seraient « IA » ne garde que celles dont le titre le dit.</li>
            <li>La classification métier et séniorité est faite par règles : sa couverture est affichée, le reste est « non classé ».</li>
            <li>Une offre sans pays identifiable est comptée mais absente des classements géographiques ; le nombre est affiché.</li>
            <li>Une offre supprimée du catalogue (source retirée) disparaît des faits du jour ; les photographies déjà prises la gardent.</li>
          </ul>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 96, paddingBottom: 96 }}>
        <Coverage coverage={coverage} />
      </section>
    </IntelPage>
  );
}

const RULES: Record<string, string> = {
  'retail-client-advisor': 'Conseiller·ère de vente, client advisor, sales associate, vendeur·se en boutique.',
  'beauty-advisor': 'Conseiller·ère beauté, beauty advisor, maquilleur·se en point de vente.',
  'retail-store-management': 'Directeur·rice, responsable ou manager de boutique, department manager.',
  'retail-area-management': 'Area, district ou regional manager retail, directeur·rice régional·e.',
  'retail-operations': 'Stock, opérations boutique, caisse, back-office de vente.',
  'visual-merchandising': 'Visual merchandiser, vitrines, merchandising en boutique.',
  'merchandising-buying': 'Merchandising produit, achats, planning, allocation.',
  'wholesale-b2b': 'Wholesale, distribution B2B, comptes clés, travel retail.',
  'crm-clienteling': 'CRM, clienteling, fidélisation, relation client VIP.',
  'ecommerce-digital': 'E-commerce, digital, produit web, marketplaces.',
  'marketing-communication': 'Marketing, communication, presse, événementiel, social media.',
  'design-creation': 'Création, design, stylisme, direction artistique, image.',
  'product-development-rd': 'Développement produit, R&D, formulation, modélisme technique.',
  'atelier-craft': 'Atelier, artisanat, maroquinerie, couture, horlogerie, joaillerie.',
  'manufacturing-quality': 'Production, industrialisation, qualité, méthodes.',
  'supply-chain-logistics': 'Supply chain, logistique, planification, entrepôt, transport.',
  finance: 'Finance, comptabilité, contrôle de gestion, audit, trésorerie.',
  'hr-talent': 'Ressources humaines, recrutement, formation, paie.',
  'it-data': 'IT, systèmes, data, ingénierie logicielle, cybersécurité.',
  'legal-compliance': 'Juridique, conformité, propriété intellectuelle.',
  'strategy-management': 'Stratégie, direction générale, transformation, PMO.',
  sustainability: 'Développement durable, RSE, traçabilité, circularité.',
  'customer-service': 'Service client, relation client à distance, après-vente.',
  hospitality: 'Hôtellerie, restauration, accueil, conciergerie.',
  'admin-facilities': 'Administration, assistanat, services généraux, sécurité.',
};
