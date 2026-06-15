/* LAABS Audio — Developer Handbook
   Classic script (no modules, no fetch) so it works over file://.
   Single source of truth for the sidebar nav; each page sets
   document.body.dataset.page to its own filename for active highlighting. */

(function () {
  "use strict";

  // The whole site map lives here. status: "ready" = linked, "soon" = placeholder.
  var NAV = [
    {
      group: "Start here",
      items: [
        { title: "Overview", page: "index.html", status: "ready" },
        { title: "Architecture", page: "architecture.html", status: "ready" },
      ],
    },
    {
      group: "Core systems",
      items: [
        { title: "Audio & Playback", page: "audio-playback.html", status: "ready" },
        { title: "Progress & Sync", page: "progress-sync.html", status: "ready" },
        { title: "Auth, Sessions & Libraries", page: "auth-sessions.html", status: "ready" },
        { title: "Data & SQLite", page: "data-sqlite.html", status: "ready" },
      ],
    },
    {
      group: "Features",
      items: [
        { title: "Home & Shelves", page: "shelves-browsing.html", status: "ready" },
        { title: "Downloads & Offline", page: "downloads-offline.html", status: "ready" },
        { title: "Deep Linking", page: "deep-linking.html", status: "ready" },
        { title: "Theming", page: "theming.html", status: "ready" },
      ],
    },
    {
      group: "Reference",
      items: [
        { title: "Build & Ops", page: "build-ops.html", status: "ready" },
        { title: "Decisions (ADRs)", page: "decisions.html", status: "ready" },
      ],
    },
  ];

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function buildSidebar() {
    var current = document.body.dataset.page || "index.html";
    var sidebar = document.querySelector(".sidebar");
    if (!sidebar) return;

    var brand = el("a", { class: "brand", href: "index.html" }, [
      el("span", { class: "mark" }, ["L"]),
      (function () {
        var s = el("span", {}, ["LAABS Audio"]);
        s.appendChild(el("small", {}, ["Developer Handbook"]));
        return s;
      })(),
    ]);
    sidebar.appendChild(brand);

    var filter = el("input", {
      class: "nav-filter",
      type: "search",
      placeholder: "Filter pages…",
      "aria-label": "Filter pages",
    });
    sidebar.appendChild(filter);

    NAV.forEach(function (grp) {
      var ul = el("ul", {});
      grp.items.forEach(function (item) {
        var li = el("li", {});
        var pill = item.status === "soon" ? el("span", { class: "soon" }, ["soon"]) : null;
        if (item.status === "ready") {
          var a = el("a", { href: item.page }, [item.title]);
          if (item.page === current) a.className = "active";
          if (pill) a.appendChild(pill);
          li.appendChild(a);
        } else {
          var span = el("span", { class: "disabled" }, [item.title]);
          if (pill) span.appendChild(pill);
          li.appendChild(span);
        }
        li.dataset.search = item.title.toLowerCase();
        ul.appendChild(li);
      });
      var g = el("nav", { class: "nav-group" }, [el("h4", {}, [grp.group]), ul]);
      sidebar.appendChild(g);
    });

    filter.addEventListener("input", function () {
      var q = filter.value.trim().toLowerCase();
      sidebar.querySelectorAll(".nav-group").forEach(function (group) {
        var any = false;
        group.querySelectorAll("li").forEach(function (li) {
          var hit = !q || li.dataset.search.indexOf(q) !== -1;
          li.style.display = hit ? "" : "none";
          if (hit) any = true;
        });
        group.style.display = any ? "" : "none";
      });
    });
  }

  function setupTheme() {
    var KEY = "laabs-docs-theme";
    var root = document.documentElement;
    function apply(mode) {
      root.setAttribute("data-theme", mode);
      try { localStorage.setItem(KEY, mode); } catch (e) {}
      var btn = document.querySelector(".theme-toggle");
      if (btn) btn.textContent = mode === "dark" ? "☀ Light" : "☾ Dark";
    }
    var btn = document.querySelector(".theme-toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        apply(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
      });
      // sync label with whatever the no-flash head script already set
      btn.textContent = root.getAttribute("data-theme") === "dark" ? "☀ Light" : "☾ Dark";
    }
  }

  function setupMobileNav() {
    var btn = document.querySelector(".menu-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      document.body.classList.toggle("nav-open");
    });
    document.addEventListener("click", function (e) {
      if (document.body.classList.contains("nav-open") &&
          !e.target.closest(".sidebar") && !e.target.closest(".menu-toggle")) {
        document.body.classList.remove("nav-open");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    buildSidebar();
    setupTheme();
    setupMobileNav();
  });
})();
