import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const repo = path.resolve(import.meta.dirname, "../..");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
function git(...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}
export async function writeThemeManifest(packageRoot, previous) {
  const make = await fs.readFile(path.join(packageRoot, "Makefile"), "utf8");
  const version =
    (make.match(/^PKG_VERSION:=(.+)$/m)?.[1] || "").trim() +
    "-r" +
    (make.match(/^PKG_RELEASE:=(.+)$/m)?.[1] || "").trim();
  const files = {};
  const staticRoot = path.join(packageRoot, "htdocs/luci-static");
  for (const relative of [
    "resources/view/shadcn/cpe.js",
    "resources/view/shadcn-shane/cpe.js",
    "resources/view/shadcn/updates.js",
    "resources/view/shadcn-shane/updates.js",
    "shadcn/main.css",
    "shadcn/cpe.css",
    "shadcn-shane/main.css",
    "shadcn-shane/cpe.css",
  ]) {
    try {
      files["/www/luci-static/" + relative] = hash(
        await fs.readFile(path.join(staticRoot, relative)),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  const metadata = {
    schema: 1,
    component: "theme",
    repository: "czyjian/luci-theme-shadcn",
    version,
    revision: previous?.revision ?? git("rev-parse", "HEAD"),
    modified:
      previous?.modified ??
      !!git(
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        ".dev/src",
        ".dev/scripts/build-update-state.mjs",
        "Makefile",
        "scripts/stage-shane.mjs",
      ),
    build_id: previous?.build_id || "",
    files,
  };
  const name = Object.keys(files).some((p) => p.includes("shadcn-shane/"))
    ? "luci-theme-shadcn-shane"
    : "luci-theme-shadcn";
  const out = path.join(packageRoot, "root/usr/share", name, "build.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(metadata) + "\n");
  return metadata;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  const inputs = [
    ".dev/src/resource/view/shadcn/updates.js",
    ".dev/src/resource/view/shadcn/cpe.js",
    ".dev/src/media/components/_cpe.css",
    "Makefile",
  ];
  const chunks = await Promise.all(
    inputs.map((p) => fs.readFile(path.join(repo, p))),
  );
  const id = hash(Buffer.concat(chunks)).slice(0, 16);
  const modulePath = path.join(
    repo,
    "htdocs/luci-static/resources/view/shadcn/updates.js",
  );
  const js = await fs.readFile(modulePath, "utf8");
  await fs.writeFile(modulePath, js.replaceAll("__QMODEM_CPE_BUILD__", id));
  await writeThemeManifest(repo, {
    revision: git("rev-parse", "HEAD"),
    modified: !!git(
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".dev/src",
      ".dev/scripts/build-update-state.mjs",
      "Makefile",
      "scripts/stage-shane.mjs",
    ),
    build_id: id,
  });
}
