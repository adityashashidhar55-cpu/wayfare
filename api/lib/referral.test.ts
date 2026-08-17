import { describe, expect, it } from "vitest";
import { generateReferralCode, REFERRAL_CODE_LENGTH, REFERRAL_CODE_RE } from "./referral";

describe("generateReferralCode", () => {
  it("mints 10-char url-safe codes", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode();
      expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
      expect(REFERRAL_CODE_RE.test(code)).toBe(true);
      // no ambiguous glyphs, nothing needing URL-encoding
      expect(code).not.toMatch(/[0O1lI+/=?&\s]/);
      expect(encodeURIComponent(code)).toBe(code);
    }
  });

  it("does not repeat across a large sample (collision-resistant)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateReferralCode());
    expect(seen.size).toBe(5000);
  });
});
