import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Color from "colorjs.io";
import { resolveMode } from "../tokens/resolve.js";
const css = readFileSync(
  new URL("../src/media/patches/admin-services-openclash.css", import.meta.url),
  "utf8",
);
const colors = [...css.matchAll(/background-color:\s*(#[0-9a-f]+)/gi)].map(
  (m) => m[1],
);
// Match the hex path in OpenClash 0.48.015's luminanceFromColor().
function legacyLuminance(hex) {
  let c = hex.slice(1);
  if (c.length === 3) c = [...c].map((x) => x + x).join("");
  return (
    0.2126 * parseInt(c.slice(0, 2), 16) +
    0.7152 * parseInt(c.slice(2, 4), 16) +
    0.0722 * parseInt(c.slice(4, 6), 16)
  );
}
test("OpenClash body probe correctly classifies both Shadcn modes", () => {
  assert.equal(colors.length, 2);
  assert.ok(legacyLuminance(colors[0]) > 156);
  assert.ok(legacyLuminance(colors[1]) < 100);
});
test("compatibility colors preserve the Shadcn background palette", () => {
  ["light", "dark"].forEach((mode, i) => {
    const original = new Color(resolveMode(mode).background).to("srgb").coords;
    const compat = new Color(colors[i]).to("srgb").coords;
    original.forEach((channel, k) =>
      assert.ok(Math.abs(channel - compat[k]) <= 1 / 255),
    );
  });
});
