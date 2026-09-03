import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { JobDetail } from '@/components/job-detail';
import { getJobStatus, getSimilarJobs } from '@/lib/jobs';
import { contractLabel, displayTitle, relativeDate } from '@/lib/format';
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
  // reste introuvable.
  const state = await getJobStatus((await params).id);
  if (state.status === 'missing') return { title: 'Offre introuvable' };
  const { job } = state;
  const closedPrefix = state.status === 'closed' ? 'Offre expirée — ' : '';

  return {
    title: `${closedPrefix}${job.title} — ${job.company}${job.city ? ` · ${job.city}` : ''}`,
    description: job.description?.slice(0, 200) ?? undefined,
    // Une offre fermée est servie en 410 + x-robots noindex par le middleware ;
    // on double la consigne au niveau métadonnées pour être sûr.
    ...(state.status === 'closed' ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  // 'missing' → 404 ; 'closed' → on rend l'offre AVEC un bandeau « expirée »
  // (§4.13), pendant que le middleware sert un 410 pour le SEO (D22) ; 'active'
  // → rendu normal.
  const state = await getJobStatus((await params).id);
  if (state.status === 'missing') notFound();
  const job = state.job;
  const isClosed = state.status === 'closed';
  // Maillage interne (S-01) : chaque fiche relie d'autres fiches — même Maison
  // d'abord, même secteur en complément. Sans lui, les ~26k pages offres sont
  // des culs-de-sac (et étaient orphelines tant que les cartes étaient des
  // boutons).
  const similar = await getSimilarJobs(job);

  /**
   * schema.org JobPosting, so search engines index the posting rather than the
   * page around it. Built from stored fields only — nothing is invented, and an
   * absent field is simply omitted.
   */
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description ?? undefined,
    datePosted: job.postedAt?.toISOString(),
    validThrough: job.validThrough?.toISOString(),
    employmentType: job.contract ?? undefined,
    hiringOrganization: { '@type': 'Organization', name: job.company },
    jobLocation: job.city
      ? {
          '@type': 'Place',
          address: {
            '@type': 'PostalAddress',
            addressLocality: job.city,
            postalCode: job.postalCode ?? undefined,
            addressCountry: 'FR',
          },
        }
      : undefined,
    baseSalary:
      job.salaryMin !== null || job.salaryMax !== null
        ? {
            '@type': 'MonetaryAmount',
            currency: job.salaryCurrency ?? 'EUR',
            value: {
              '@type': 'QuantitativeValue',
              minValue: job.salaryMin ?? undefined,
              maxValue: job.salaryMax ?? undefined,
              unitText: job.salaryPeriod ?? undefined,
            },
          }
        : undefined,
  };

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
        {/* Fil d'Ariane : retour à la liste (§5.3). */}
        <Link
          href="/emplois"
          className="mb-6 inline-flex items-center gap-2 text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" /> <span className="t-ui-small">Toutes les offres</span>
        </Link>

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
        <div className="has-apply-bar max-w-[720px]">
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

        {similar.length > 0 && (
          <section className="mt-14 max-w-[720px]" aria-labelledby="similar-title">
            <h2 id="similar-title" className="t-d1 rule pt-6">Offres similaires.</h2>
            <ul className="mt-2">
              {similar.map((o) => (
                <li key={o.id} className="rule-b">
                  <Link href={`/offre/${o.id}`} className="block py-5 hover:bg-paper-alt">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="t-caption">{o.company}</span>
                      {o.postedAt && <span className="t-caption-soft shrink-0">{relativeDate(o.postedAt)}</span>}
                    </div>
                    <p className="t-d2 mt-1">{displayTitle(o.title)}</p>
                    {(o.city || o.contract) && (
                      <p className="t-body2 muted mt-1">
                        {[o.city, contractLabel(o.contract)].filter(Boolean).join(' · ')}
                      </p>
                    )}
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
