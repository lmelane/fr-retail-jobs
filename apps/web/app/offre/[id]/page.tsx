import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { JobDetail } from '@/components/job-detail';
import { getJob } from '@/lib/jobs';
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
  const job = await getJob((await params).id);
  if (!job) return { title: 'Offre introuvable' };

  return {
    title: `${job.title} — ${job.company}${job.city ? ` · ${job.city}` : ''}`,
    description: job.description?.slice(0, 200) ?? undefined,
  };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const job = await getJob((await params).id);
  if (!job) notFound();

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />

      <div className="container py-8">
        {/* Fil d'Ariane : retour à la liste (§5.3). */}
        <Link
          href="/emplois"
          className="mb-6 inline-flex items-center gap-2 text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" /> <span className="t-ui-small">Toutes les offres</span>
        </Link>

        {/* Fiche autonome : la page scrolle, pas de sticky ni de scroll interne
            (le panneau détail /emplois, lui, garde son scroll). Même composant
            JobDetail : une seule identité visuelle pour une offre. */}
        <div className="max-w-[720px]">
          <JobDetail job={job} />
        </div>
      </div>
    </main>
  );
}
