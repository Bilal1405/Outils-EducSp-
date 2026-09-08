import { describe, it, expect } from "vitest";
import { calculerQuotaRestant, moisCourant } from "../src/services/quotaService";

// QUOTA-01 : calcul pur, testable sans DB.
describe("calculerQuotaRestant", () => {
  it("soustrait la consommation du quota mensuel", () => {
    expect(calculerQuotaRestant(50, 10)).toBe(40);
  });

  it("ne descend jamais sous zéro (quota déjà dépassé)", () => {
    expect(calculerQuotaRestant(50, 60)).toBe(0);
  });

  it("quota intact si aucune consommation", () => {
    expect(calculerQuotaRestant(50, 0)).toBe(50);
  });
});

describe("moisCourant", () => {
  it("normalise toute date au premier jour du mois (UTC)", () => {
    expect(moisCourant(new Date("2026-07-31T23:00:00Z"))).toBe("2026-07-01");
  });

  it("change de mois au passage UTC", () => {
    expect(moisCourant(new Date("2026-08-01T00:00:00Z"))).toBe("2026-08-01");
  });
});
