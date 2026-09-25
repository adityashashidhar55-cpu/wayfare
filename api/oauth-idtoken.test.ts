import { describe, expect, it } from "vitest";
import { microsoftIssuerOk } from "./oauth-providers";

describe("microsoftIssuerOk", () => {
  const tid = "9188040d-6c67-4c5b-b112-36a304b66dad";
  it("accepts the issuer that matches the token's own tenant", () => {
    expect(microsoftIssuerOk(`https://login.microsoftonline.com/${tid}/v2.0`, tid)).toBe(true);
  });
  it("rejects a mismatched or missing tenant", () => {
    expect(microsoftIssuerOk(`https://login.microsoftonline.com/${tid}/v2.0`, "other")).toBe(false);
    expect(microsoftIssuerOk("https://evil.example/v2.0", tid)).toBe(false);
    expect(microsoftIssuerOk(undefined, tid)).toBe(false);
  });
});
