import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import seed from "../../../../packages/db/data/occupations-v1.json" with { type: "json" };
import {
  compileOccupationManifest,
  occupationLevelOnly,
  occupationTitleReadings,
  occupationTitleRoles,
} from "@catwalks/db/occupations";

/**
 * Les métiers lus dans l'intitulé (D-475 point 38, packages/db/occupation-title-roles.ts). Chaque témoin affirme d'abord
 * que sa situation de départ atteint le défaut (le résolveur LIT bien l'expression, le moteur ne classe pas déjà
 * l'offre), puis que la règle le retient : sinon il passerait au vert sans rien exercer.
 */
const base = structuredClone(seed) as any;
base.id = "lecture-titre-test";
const metier = (k: string) => base.occupations.find((o: any) => o.key === k);
metier("sales-advisor").aliases.push("Vendeur", "Retail Assistant");
metier("sales-advisor").titleReadingAliases = ["Vendeur", "Conseiller de vente", "Retail Assistant"];
// Une forme décidée sans métier (§37, étape 3c) : elle empêche la lecture, contrairement au routage servi.
metier("sales-advisor").titleReadingExclusions = ["Retail Assistant - Night Shift"];
metier("store-manager").aliases.push("Butikschef");
metier("store-manager").titleReadingAliases = ["Butikschef"];
base.occupations.push(
  { key: "keyholder", labels: { fr: "Keyholder", en: "Keyholder" }, family: "retail-store-management", aliases: ["Keyholder"], titleReadingAliases: ["Keyholder"] },
  { key: "commercial", labels: { fr: "Commercial", en: "Sales representative" }, family: "wholesale-b2b", aliases: ["Commercial"] },
  { key: "responsable-vendeur", labels: { fr: "Responsable vendeur", en: "Sales team leader" }, family: "retail-store-management", aliases: ["Responsable vendeur"] },
  { key: "floor-manager", labels: { fr: "Floor manager", en: "Floor Manager" }, family: "retail-store-management", aliases: ["Supervisor"], titleReadingAliases: ["Floor Manager", "Supervisor"] },
  { key: "trainer", labels: { fr: "Formateur", en: "Trainer" }, family: "hr-talent", aliases: ["Trainer"], titleReadingAliases: ["Trainer"] },
);
// Un intitulé entier jugé pour l'adjoint (règle exacte de la curation) : il ne lit pas le responsable qu'il contient.
base.rules.push({ id: "test-adjoint-exact", occupation: "assistant-store-manager", all: [{ field: "title", any: ["Assisterande butikschef"], mode: "exact" }],
  evidence: "Témoin : un intitulé jugé entier pour l'adjoint." });
const catalogue = compileOccupationManifest(base);
/** La lecture seule : aucune décision du moteur (la v1 classe déjà « Vendeur » : le candidat masquerait la lecture). */
const AUCUNE = { occupationCode: null, occupationStatus: "NO_RULE", occupationEvidence: { candidates: [], matchedRules: [] } };
const roles = (t: string) => occupationTitleRoles(catalogue, t, AUCUNE);
const lu = (t: string, role: string) => occupationTitleReadings(catalogue, t, AUCUNE).some((l) => l.role === role);
const sansEncadrement = compileOccupationManifest({ ...structuredClone(base), id: "lecture-sans-exclusions",
  occupations: base.occupations.map(({ titleReadingExclusions, ...o }: any) => o) });

