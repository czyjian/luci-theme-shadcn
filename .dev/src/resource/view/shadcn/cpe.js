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
var trafficHistory = rpc.declare({
  object: "qmodem.traffic",
  method: "get",
  params: ["config_section"],
});
// Server samples survive page navigation and browser restarts.
function mergeHistory(previous, samples, now) {
  var points = new Map();
  previous.concat(samples || []).forEach(function (p) {
    if (
      !p ||
      !Number.isFinite(p.time) ||
      p.time > now + 5 ||
      p.time < now - 3600 ||
      !Number.isFinite(p.rx) ||
      !Number.isFinite(p.tx) ||
      p.rx < 0 ||
      p.tx < 0
    )
      return;
    points.set(p.time, { time: p.time, rx: p.rx, tx: p.tx });
  });
  return Array.from(points.values())
    .sort(function (a, b) {
      return a.time - b.time;
    })
    .slice(-60);
}
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
function carrierValues(data, key) {
  var items = (data || {}).modem_info || [];
  function values(name) {
    return items
      .filter(function (item) {
        return item.key === name;
      })
      .flatMap(function (item) {
        return String(item.value == null ? "" : item.value)
          .split(/\s*[/+]\s*/)
          .map(function (value) {
            return { value: value.trim(), extra: item.extra_info || "" };
          })
          .filter(function (part) {
            return /\d/.test(part.value);
          });
      });
  }
  var primary = values(key);
  // Some modems already include all carriers in the base field.
  return primary.length > 1 ? primary : primary.concat(values(key + " (CA)"));
}
function bandwidth(data, direction) {
  return (
    carrierValues(data, direction + " Bandwidth")
      .map(function (part) {
        return part.value;
      })
      .join("+") || "—"
  );
}
function bands(data) {
  var mode = fields(data).network_mode || "";
  return (
    carrierValues(data, "Band")
      .map(function (part) {
        if (/^[nBb]\d/.test(part.value)) return part.value;
        var rat = part.extra || mode;
        return (
          (/NR|5G/i.test(rat) ? "n" : /LTE|4G/i.test(rat) ? "B" : "") +
          part.value
        );
      })
      .join(" / ") || "—"
  );
}
function carrierIds(data, key) {
  return (
    carrierValues(data, key)
      .map(function (part) {
        return part.value;
      })
      .join(" + ") || "—"
  );
}
function isp(v, mcc, mnc) {
  v = String(v || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (/^(?:[0-9a-f]{4}){2,}$/i.test(v))
    v = v.replace(/.{4}/g, function (x) {
      return String.fromCharCode(parseInt(x, 16));
    });
  v = v.replace(/\0/g, "").trim();
  if (!v || /^[?\s-]+$/.test(v)) {
    var country = String(mcc || "").trim(),
      network = String(mnc || "").trim();
    if (/^\d{3}$/.test(country) && /^\d{1,3}$/.test(network))
      v = country + network.padStart(2, "0");
  }
  var names = [
    [
      "中国电信",
      "China Telecom",
      [
        "chinatelecom",
        "中国电信",
        "中国电信通信",
        "ctcc",
        "ct",
        "chnct",
        "chnctcc",
        "chntelecom",
        "46003",
        "46005",
        "46011",
        "46059",
      ],
    ],
    [
      "中国移动",
      "China Mobile",
      [
        "chinamobile",
        "中国移动",
        "中国移动通信",
        "cmcc",
        "chncmcc",
        "chnmobile",
        "46000",
        "46002",
        "46004",
        "46007",
        "46008",
        "46013",
      ],
    ],
    [
      "中国联通",
      "China Unicom",
      [
        "chinaunicom",
        "中国联通",
        "中国联合网络通信",
        "cucc",
        "unicom",
        "chnunicom",
        "chncucc",
        "46001",
        "46006",
        "46009",
      ],
    ],
    [
      "中国广电",
      "China Broadnet",
      [
        "chinabroadnet",
        "chinabroadcastingnetwork",
        "中国广电",
        "中国广播电视网络",
        "cbn",
        "chncbn",
        "46015",
      ],
    ],
    [
      "中国铁通",
      "China Tietong",
      ["chinatietong", "中国铁通", "tietong", "crtc", "46020"],
    ],
  ];
  var key = v
    .toLowerCase()
    .replace(/[\s_\-().（）]/g, "")
    .replace(/(?:[2345]g|lte|nr)+$/g, "");
  for (var i = 0; i < names.length; i++) {
    if (
      names[i][2].indexOf(key) !== -1 ||
      key === (names[i][0] + names[i][1]).toLowerCase().replace(/\s+/g, "")
    )
      return names[i][0] + "（" + names[i][1] + "）";
  }
  return v || "运营商未知";
}
var listSms = rpc.declare({
  object: "qmodem.sms",
  method: "list",
  params: ["modem_id", "limit", "offset"],
  reject: true,
});

var syncSms = rpc.declare({
  object: "qmodem.sms",
  method: "sync",
  params: ["modem_id"],
  reject: true,
});

var markSmsRead = rpc.declare({
  object: "qmodem.sms",
  method: "mark_read",
  params: ["modem_id", "id"],
  reject: true,
});

var sendSms = rpc.declare({
  object: "qmodem.sms",
  method: "send",
  params: [
    "modem_id",
    "recipient",
    "content",
    "conversation_contact",
    "country_code",
  ],
  reject: true,
});

function smsPreview() {
  var marking = new Set();
  var smsMode;
  var modemId = null,
    activeSender = null,
    pending = false,
    sending = false,
    visible = false,
    messages = [];
  var preview = card("短信预览", [], "cpe-sms");
  var unreadBadge = E("span", {
    class: "cpe-sms-unread",
    "aria-live": "polite",
    hidden: "",
  });
  preview.querySelector("h3").appendChild(unreadBadge);
  var title = E("h3", { id: "cpe-sms-dialog-title" });
  var thread = E("div", { class: "cpe-sms-thread" });
  var replyInput = E("textarea", {
    rows: "2",
    placeholder: "输入回复内容…（Ctrl+Enter 发送）",
    "aria-label": "快速回复内容",
  });
  var replyStatus = E("span", {
    class: "cpe-muted",
    "aria-live": "polite",
  });
  var replyButton = E(
    "button",
    { type: "submit", class: "btn cbi-button-action" },
    "发送",
  );
  var replyForm = E("form", { class: "cpe-sms-reply" }, [
    replyInput,
    E("div", { class: "cpe-sms-reply-actions" }, [replyStatus, replyButton]),
  ]);
  var dialog = E(
    "dialog",
    {
      class: "cpe-sms-dialog",
      "aria-labelledby": "cpe-sms-dialog-title",
    },
    [
      E("header", {}, [
        title,
        E(
          "button",
          {
            type: "button",
            class: "btn",
            click: function () {
              dialog.close();
            },
          },
          "关闭",
        ),
      ]),
      thread,
      replyForm,
    ],
  );
  dialog.addEventListener("close", function () {
    if (!dialog.open) {
      activeSender = null;
      replyInput.value = "";
      replyStatus.textContent = "";
      thread.replaceChildren();
    }
  });
  var list = E("div", { class: "cpe-sms-list" });
  var eye = E("img", { width: 16, height: 16, alt: "" });
  var toggle = E(
    "button",
    {
      type: "button",
      class: "topbar-icon-btn",
      click: function () {
        visible = !visible;
        render();
      },
    },
    eye,
  );
  preview.querySelector(".cpe-card-heading").appendChild(toggle);
  preview.appendChild(list);

  function address(message) {
    return message.type === "sent"
      ? message.conversation_contact || message.recipient
      : message.sender;
  }

  function formatSmsTime(message) {
    var raw =
      message.type === "received" &&
      message.received_at != null &&
      message.received_at !== ""
        ? message.received_at
        : message.timestamp;
    if (raw == null || raw === "") return "";
    var date;
    if (typeof raw === "number") {
      date = new Date(raw > 1e12 ? raw : raw * 1000);
    } else {
      var text = String(raw).trim();
      if (/^\d+$/.test(text)) {
        var num = Number(text);
        date = new Date(num > 1e12 ? num : num * 1000);
      } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(text)) {
        date = new Date(text.replace(" ", "T") + "Z");
      } else {
        date = new Date(text);
      }
    }
    if (!date || Number.isNaN(date.getTime())) return "";
    return (
      String(date.getMonth() + 1).padStart(2, "0") +
      "/" +
      String(date.getDate()).padStart(2, "0") +
      " " +
      String(date.getHours()).padStart(2, "0") +
      ":" +
      String(date.getMinutes()).padStart(2, "0")
    );
  }

  function renderThread(sender, scrollBottom) {
    var atBottom =
      scrollBottom ||
      thread.scrollHeight - thread.clientHeight - thread.scrollTop <= 24;
    thread.replaceChildren(
      ...messages
        .filter(function (message) {
          return address(message) === sender;
        })
        .reverse()
        .map(function (message) {
          var label = message.type === "sent" ? "已发送" : "已接收";
          var time = formatSmsTime(message);
          return E(
            "div",
            {
              class:
                "cpe-sms-bubble" + (message.type === "sent" ? " is-sent" : ""),
            },
            [
              E(
                "small",
                { class: "cpe-muted" },
                time ? label + " · " + time : label,
              ),
              E("div", {}, String(message.content || "")),
            ],
          );
        }),
    );
    if (atBottom) thread.scrollTop = thread.scrollHeight;
  }

  function submitReply() {
    if (sending) return;
    var content = replyInput.value.trim();
    var targetSender = activeSender;
    var targetModem = modemId;
    if (!content) {
      replyStatus.textContent = "请输入回复内容";
      replyInput.focus();
      return;
    }
    if (!targetSender || !targetModem) return;
    sending = true;
    replyInput.disabled = true;
    replyButton.disabled = true;
    replyButton.textContent = "发送中…";
    replyStatus.textContent = "正在发送…";
    sendSms(targetModem, targetSender, content, targetSender, "")
      .then(function (result) {
        if (!result || result.status !== "success") {
          throw new Error(
            (result && (result.error || result.message)) || "发送失败",
          );
        }
        pending = false;
        if (modemId === targetModem) {
          messages.unshift({
            type: "sent",
            recipient: targetSender,
            conversation_contact: targetSender,
            content: content,
            timestamp: Math.floor(Date.now() / 1000),
          });
          render();
        }
        if (dialog.open && activeSender === targetSender) {
          replyInput.value = "";
          replyStatus.textContent = "已发送";
          renderThread(targetSender, true);
        }
      })
      .catch(function (err) {
        if (dialog.open && activeSender === targetSender) {
          replyStatus.textContent =
            "发送失败：" + ((err && err.message) || "未知错误");
        }
      })
      .finally(function () {
        sending = false;
        replyInput.disabled = false;
        replyButton.disabled = false;
        replyButton.textContent = "发送";
        if (dialog.open && activeSender === targetSender && !replyInput.value)
          replyInput.focus();
      });
  }

  replyForm.addEventListener("submit", function (event) {
    event.preventDefault();
    submitReply();
  });
  replyInput.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      submitReply();
    }
  });

  function markConversationRead(sender) {
    if (!sender || !modemId || document.hidden || !preview.isConnected) return;
    var activeWrites = marking;
    var id = modemId;
    messages.forEach(function (message) {
      if (
        message.type !== "received" ||
        message.sender !== sender ||
        message.is_read !== false ||
        !message.id ||
        activeWrites.has(message.id)
      )
        return;
      pending = false;
      activeWrites.add(message.id);
      safe(markSmsRead(id, message.id)).then(function (result) {
        activeWrites.delete(message.id);
        if (marking !== activeWrites || !preview.isConnected) return;
        if (result && result.status === "success") message.is_read = true;
        if (!activeWrites.size) {
          render();
        }
      });
    });
  }

  function openConversation(sender) {
    activeSender = sender;
    title.textContent = sender;
    replyInput.value = "";
    replyStatus.textContent = "";
    renderThread(sender, true);
    dialog.showModal();
    thread.scrollTop = thread.scrollHeight;
    markConversationRead(sender);
  }

  var state = "正在读取短信…";
  function render() {
    var label = visible ? "隐藏短信内容" : "显示短信内容";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-pressed", String(visible));
    toggle.title = label;
    eye.src = L.env.media + "/icons/" + (visible ? "eye.svg" : "eye-off.svg");
    var latestBySender = new Map();
    var unreadBySender = new Map();
    var unreadTotal = 0;
    messages.forEach(function (message) {
      if (
        message.type === "received" &&
        message.sender &&
        !latestBySender.has(message.sender)
      )
        latestBySender.set(message.sender, message);
      if (
        message.type === "received" &&
        message.sender &&
        message.is_read === false
      ) {
        unreadBySender.set(
          message.sender,
          (unreadBySender.get(message.sender) || 0) + 1,
        );
        unreadTotal++;
      }
    });
    unreadBadge.hidden = !!state;
    unreadBadge.textContent = unreadTotal ? "未读 " + unreadTotal : "全部已读";
    var incoming = Array.from(latestBySender.values()).slice(0, 5);
    if (!incoming.length) {
      list.replaceChildren(
        E("p", { class: "cpe-muted" }, state || "暂无接收短信"),
      );
      return;
    }
    list.replaceChildren(
      ...incoming.map(function (message) {
        var sender = message.sender;
        var unread = unreadBySender.get(sender) || 0;
        var heading = [E("strong", {}, sender)];
        if (unread)
          heading.push(
            E("span", { class: "cpe-sms-unread" }, "未读 " + unread),
          );
        var details = [E("div", { class: "cpe-sms-row-heading" }, heading)];
        if (visible)
          details.push(
            E("span", { class: "cpe-muted" }, String(message.content || "")),
          );
        return E(
          "button",
          {
            type: "button",
            click: function () {
              openConversation(sender);
            },
          },
          details,
        );
      }),
    );
  }

  render();
  return {
    card: preview,
    dialog: dialog,
    refresh: function (id) {
      if (id !== modemId) {
        modemId = id;
        smsMode = undefined;
        pending = false;
        marking = new Set();
        visible = false;
        messages = [];
        state = id ? "正在读取短信…" : "未检测到可用模组";
        if (dialog.open) dialog.close();
        render();
      }
      if (
        !id ||
        pending ||
        marking.size ||
        document.hidden ||
        !preview.isConnected
      )
        return;
      var request = (
        smsMode === "database_poll" ? safe(syncSms(id)) : Promise.resolve()
      ).then(function () {
        return safe(listSms(id, 100, 0));
      });
      pending = request;
      request.then(function (result) {
        if (pending !== request || !preview.isConnected) return;
        pending = false;
        if (result && result.mode) smsMode = result.mode;
        var next =
          result && Array.isArray(result.messages) ? result.messages : [];
        var nextState =
          result && Array.isArray(result.messages) ? "" : "暂时无法读取短信";
        if (
          nextState === state &&
          JSON.stringify(next) === JSON.stringify(messages)
        )
          return;
        messages = next;
        state = nextState;
        render();
        if (dialog.open && activeSender) {
          renderThread(activeSender);
          markConversationRead(activeSender);
        }
      });
    },
  };
}
function icon(name) {
  var paths = {
    antenna: [
      "M12 9v13M8 22h8M8 3a7 7 0 0 0 0 10M16 3a7 7 0 0 1 0 10M4 1a11 11 0 0 0 0 14M20 1a11 11 0 0 1 0 14",
    ],
    traffic: ["M7 3v18m-4-4 4 4 4-4M17 21V3m-4 4 4-4 4 4"],
    link: [
      "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",
      "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    ],
    memory: [
      "M5 5h14v14H5zM9 9h6v6H9zM9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3",
    ],
    clock: ["M12 6v6l4 2"],
    monitor: ["M3 4h18v13H3zM8 21h8m-4-4v4"],
    phone: ["M7 2h10v20H7zM11 18h2"],
    network: ["M12 2v20M2 12h20M5 5c5 4 9 4 14 0M5 19c5-4 9-4 14 0"],
  };
  var ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (name === "clock" || name === "network") {
    var circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "9");
    svg.appendChild(circle);
  }
  (paths[name] || paths.monitor).forEach(function (d) {
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  });
  return E("span", { class: "cpe-glyph" }, svg);
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
    [E("div", { class: "cpe-card-heading" }, [E("h3", {}, title)])].concat(
      children,
    ),
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
var cpeCssState = null;
function ensureCpeCss() {
  if (typeof document === "undefined" || !document.head)
    return Promise.resolve();
  var href =
    L.env.media +
    "/cpe.css?v=" +
    encodeURIComponent(
      ((document.body && document.body.dataset.assetVersion) || "2026111605") +
        "-hero-layout-1",
    );
  var existing = document.querySelector('link[data-cpe-css="1"]');
  if (existing && existing.sheet) return Promise.resolve();
  if (cpeCssState && cpeCssState.href === href) return cpeCssState.promise;
  var linkEl =
    existing ||
    E("link", {
      rel: "stylesheet",
      href: href,
      "data-cpe-css": "1",
    });
  var promise = new Promise(function (resolve) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      resolve();
    }
    linkEl.addEventListener("load", finish, { once: true });
    linkEl.addEventListener("error", finish, { once: true });
    if (!existing) document.head.appendChild(linkEl);
    if (linkEl.sheet) finish();
  });
  cpeCssState = { href: href, promise: promise };
  return promise;
}
return view.extend({
  load: function () {
    return Promise.all([
      safe(uci.load("qmodem")),
      safe(board()),
      safe(uci.load("firewall")),
      safe(ensureCpeCss()),
    ]);
  },
  render: function (data) {
    var interfaceRoles = {};
    uci.sections("firewall", "zone").forEach(function (zone) {
      var role = zone.name === "wan" ? "wan" : zone.name === "lan" ? "lan" : "";
      L.toArray(zone.network).forEach(function (name) {
        if (role) interfaceRoles[name] = role;
      });
    });
    var self = this,
      modems = uci.sections("qmodem", "modem-device").filter(function (s) {
        return s.state !== "disabled" && s.at_port;
      });
    var selected = modems[0] && modems[0][".name"],
      history = [],
      previous = null,
      generation = 0,
      modemCache = null,
      chartHover = null;
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
          promise: Promise.all([
            safe(base(id)),
            safe(cell(id)),
            safe(sim(id)),
            safe(trafficHistory(id)),
          ]),
        };
      return modemCache.promise;
    }
    ensureCpeCss();
    var root = E("div", { class: "cpe-dashboard" }),
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
      chartHover = null;
      previous = null;
      generation++;
      refresh();
    });
    var sms = smsPreview();
    var clientsCard = E("div"),
      interfacesCard = E("div");
    var lowerGrid = E("div", { class: "cpe-bottom-grid" }, [
      clientsCard,
      sms.card,
      interfacesCard,
    ]);
    root.append(
      live,
      lowerGrid,
      E("nav", { class: "cpe-shortcuts", "aria-label": "CPE 快捷入口" }, [
        link("更多信息", "admin/modem/qmodem/overview"),
        link("流量统计", "admin/modem/qmodem/traffic"),
        link("短信", "admin/modem/qmodem/sms"),
      ]),
      sms.dialog,
    );
    function paint(r, id, loaded) {
      var countText = String(r[6] == null ? "" : r[6]).trim();
      var connectionCount = /^\d+$/.test(countText)
        ? Number(countText)
        : null;
      var neighborResult = r[7];
      var modemData = r[4] || [null, null, null, null];
      var snapshot = modemData[3];
        if (
          snapshot &&
          snapshot.config &&
          snapshot.config.enabled &&
          !snapshot.stale
        )
          history = mergeHistory(history, snapshot.live, Date.now() / 1000);
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
        var candidates = nets.filter(function (n) {
          return uci.get("network", n.getName(), "modem_config") === id;
        });
        if (!candidates.length)
          candidates = nets.filter(function (n) {
            var device = n.getL3Device();
            return device && device.getName() === iface;
          });
        var monitoredNetwork =
          candidates.find(function (n) {
            return n.getName() === id;
          }) ||
          candidates.find(function (n) {
            return uci.get("network", n.getName(), "proto") !== "dhcpv6";
          }) ||
          candidates[0];
        var interfaceName = monitoredNetwork
          ? monitoredNetwork.getName()
          : iface;
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
          history = mergeHistory(
            history,
            [
              {
                time:
                  t && t.now && t.config && t.config.enabled && !t.stale
                    ? t.now
                    : Date.now() / 1000,
                rx: rx,
                tx: tx,
              },
            ],
            Date.now() / 1000,
          );
        }
        var connected = b.connect_status === "Yes",
          mode = c.network_mode || "等待网络信息",
          name = String(
            b.name || (section && section.name) || "未发现模组",
          ).toUpperCase();
        var hero = E("section", { class: "cpe-card cpe-hero" }, [
          E("div", { class: "cpe-identity" }, [
            E("div", { class: "cpe-identity-row" }, [
              E(
                "div",
                { class: "cpe-device-icon", "aria-hidden": "true" },
                icon("antenna"),
              ),
              E("div", { class: "cpe-device" }, [
                E("h3", {}, name),
                E(
                  "span",
                  { class: "cpe-muted" },
                  (data[1] || {}).hostname +
                    " · " +
                    ((data[1] || {}).release || {}).distribution +
                    " · 连接、信号与流量，一目了然。",
                ),
              ]),
            ]),
          ]),
          E(
            "span",
            { class: "cpe-status " + (connected ? "is-online" : "") },
            connected ? "● 蜂窝已连接" : "○ 蜂窝未连接",
          ),
          E("div", { class: "cpe-hero-meta" }, [
            detail("运营商", isp(s.ISP, c.MCC, c.MNC)),
            detail("网络模式", mode),
          ]),
          E("div", { class: "cpe-controls" }, [stamp, select]),
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
              metric("监测接口", interfaceName || "—", "最近 60 个采样点"),
            ]),
          ],
          "cpe-traffic",
        );
        var ns = "http://www.w3.org/2000/svg",
          svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 720 170");
        svg.setAttribute("role", "img");
        svg.setAttribute(
          "aria-label",
          "蜂窝接口实时速率：下载为蓝色实线，上传为橙色虚线",
        );
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
        // Split at missing samples so neither the line nor the fill bridges a gap.
        var segments = [];
        history.forEach(function (point, index) {
          if (!index || point.time - history[index - 1].time > 30)
            segments.push([]);
          segments[segments.length - 1].push({
            x: ((60 - history.length + index) * 720) / 59,
            rx: 160 - (point.rx / max) * 140,
            tx: 160 - (point.tx / max) * 140,
          });
        });

        function curve(points, key) {
          var steps = points.slice(1).map(function (point, i) {
            return point[key] - points[i][key];
          });
          // Harmonic-mean tangents keep each curve between its samples.
          var slopes = points.map(function (_, i) {
            if (!i) return steps[0];
            if (i === steps.length) return steps[i - 1];
            var before = steps[i - 1],
              after = steps[i];
            return before * after > 0
              ? (2 * before * after) / (before + after)
              : 0;
          });
          return points
            .slice(1)
            .map(function (point, i) {
              var start = points[i],
                dx = (point.x - start.x) / 3;
              return (
                "C" +
                [
                  start.x + dx,
                  start[key] + slopes[i] / 3,
                  point.x - dx,
                  point[key] - slopes[i + 1] / 3,
                  point.x,
                  point[key],
                ]
                  .map(function (n) {
                    return n.toFixed(1);
                  })
                  .join(" ")
              );
            })
            .join(" ");
        }

        ["rx", "tx"].forEach(function (key) {
          var lines = [],
            fills = [];
          segments.forEach(function (points) {
            var first = points[0],
              last = points[points.length - 1];
            var start = first.x.toFixed(1) + " " + first[key].toFixed(1);
            var path = curve(points, key);
            lines.push("M" + start + path);
            if (points.length > 1)
              fills.push(
                "M" +
                  first.x.toFixed(1) +
                  " 160L" +
                  start +
                  path +
                  "L" +
                  last.x.toFixed(1) +
                  " 160Z",
              );
          });
          if (key === "rx" && fills.length) {
            var area = document.createElementNS(ns, "path");
            area.setAttribute("d", fills.join(" "));
            area.setAttribute("class", "cpe-chart-area");
            svg.appendChild(area);
          }
          var line = document.createElementNS(ns, "path");
          line.setAttribute("d", lines.join(" "));
          line.setAttribute("stroke-linecap", "round");
          line.setAttribute("stroke-linejoin", "round");
          line.setAttribute("class", "cpe-line " + key);
          svg.appendChild(line);
        });
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("tabindex", "0");
        svg.setAttribute(
          "aria-label",
          "实时速率曲线，悬停或使用左右方向键查看采样时间与速率",
        );
        var chart = E("div", { class: "cpe-chart" });
        var tooltip = E("div", {
          class: "cpe-chart-tooltip",
          hidden: true,
          role: "status",
        });
        var guide = document.createElementNS(ns, "path");
        guide.setAttribute("class", "cpe-chart-guide");
        guide.style.display = "none";
        svg.appendChild(guide);
        var markers = ["rx", "tx"].map(function (key) {
          var dot = document.createElementNS(ns, "circle");
          dot.setAttribute("class", "cpe-chart-marker " + key);
          dot.setAttribute("r", "3");
          dot.style.display = "none";
          svg.appendChild(dot);
          return dot;
        });
        function hideTooltip() {
          chartHover = null;
          tooltip.hidden = true;
          guide.style.display = "none";
          markers.forEach(function (dot) {
            dot.style.display = "none";
          });
        }
        function showSample(fraction) {
          if (!history.length) return;
          var slot = Math.max(0, Math.min(59, fraction * 59)),
            start = 60 - history.length;
          if (slot < start - 0.5) {
            hideTooltip();
            return;
          }
          var index = Math.max(
              0,
              Math.min(history.length - 1, Math.round(slot - start)),
            ),
            point = history[index];
          var x = ((start + index) * 720) / 59;
          chartHover = fraction;
          guide.setAttribute("d", "M" + x + " 0V170");
          guide.style.display = "";
          markers.forEach(function (dot, i) {
            dot.setAttribute("cx", String(x));
            dot.setAttribute(
              "cy",
              String(160 - (point[i ? "tx" : "rx"] / max) * 140),
            );
            dot.style.display = "";
          });
          tooltip.replaceChildren(
            E(
              "strong",
              {},
              new Date(point.time * 1000).toLocaleTimeString("zh-CN", {
                hour12: false,
              }),
            ),
            E(
              "div",
              { class: "cpe-tooltip-rx" },
              "↓ 下载 " + ((point.rx * 8) / 1e6).toFixed(2) + " Mbps",
            ),
            E(
              "div",
              { class: "cpe-tooltip-tx" },
              "↑ 上传 " + ((point.tx * 8) / 1e6).toFixed(2) + " Mbps",
            ),
          );
          tooltip.hidden = false;
          var width = chart.getBoundingClientRect().width;
          var plotRect = svg.getBoundingClientRect(),
            chartRect = chart.getBoundingClientRect();
          tooltip.style.left =
            Math.max(
              0,
              Math.min(
                width - tooltip.offsetWidth,
                plotRect.left -
                  chartRect.left +
                  (x / 720) * plotRect.width -
                  tooltip.offsetWidth / 2,
              ),
            ) + "px";
        }
        function pointAt(event) {
          var rect = svg.getBoundingClientRect();
          if (rect.width) showSample((event.clientX - rect.left) / rect.width);
        }
        svg.addEventListener("pointermove", pointAt);
        svg.addEventListener("pointerdown", pointAt);
        svg.addEventListener("pointerleave", function (event) {
          if (svg.isConnected && event.pointerType !== "touch") hideTooltip();
        });
        svg.addEventListener("keydown", function (event) {
          if (!history.length) return;
          var index =
            chartHover == null
              ? history.length - 1
              : Math.round(chartHover * 59 - (60 - history.length));
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            index = Math.max(
              0,
              Math.min(
                history.length - 1,
                index + (event.key === "ArrowLeft" ? -1 : 1),
              ),
            );
            showSample((60 - history.length + index) / 59);
          } else if (event.key === "Escape") hideTooltip();
        });
        svg.addEventListener("blur", function () {
          if (svg.isConnected) hideTooltip();
        });
        chart.append(
          E("div", { class: "cpe-chart-axis", "aria-hidden": "true" }, [
            E("span", {}, ((max * 8) / 1e6).toFixed(1)),
            E("span", {}, ((max * 4) / 1e6).toFixed(1)),
            E("span", {}, "0"),
          ]),
          svg,
          tooltip,
        );
        speed.appendChild(chart);
        speed.appendChild(
          E("div", { class: "cpe-time-axis" }, [
            E(
              "span",
              {},
              history.length
                ? new Date(history[0].time * 1000).toLocaleTimeString("zh-CN", {
                    hour12: false,
                  })
                : "等待采样",
            ),
            E("span", {}, "现在"),
          ]),
        );
        speed.appendChild(
          E("div", { class: "cpe-chart-caption" }, [
            E("span", {}, [
              E("span", { class: "cpe-rx-label" }, "↓ 下载"),
              " / ",
              E("span", { class: "cpe-tx-label" }, "↑ 上传"),
            ]),
            E("span", {}, "刻度上限 " + ((max * 8) / 1e6).toFixed(1) + " Mbps"),
          ]),
        );
        var signals = card(
          "蜂窝信号",
          [
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
            detail("主载波频段 / 聚合载波", bands(r[5])),
            detail(
              c.EARFCN && !c.ARFCN ? "PCI / EARFCN" : "PCI / ARFCN",
              carrierIds(r[5], "Physical Cell ID") +
                " / " +
                carrierIds(r[5], c.ARFCN ? "ARFCN" : "EARFCN"),
            ),
            detail(
              "下行带宽 / 上行带宽",
              bandwidth(r[5], "DL") + " / " + bandwidth(r[5], "UL"),
            ),
            E("div", { class: "cpe-sensor-row" }, [
              detail("温度", b.temperature),
              detail("电压", b.voltage),
            ]),
          ],
          "cpe-signals",
        );
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
        Array.from(stats.children).forEach(function (item, index) {
          var label = item.querySelector(".cpe-muted");
          label.classList.add("cpe-stat-label");
          label.prepend(
            E(
              "span",
              { class: "cpe-stat-icon" },
              icon(["traffic", "link", "memory", "clock"][index]),
            ),
          );
        });
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
                      icon(
                        /iphone|phone|android|手机/i.test(x.hostname || "")
                          ? "phone"
                          : "monitor",
                      ),
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
                var role = interfaceRoles[n.getName()] || "";
                return E("div", { class: "cpe-interface" }, [
                  E(
                    "span",
                    {
                      class: "cpe-interface-icon " + (role ? "is-" + role : ""),
                      title:
                        role === "wan"
                          ? "外网接口"
                          : role === "lan"
                            ? "内网接口"
                            : "其他接口",
                    },
                    icon("network"),
                  ),
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
                    {
                      class:
                        "cpe-interface-status " + (n.isUp() ? "is-online" : ""),
                    },
                    n.isUp() ? "已连接" : "未连接",
                  ),
                ]);
              }),
          ),
        ]);
        clients
          .querySelector("h3")
          .appendChild(
            E(
              "span",
              { class: "cpe-count" },
              connectedDevices ? String(connectedDevices.length) : "—",
            ),
          );
        clients
          .querySelector(".cpe-card-heading")
          .appendChild(
            E(
              "a",
              { href: L.url("admin", "network", "dhcp"), class: "cpe-manage" },
              "管理 ↗",
            ),
          );
        interfaces.querySelector(".cpe-card-heading").appendChild(
          E(
            "a",
            {
              href: L.url("admin", "network", "network"),
              class: "cpe-manage",
            },
            "管理 ↗",
          ),
        );
        live.replaceChildren(
          hero,
          E("div", { class: "cpe-main-grid" }, [speed, signals]),
          stats,
        );
        clientsCard.replaceWith(clients);
        interfacesCard.replaceWith(interfaces);
        clientsCard = clients;
        interfacesCard = interfaces;
        if (chartHover != null) showSample(chartHover);
        if (!modems.length)
          live.prepend(
            E(
              "div",
              { class: "alert-message warning" },
              "未检测到可用的模组，请检查模组配置。",
            ),
          );
        if (loaded && !r[4] && id)
          live.prepend(
            E(
              "div",
              { class: "alert-message warning" },
              "暂时无法读取蜂窝信息，请检查 QModem 服务和访问权限。",
            ),
          );
        if (loaded) {
          stamp.textContent =
            "更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
          sms.refresh(id);
        }
    }
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
        paint(r, id, true);
      });
    }
    paint(
      [null, null, null, null, [null, null, null, null], null, null, null],
      selected,
      false,
    );
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
