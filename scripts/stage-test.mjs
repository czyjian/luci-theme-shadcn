import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist/luci-theme-shadcn-test");
// Keep upstream sources intact; namespace every shipped path and text asset.
const rename = (s) => s.replaceAll("shadcn", "shadcn-test");
const content = (s) =>
  s
    .replaceAll("{# PKG_VERSION #}", "0.6.3-r2026111613")
    .replaceAll("/luci-static/shadcn", "/luci-static/shadcn-test")
    .replaceAll("themes/shadcn", "themes/shadcn-test")
    .replaceAll("shadcn/cpe", "shadcn-test/cpe")
    .replaceAll("menu-shadcn", "menu-shadcn-test")
    .replaceAll("sidebar-shadcn", "sidebar-shadcn-test")
    .replaceAll("router-shadcn", "router-shadcn-test")
    .replaceAll("luci-theme-shadcn-cpe", "luci-theme-shadcn-test-cpe")
    .replaceAll("shadcn.sidebar", "shadcn-test.sidebar");
async function copy(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const ent of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, ent.name),
      dst = path.join(to, rename(ent.name));
    if (ent.isDirectory()) await copy(src, dst);
    else {
      const buf = await fs.readFile(src);
      await fs.writeFile(
        dst,
        /\.(js|css|ut|json|svg|webmanifest)$/.test(ent.name) ||
          !ent.name.includes(".")
          ? content(buf.toString("utf8"))
          : buf,
      );
    }
  }
}
await fs.mkdir(target, { recursive: true });
for (const dir of ["htdocs", "ucode", "root"])
  await copy(path.join(root, dir), path.join(target, dir));
await fs.copyFile(path.join(root, "LICENSE"), path.join(target, "LICENSE"));
let make = await fs.readFile(path.join(root, "Makefile"), "utf8");
make = make
  .replace("LUCI_TITLE:=", "LUCI_TITLE:=5G CPE Test - ")
  .replace("PKG_RELEASE:=20261104", "PKG_RELEASE:=2026111613");
await fs.writeFile(path.join(target, "Makefile"), make);
await fs.writeFile(
  path.join(target, "root/etc/uci-defaults/30_luci-theme-shadcn-test"),
  `#!/bin/sh
uci set luci.themes.Shadcn_CPE_Test='/luci-static/shadcn-test'
uci commit luci
exit 0
`,
);
console.log(target);
