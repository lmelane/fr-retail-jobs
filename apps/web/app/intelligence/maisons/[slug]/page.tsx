import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Block, IntelPage, JsonLd, Kpi, NA, PageHead } from '@/components/intelligence/chrome';
import { ProfileBlocks, ProfileFooter, ProfileKpis, ProfileSeries } from '@/components/intelligence/profile-view';
import { countryLabel } from '@/lib/countries';
import { companySlug } from '@/lib/company-slug';
import { getProfile } from '@/lib/intelligence/queries/profile';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { resolveCompany } from '@/lib/intelligence/queries/resolve';
import { intensity } from '@/lib/intelligence/metrics';
import { addDays, fmtDate, fmtInt, MIN_SAMPLE, NA_FROM, windowAvailable, windowFrom } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';
import { sectorLabel } from '@/lib/intelligence/taxonomy';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const company = await resolveCompany((await params).slug);
  if (!company) return { title: 'Maison introuvable' };
  const profile = await getProfile({ companyId: company.id }, { snapshot: { scope: 'company', key: company.id }, skills: true, newCities: true });
  const n = profile.headline.active;
  return intelMetadata({
    subject: `${company.name} : intelligence recrutement`,
    description: `${company.name}${company.parentGroup ? ` (${company.parentGroup})` : ''} : ${fmtInt(n)} offres actives, ouvertes 7 / 30 / 90 jours, fermées 30 jours, ${fmtInt(profile.countriesTotal)} pays, ${fmtInt(profile.headline.cities)} villes, métiers, séniorité, contrats, retail vs corporate, durée médiane, ré-ouvertures.`,
    path: intelPaths.company(company.name),
    noindex: n < MIN_SAMPLE,
  });
}

export default async function Page({ params }: Params) {
  const company = await resolveCompany((await params).slug);
  if (!company) notFound();
  const [profile, coverage] = await Promise.all([
    getProfile({ companyId: company.id }, { snapshot: { scope: 'company', key: company.id }, skills: true, newCities: true }),
    getCoverage(),
  ]);
  const h = profile.headline;
  const path = intelPaths.company(company.name);
  const crumbs = [{ name: 'Intelligence', path: intelPaths.home }, { name: company.name, path }];
  const ctx = { kind: 'company' as const, name: company.name, jobsParams: { maison: company.name } };
  const inten = intensity(h.active, profile.series);
  // « Nouveaux marchés » n'a de sens qu'avec 30 jours d'historique réel.
  const today = new Date().toISOString().slice(0, 10);
  const historyOk = coverage.firstJobSeen !== null && addDays(coverage.firstJobSeen, 30) <= today;

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: `${company.name} — intelligence recrutement`, description: `${fmtInt(h.active)} offres actives chez ${company.name}.`, path, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead
        crumbs={crumbs}
        eyebrow={[sectorLabel(company.sector), company.parentGroup].filter(Boolean).join(' · ') || 'Maison'}
        title={company.name}
        lede={
          <p>
            {fmtInt(h.active)} offres actives, {fmtInt(profile.countriesTotal)} pays, {fmtInt(h.cities)} villes.{' '}
            <Link href={`/entreprise/${companySlug(company.name)}`} className="u-line text-ink">Fiche Maison et offres</Link>
            {company.parentGroup && (
              <>
                {' · '}
                <Link href={intelPaths.group(company.parentGroup)} className="u-line text-ink">Groupe {company.parentGroup}</Link>
              </>
            )}
          </p>
        }
      />

      <section className="container" style={{ paddingTop: 48 }}>
        <ProfileKpis profile={profile} coverage={coverage} ctx={ctx} />
        <div className="kpis mt-8">
          <Kpi label="Ouvertes · 7 j" value={windowAvailable(7) ? fmtInt(h.new7d) : undefined} na={windowAvailable(7) ? undefined : NA_FROM(windowFrom(7))} level="fact" />
          <Kpi label="Ouvertes · 30 j" value={windowAvailable(30) ? fmtInt(h.new30d) : undefined} na={windowAvailable(30) ? undefined : NA_FROM(windowFrom(30))} level="fact" />
          <Kpi label="Ouvertes · 90 j" value={windowAvailable(90) ? fmtInt(h.new90d) : undefined} na={windowAvailable(90) ? undefined : NA_FROM(windowFrom(90))} level="fact" />
          <Kpi label="Intensité vs référence 90 j" value={inten.ok ? `${inten.value.toFixed(2).replace('.', ',')}×` : undefined} na={inten.ok ? undefined : inten.na.kind === 'none' ? NA_FROM(addDays(coverage.historyStart, 1)) : inten.na} level="derived" sub="actives / moyenne des snapshots 90 j" />
        </div>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <ProfileSeries profile={profile} coverage={coverage} title={`Offres actives chez ${company.name}, jour par jour.`} />
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <Block id="nouveaux-marches" title="Nouveaux marchés." level="derived">
          {!historyOk ? (
            <NA na={NA_FROM(addDays(coverage.firstJobSeen ?? coverage.historyStart, 30))} />
          ) : profile.newCities.length > 0 ? (
            <ul className="grid gap-2 md:grid-cols-3">
              {profile.newCities.map((c) => (
                <li key={`${c.code}-${c.city}`} className="t-body">
                  {c.code ? <Link href={intelPaths.city(c.code, c.city)} className="u-line">{c.city}</Link> : c.city}
                  <span className="muted"> · {c.code ? countryLabel(c.code) : '—'} · première offre le {fmtDate(c.firstSeenAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="na">Aucune ville nouvelle sur les 30 derniers jours.</p>
          )}
          <p className="t-caption-soft mt-3">Ville où la première offre de {company.name} a été observée il y a moins de 30 jours, absente auparavant. Signal d'activité, pas une annonce d'ouverture.</p>
        </Block>
      </section>

      <section className="container" style={{ paddingTop: 64 }}>
        <ProfileBlocks profile={profile} ctx={ctx} />
      </section>
      <ProfileFooter coverage={coverage} jobs={h.active} />
    </IntelPage>
  );
}