describe("métiers lus dans un intitulé plus long (D-475 point 38)", () => {
  it("une expression vérifiée (titleReadingAliases) se lit : « Retail Keyholder - Mall »", () => {
    expect(catalogue.classify("Retail Keyholder - Mall").occupationEvidence.candidates).not.toContain("keyholder");
    expect(roles("Retail Keyholder - Mall")).toContain("keyholder");
  });

  it("une expression NON vérifiée ne se lit pas : « Commercial Controller » n'est pas un commercial", () => {
    expect(lu("Commercial Controller - NIVEA", "commercial")).toBe(true);
    expect(roles("Commercial Controller - NIVEA")).not.toContain("commercial");
  });

  it("l'exemple de la décision se lit : l'exclusion servie « formation » n'empêche pas la lecture (seul l'encadrement)", () => {
    const titre = "Conseiller(ère) de Vente H/F – Poste avec formation avant embauche";
    expect(catalogue.excludedOccupations(titre)).toContain("sales-advisor");
    expect(catalogue.classify(titre).occupationCode).toBeNull();
    expect(roles(titre)).toContain("sales-advisor");
  });

  it("la portée la plus longue l'emporte : « Responsable vendeur » ne laisse pas lire « vendeur » (point 32 a)", () => {
    expect(roles("Vendeur Paris")).toContain("sales-advisor");
    expect(lu("Responsable vendeur Paris", "sales-advisor")).toBe(false);
    expect(roles("Responsable vendeur Paris")).not.toContain("sales-advisor");
  });

  it("sous un mot d'encadrement du même segment, pas de lecture ; un autre segment ne compte pas", () => {
    expect(occupationTitleReadings(catalogue, "Trainer", AUCUNE)).toEqual([]);
    expect(roles("Middle East & Africa Trainer Manager")).not.toContain("trainer");
    expect(roles("Field Retail Trainer")).toContain("trainer");
    expect(roles("Sales Supervisor (Keyholder) | Walnut Street")).toContain("keyholder");
    expect(roles("Store Lead / Trainer")).toContain("trainer");
    expect(roles("Superviseur Vendeur Paris")).not.toContain("sales-advisor");
  });

  it("une forme décidée pour aucun métier (§37) empêche la lecture ; le reste du vocabulaire se lit", () => {
    expect(occupationTitleRoles(sansEncadrement, "Retail Assistant - Night Shift - Paris", AUCUNE)).toContain("sales-advisor");
    expect(roles("Retail Assistant - Night Shift - Paris")).not.toContain("sales-advisor");
    expect(roles("Retail Assistant - Paris")).toContain("sales-advisor");
  });

  it("un intitulé classé par une règle exacte ne lit rien de plus (« Assisterande butikschef » reste l'adjoint)", () => {
    const d = catalogue.classify("Assisterande butikschef");
    expect(d.occupationCode).toBe("assistant-store-manager");
    expect(lu("Assisterande butikschef", "store-manager")).toBe(true);
    expect(occupationTitleRoles(catalogue, "Assisterande butikschef", d)).toEqual(["assistant-store-manager"]);
    expect(roles("Butikschef Göteborg")).toContain("store-manager");
  });

  it("l'écriture inclusive entre parenthèses n'est pas une frontière : « Conseiller(ère) de vente - Paris »", () => {
    expect(roles("Conseiller(ère) de vente - Paris")).toContain("sales-advisor");
    expect(roles("Vendeur/euse - Paris")).toContain("sales-advisor");
  });

  it("un alias fait de mots de niveau ne se lit jamais dans un intitulé plus long, même listé (points 36, 37)", () => {
    expect(occupationLevelOnly("Supervisor")).toBe(true);
    expect(roles("Supervisor Warehouse")).not.toContain("floor-manager");
    expect(roles("Floor Manager Maastricht")).toContain("floor-manager");
  });

  it("les candidats du moteur restent, et l'intitulé vide ne lit rien", () => {
    expect(occupationTitleRoles(catalogue, "Sales Advisor", catalogue.classify("Sales Advisor"))).toEqual(["sales-advisor"]);
    const candidat = { ...AUCUNE, occupationEvidence: { candidates: ["sales-advisor"], matchedRules: [] } };
    expect(occupationTitleRoles(catalogue, "  ", candidat)).toEqual(["sales-advisor"]);
    expect(occupationTitleRoles(catalogue, null, AUCUNE)).toEqual([]);
  });

  it("le moteur refuse une expression lue absente du vocabulaire du métier, et une exclusion vide", () => {
    const faux = structuredClone(base);
    faux.id = "lecture-titre-hors-vocabulaire";
    faux.occupations.find((o: any) => o.key === "keyholder").titleReadingAliases = ["Store Keyholder"];
    expect(() => compileOccupationManifest(faux)).toThrow(/Title reading alias outside the occupation vocabulary: keyholder/);
    const vide = structuredClone(base);
    vide.id = "lecture-titre-exclusion-vide";
    vide.occupations.find((o: any) => o.key === "keyholder").titleReadingExclusions = [" "];
    expect(() => compileOccupationManifest(vide)).toThrow(/Invalid title reading exclusion: keyholder/);
  });
});

