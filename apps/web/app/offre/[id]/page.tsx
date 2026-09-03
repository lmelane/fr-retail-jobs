import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { JobDetail } from '@/components/job-detail';
import { resolveOfferParam, getSimilarJobs } from '@/lib/jobs';
import { offerPath } from '@/lib/offer-url';
import { companySlug } from '@/lib/company-slug';
import { jobPostingSchema } from '@/lib/job-posting-schema';
import { siteUrl } from '@/lib/site-url';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

/**
 * Serialize JSON-LD safely for inline injection.
 *
 * JSON.stringify escapes quotes but NOT "<" (so "</script>" would end the tag)
 * nor the JS line separators U+2028/U+2029 (valid in JSON, fatal in a script).
 * The values come from untrusted third-party ATS feeds, so a title or
 * description containing "</script>" could otherwise inject markup (stored XSS).
 * Escapes are written with \u so this source stays ASCII.
 */
function safeJsonLd(data: unknown): string {
  // Built from a string so this source carries no literal U+2028/U+2029
  // (those are line terminators and would break the file itself).
  const dangerous = new RegExp('[<\\u2028\\u2029]', 'g');
  return JSON.stringify(data).replace(
    dangerous,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/**
 * One offer, on its own URL.
 *
 * A jobboard's postings have to be shareable — a candidate sends a colleague an
 * offer, not a search — and each one carries its own title and JobPosting
 * structured data, which a single client-rendered list cannot.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // Une offre fermée rend désormais sa vraie page (avec bandeau + 410) : ses
  // métadonnées doivent décrire l'offre, pas « introuvable ». Seul 'missing'
  // reste introuvable. Le param accepte id nu ou slug-id (S-01).
  const state = await resolveOfferParam(decodeURIComponent((await params).id));
  if (state.status === 'missing') return { title: 'Offre introuvable' };
  const { job } = state;
  const closedPrefix = state.status === 'closed' ? 'Offre expirée — ' : '';

  return {
    title: `${closedPrefix}${job.title} — ${job.company}${job.city ? ` · ${job.city}` : ''}`,
    description: job.description?.slice(0, 200) ?? undefined,
    // Une seule URL canonique par offre, quel que soit le chemin d'arrivée.
    alternates: { canonical: `${siteUrl()}${offerPath(job)}` },
    // Une offre fermée est servie en 410 + x-robots noindex par le middleware ;
    // on double la consigne au niveau métadonnées pour être sûr.
    ...(state.status === 'closed' ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  // 'missing' → 404 ; 'closed' → on rend l'offre AVEC un bandeau « expirée »
  // (§4.13), pendant que le middleware sert un 410 pour le SEO (D22) ; 'active'
  // → rendu normal. Le param accepte l'ancien id nu ET slug-id (S-01).
  const raw = decodeURIComponent((await params).id);
  const state = await resolveOfferParam(raw);
  if (state.status === 'missing') notFound();
  const job = state.job;
  const isClosed = state.status === 'closed';

  // 301 vers l'URL canonique /offre/[slug]-[id] : ancien id nu, slug périmé
  // (titre modifié à la source) ou slug forgé. Jamais sur une offre fermée —
  // le middleware sert son 410 sur l'URL demandée, une redirection le
  // remplacerait par un 308 et Google ne déréférencerait plus.
  const canonical = offerPath(job);
  if (!isClosed && `/offre/${raw}` !== canonical) permanentRedirect(canonical);

  // S-02a/S-02b : JSON-LD complet, construit et testé dans lib/job-posting-schema.
  const structuredData = jobPostingSchema(job);

  // S-01 : offres similaires — vraies ancres crawlables entre offres.
  const similar = await getSimilarJobs(job, 6);

  return (
    <main className="page bg-paper">
      {/* JSON-LD JobPosting seulement pour une offre active : sur une offre
          fermée (410 + noindex), annoncer un poste ouvert serait contradictoire. */}
      {!isClosed && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
        />
      )}

      <div className="container py-8">
        {/* Fil d'Ariane : retour à la liste + la Maison (S-01) — deux vraies
            ancres, le crawl circule entre offres, Maisons et listes. */}
        <nav aria-label="Fil d'Ariane" className="mb-6 flex items-center gap-4">
          <Link
            href="/emplois"
            className="inline-flex items-center gap-2 text-ink-muted hover:text-ink"
          >
            <ArrowLeft className="size-4" /> <span className="t-ui-small">Toutes les offres</span>
          </Link>
          <Link
            href={`/entreprise/${companySlug(job.company)}`}
            className="t-ui-small text-ink-muted hover:text-ink"
          >
            Toutes les offres {job.company}
          </Link>
        </nav>

        {/* Offre expirée (§4.13) : bandeau paper-alt à filets, chip « Expirée »,
            lien vers les offres de la Maison. Rendu seulement pour une offre
            fermée (le middleware sert le 410 en parallèle). */}
        {isClosed && (
          <div className="banner rule rule-b mb-6 max-w-[720px]">
            <span className="t-body">
              <span className="chip chip--warn">Expirée</span>&nbsp; Cette offre n’est plus
              publiée par {job.company}.
            </span>
            <Link className="btn" href={`/emplois?maison=${encodeURIComponent(job.company)}`}>
              Voir les offres similaires
              <svg viewBox="0 0 24 24" aria-hidden width="16" height="16" stroke="currentColor" strokeWidth="1.25" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </Link>
          </div>
        )}

        {/* Fiche autonome : la page scrolle, pas de sticky ni de scroll interne
            (le panneau détail /emplois, lui, garde son scroll). Même composant
            JobDetail : une seule identité visuelle pour une offre.
            `has-apply-bar` : sur mobile, les CTA inline sont masqués au profit
            de la barre sticky ci-dessous. */}
        {/* `lang` sur le CONTENU : le layout racine garde <html lang="fr"> (le
            chrome du site est français), mais le texte de l'offre porte sa
            vraie langue pour les lecteurs d'écran et les crawlers (S-02a,
            adaptation par délégation : App Router ne permet pas un <html lang>
            par route). */}
        <div className="has-apply-bar max-w-[720px]" lang={job.language ?? undefined}>
          <JobDetail job={job} />

          {/* Barre CTA sticky (mobile only, cf. globals .apply-bar). Reprend les
              2 actions honnêtes D18. Cachée à lg+. */}
          <div className="apply-bar">
            <a
              className="btn btn--primary btn--lg"
              href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator&utm_campaign=job-detail"
              target="_blank"
              rel="noopener noreferrer"
            >
              Matcher mon profil avec Catwalks
            </a>
            <a className="btn btn--lg" href={job.applyUrl} target="_blank" rel="noopener noreferrer">
              Voir l’offre chez {job.company}
            </a>
          </div>
        </div>

        {/* Offres similaires (S-01) : même Maison d'abord, puis même secteur.
            Rendues serveur — chaque carte est une ancre réelle, le maillage
            interne dont dépend le crawl sans sitemap. */}
        {similar.length > 0 && (
          <section aria-labelledby="similaires-titre" className="mt-12 max-w-[720px]">
            <p className="t-caption text-ink-muted" id="similaires-titre">
              Offres similaires
            </p>
            <ul className="mt-4">
              {similar.map((s) => (
                <li key={s.id} className="rule rule-t">
                  <Link href={offerPath(s)} className="block py-4 hover:bg-paper-alt">
                    <span className="t-body block">{s.title}</span>
                    <span className="t-caption-soft block">
                      {s.company}
                      {s.city ? ` · ${s.city}` : ''}
                      {s.contract ? ` · ${s.contract}` : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
