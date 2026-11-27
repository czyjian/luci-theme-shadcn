import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source = fs.readFileSync(
  new URL("../src/resource/view/shadcn/updates.js", import.meta.url),
  "utf8",
);
const module = new Function("rpc", "L", source)(
  { declare: () => () => {} },
  { Class: { extend: (x) => x } },
);
test("update dialog keeps statuses concise and never calls unrecorded revisions current", () => {
  assert.equal(
    module.sourceState({ state: "identical" }, { modified: true }),
    "暂无更新",
  );
  assert.equal(module.sourceState({ state: "ahead" }), "有更新");
  assert.equal(module.sourceState({ state: "behind" }), "暂无更新");
  assert.equal(module.sourceState({ state: "failed" }), "检查失败");
  assert.equal(
    module.sourceState({ state: "unrecorded" }),
    "未记录源码版本，无法比较",
  );
  assert(!source.includes("版本详情"));
  assert(!source.includes("本地修改"));
});
