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
  const v3 = compileOccupationManifest(JSON.parse(readFileSync(new URL("../../../../audits/2026-09-28/curation-v3/6-manifeste-v3.json", import.meta.url), "utf8")));
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
});
