import { describe, it, expect } from "vitest";
import seed from "../../../../packages/db/data/occupations-v1.json" with { type: "json" };
import {
  compileOccupationManifest,
  normalizeOccupationTitle,
} from "@catwalks/db/occupations";
const catalogue = compileOccupationManifest(seed);

describe("occupation resolution from real multilingual title shapes", () => {
  it.each([
    "Sales Advisor",
    "Client Advisor",
    "Luxury Sales Advisor",
    "Conseiller de vente",
    "Conseillère de vente",
    "Fashion Advisor",
    "Conseiller·ère de vente - Paris",
    "Sales Associate",
    "Verkaufsberater (m/w/d)",
    "Vendedora",
    "销售顾问",
  ])("%s keeps a stable sales occupation", (title) => {
    const d = catalogue.classify(title);
    expect(d.occupationCode).toBe("sales-advisor");
    expect(d.occupationStatus).toBe("CLASSIFIED");
    expect(d.seniority).toBeNull();
    expect(d.occupationEvidence.inputTitle).toBe(title);
  });
  it("uses a native department to disambiguate, never the employer identity", () => {
    expect(
      catalogue.classify("Stylist", " Salon Professionals").occupationCode,
    ).toBe("hairdresser");
    expect(catalogue.classify("Stylist").occupationCode).toBeNull();
    expect(
      catalogue.classify("Client Consultant", "Retail").occupationCode,
    ).toBe("sales-advisor");
    expect(catalogue.classify("Client Consultant").occupationCode).toBeNull();
  });
  it("preserves distinct roles and explicitly ambiguous hybrids", () => {
    expect(catalogue.classify("Beauty Advisor").occupationCode).toBe(
      "beauty-consultant",
    );
    expect(catalogue.classify("Dispensing Optician").occupationCode).toBe(
      "dispensing-optician",
    );
    expect(catalogue.classify("Pharmacy Technician").jobFunction).toBe(
      "health-optical-services",
    );
    expect(catalogue.classify("Demand Planner").jobFunction).toBe(
      "supply-chain-logistics",
    );
    expect(
      catalogue.classify("Distribution Center Area Manager").occupationCode,
    ).not.toBe("regional-retail-manager");
    const d = catalogue.classify("Caissier-Stockiste - Monaco");
    expect(d.occupationStatus).toBe("AMBIGUOUS");
    expect(d.occupationCode).toBeNull();
    expect(d.occupationEvidence.candidates).toEqual([
      "cashier",
      "stock-associate",
    ]);
  });
  it("does not let a generic advisor rule absorb remote customer service", () => {
    expect(catalogue.classify("E-Boutique Client Advisor").occupationCode).toBe(
      "customer-service-advisor",
    );
    expect(
      catalogue.classify("Senior Client Advisor - Mandarin Speaker").seniority,
    ).toBe("SENIOR");
  });
  it("keeps unknown, overlong and multilingual inputs as traceable unresolved decisions", () => {
    for (const title of [
      "Poste à pourvoir",
      "次世代の仕事",
      "مهنة جديدة",
      "x".repeat(1025),
    ]) {
      const d = catalogue.classify(title);
      expect(d.occupationCode).toBeNull();
      expect(d.occupationEvidence.inputTitle).toBe(title);
      expect(d.occupationEvidence.reason.length).toBeGreaterThan(15);
    }
    expect(normalizeOccupationTitle("  Conseillère  de vente ")).toBe(
      "CONSEILLERE DE VENTE",
    );
  });
  it("does not merge nearby professions or infer a director from an assistant title", () => {
    expect(catalogue.classify("Paralegal").occupationCode).toBe("paralegal");
    expect(catalogue.classify("Pharmacy Dispenser").occupationCode).toBe(
      "pharmacy-support-worker",
    );
    expect(catalogue.classify("Machine Learning Engineer").occupationCode).toBe(
      "machine-learning-engineer",
    );
    expect(catalogue.classify("Lash Technician").occupationCode).toBe(
      "lash-technician",
    );
    expect(catalogue.classify("Assistante de direction").seniority).toBeNull();
    expect(
      catalogue.classify(
        "Stage : Étudier l'impact de l'usinage sur un matériau et la fonction d'un composant horloger",
      ).occupationCode,
    ).toBeNull();
    expect(catalogue.classify("Area Manager").occupationCode).toBeNull();
    expect(catalogue.classify("Area Manager", "Retail").occupationCode).toBe(
      "regional-retail-manager",
    );
    expect(
      catalogue.classify("Fragrance Advisor").occupationSpecializations,
    ).toEqual(["fragrance"]);
  });
  it("keeps advertised alternative ranks unresolved, with the exact reason", () => {
    for (const title of [
      "Sales Associate (Junior/Senior/Supervisor)",
      "In-Store Visual Merchandiser (Junior/Senior)",
    ]) {
      const d = catalogue.classify(title);
      expect(d.seniority).toBeNull();
      expect(d.occupationEvidence.seniorityConfidence).toBe("UNRESOLVED");
      expect(d.occupationEvidence.seniorityRule).toBe(
        "explicit-alternative-ranks",
      );
    }
  });
  it("preserves evidenced intermediate ranks instead of targeting a cosmetic zero MID count", () => {
    expect(catalogue.classify("Mid-Weight Graphic Designer").seniority).toBe(
      "MID",
    );
    expect(catalogue.classify("Mid-Level Store Manager").seniority).toBe("MID");
    expect(catalogue.classify("Graphic Designer").seniority).toBeNull();
    expect(
      catalogue.classify("Senior Brand (mid-level) Designer").seniority,
    ).toBeNull();
    expect(
      catalogue.classify("Project Manager (mid-level to senior position)")
        .seniority,
    ).toBeNull();
  });
  it("refuses executable pattern changes in a data publication", () => {
    const changed = structuredClone(seed);
    changed.familyRules[0].pattern = "(a+)+$";
    expect(() => compileOccupationManifest(changed)).toThrow("immutable");
  });
  /**
   * L'exemple d'ajout doit porter sur un métier ABSENT du référentiel réel — le test ci-dessous vérifie
   * précisément que le catalogue courant ne le classe pas. `optical-assistant` servait d'exemple ; il est
   * devenu un vrai métier le 2026-09-14 (assistants de magasin d'optique chez Boots et Clarkson Eyecare),
   * et le test s'est mis à échouer sur un doublon de clé — ce qui est le bon comportement.
   *
   * *Un exemple de test qui finit par exister pour de vrai n'est plus un exemple : il faut en choisir un
   * autre, pas retirer le métier.*
   */
  it("a new occupation and its labels/rules can be added as data alone", () => {
    const updated = structuredClone(seed) as any;
    updated.id = "data-only-test-release";
    updated.occupations.push({
      key: "eyewear-workshop-technician",
      labels: { fr: "Technicien atelier lunetterie", en: "Eyewear workshop technician" },
      family: "health-optical-services",
      aliases: ["Eyewear Workshop Technician"],
    });
    updated.rules.push({
      id: "eyewear-workshop-technician-title",
      occupation: "eyewear-workshop-technician",
      all: [{ field: "title", any: ["Eyewear Workshop Technician"] }],
      evidence:
        "Real previously unclassified production title; reviewed test of data-only addition.",
    });
    const next = compileOccupationManifest(updated);
    expect(next.classify("Eyewear Workshop Technician").occupationCode).toBe(
      "eyewear-workshop-technician",
    );
    expect(catalogue.classify("Eyewear Workshop Technician").occupationCode).toBeNull();
    expect(next.occupations.get("eyewear-workshop-technician")?.labels).toEqual({
      fr: "Technicien atelier lunetterie",
      en: "Eyewear workshop technician",
    });
  });
  it("rule order cannot choose between two conflicting occupations", () => {
    const next = structuredClone(seed);
    next.rules.reverse();
    expect(
      compileOccupationManifest(next).classify("Caissier-Stockiste - Monaco"),
    ).toEqual(catalogue.classify("Caissier-Stockiste - Monaco"));
  });
  it("rejects broken links, duplicate keys and cyclic precedence before activation", () => {
    const missing = structuredClone(seed);
    missing.occupations[0].family = "missing";
    expect(() => compileOccupationManifest(missing)).toThrow("Missing family");
    const duplicate = structuredClone(seed);
    duplicate.occupations.push(duplicate.occupations[0]);
    expect(() => compileOccupationManifest(duplicate)).toThrow("duplicate");
    const cycle = structuredClone(
      seed,
    ) as import("@catwalks/db/occupations").OccupationManifest;
    cycle.rules[0].supersedes = [cycle.rules[1].id];
    cycle.rules[1].supersedes = [cycle.rules[0].id];
    expect(() => compileOccupationManifest(cycle)).toThrow("Cyclic");
  });
});

