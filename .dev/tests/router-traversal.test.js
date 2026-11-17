import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL(
    "../node_modules/@eamonxg/luci-theme-devkit/runtime/router.js",
    import.meta.url,
  ),
  "utf8",
);
function setup(reason, options = {}) {
  let reloads = 0,
    intercept = null,
    rendered = 0;
  const window = {
    L: {},
    location: {
      href:
        options.currentUrl ||
        "http://router/cgi-bin/luci/admin/modem/qmodem/overview",
      reload: () => {
        reloads++;
      },
    },
  };
  const router = new Function(
    "baseclass",
    "ui",
    "poll",
    "rpc",
    "window",
    "navigation",
    source,
  )({ extend: (x) => x }, {}, {}, {}, window, {});
  router.route = () =>
    reason === "unknown" ? null : { className: "view.shadcn.cpe" };
  router.expired = reason === "expired";
  router.poisoned = () => reason === "stylesheet";
  router.scroller = () => null;
  router.navigate = () => {
    rendered++;
  };
  const event = {
    canIntercept: true,
    hashChange: false,
    downloadRequest: null,
    formData: null,
    navigationType: "traverse",
    destination: {
      url: "http://router/cgi-bin/luci/admin/cpe",
      sameDocument: true,
    },
    signal: { aborted: false },
    intercept: (value) => {
      intercept = value;
    },
    ...options,
  };
  router.onNavigate(event);
  return {
    event,
    get intercepted() {
      return intercept;
    },
    get reloads() {
      return reloads;
    },
    get rendered() {
      return rendered;
    },
  };
}
for (const reason of ["stylesheet", "expired", "unknown"]) {
  test(`unsafe same-document history entry reloads the committed destination: ${reason}`, () => {
    const state = setup(reason);
    assert.equal(typeof state.intercepted?.handler, "function");
    state.intercepted.handler();
    assert.equal(state.reloads, 1);
    assert.equal(state.rendered, 0);
  });
}
test("cancelled history traversal does not reload a newer page", () => {
  const state = setup("stylesheet");
  state.event.signal.aborted = true;
  state.intercepted.handler();
  assert.equal(state.reloads, 0);
});
test("ordinary link navigation and cross-document back keep native loading", () => {
  assert.equal(
    setup("stylesheet", { navigationType: "push" }).intercepted,
    null,
  );
  assert.equal(
    setup("stylesheet", {
      destination: {
        url: "http://router/cgi-bin/luci/admin/cpe",
        sameDocument: false,
      },
    }).intercepted,
    null,
  );
});
test("safe back navigation still uses the normal view renderer", () => {
  const state = setup("safe");
  assert.equal(state.intercepted.scroll, "after-transition");
  state.intercepted.handler();
  assert.equal(state.rendered, 1);
  assert.equal(state.reloads, 0);
});

for (const path of [
  "modem/qmodem/overview",
  "modem/qmodem/traffic",
  "modem/qmodem/sms",
  "network/network",
]) {
  test(`returning from dashboard shortcut restores the panel: ${path}`, () => {
    const state = setup("stylesheet", {
      currentUrl: "http://router/cgi-bin/luci/admin/" + path,
    });
    assert.equal(typeof state.intercepted?.handler, "function");
    state.intercepted.handler();
    assert.equal(state.reloads, 1);
    assert.equal(state.rendered, 0);
  });
}
