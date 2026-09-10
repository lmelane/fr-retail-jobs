import { describe, it, expect } from "vitest";
import { KIND_TO_ATS } from "./catalogKinds.js";
import { SUPPORTED_ATS_TYPES } from "./index.js";
describe("One adapter registry for qualification and ingestion", () => {
  it("qualification uses the exact runtime registry, including formerly omitted adapters", () => {
    for (const kind of [
      "icims",
      "oraclehcm",
      "flatchr",
      "taleo",
      "jobaffinity-wordpress",
      "swatchgroup",
    ])
      expect(KIND_TO_ATS[kind]).toBeTruthy();
  });
  it("every registered adapter is reachable and no kind invents an adapter", () => {
    expect([...new Set(Object.values(KIND_TO_ATS))].sort()).toEqual(
      [...SUPPORTED_ATS_TYPES].sort(),
    );
  });
});