it("separates hands-on beauty services from retail beauty advice", () => {
  for (const title of ["Hairdresser", "Esthetician", "Make-Up Artist", "Brow Waxing Expert"]) {
    const decision = catalogue.classify(title);
    expect(decision.jobFunction).toBe("beauty-services");
    expect(decision.occupationGroup).toBe("services");
  }
  const retail = catalogue.classify("Beauty Advisor");
  expect(retail.jobFunction).toBe("beauty-advisor");
  expect(retail.occupationGroup).toBe("retail");
});

/**
 * OPTIQUE ET PHARMACIE — le piège du mot isolé, mesuré en production le 2026-09-14.
 *
 * `Dispenser` est le titre le plus fréquent des offres non classées (217 chez Boots). Le réflexe est de
 * l'attacher à l'optique — « dispensing optician », opticien-lunetier. **La mesure dit l'inverse : sur les
 * 306 offres `Dispenser` / `Trainee Dispenser` / `Relief Dispenser`, 306 descriptions parlent de pharmacie
 * et ZÉRO d'optique** (« you will be key member of our pharmacy team as you support the pharmacist »).
 *
 * Une règle écrite sur le mot seul aurait rangé 306 postes de préparateur en pharmacie dans l'optique.
 * *Un mot n'est pas un métier : c'est la description qui tranche, et elle se lit avant d'écrire la règle.*
 */
