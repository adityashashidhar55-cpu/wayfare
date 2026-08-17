import { describe, expect, it } from "vitest";
import {
  hasNonLatinScript,
  pickDisplayName,
  splitBilingual,
} from "./latin-name";

describe("hasNonLatinScript", () => {
  it("detects Arabic", () => {
    expect(hasNonLatinScript("المسجد النبوي")).toBe(true);
  });
  it("detects CJK / kana / hangul", () => {
    expect(hasNonLatinScript("浅草寺")).toBe(true);
    expect(hasNonLatinScript("スターバックス")).toBe(true);
    expect(hasNonLatinScript("경복궁")).toBe(true);
  });
  it("detects Cyrillic, Thai, Hebrew, Devanagari", () => {
    expect(hasNonLatinScript("Красная площадь")).toBe(true);
    expect(hasNonLatinScript("วัดพระแก้ว")).toBe(true);
    expect(hasNonLatinScript("הכותל המערבי")).toBe(true);
    expect(hasNonLatinScript("ताज महल")).toBe(true);
  });
  it("returns false for plain Latin incl. diacritics", () => {
    expect(hasNonLatinScript("Mémorial Yves Saint Laurent")).toBe(false);
    expect(hasNonLatinScript("Café Müller")).toBe(false);
    expect(hasNonLatinScript("")).toBe(false);
  });
});

describe("splitBilingual", () => {
  it("splits Latin + Arabic mashup (Latin first)", () => {
    expect(splitBilingual("Mémorial Yves Saint Laurent نصب تذكاري إيف سانت لورينت")).toEqual({
      latin: "Mémorial Yves Saint Laurent",
      local: "نصب تذكاري إيف سانت لورينت",
    });
  });
  it("splits non-Latin first, Latin second", () => {
    expect(splitBilingual("スターバックス Starbucks")).toEqual({
      latin: "Starbucks",
      local: "スターバックス",
    });
  });
  it("keeps punctuation inside the Latin segment", () => {
    expect(splitBilingual("McDonald's ماكدونالدز")).toEqual({
      latin: "McDonald's",
      local: "ماكدونالدز",
    });
  });
  it("returns null for pure non-Latin names", () => {
    expect(splitBilingual("المسجد النبوي")).toBeNull();
  });
  it("returns null for pure Latin names", () => {
    expect(splitBilingual("Eiffel Tower")).toBeNull();
  });
  it("returns null when the Latin segment is too short", () => {
    expect(splitBilingual("AB مطعم")).toBeNull();
  });
  it("returns null when the Latin segment is a generic word", () => {
    expect(splitBilingual("Hotel فندق")).toBeNull();
    expect(splitBilingual("مطعم Restaurant")).toBeNull();
  });
  it("returns null when Latin appears in several disjoint runs", () => {
    expect(splitBilingual("Café カフェ Test")).toBeNull();
  });
});

describe("pickDisplayName", () => {
  it("keeps fully Latin names unchanged", () => {
    expect(pickDisplayName({ name: "Eiffel Tower" }, "Eiffel Tower")).toEqual({
      name: "Eiffel Tower",
      nameLocal: null,
    });
  });
  it("splits bilingual mashups even when name:en exists", () => {
    const tags = { name: "Mémorial Yves Saint Laurent نصب تذكاري", "name:en": "YSL Memorial" };
    expect(pickDisplayName(tags, tags.name)).toEqual({
      name: "Mémorial Yves Saint Laurent",
      nameLocal: "Mémorial Yves Saint Laurent نصب تذكاري",
    });
  });
  it("prefers name:en for pure non-Latin names", () => {
    const tags = { name: "المسجد النبوي", "name:en": "Al-Masjid an-Nabawi" };
    expect(pickDisplayName(tags, tags.name)).toEqual({
      name: "Al-Masjid an-Nabawi",
      nameLocal: "المسجد النبوي",
    });
  });
  it("falls back through int_name → name:en-Latn → name:latin", () => {
    expect(pickDisplayName({ int_name: "Senso-ji" }, "浅草寺")).toEqual({
      name: "Senso-ji",
      nameLocal: "浅草寺",
    });
    expect(pickDisplayName({ "name:en-Latn": "Gyeongbokgung" }, "경복궁")).toEqual({
      name: "Gyeongbokgung",
      nameLocal: "경복궁",
    });
    expect(pickDisplayName({ "name:latin": "Taj Mahal" }, "ताज महल")).toEqual({
      name: "Taj Mahal",
      nameLocal: "ताज महल",
    });
  });
  it("name:en wins over int_name", () => {
    const tags = { "name:en": "Red Square", int_name: "Krasnaya Ploshchad" };
    expect(pickDisplayName(tags, "Красная площадь")).toEqual({
      name: "Red Square",
      nameLocal: "Красная площадь",
    });
  });
  it("leaves the row unchanged when no English form exists", () => {
    expect(pickDisplayName({}, "المسجد النبوي")).toEqual({
      name: "المسجد النبوي",
      nameLocal: null,
    });
  });
  it("ignores empty alt-name tags", () => {
    const tags = { "name:en": "  ", int_name: "Senso-ji" };
    expect(pickDisplayName(tags, "浅草寺")).toEqual({
      name: "Senso-ji",
      nameLocal: "浅草寺",
    });
  });
});
