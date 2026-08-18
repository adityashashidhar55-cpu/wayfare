import { describe, it, expect } from "vitest";
import { hostOf, requiresTls, normalizeDatabaseUrl } from "./db-url";

describe("hostOf", () => {
  it("reads the host past credentials", () => {
    expect(hostOf("mysql://u:p@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/wayfare"))
      .toBe("gateway01.eu-central-1.prod.aws.tidbcloud.com");
  });
  it("is not fooled by an @ inside the password", () => {
    expect(hostOf("mysql://user:p@ss@db.example.com:3306/x")).toBe("db.example.com");
  });
  it("handles a bracketed IPv6 host", () => {
    expect(hostOf("mysql://u:p@[::1]:3306/x")).toBe("[::1]");
  });
  it("returns empty for junk", () => {
    expect(hostOf("not-a-url")).toBe("");
  });
});

describe("requiresTls", () => {
  it("matches the managed providers that reject plaintext", () => {
    expect(requiresTls("gateway01.eu-central-1.prod.aws.tidbcloud.com")).toBe(true);
    expect(requiresTls("aws.connect.psdb.cloud")).toBe(true);
    expect(requiresTls("mysql-abc.a.aivencloud.com")).toBe(true);
  });
  it("does not match a lookalike domain", () => {
    expect(requiresTls("tidbcloud.com.evil.example")).toBe(false);
    expect(requiresTls("nottidbcloud.com")).toBe(false);
  });
  it("does not match ordinary hosts", () => {
    expect(requiresTls("mysql.railway.internal")).toBe(false);
    expect(requiresTls("localhost")).toBe(false);
  });
});

describe("normalizeDatabaseUrl", () => {
  it("adds TLS for a managed host that forgot it", () => {
    expect(normalizeDatabaseUrl("mysql://u:p@gateway01.tidbcloud.com:4000/wayfare"))
      .toBe('mysql://u:p@gateway01.tidbcloud.com:4000/wayfare?ssl={"rejectUnauthorized":true}');
  });
  it("appends with & when a query string already exists", () => {
    expect(normalizeDatabaseUrl("mysql://u:p@h.tidbcloud.com:4000/db?timezone=Z"))
      .toBe('mysql://u:p@h.tidbcloud.com:4000/db?timezone=Z&ssl={"rejectUnauthorized":true}');
  });
  it("leaves an explicit ssl param untouched", () => {
    const u = 'mysql://u:p@h.tidbcloud.com:4000/db?ssl={"rejectUnauthorized":false}';
    expect(normalizeDatabaseUrl(u)).toBe(u);
  });
  it("leaves ssl-mode untouched too", () => {
    const u = "mysql://u:p@h.example.com:3306/db?ssl-mode=DISABLED";
    expect(normalizeDatabaseUrl(u)).toBe(u);
  });
  it("does not touch localhost", () => {
    const u = "mysql://root:root@localhost:3306/wayfare";
    expect(normalizeDatabaseUrl(u)).toBe(u);
  });
  it("does not touch 127.0.0.1", () => {
    const u = "mysql://root@127.0.0.1:3306/wayfare";
    expect(normalizeDatabaseUrl(u)).toBe(u);
  });
  it("leaves Railway's internal host alone - it has no certificate", () => {
    const u = "mysql://root:pw@mysql.railway.internal:3306/railway";
    expect(normalizeDatabaseUrl(u)).toBe(u);
  });
  it("leaves a private-subnet host alone", () => {
    const u = "mysql://u:p@10.0.0.7:3306/wayfare";
    expect(normalizeDatabaseUrl(u)).toBe(u);
  });
  it("DB_SSL=on forces TLS on an unlisted host, DB_SSL=off suppresses it", () => {
    const priv = "mysql://u:p@10.0.0.7:3306/wayfare";
    expect(normalizeDatabaseUrl(priv, "on")).toContain("rejectUnauthorized");
    const tidb = "mysql://u:p@h.tidbcloud.com:4000/db";
    expect(normalizeDatabaseUrl(tidb, "off")).toBe(tidb);
  });
  it("passes a non-mysql url straight through", () => {
    const u = "postgres://u:p@h.example.com:5432/db";
    expect(normalizeDatabaseUrl(u)).toBe(u);
  });
  it("is a no-op on an empty string", () => {
    expect(normalizeDatabaseUrl("")).toBe("");
  });
});
