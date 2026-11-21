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

    const heading = E("div", { class: "shadcn-notification-heading" }, title);
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

    function showHistory(open) {
      panel.toggleAttribute("data-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      if (open) {
        toggle.removeAttribute("data-pending");
        // Close the history without replaying messages already seen there.
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
      if (!panel.hasAttribute("data-open")) {
        toggle.setAttribute("data-pending", "");
        node.setAttribute("data-recent", "");
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
      if (empty.hidden === false) toggle.removeAttribute("data-pending");
    }).observe(list, { childList: true });
    Array.from(main.children).reverse().forEach(collect);
  },
});
