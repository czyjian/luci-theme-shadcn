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
    const panel = E(
      "section",
      { id: "notification-panel", "aria-label": title },
      [heading, list, empty],
    );
    document.body.appendChild(panel);
    toggle.hidden = false;

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
    }

    markAll.addEventListener("click", () => {
      list.querySelectorAll("[data-unread]").forEach((msg) => {
        msg.removeAttribute("data-unread");
        msg.querySelector(".shadcn-notification-unread")?.remove();
      });
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
      if (dismiss) dismiss.textContent = chinese ? "清除" : _("Clear");
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
    Array.from(main.children).reverse().forEach(collect);
  },
});