describe("optique et pharmacie : le mot seul ne décide pas", () => {
  it("« Dispenser » et ses variantes sont de la PHARMACIE, pas de l'optique", () => {
    for (const titre of ["Dispenser", "Trainee Dispenser", "Relief Dispenser"]) {
      expect(catalogue.classify(titre).occupationCode).toBe("pharmacy-support-worker");
    }
  });

  it("l'optique reste distinguée par métier", () => {
    expect(catalogue.classify("Dispensing Optician").occupationCode).toBe("dispensing-optician");
    expect(catalogue.classify("Contact Lens Optician").occupationCode).toBe("dispensing-optician");
    expect(catalogue.classify("Optometric Technician").occupationCode).toBe("optometrist");
  });

  it("l'assistant de magasin d'optique n'est ni opticien diplômé ni optométriste", () => {
    for (const titre of ["Optical Assistant", "Retail Assistant (Opticians)"]) {
      expect(catalogue.classify(titre).occupationCode).toBe("optical-assistant");
    }
  });

  it("les deux métiers vivent dans le MÊME groupe — services spécialisés", () => {
    /**
     * Décision propriétaire du 2026-09-14 : classer optique ET pharmacie, sous la famille commune
     * `health-optical-services` (« Santé, pharmacie et optique »), déjà présente au référentiel.
     * `classify` expose le GROUPE (`services`) ; la famille se lit sur le métier lui-même.
     */
    for (const titre of ["Dispenser", "Optical Assistant", "Dispensing Optician"]) {
      expect(catalogue.classify(titre).occupationGroup).toBe("services");
    }
  });
});

/**
 * Correspondance v2 (lot 2B de D-475, plan `docs/architecture/classification-metiers.md` §3.3 et exigences (9) à (11)
 * du §3.1) : activée par le manifeste (`matchingVersion: 2`), jamais par défaut. Chaque témoin vérifie d'abord que la
 * v1 échoue sur le même manifeste (sa prémisse : le défaut existe), puis que la v2 le corrige.
 */