describe("la v3 de la passe de curation, sur les exemples de l'arbitrage, des mesures 6f et de l'audit", () => {
  // Copie du manifeste audité (audits/2026-09-28/curation-v3/6-manifeste-v3.json, après l'étape 6h du 30/09/2026) : le code
  // ne lit jamais les archives (check:layout) ; l'empreinte garde la copie identique à l'audit.
  const EMPREINTE_V3 = "e789492df4c8b17ae379818c81b2f588023ab56ce47a24fb83084391cb943850";
  const texte = readFileSync(new URL("./__fixtures__/manifeste-v3-20260928.json", import.meta.url), "utf8");
  it("la copie est celle de l'audit", () => { expect(createHash("sha256").update(texte).digest("hex")).toBe(EMPREINTE_V3); });
  const v3 = compileOccupationManifest(JSON.parse(texte));
  const r = (t: string) => occupationTitleRoles(v3, t, v3.classify(t));
  it.each([
    ["Keyholder (Part time) - Reitmans", "keyholder"],
    ["Floor Manager - Chadstone, Melbourne", "manager-floor"],
    ["Butikschef till Brothers Södertälje (vik)", "store-manager"],
  ])("« %s » se lit %s", (titre, role) => {
    expect(r(titre)).toContain(role);
  });
  it.each([
    ["Commercial Controller - NIVEA", "commercial"],
    ["Extra salle H/F", "figurant"],
    ["IT Operations Manager", "responsable-operationnel"],
    ["Digital Product Manager", "chef-produit"],
    ["Digital - Senior Manager/Manager, Concierge Analytics", "concierge"],
  ])("« %s » ne se lit pas %s (lu par le résolveur, rejeté par l'étape 6g)", (titre, role) => {
    expect(occupationTitleReadings(v3, titre, v3.classify(titre)).some((l) => l.role === role)).toBe(true);
    expect(r(titre)).not.toContain(role);
  });
  it("« Responsable vendeur » reste le seul encadrement de la vente, « Assisterande butikschef » l'adjoint", () => {
    expect(r("Responsable vendeur")).toEqual(["retail-sales-lead"]);
    expect(r("Assisterande butikschef")).toEqual(["assistant-store-manager"]);
  });

  // Étape 6h (D-475 §39 : le vocabulaire se corrige à la main avant l'activation) : les faux mesurés aux tours 7 (moteur)
  // et 4 (métiers lus) qui contredisaient une décision prise ou une frontière servie. Chaque témoin affirme d'abord que
  // l'intitulé contient bien une expression du métier écarté (la prémisse du défaut), puis que ce métier n'en sort plus.
  it.each([
    ["Manager des Ventes (F/H) // Axe Caisse - Champs Elysées - CDI 35h"],
    ["Manager des ventes H/F"],
    ["Manager, Sales"],
    ["Manager, Sales - Cosmetics"],
  ])("« %s » reste sans métier, comme « Sales Manager » (§37 d)", (titre) => {
    expect(v3.classify("Sales Manager").occupationCode).toBeNull();
    expect(v3.classify(titre).occupationCode).toBeNull();
    expect(r(titre)).toEqual([]);
  });
  // Les exclusions de 6h (copie des formes de audits/2026-09-28/curation-v3/6h-corrections-main.json : le code ne lit pas
  // les archives). La prémisse se prouve EN MÉMOIRE : les mêmes formes retirées du manifeste, le métier revient.
  const EXCLUSIONS_6H: Record<string, string[]> = {
    "store-manager": ["assistent", "assistants", "assisterende", "assisterande", "stellvertretender", "stellvertretende", "stellv", "vice store manager", "アシスタント", "ställföreträdande"],
    cook: ["assistent"], "designer-chaussures": ["assistant"], "assistant-merchandiser": ["visual merchandising"],
    "financial-controller": ["responsable", "controlling solutions", "inventory controlling"],
    "assistant-store-manager": ["adjoint comptabilite", "adjoint visual merchandising", "adjoint prevention des pertes"],
    "collection-merchandiser": ["assistant"], "office-manager": ["programme office"], "assistant-designer": ["product manager assistant"],
  };
  const sansExclusions = (metier: string) => {
    const m = JSON.parse(texte);
    m.id = `sans-6h-${metier}`;
    const garde = (l: string[]) => l.filter((v) => !EXCLUSIONS_6H[metier].includes(v));
    for (const regle of m.rules) if (regle.occupation === metier && regle.exclude) {
      regle.exclude = regle.exclude.map((c: any) => ({ ...c, any: garde(c.any) })).filter((c: any) => c.any.length);
      if (!regle.exclude.length) delete regle.exclude;
    }
    for (const o of m.occupations) if (o.key === metier && o.titleReadingExclusions) o.titleReadingExclusions = garde(o.titleReadingExclusions);
    return compileOccupationManifest(m);
  };
  const sort = (cat: ReturnType<typeof compileOccupationManifest>, t: string, k: string) => occupationTitleRoles(cat, t, cat.classify(t)).includes(k);
  it.each([
    ["Assistent Shopmanager", "Shopmanager", "store-manager", "assistant-store-manager"],
    ["Assistent Store Manager Utrecht", "Store Manager", "store-manager", "assistant-store-manager"],
    ["ASSISTANTS STORE MANAGER - MARBELLA CAÑADA TEEN", "Store Manager", "store-manager", "assistant-store-manager"],
    ["Stellvertretender Filialleiter (m/w/d)", "Filialleiter", "store-manager", "assistant-store-manager"],
    ["Stellvertretende/r Filialleiter/in - Innsbruck", "Filialleiter", "store-manager", "assistant-store-manager"],
    ["Stellv. Filialleiter München Theatinerstraße m/w/d", "Filialleiter", "store-manager", "assistant-store-manager"],
    ["Vice Store Manager - Antwerp", "Store Manager", "store-manager", "assistant-store-manager"],
    ["Assisterende butikschef", "Butikschef", "store-manager", "assistant-store-manager"],
    ["Ställföreträdande Butikschef till MQ Marqet", "Butikschef", "store-manager", "assistant-store-manager"],
    ["【プーマアウトレット入間】アシスタントストアマネージャー募集！", "ストアマネージャー", "store-manager", "assistant-store-manager"],
    ["Assistent kok bij Asia Street Cooking", "Kok", "cook", "commis-de-cuisine"],
    ["Commis Cuisinier 18H H/F - Anglet - CAFE ONO", "Cuisinier", "cook", "commis-de-cuisine"],
    ["Stage - Assistant Key Account Manager Europe", "Account Manager", "responsable-de-comptes", "assistant-key-account-manager"],
  ])("« %s » : le métier distinct de ce niveau, pas celui de « %s » (§37 b, frontières servies « assistant », « deputy »)", (titre, contenu, seconde, attendu) => {
    expect(v3.classify(contenu).occupationCode).toBe(seconde);
    expect(r(titre)).toEqual([attendu]);
  });
  it.each([
    ["Assistent Store Manager Utrecht", "store-manager"],
    ["ASSISTANTS STORE MANAGER - MARBELLA CAÑADA TEEN", "store-manager"],
    ["Assisterande Butikschef Gant Outlet Hede", "store-manager"],
    ["Stellvertretende/r Filialleiter/in - Innsbruck", "store-manager"],
    ["【プーマアウトレット入間】アシスタントストアマネージャー募集！", "store-manager"],
    ["Assistent kok bij Asia Street Cooking", "cook"],
    ["Functional Consultant Controlling Solutions (f/m/x)", "financial-controller"],
    ["Lead, Inventory Controlling NA (Business Strategy)", "financial-controller"],
    ["Responsable Controle de Gestion Industriel H/F", "financial-controller"],
    ["ASSISTANT(E) FOOTWEAR DESIGNER - NEW CREATIONS", "designer-chaussures"],
    ["Visual Merchandising Assistant", "assistant-merchandiser"],
    ["CDI - Responsable Adjoint Visual Merchandising - 31 Rue Cambon - H/F/X", "assistant-store-manager"],
    ["CDI - Responsable adjoint Comptabilité Fournisseurs (H/F)", "assistant-store-manager"],
    ["CDI - Responsable Adjoint prévention des pertes (F/H)", "assistant-store-manager"],
    ["Internship - Export Marketing Product Manager Assistant Designer Fragance Brands", "assistant-designer"],
    ["Berluti Stage - Assistant(e) Collection Merchandiser (F/H)", "collection-merchandiser"],
    ["Stage - Global IT Client Programme Office Manager - Corporate - Janvier 2027 - H/F/X", "office-manager"],
  ])("« %s » ne sort plus sous %s ; sans l'exclusion de 6h, retirée en mémoire, il y revient", (titre, ecarte) => {
    expect(sort(sansExclusions(ecarte), titre, ecarte)).toBe(true);
    expect(v3.classify(titre).occupationCode).not.toBe(ecarte);
    expect(r(titre)).not.toContain(ecarte);
  });
  it("« Optometric Technician » : le résolveur lit encore l'Optométriste, la lecture retirée par 6h ne le retient plus", () => {
    const titre = "Optometric Technician - Training Provided!";
    expect(occupationTitleReadings(v3, titre, v3.classify(titre)).some((l) => l.role === "optometrist")).toBe(true);
    expect(r(titre)).not.toContain("optometrist");
  });
  it("les corrections ne retirent rien de juste : le métier écarté se lit ou se classe encore là où il est", () => {
    expect(r("Store Manager - Hurstville")).toEqual(["store-manager"]);
    expect(r("Filialleiter (m/w/d)")).toEqual(["store-manager"]);
    expect(r("Assistant Store Manager Visual Merchandiser I")).toEqual(["assistant-store-manager"]);
    expect(r("Responsable adjoint F/H")).toEqual(["assistant-store-manager"]);
    expect(r("Footwear Designer")).toEqual(["designer-chaussures"]);
    expect(r("Merchandising Assistant - Paris")).toContain("assistant-merchandiser");
    expect(r("Werkstudent Controlling (m/w/d)")).toContain("financial-controller");
    expect(r("Contrôleur de gestion H/F")).toEqual(["financial-controller"]);
    expect(r("Account Manager")).toEqual(["responsable-de-comptes"]);
  });
});
