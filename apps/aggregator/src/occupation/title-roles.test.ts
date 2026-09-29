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
 * que sa situation de départ atteint le défaut (le résolveur LIT bien l'expression), puis que la règle le retient : sinon
 * il passerait au vert sans rien exercer.
 */
const base = structuredClone(seed) as any;
base.id = "lecture-titre-test";
const vendeur = base.occupations.find((o: any) => o.key === "sales-advisor");
vendeur.aliases = [...vendeur.aliases, "Vendeur"];
vendeur.titleReadingAliases = ["Vendeur"];
base.occupations.push(
  { key: "keyholder", labels: { fr: "Keyholder", en: "Keyholder" }, family: "retail-store-management", aliases: ["Keyholder"], titleReadingAliases: ["Keyholder"] },
  { key: "commercial", labels: { fr: "Commercial", en: "Sales representative" }, family: "wholesale-b2b", aliases: ["Commercial"] },
  { key: "responsable-vendeur", labels: { fr: "Responsable vendeur", en: "Sales team leader" }, family: "retail-store-management", aliases: ["Responsable vendeur"] },
  { key: "floor-manager", labels: { fr: "Floor manager", en: "Floor Manager" }, family: "retail-store-management", aliases: ["Supervisor"], titleReadingAliases: ["Floor Manager", "Supervisor"] },
);
const catalogue = compileOccupationManifest(base);
// La lecture seule, sans les candidats du moteur (la v1 classe déjà « Vendeur » : le candidat masquerait la lecture).
const roles = (t: string) => occupationTitleRoles(catalogue, t, []);
const lu = (t: string, role: string) => occupationTitleReadings(catalogue, t).some((l) => l.role === role);

describe("métiers lus dans un intitulé plus long (D-475 point 38)", () => {
  it("une expression vérifiée (titleReadingAliases) se lit : « Retail Keyholder - Mall »", () => {
    expect(catalogue.classify("Retail Keyholder - Mall").occupationEvidence.candidates).not.toContain("keyholder");
    expect(roles("Retail Keyholder - Mall")).toContain("keyholder");
  });

  it("une expression NON vérifiée ne se lit pas (R-66 §2) : « Commercial Controller » n'est pas un commercial", () => {
    expect(lu("Commercial Controller - NIVEA", "commercial")).toBe(true);
    expect(roles("Commercial Controller - NIVEA")).not.toContain("commercial");
  });

  it("la portée la plus longue l'emporte : « Responsable vendeur » ne laisse pas lire « vendeur » (point 32 a)", () => {
    expect(roles("Vendeur Paris")).toContain("sales-advisor");
    expect(lu("Responsable vendeur Paris", "sales-advisor")).toBe(false);
    expect(roles("Responsable vendeur Paris")).not.toContain("sales-advisor");
  });

  it("un métier dont une règle exclut l'intitulé (mot d'encadrement jugé) n'est pas lu", () => {
    expect(roles("Superviseur Vendeur Paris")).toContain("sales-advisor");
    const avecExclusion = structuredClone(base);
    avecExclusion.id = "lecture-titre-exclusion";
    avecExclusion.rules.push({ id: "test-vendeur-encadrement", occupation: "sales-advisor", all: [{ field: "title", any: ["Vendeur"] }],
      exclude: [{ field: "title", any: ["Superviseur"] }], evidence: "Témoin : un mot d'encadrement exclut le métier encadré." });
    const c = compileOccupationManifest(avecExclusion);
    expect(occupationTitleRoles(c, "Superviseur Vendeur Paris", [])).not.toContain("sales-advisor");
  });

  it("un alias fait de mots de niveau ne se lit jamais dans un intitulé plus long, même listé (points 36, 37)", () => {
    expect(occupationLevelOnly("Supervisor")).toBe(true);
    expect(lu("Supervisor Warehouse", "floor-manager")).toBe(true);
    expect(roles("Supervisor Warehouse")).not.toContain("floor-manager");
    expect(roles("Floor Manager Maastricht")).toContain("floor-manager");
  });

  it("les candidats du moteur restent, et l'intitulé vide ne lit rien", () => {
    expect(occupationTitleRoles(catalogue, "Sales Advisor", catalogue.classify("Sales Advisor").occupationEvidence.candidates)).toEqual(["sales-advisor"]);
    expect(occupationTitleRoles(catalogue, "  ", ["sales-advisor"])).toEqual(["sales-advisor"]);
    expect(occupationTitleRoles(catalogue, null, [])).toEqual([]);
  });

  it("le moteur refuse une expression lue absente du vocabulaire du métier", () => {
    const faux = structuredClone(base);
    faux.id = "lecture-titre-hors-vocabulaire";
    faux.occupations.find((o: any) => o.key === "keyholder").titleReadingAliases = ["Store Keyholder"];
    expect(() => compileOccupationManifest(faux)).toThrow(/Title reading alias outside the occupation vocabulary: keyholder/);
  });
});

describe("la v3 de la passe de curation, sur les exemples de l'arbitrage et de la mesure 6f", () => {
  const v3 = compileOccupationManifest(JSON.parse(readFileSync(new URL("../../../../audits/2026-09-28/curation-v3/6-manifeste-v3.json", import.meta.url), "utf8")));
  const r = (t: string) => occupationTitleRoles(v3, t, v3.classify(t).occupationEvidence.candidates);
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
    expect(occupationTitleReadings(v3, titre).some((l) => l.role === role)).toBe(true);
    expect(r(titre)).not.toContain(role);
  });
  it("« Responsable vendeur » reste le seul encadrement de la vente", () => {
    expect(r("Responsable vendeur")).toEqual(["retail-sales-lead"]);
  });
});
