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
    "暂无版本更新",
  );
  assert.equal(module.sourceState({ state: "ahead" }), "有更新");
  assert.equal(module.sourceState({ state: "behind" }), "暂无版本更新");
  assert.equal(module.sourceState({ state: "failed" }), "检查失败");
  assert.equal(
    module.sourceState({ state: "unrecorded" }),
    "未记录源码版本，无法比较",
  );
  assert(!source.includes("版本详情"));
  assert(!source.includes("本地修改"));
});

test("theme installer renders real phases and removes progress on completion", async () => {
  let modal,
    pending = [];
  function element(tag, attrs = {}, children) {
    const list =
      children == null ? [] : Array.isArray(children) ? children : [children];
    return {
      tag,
      attrs,
      style: {},
      children: list,
      disabled: !!attrs.disabled,
      firstChild:
        typeof list[0] === "object" ? list[0] : { textContent: list[0] },
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      remove() {
        this.removed = true;
      },
    };
  }
  const states = [
    { phase: "downloading", percent: 42 },
    { phase: "installing", percent: 65 },
    { phase: "complete", percent: 100 },
  ];
  const api = new Function(
    "rpc",
    "L",
    "E",
    "ui",
    "window",
    source.replace(
      "return L.Class.extend({",
      "return {showThemeUpdate}; return L.Class.extend({",
    ),
  )(
    {
      declare: (spec) =>
        spec.object === "shadcn.update" && spec.method === "start"
          ? async () => ({ started: true })
          : async () => states.shift(),
    },
    {},
    element,
    {
      showModal: (title, nodes) => {
        modal = nodes;
      },
      hideModal() {},
    },
    { setTimeout: (fn) => pending.push(fn) },
  );
  api.showThemeUpdate();
  const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  await flush();
  assert.equal(modal[0].textContent, "正在下载...");
  assert.equal(modal[1].attrs["aria-valuenow"], "42");
  pending.shift()();
  await flush();
  assert.equal(modal[0].textContent, "正在安装...");
  assert.equal(modal[1].attrs["aria-valuenow"], "65");
  pending.shift()();
  await flush();
  assert.equal(modal[0].textContent, "更新完成");
  assert.equal(modal[1].removed, true);
  assert.equal(modal[2].children[0].disabled, false);
});
