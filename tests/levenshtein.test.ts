import { describe, expect, it } from "vitest";
import { editDistance, findTypos } from "../src/domain/levenshtein.js";

describe("editDistance", () => {
  it("is zero for identical strings", () => {
    expect(editDistance("kelakuan", "kelakuan")).toBe(0);
  });

  it("counts a single substitution", () => {
    expect(editDistance("kelakuan", "kelakuam")).toBe(1);
  });

  it("counts an insertion", () => {
    expect(editDistance("rumah", "rumahh")).toBe(1);
  });

  it("counts a deletion", () => {
    expect(editDistance("rumah", "umah")).toBe(1);
  });

  it("is symmetric", () => {
    expect(editDistance("kebun", "buku")).toBe(editDistance("buku", "kebun"));
  });

  it("measures against the empty string", () => {
    expect(editDistance("", "")).toBe(0);
    expect(editDistance("", "abc")).toBe(3);
  });
});

describe("findTypos", () => {
  const dictionary = ["kelakuan", "keluarga", "keliling", "rumah", "buku"];

  it("returns the nearest candidate first", () => {
    expect(findTypos("kelakuam", dictionary)[0]?.word).toBe("kelakuan");
  });

  it("never offers the input back as its own suggestion", () => {
    const suggestions = findTypos("kelakuan", dictionary);
    expect(suggestions.map((s) => s.word)).not.toContain("kelakuan");
  });

  it("drops candidates beyond the distance limit", () => {
    const suggestions = findTypos("kelakuan", dictionary, 1);
    expect(suggestions.every((s) => s.distance === 1)).toBe(true);
  });

  it("honours the result limit", () => {
    // Every candidate here is within 2 edits of "kel", so the limit is what
    // decides the result count rather than the distance filter.
    const candidates = ["keli", "kelo", "kelu"];
    expect(findTypos("kel", candidates, 2, 2)).toHaveLength(2);
  });

  it("returns an empty list rather than throwing on an unknown word", () => {
    expect(findTypos("xyzzy", dictionary)).toEqual([]);
  });

  it("orders results by distance, then alphabetically", () => {
    const suggestions = findTypos("kel", ["keli", "kelo", "kelu"], 2);
    const nearest = suggestions.filter((s) => s.distance === 1);
    expect(nearest.map((s) => s.word)).toEqual([...nearest.map((s) => s.word)].sort());
  });
});