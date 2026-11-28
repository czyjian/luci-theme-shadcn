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
var startThemeUpdate = rpc.declare({
  object: "shadcn.update",
  method: "start",
  expect: {},
});
var themeUpdateStatus = rpc.declare({
  object: "shadcn.update",
  method: "status",
  expect: {},
});
var startQModemUpdate = rpc.declare({
  object: "shadcn.update",
  method: "qmodem_start",
  expect: {},
});
var qmodemUpdateStatus = rpc.declare({
  object: "shadcn.update",
  method: "qmodem_status",
  expect: {},
});
function showThemeUpdate() {
  return showSoftwareUpdate("theme");
}
function showQModemUpdate() {
  return showSoftwareUpdate("qmodem");
}
function showSoftwareUpdate(component) {
  var startUpdate =
    component === "qmodem" ? startQModemUpdate : startThemeUpdate;
  var updateStatus =
    component === "qmodem" ? qmodemUpdateStatus : themeUpdateStatus;
  var title = E(
    "p",
    { style: "text-align:center", role: "status", "aria-live": "polite" },
    "正在下载...",
  );
  var fill = E("div", { style: "width:0%" }, E("small", {}, "0%"));
  var progress = E(
    "div",
    {
      class: "cbi-progressbar",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": "0",
    },
    fill,
  );
  var close = E(
    "button",
    {
      type: "button",
      class: "cbi-button",
      disabled: true,
      click: ui.hideModal,
    },
    "关闭",
  );
  ui.showModal(
    component === "qmodem" ? "更新 QModem" : "更新 luci-theme-shadcn",
    [title, progress, E("div", { class: "right" }, close)],
  );
  var failures = 0;
  function poll() {
    updateStatus()
      .then(function (data) {
        failures = 0;
        var percent = Math.max(0, Math.min(100, Number(data.percent) || 0));
        fill.style.width = percent + "%";
        fill.firstChild.textContent = percent + "%";
        progress.setAttribute("aria-valuenow", String(percent));
        if (data.phase === "complete") {
          title.textContent = "更新完成";
          progress.remove();
          close.disabled = false;
          close.onclick = function () {
            window.location.reload();
          };
          return;
        }
        if (data.phase === "failed") {
          title.textContent = data.message || "更新失败，请重试";
          progress.remove();
          close.disabled = false;
          return;
        }
        title.textContent =
          data.phase === "installing" ? "正在安装..." : "正在下载...";
        window.setTimeout(poll, 700);
      })
      .catch(function () {
        if (++failures < 15) {
          window.setTimeout(poll, 1000);
          return;
        }
        title.textContent = "暂时无法读取更新进度，请刷新页面后检查版本";
        progress.remove();
        close.disabled = false;
      });
  }
  startUpdate()
    .then(function (result) {
      if (result && result.busy) {
        title.textContent = "有其他更新任务正在进行，请稍后重试";
        progress.remove();
        close.disabled = false;
        return;
      }
      poll();
    })
    .catch(function () {
      title.textContent = "无法启动更新，请刷新页面后重试";
      progress.remove();
      close.disabled = false;
    });
}
function sourceState(remote) {
  if (!remote) return "正在检查…";
  if (remote.state === "unpublished") return "暂无版本更新";
  if (remote.state === "ahead") return "有更新";
  if (remote.state === "identical" || remote.state === "behind")
    return "暂无版本更新";
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
        ["theme", "luci-theme-shadcn"],
      ].forEach(function (item) {
        var version = E("td", { class: "td" }, "—"),
          state = E("td", { class: "td" }, "正在检查…"),
          action = E("td", {
            class: "td right",
            style: "width:1%;white-space:nowrap",
          });
        rows[item[0]] = { version: version, state: state, action: action };
        body.appendChild(
          E("tr", { class: "tr" }, [
            E("td", { class: "td" }, item[1]),
            version,
            state,
            action,
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
              E("th", { class: "th", "aria-label": "操作" }),
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
            if (result && result.state === "ahead") {
              row.action.textContent = "";
              row.action.appendChild(
                E(
                  "button",
                  {
                    type: "button",
                    class: "cbi-button cbi-button-action",
                    click:
                      component.name === "theme"
                        ? showThemeUpdate
                        : showQModemUpdate,
                  },
                  "更新",
                ),
              );
            }
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
