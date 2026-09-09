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
  it("does not drop query constraints when expanding synonyms", () => {
    expect(catalogue.queryOccupations("Conseillère de vente")).toEqual([
      "sales-advisor",
    ]);
    expect(catalogue.queryOccupations("Conseillère de vente Paris")).toEqual(
      [],
    );
    expect(catalogue.queryOccupations("Client Consultant")).toEqual([]);
  });
  it("a new occupation and its labels/rules can be added as data alone", () => {
    const updated = structuredClone(seed) as any;
    updated.id = "data-only-test-release";
    updated.occupations.push({
      key: "optical-assistant",
      labels: { fr: "Assistant optique", en: "Optical assistant" },
      family: "health-optical-services",
      aliases: ["Optical Assistant"],
    });
    updated.rules.push({
      id: "optical-assistant-title",
      occupation: "optical-assistant",
      all: [{ field: "title", any: ["Optical Assistant"] }],
      evidence:
        "Real previously unclassified production title; reviewed test of data-only addition.",
    });
    const next = compileOccupationManifest(updated);
    expect(next.classify("Optical Assistant").occupationCode).toBe(
      "optical-assistant",
    );
    expect(catalogue.classify("Optical Assistant").occupationCode).toBeNull();
    expect(next.queryOccupations("Assistant optique")).toEqual([
      "optical-assistant",
    ]);
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
    expect(decision.isRetail).toBe(false);
  }
  const retail = catalogue.classify("Beauty Advisor");
  expect(retail.jobFunction).toBe("beauty-advisor");
  expect(retail.isRetail).toBe(true);
});
