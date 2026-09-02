import Link from 'next/link';

/**
 * The site footer — navigation, the brand relationship, and legal links.
 *
 * Fashion Atlas is the aggregator brand that belongs to Catwalks (decision
 * D14): the footer states that plainly and links the two, and carries the legal
 * pages (CGU, confidentialité, mentions légales) a real product needs. Its link columns are
 * also SEO surface — the internal mesh toward the offer and company pages.
 */
export function SiteFooter() {
  return (
    <footer className="border-border mt-24 border-t bg-white">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fashion-atlas-logo.svg" alt="Fashion Atlas" className="h-5 w-auto self-start" />
          <p className="text-grey-400 text-[13px] leading-relaxed tracking-[0.4px]">
            Le moteur de recherche des offres Mode, Luxe, Beauté & Retail.
            <br />
            Une marque{' '}
            <a
              href="https://catwalks.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline-offset-2 hover:underline"
            >
              Catwalks
            </a>
            .
          </p>
        </div>

        <FooterColumn title="Rechercher">
          <FooterLink href="/emplois">Toutes les offres</FooterLink>
          <FooterLink href="/entreprises">Toutes les Maisons</FooterLink>
          <FooterLink href="/emplois?secteur=LUXURY">Offres Luxe</FooterLink>
          <FooterLink href="/emplois?secteur=BEAUTY">Offres Beauté</FooterLink>
          <FooterLink href="/emplois?secteur=FASHION">Offres Mode</FooterLink>
        </FooterColumn>

        <FooterColumn title="Candidats">
          <FooterExternal href="https://catwalks.io/inscription?utm_source=fashion-atlas&utm_medium=aggregator">
            Créer mon profil
          </FooterExternal>
          <FooterExternal href="https://catwalks.io">Matching Catwalks</FooterExternal>
        </FooterColumn>

        <FooterColumn title="Informations">
          {/* Only the legal pages Catwalks actually serves (verified live):
              /cgu, /confidentialite, /mentions-legales are 200 — /cgv is 404,
              so it is not linked. */}
          <FooterExternal href="https://catwalks.io/cgu">Conditions d’utilisation</FooterExternal>
          <FooterExternal href="https://catwalks.io/confidentialite">Confidentialité</FooterExternal>
          <FooterExternal href="https://catwalks.io/mentions-legales">Mentions légales</FooterExternal>
        </FooterColumn>
      </div>

      <div className="border-border border-t">
        <p className="text-grey-400 mx-auto max-w-[1280px] px-6 py-6 text-[12px] tracking-[0.4px]">
          © {new Date().getFullYear()} Fashion Atlas — une marque Catwalks. Tous droits réservés.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-grey-400 text-[11px] uppercase tracking-[1px]">{title}</p>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-foreground/80 hover:text-foreground text-[14px] tracking-[0.4px] transition-colors duration-300 ease-catwalks"
      >
        {children}
      </Link>
    </li>
  );
}

function FooterExternal({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground/80 hover:text-foreground text-[14px] tracking-[0.4px] transition-colors duration-300 ease-catwalks"
      >
        {children}
      </a>
    </li>
  );
}
