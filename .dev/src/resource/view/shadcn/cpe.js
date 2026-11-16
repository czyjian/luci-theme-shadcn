"use strict";
"require view";
"require rpc";
"require uci";
"require poll";
"require network";
"require fs";

var info = rpc.declare({ object: "system", method: "info" });
var board = rpc.declare({ object: "system", method: "board" });
var devices = rpc.declare({ object: "network.device", method: "status" });
var leases = rpc.declare({
  object: "luci-rpc",
  method: "getDHCPLeases",
  params: ["family"],
  expect: {},
});
function modem(method) {
  return rpc.declare({
    object: "qmodem",
    method: method,
    params: ["config_section"],
  });
}
var base = modem("base_info"),
  cell = modem("cell_info"),
  sim = modem("sim_info");
var current = rpc.declare({
  object: "qmodem.traffic",
  method: "current",
  params: ["config_section"],
});
function safe(p) {
  return p.catch(function () {
    return null;
  });
}
function bytes(n) {
  n = Number(n) || 0;
  var u = ["B", "KB", "MB", "GB", "TB"],
    i = 0;
  while (n >= 1024 && i < 4) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i ? 2 : 0) + " " + u[i];
}
function fields(data) {
  var out = {};
  ((data || {}).modem_info || []).forEach(function (x) {
    if (out[x.key] == null)
      out[x.key] = String(x.value == null ? "" : x.value).trim();
  });
  return out;
}
function isp(v) {
  v = (v || "").trim();
  if (/^(?:[0-9a-f]{4})+$/i.test(v))
    v = v.replace(/.{4}/g, function (x) {
      return String.fromCharCode(parseInt(x, 16));
    });
  return v || "运营商未知";
}
function metric(label, value, note) {
  return E("div", { class: "cpe-metric" }, [
    E("span", { class: "cpe-muted" }, label),
    E("strong", {}, value),
    E("small", { class: "cpe-muted" }, note || ""),
  ]);
}
function card(title, children, cls) {
  return E(
    "section",
    { class: "cpe-card " + (cls || "") },
    [E("h3", {}, title)].concat(children),
  );
}
function link(label, path) {
  return E(
    "a",
    { class: "cpe-shortcut", href: L.url.apply(L, path.split("/")) },
    label + " ↗",
  );
}
function detail(label, value) {
  return E("div", { class: "cpe-detail" }, [
    E("span", { class: "cpe-muted" }, label),
    E("strong", {}, value || "—"),
  ]);
}
return view.extend({
  load: function () {
    return Promise.all([safe(uci.load("qmodem")), safe(board())]);
  },
  render: function (data) {
    var self = this,
      modems = uci.sections("qmodem", "modem-device").filter(function (s) {
        return s.state !== "disabled" && s.at_port;
      });
    var selected = modems[0] && modems[0][".name"],
      history = [],
      previous = null,
      generation = 0,
      modemCache = null;
    function readModem(id) {
      if (!id) return Promise.resolve([null, null, null]);
      if (
        !modemCache ||
        modemCache.id !== id ||
        Date.now() - modemCache.time > 10000
      )
        modemCache = {
          id: id,
          time: Date.now(),
          promise: Promise.all([safe(base(id)), safe(cell(id)), safe(sim(id))]),
        };
      return modemCache.promise;
    }
    var root = E("div", { class: "cpe-dashboard" }, [
        E("link", {
          rel: "stylesheet",
          href:
            L.env.media +
            "/cpe.css?v=" +
            encodeURIComponent(
              document.body.dataset.assetVersion || "2026111605",
            ),
        }),
      ]),
      live = E("div"),
      stamp = E("span", { class: "cpe-muted" }, "正在读取设备…");
    var select = E(
      "select",
      { "aria-label": "选择蜂窝模组" },
      modems.map(function (s) {
        return E(
          "option",
          { value: s[".name"] },
          s.alias && s.alias !== "-"
            ? s.alias
            : String(s.name || s[".name"]).toUpperCase(),
        );
      }),
    );
    select.addEventListener("change", function () {
      selected = select.value;
      history = [];
      previous = null;
      generation++;
      refresh();
    });
    root.appendChild(
      E("div", { class: "cpe-heading" }, [
        E("div", {}, [
          E("h2", {}, "面板"),
          E("p", { class: "cpe-muted" }, "连接、信号与流量，一目了然。"),
        ]),
        E("div", { class: "cpe-controls" }, [stamp, select]),
      ]),
    );
    root.appendChild(live);
    function refresh() {
      var id = selected,
        ticket = generation;
      return Promise.all([
        safe(info()),
        safe(devices()),
        safe(leases(4)),
        safe(network.getNetworks()),
        readModem(id),
        id ? safe(current(id)) : null,
        safe(fs.read("/proc/sys/net/netfilter/nf_conntrack_count")),
        safe(fs.exec("/sbin/ip", ["-j", "neigh", "show"])),
      ]).then(function (r) {
        if (ticket !== generation || !root.isConnected) return;
        var countText = String(r[6] == null ? "" : r[6]).trim();
        var connectionCount = /^\d+$/.test(countText)
          ? Number(countText)
          : null;
        var neighborResult = r[7];
        var modemData = r[4];
        r = [
          r[0],
          r[1],
          r[2],
          r[3],
          modemData[0],
          modemData[1],
          modemData[2],
          r[5],
        ];
        var sys = r[0] || {},
          dev = r[1] || {},
          lease = (r[2] || {}).dhcp_leases || [],
          nets = r[3] || [],
          b = fields(r[4]),
          c = fields(r[5]),
          s = fields(r[6]),
          t = r[7];
        var connectedDevices = null;
        try {
          if (neighborResult && neighborResult.code === 0) {
            var lan = nets.find(function (n) {
              return n.getName().toLowerCase() === "lan";
            });
            var lanDevice = lan && lan.getL3Device();
            var lanName = lanDevice && lanDevice.getName();
            if (lanName) {
              var known = {},
                active = {};
              lease.forEach(function (x) {
                if (x.macaddr) known[x.macaddr.toLowerCase()] = x;
              });
              JSON.parse(neighborResult.stdout || "[]").forEach(function (x) {
                if (
                  x.dev !== lanName ||
                  !x.lladdr ||
                  !(x.state || []).some(function (state) {
                    return (
                      ["REACHABLE", "DELAY", "PROBE", "PERMANENT"].indexOf(
                        state,
                      ) !== -1
                    );
                  })
                )
                  return;
                var mac = x.lladdr.toLowerCase(),
                  record = active[mac];
                if (!record)
                  record = active[mac] = {
                    macaddr: x.lladdr.toUpperCase(),
                    hostname: (known[mac] || {}).hostname,
                    ipaddr: x.dst,
                  };
                else if (x.dst.indexOf(":") === -1) record.ipaddr = x.dst;
              });
              connectedDevices = Object.keys(active).map(function (mac) {
                return active[mac];
              });
            }
          }
        } catch (e) {
          connectedDevices = null;
        }
        var section = modems.find(function (m) {
            return m[".name"] === id;
          }),
          iface = section && section.network,
          counters = dev[iface] && dev[iface].statistics;
        var now = performance.now(),
          rx = null,
          tx = null;
        if (t && t.config && t.config.enabled && t.now && !t.stale) {
          rx = Number(t.rx_rate) || 0;
          tx = Number(t.tx_rate) || 0;
        } else if (counters && previous && now > previous.time) {
          var dt = (now - previous.time) / 1000;
          if (
            counters.rx_bytes >= previous.rx &&
            counters.tx_bytes >= previous.tx
          ) {
            rx = (counters.rx_bytes - previous.rx) / dt;
            tx = (counters.tx_bytes - previous.tx) / dt;
          }
        }
        if (counters)
          previous = {
            rx: counters.rx_bytes,
            tx: counters.tx_bytes,
            time: now,
          };
        if (rx != null) {
          history.push({ rx: rx, tx: tx });
          if (history.length > 60) history.shift();
        }
        var connected = b.connect_status === "Yes",
          mode = c.network_mode || "等待网络信息",
          name = b.name || (section && section.name) || "未发现模组";
        var hero = E("section", { class: "cpe-card cpe-hero" }, [
          E("div", { class: "cpe-device-icon", "aria-hidden": "true" }, "5G"),
          E("div", { class: "cpe-device" }, [
            E("h3", {}, name),
            E(
              "span",
              { class: "cpe-muted" },
              (data[1] || {}).hostname +
                " · " +
                ((data[1] || {}).release || {}).distribution,
            ),
          ]),
          E(
            "span",
            { class: "cpe-status " + (connected ? "is-online" : "") },
            connected ? "● 蜂窝已连接" : "○ 蜂窝未连接",
          ),
          detail("运营商", isp(s.ISP)),
          detail("网络模式", mode),
        ]);
        var speed = card(
          "实时流量",
          [
            E("div", { class: "cpe-speeds" }, [
              metric(
                "↓ 下载",
                rx == null ? "—" : ((rx * 8) / 1e6).toFixed(2),
                "Mbps",
              ),
              metric(
                "↑ 上传",
                tx == null ? "—" : ((tx * 8) / 1e6).toFixed(2),
                "Mbps",
              ),
              metric("监测接口", iface || "—", "最近 60 个采样点"),
            ]),
          ],
          "cpe-traffic",
        );
        var ns = "http://www.w3.org/2000/svg",
          svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 720 170");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "蜂窝接口实时下载和上传速率曲线");
        [30, 75, 120, 165].forEach(function (y) {
          var l = document.createElementNS(ns, "path");
          l.setAttribute("d", "M0 " + y + "H720");
          l.setAttribute("class", "cpe-gridline");
          svg.appendChild(l);
        });
        var max = Math.max.apply(
          null,
          history
            .map(function (p) {
              return Math.max(p.rx, p.tx);
            })
            .concat([125000]),
        );
        ["rx", "tx"].forEach(function (key) {
          if (history.length < 2) return;
          var line = document.createElementNS(ns, "path");
          line.setAttribute(
            "d",
            history
              .map(function (p, i) {
                return (
                  (i ? "L" : "M") +
                  (((60 - history.length + i) * 720) / 59).toFixed(1) +
                  " " +
                  (160 - (p[key] / max) * 140).toFixed(1)
                );
              })
              .join(" "),
          );
          line.setAttribute("class", "cpe-line " + key);
          svg.appendChild(line);
        });
        speed.appendChild(svg);
        speed.appendChild(
          E("div", { class: "cpe-chart-caption" }, [
            E("span", {}, [
              E("span", { class: "cpe-rx-label" }, "● 下载"),
              " / ",
              E("span", { class: "cpe-tx-label" }, "● 上传"),
            ]),
            E("span", {}, "刻度上限 " + ((max * 8) / 1e6).toFixed(1) + " Mbps"),
          ]),
        );
        var signals = card("蜂窝信号", [
          E(
            "div",
            { class: "cpe-signal-grid" },
            ["RSRP", "RSRQ", "SINR"].map(function (k) {
              var n = parseFloat(c[k]),
                min = k === "RSRP" ? -140 : k === "RSRQ" ? -20 : -10,
                max = k === "RSRP" ? -65 : k === "RSRQ" ? -3 : 30;
              var pct = Number.isFinite(n)
                ? Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100))
                : 0;
              return E("div", {}, [
                metric(
                  k,
                  Number.isFinite(n) ? String(n) : "—",
                  k === "RSRP" ? "dBm" : "dB",
                ),
                E("progress", { max: 100, value: pct, "aria-label": k }),
              ]);
            }),
          ),
          detail("主载波频段", c.Band ? "n" + c.Band : "—"),
          detail("聚合载波", c["Band (CA)"] ? "n" + c["Band (CA)"] : "—"),
          detail(
            "PCI / ARFCN",
            [c["Physical Cell ID"], c.ARFCN].filter(Boolean).join(" / "),
          ),
          detail("下行带宽", c["DL Bandwidth"]),
        ]);
        var memory = sys.memory || {},
          mem = memory.total
            ? 100 *
              (1 -
                (memory.available != null ? memory.available : memory.free) /
                  memory.total)
            : null;
        var stats = E("div", { class: "cpe-summary" }, [
          metric(
            "今日用量",
            t && t.config && t.config.enabled && !t.stale
              ? bytes(((t.today || {}).rx || 0) + ((t.today || {}).tx || 0))
              : "—",
            "蜂窝接口统计",
          ),
          metric(
            "总连接数",
            connectionCount == null
              ? "—"
              : connectionCount.toLocaleString("zh-CN"),
            "连接跟踪表（TCP / UDP 等）",
          ),
          metric(
            "内存占用",
            mem == null ? "—" : mem.toFixed(0) + "%",
            bytes(memory.total) + " 总内存",
          ),
          metric(
            "运行时间",
            sys.uptime != null
              ? Math.floor(sys.uptime / 86400) +
                  " 天 " +
                  Math.floor((sys.uptime % 86400) / 3600) +
                  " 小时"
              : "—",
            "系统持续运行",
          ),
        ]);
        var clients = card("已连接设备", [
          E(
            "div",
            { class: "cpe-list" },
            connectedDevices && connectedDevices.length
              ? connectedDevices.map(function (x) {
                  return E("div", { class: "cpe-client" }, [
                    E(
                      "div",
                      { class: "cpe-client-icon", "aria-hidden": "true" },
                      "↗",
                    ),
                    E("div", {}, [
                      E("strong", {}, x.hostname || "未命名设备"),
                      E("small", { class: "cpe-muted" }, x.macaddr || ""),
                    ]),
                    E("span", { class: "cpe-muted" }, x.ipaddr || "—"),
                  ]);
                })
              : [
                  E(
                    "p",
                    { class: "cpe-muted" },
                    connectedDevices
                      ? "暂未检测到活跃的局域网设备。"
                      : "设备连接状态暂不可用，请检查读取权限。",
                  ),
                ],
          ),
        ]);
        var interfaces = card("网络接口", [
          E(
            "div",
            { class: "cpe-list" },
            nets
              .filter(function (n) {
                return n.getName() !== "loopback";
              })
              .map(function (n) {
                return E("div", { class: "cpe-interface" }, [
                  E("span", {
                    class: "cpe-dot " + (n.isUp() ? "is-online" : ""),
                  }),
                  E("div", {}, [
                    E("strong", {}, n.getName()),
                    E(
                      "small",
                      { class: "cpe-muted" },
                      n.getIPAddr() || n.getIP6Addr() || "无地址",
                    ),
                  ]),
                  E(
                    "span",
                    { class: "cpe-muted" },
                    n.isUp() ? "已连接" : "未连接",
                  ),
                ]);
              }),
          ),
        ]);
        live.replaceChildren(
          hero,
          E("div", { class: "cpe-main-grid" }, [speed, signals]),
          stats,
          E("div", { class: "cpe-bottom-grid" }, [clients, interfaces]),
          E("nav", { class: "cpe-shortcuts", "aria-label": "CPE 快捷入口" }, [
            link("模组管理", "admin/modem/qmodem/overview"),
            link("流量统计", "admin/modem/qmodem/traffic"),
            link("短信", "admin/modem/qmodem/sms"),
            link("网络设置", "admin/network/network"),
          ]),
        );
        if (!modems.length)
          live.prepend(
            E(
              "div",
              { class: "alert-message warning" },
              "未发现启用的 QModem 模组，请先完成模组配置。",
            ),
          );
        if (!r[4] && id)
          live.prepend(
            E(
              "div",
              { class: "alert-message warning" },
              "暂时无法读取蜂窝信息，请检查 QModem 服务和访问权限。",
            ),
          );
        stamp.textContent =
          "更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
      });
    }
    window.setTimeout(function () {
      refresh();
    }, 0);
    poll.add(refresh, 3);
    return root;
  },
  handleSaveApply: null,
  handleSave: null,
  handleReset: null,
});
