import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { IntelPage, JsonLd, PageHead } from '@/components/intelligence/chrome';
import { ProfileBlocks, ProfileFooter, ProfileKpis, ProfileSeries } from '@/components/intelligence/profile-view';
import { countryLabel } from '@/lib/countries';
import { getProfile } from '@/lib/intelligence/queries/profile';
import { getCoverage } from '@/lib/intelligence/queries/coverage';
import { resolveCity } from '@/lib/intelligence/queries/resolve';
import { fmtInt, MIN_SAMPLE } from '@/lib/intelligence/format';
import { intelPaths } from '@/lib/intelligence/paths';
import { breadcrumbLd, intelMetadata, webPageLd } from '@/lib/intelligence/seo';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const city = await resolveCity((await params).slug);
  if (!city) return { title: 'Ville introuvable' };
  const profile = await getProfile({ country: city.code, city: city.city }, { snapshot: { scope: 'city', key: `${city.code}|${city.city}` } });
  const n = profile.headline.active;
  return intelMetadata({
    subject: `Recrutement luxe : ${city.city}`,
    description: `${fmtInt(n)} offres actives Mode, Luxe, Beauté, Horlogerie et Retail à ${city.city} (${countryLabel(city.code)}) : Maisons qui recrutent, métiers, séniorité, contrats, concentration.`,
    path: intelPaths.city(city.code, city.city),
    noindex: n < MIN_SAMPLE,
  });
}

export default async function Page({ params }: Params) {
  const city = await resolveCity((await params).slug);
  if (!city) notFound();
  const scope = { country: city.code, city: city.city };
  const [profile, coverage] = await Promise.all([getProfile(scope, { snapshot: { scope: 'city', key: `${city.code}|${city.city}` } }), getCoverage()]);
  if (profile.headline.active === 0) notFound();
  const path = intelPaths.city(city.code, city.city);
  const label = countryLabel(city.code);
  const crumbs = [
    { name: 'Intelligence', path: intelPaths.home },
    { name: 'Géographies', path: intelPaths.geographies },
    { name: label, path: intelPaths.country(city.code) },
    { name: city.city, path },
  ];
  const ctx = { kind: 'city' as const, name: city.city, jobsParams: { pays: city.code, ville: city.city } };

  return (
    <IntelPage>
      <JsonLd data={webPageLd({ name: `Recrutement luxe à ${city.city}`, description: `${fmtInt(profile.headline.active)} offres actives à ${city.city}, ${label}.`, path, dateModified: coverage.updatedAt })} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <PageHead crumbs={crumbs} eyebrow={`Ville · ${label}`} title={city.city} lede={<p>{fmtInt(profile.headline.active)} offres actives, {fmtInt(profile.headline.companies)} Maisons. Les parts et médianes sont calculées ; sous 30 offres elles s'affichent n/d.</p>} />

      <section className="container" style={{ paddingTop: 48 }}>
        <ProfileKpis profile={profile} coverage={coverage} ctx={ctx} />
      </section>
      <section className="container" style={{ paddingTop: 64 }}>
        <ProfileSeries profile={profile} coverage={coverage} title={`Offres actives à ${city.city}, jour par jour.`} />
      </section>
      <section className="container" style={{ paddingTop: 64 }}>
        <ProfileBlocks profile={profile} ctx={ctx} />
      </section>
      <ProfileFooter coverage={coverage} jobs={profile.headline.active} />
    </IntelPage>
  );
}
