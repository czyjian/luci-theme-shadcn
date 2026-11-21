"use strict";
"require baseclass";

return baseclass.extend({
  __init__() {
    const main = document.getElementById("maincontent");
    const toggle = document.getElementById("notification-toggle");
    if (!main || !toggle) return;
    const chinese = /^zh(?:-|$)/i.test(document.documentElement.lang);
    const title = chinese ? "通知" : _("Notifications");
    toggle.setAttribute("aria-label", title);

    const markAll = E(
      "button",
      { type: "button", class: "shadcn-notification-read-all", disabled: "" },
      chinese ? "全部已读" : _("Mark all as read"),
    );
    const heading = E("div", { class: "shadcn-notification-heading" }, [
      E("span", {}, title),
      markAll,
    ]);
    const empty = E(
      "p",
      { class: "shadcn-notification-empty" },
      chinese ? "暂无通知" : _("No notifications"),
    );
    const list = E("div", { class: "shadcn-notification-list", role: "log" });
    const clearAll = E(
      "button",
      {
        type: "button",
        class: "shadcn-notification-clear-all",
        click: () => {
          list.replaceChildren();
          empty.hidden = false;
          syncUnread();
        },
      },
      chinese ? "清空" : _("Clear all"),
    );
    const panel = E(
      "section",
      { id: "notification-panel", "aria-label": title },
      [heading, list, empty, clearAll],
    );
    document.body.appendChild(panel);
    toggle.hidden = false;

    const storageKey = "shadcn-notification-history-v1";
    function saveHistory() {
      try {
        const records = Array.from(list.children)
          .slice(0, 100)
          .map((msg) => {
            const body = msg.firstElementChild?.cloneNode(true);
            body
              ?.querySelectorAll(".shadcn-notification-unread")
              .forEach((badge) => badge.remove());
            return {
              text: body?.textContent || "",
              kind:
                [
                  "success",
                  "info",
                  "warning",
                  "notice",
                  "error",
                  "danger",
                ].find((kind) => msg.classList.contains(kind)) || "info",
              unread: msg.hasAttribute("data-unread"),
            };
          });
        sessionStorage.setItem(storageKey, JSON.stringify(records));
      } catch (_) {}
    }

    function syncUnread() {
      const pending = !!list.querySelector("[data-unread]");
      toggle.toggleAttribute("data-pending", pending);
      toggle.setAttribute(
        "aria-label",
        pending
          ? chinese
            ? "通知（有未读消息）"
            : _("Notifications (unread)")
          : title,
      );
      markAll.disabled = !pending;
      clearAll.disabled = !list.childElementCount;
      saveHistory();
    }

    function markRead(msg) {
      msg.removeAttribute("data-unread");
      msg.querySelector(".shadcn-notification-unread")?.remove();
    }

    list.addEventListener("click", (event) => {
      if (!panel.hasAttribute("data-open")) return;
      const msg = event.target.closest?.(".alert-message[data-unread]");
      if (!msg || !list.contains(msg)) return;
      markRead(msg);
      syncUnread();
    });

    markAll.addEventListener("click", () => {
      list.querySelectorAll("[data-unread]").forEach(markRead);
      toggle.focus();
      syncUnread();
    });

    function showHistory(open) {
      panel.toggleAttribute("data-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      if (open) {
        // Close the history without replaying old previews.
        list
          .querySelectorAll("[data-recent]")
          .forEach((msg) => msg.removeAttribute("data-recent"));
      }
    }

    toggle.addEventListener("click", () =>
      showHistory(!panel.hasAttribute("data-open")),
    );
    document.addEventListener("click", (event) => {
      if (!panel.contains(event.target) && !toggle.contains(event.target))
        showHistory(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !panel.hasAttribute("data-open")) return;
      showHistory(false);
      toggle.focus();
    });

    function collect(node) {
      // LuCI inserts runtime notices directly under #maincontent. Moving the
      // original node preserves action buttons, dismissal and LuCI's timers.
      if (!node.matches?.(".alert-message.fade-in") || node.parentNode !== main)
        return;
      node.setAttribute("data-unread", "");
      node.firstElementChild?.prepend(
        E(
          "span",
          { class: "shadcn-notification-unread" },
          chinese ? "未读" : _("Unread"),
        ),
      );
      if (!panel.hasAttribute("data-open")) {
        node.setAttribute("data-recent", "");
      }
      const dismiss = node.querySelector(":scope > div:last-child > button");
      if (dismiss) {
        const readButton = E(
          "button",
          {
            type: "button",
            class: "btn",
            click: () => {
              markRead(node);
              node.removeAttribute("data-recent");
              syncUnread();
            },
          },
          chinese ? "已读" : _("Read"),
        );
        dismiss.replaceWith(readButton);
      }
      list.prepend(node);
      function hidePreview() {
        if (!node.isConnected) return;
        if (node.matches(":hover, :focus-within")) {
          window.setTimeout(hidePreview, 1000);
          return;
        }
        node.removeAttribute("data-recent");
      }
      window.setTimeout(hidePreview, 6500);
    }

    new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(collect);
    }).observe(main, { childList: true });
    new MutationObserver(() => {
      empty.hidden = !!list.childElementCount;
      syncUnread();
    }).observe(list, { childList: true });
    try {
      const records = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      if (Array.isArray(records))
        records.slice(0, 100).forEach((record) => {
          if (typeof record.text !== "string") return;
          const kind = [
            "success",
            "info",
            "warning",
            "notice",
            "error",
            "danger",
          ].includes(record.kind)
            ? record.kind
            : "info";
          const body = E("div", {}, record.text);
          const msg = E("div", { class: "alert-message fade-in " + kind }, [
            body,
            E(
              "div",
              {},
              E(
                "button",
                {
                  class: "btn",
                  click: () => {
                    markRead(msg);
                    msg.removeAttribute("data-recent");
                    syncUnread();
                  },
                },
                chinese ? "已读" : _("Read"),
              ),
            ),
          ]);
          if (record.unread) {
            msg.setAttribute("data-unread", "");
            body.prepend(
              E(
                "span",
                { class: "shadcn-notification-unread" },
                chinese ? "未读" : _("Unread"),
              ),
            );
          }
          list.appendChild(msg);
        });
    } catch (_) {}
    empty.hidden = !!list.childElementCount;
    syncUnread();
    Array.from(main.children).reverse().forEach(collect);
  },
});