describe("correspondance v2 : écritures, genre, marques", () => {
  const regle = (id: string, occupation: string, any: string[], mode?: "exact") => ({
    id, occupation, all: [{ field: "title", any, ...(mode ? { mode } : {}) }], evidence: "témoin du lot 2B",
  });
  const rules = [
    regle("t-beaute-ja", "beauty-consultant", ["ビューティーアドバイザー"]),
    regle("t-vente-th", "sales-advisor", ["พนักงานขาย"]),
    regle("t-vente-ja", "sales-advisor", ["販売員"]),
    regle("t-vente-ar", "sales-advisor", ["مستشار مبيعات"]),
    regle("t-vente-ko", "sales-advisor", ["판매 사원"]),
    regle("t-acheteur-ja", "buyer", ["バイヤー"]),
    regle("t-adjoint", "assistant-store-manager", ["Responsable adjoint"]),
    regle("t-vente-it", "sales-advisor", ["Commesso"]),
    regle("t-vente-es", "sales-advisor", ["Dependiente"]),
    regle("t-vente-de", "sales-advisor", ["Kaufmann im Einzelhandel"]),
    regle("t-caisse-exact", "cashier", ["Employé de caisse"], "exact"),
    regle("t-niveau-exact", "store-manager", ["Supervisor I"], "exact"),
  ];
  const avec = (version?: 2) => compileOccupationManifest({ ...seed, ...(version ? { matchingVersion: version } : {}), rules: [...seed.rules, ...rules] });
  const v1 = avec(), v2 = avec(2);

  it.each([
    ["コスメビューティーアドバイザー", "beauty-consultant"],
    ["พนักงานขายเครื่องสำอาง", "sales-advisor"],
    ["Responsable adjointe", "assistant-store-manager"],
    ["Commessa", "sales-advisor"],
    ["Dependienta de tienda", "sales-advisor"],
    ["Kauffrau im Einzelhandel", "sales-advisor"],
    ["Employée de caisse H/F", "cashier"],
    ["Employé de caisse (m/w/d) - Part Time", "cashier"],
    ["Employé de caisse CDI 35H", "cashier"],
    ["Supervisor I - Full Time", "store-manager"],
  ])("%s : la v1 le manque, la v2 le classe", (titre, attendu) => {
    expect(v1.classify(titre).occupationCode).not.toBe(attendu);
    const d = v2.classify(titre);
    expect(d.occupationCode).toBe(attendu);
    expect(d.occupationEvidence.normalizationVersion).toBe(2);
  });

  it("le dakuten distingue deux mots que la v1 confondait : « バイヤー » (acheteur) n'est pas « ハイヤー » (voiture de place)", () => {
    expect(v1.classify("ハイヤー運転手").occupationCode).toBe("buyer");
    expect(v2.classify("ハイヤー運転手").occupationCode).not.toBe("buyer");
    expect(v2.classify("アパレルバイヤー").occupationCode).toBe("buyer");
  });

  it("ce que la v1 classait déjà reste classé en v2 (idéogrammes, arabe, coréen)", () => {
    expect(v2.classify("販売員（アルバイト）").occupationCode).toBe("sales-advisor");
    expect(v2.classify("مستشار مبيعات - دوام كامل").occupationCode).toBe("sales-advisor");
    expect(v2.classify("판매 사원 모집").occupationCode).toBe("sales-advisor");
  });

  it("une règle exacte reste exacte : un intitulé plus long, hors marques, ne la déclenche pas", () => {
    expect(v2.classify("Employé de caisse principal").occupationCode).not.toBe("cashier");
    expect(v2.classify("Lead Supervisor I").occupationCode).not.toBe("store-manager");
    // Une lettre seule n'est pas une marque de genre : « Supervisor I » n'est pas « Supervisor ».
    expect(v2.classify("Supervisor").occupationCode).not.toBe("store-manager");
  });

  it("la v1 reste la version servie à l'identique : clé, statut et version de normalisation", () => {
    const servie = compileOccupationManifest(seed);
    for (const titre of ["Conseillère de vente", "Verkaufsberater (m/w/d)", "Directrice de magasin", "Vendedora", "販売員"]) {
      const d = servie.classify(titre);
      expect(d.occupationEvidence.normalizationVersion).toBe(1);
      expect(d.normalizedTitle).toBe(normalizeOccupationTitle(titre));
    }
    expect(() => compileOccupationManifest({ ...seed, matchingVersion: 3 })).toThrow(/matching version/);
  });
});
