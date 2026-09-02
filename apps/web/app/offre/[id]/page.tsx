import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { JobDetail } from '@/components/job-detail';
import { getJob } from '@/lib/jobs';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

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
    <div className="bg-background flex h-dvh flex-col gap-3 p-3">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <header className="bg-surface-low shadow-m3-1 flex shrink-0 items-center gap-2 rounded-[28px] px-4 py-3">
        <Link
          href="/"
          className="hover:bg-surface flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="size-[18px]" />
          Toutes les offres
        </Link>
      </header>

      <main className="bg-surface-low shadow-m3-1 min-h-0 flex-1 overflow-hidden rounded-[28px]">
        <JobDetail job={job} />
      </main>
    </div>
  );
}
