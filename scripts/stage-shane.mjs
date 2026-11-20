import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const target = path.join(root, "dist/luci-theme-shadcn-shane");
// Keep upstream sources intact; namespace every shipped path and text asset.
const rename = (s) => s.replaceAll("shadcn", "shadcn-shane");
const content = (s) =>
  s
    .replaceAll("{# PKG_VERSION #}", "0.6.3-r2026112001")
    .replaceAll("/luci-static/shadcn", "/luci-static/shadcn-shane")
    .replaceAll("themes/shadcn", "themes/shadcn-shane")
    .replaceAll("shadcn/cpe", "shadcn-shane/cpe")
    .replaceAll("menu-shadcn", "menu-shadcn-shane")
    .replaceAll("sidebar-shadcn", "sidebar-shadcn-shane")
    .replaceAll("router-shadcn", "router-shadcn-shane")
    .replaceAll("luci-theme-shadcn-cpe", "luci-theme-shadcn-shane-cpe")
    .replaceAll("shadcn.sidebar", "shadcn-shane.sidebar");
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
  .replace("LUCI_TITLE:=", "LUCI_TITLE:=Shadcn_Shane - ")
  .replace("PKG_RELEASE:=20261104", "PKG_RELEASE:=2026112001");
await fs.writeFile(path.join(target, "Makefile"), make);
await fs.writeFile(
  path.join(target, "root/etc/uci-defaults/30_luci-theme-shadcn-shane"),
  `#!/bin/sh
uci set luci.themes.Shadcn_Shane='/luci-static/shadcn-shane'
uci commit luci
exit 0
`,
);
console.log(target);
