import { describe, expect, it } from "vitest";
import { loadOccupationTaxonomy } from "@catwalks/db/occupations";

/** La garde de schéma du lot 2B (packages/db/occupation-catalogue.ts) : sans les migrations, refus avant toute écriture,
 * en nommant les migrations ; revérifiée après un refus. Fichier à part : la garde se souvient d'un succès par processus. */
describe("garde de schéma 2B", () => {
  it("refuse sans les migrations, puis laisse passer une fois appliquées", async () => {
    let migre = false;
    const db = {
      $queryRaw: async () => [{ ok: migre }],
      occupationState: { findUnique: async () => null },
    } as any;
    await expect(loadOccupationTaxonomy(db)).rejects.toThrow(/OCCUPATION_SCHEMA_2B_MISSING: appliquer les migrations 20260929160000 et 20260929160100/);
    migre = true;
    // La garde passe : l'erreur suivante est celle du catalogue non activé, lue après elle.
    await expect(loadOccupationTaxonomy(db)).rejects.toThrow("OCCUPATION_CATALOGUE_NOT_ACTIVATED");
  });
});
