"use strict";
"require rpc";
"require ui";
var localStatus = rpc.declare({
  object: "qmodem.update",
  method: "status",
  expect: {},
});
var remoteStatus = rpc.declare({
  object: "qmodem.update",
  method: "check",
  expect: {},
});
function sourceState(remote) {
  if (!remote) return "正在检查…";
  if (remote.state === "ahead") return "有更新";
  if (remote.state === "identical" || remote.state === "behind")
    return "暂无更新";
  if (remote.state === "unrecorded") return "未记录源码版本，无法比较";
  if (remote.state === "diverged") return "版本分支不同";
  return "检查失败";
}
return L.Class.extend({
  sourceState: sourceState,
  render: function () {
    var button = E(
      "button",
      { type: "button", class: "cbi-button cbi-button-action" },
      "检查更新",
    );
    button.addEventListener("click", function () {
      button.disabled = true;
      var body = E("tbody");
      var rows = {};
      [
        ["qmodem", "QModem"],
        ["theme", "shadcn"],
      ].forEach(function (item) {
        var version = E("td", { class: "td" }, "—"),
          state = E("td", { class: "td" }, "正在检查…");
        rows[item[0]] = { version: version, state: state };
        body.appendChild(
          E("tr", { class: "tr" }, [
            E("td", { class: "td" }, item[1]),
            version,
            state,
          ]),
        );
      });
      ui.showModal("检查更新", [
        E("table", { class: "table" }, [
          E(
            "thead",
            {},
            E("tr", { class: "tr" }, [
              E("th", { class: "th" }, "组件"),
              E("th", { class: "th" }, "当前版本"),
              E("th", { class: "th" }, "更新状态"),
            ]),
          ),
          body,
        ]),
        E(
          "div",
          { class: "right" },
          E(
            "button",
            { type: "button", class: "cbi-button", click: ui.hideModal },
            "关闭",
          ),
        ),
      ]);
      function paint(data, remote) {
        (data.components || []).forEach(function (component) {
          var row = rows[component.name];
          if (!row) return;
          row.version.textContent = component.version || "未安装";
          if (remote) {
            var result = ((data.remote || {}).components || []).find(
              function (item) {
                return item.name === component.name;
              },
            );
            row.state.textContent =
              data.remote && data.remote.busy
                ? "请稍后重试"
                : sourceState(result || { state: "failed" });
          }
        });
      }
      // Show local versions even if the network query fails.
      var local = localStatus().then(
        function (data) {
          paint(data, false);
        },
        function () {},
      );
      local
        .then(function () {
          return remoteStatus();
        })
        .then(
          function (data) {
            paint(data, true);
          },
          function () {
            Object.keys(rows).forEach(function (key) {
              rows[key].state.textContent = "检查失败";
            });
          },
        )
        .finally(function () {
          button.disabled = false;
        });
    });
    return E("div", { class: "cpe-update-actions" }, button);
  },
});
