import type { Metadata } from 'next';
import { siteUrl } from '@/lib/site-url';

/**
 * LA PAGE QUE NOTRE ROBOT DÉSIGNE — préalable bloquant de D62.
 *
 * Le User-Agent `CatwalksBot/1.0 (+…/bot)` porte cette URL sur chaque requête sortante. Tant qu'elle rend
 * 404, un éditeur qui veut savoir qui le visite n'a **aucun** moyen de nous joindre : l'identité annoncée
 * est alors une chaîne de caractères, pas une identité. D62 l'écrit — « ne pas activer un User-Agent dont
 * l'URL rend 404 ».
 *
 * Elle doit rester servie tant que le robot tourne, et rester indexable : c'est ce qu'un opérateur cherche
 * quand il lit un User-Agent inconnu dans ses journaux.
 */
export const dynamic = 'force-dynamic';

const CONTACT = 'loic.melane@catwalks.io';

export const metadata: Metadata = {
  title: 'CatwalksBot — notre robot d’indexation',
  description:
    'Qui est CatwalksBot, ce qu’il collecte, à quelle cadence, et comment demander son retrait.',
  alternates: { canonical: `${siteUrl()}/bot` },
};

export default function BotPage() {
  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 720, paddingBottom: '4rem' }}>
        <h1>CatwalksBot</h1>
        <p>
          <code>CatwalksBot/1.0 (+{siteUrl()}/bot)</code>
        </p>

        <h2>Qui l&apos;opère</h2>
        <p>
          Catwalks, qui édite Mode Careers. Un signalement, une question ou une demande de retrait&nbsp;:{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Cette adresse est relevée.
        </p>

        <h2>Ce qu&apos;il collecte</h2>
        <p>
          Uniquement des <strong>offres d&apos;emploi publiquement diffusées</strong> dans la mode, le luxe, la
          beauté, l&apos;horlogerie, la joaillerie, la parfumerie, la cosmétique, les accessoires et le retail
          associé&nbsp;: intitulé, lieu, description, date, et le lien de candidature vers l&apos;employeur.
        </p>
        <p>
          Il ne collecte <strong>jamais</strong> de comptes candidats, CV, lettres, profils, candidatures,
          notes RH, viviers privés, offres internes, back-office ni donnée personnelle non publiée. Il ne
          contourne aucun contrôle d&apos;accès et n&apos;utilise les identifiants de personne.
        </p>

        <h2>Comment il se comporte</h2>
        <ul>
          <li>Il s&apos;annonce toujours sous ce seul User-Agent, sur tous ses modes d&apos;accès.</li>
          <li>Il n&apos;usurpe l&apos;identité d&apos;aucun autre robot.</li>
          <li>
            Il limite sa cadence par hôte, respecte <code>Retry-After</code> et ralentit de lui-même après une
            réponse 429.
          </li>
          <li>Il préfère une API ou un flux structuré public quand le site en publie un.</li>
        </ul>

        <h2>Nous demander d&apos;arrêter</h2>
        <p>
          Écrivez à <a href={`mailto:${CONTACT}`}>{CONTACT}</a> en indiquant le domaine concerné&nbsp;: nous
          retirons la source et les offres associées. Vous pouvez aussi nous exclure par{' '}
          <code>robots.txt</code>&nbsp;:
        </p>
        <pre>
          <code>{'User-agent: CatwalksBot\nDisallow: /'}</code>
        </pre>
        <p>
          Le lien de candidature de chaque offre pointe vers le site de l&apos;employeur&nbsp;: nous
          n&apos;interceptons aucune candidature.
        </p>
      </div>
    </main>
  );
}
