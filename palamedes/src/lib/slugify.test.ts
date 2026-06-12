import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/slugify";

describe("slugify", () => {
  it("converts titles to kebab-case", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("strips accents", () => {
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  it("only ever emits lowercase alphanumerics separated by single hyphens", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(slugify(input)).toMatch(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      }),
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        expect(slugify(slugify(input))).toBe(slugify(input));
      }),
    );
  });
});
