/* Pixel Pirates — shared app shell, API client and UI helpers. */

const NAV = [
  { href: "/dashboard", page: "dashboard", icon: "layout-dashboard", label: "Dashboard" },
  { href: "/brands", page: "brands", icon: "building-2", label: "Brands" },
  { href: "/scanner", page: "scanner", icon: "scan-search", label: "Risk Scanner" },
  { href: "/investigations", page: "investigations", icon: "folder-search", label: "Investigations", countKey: "openInvestigations" },
];

export const PLATFORMS = {
  instagram: { label: "Instagram", icon: "camera" },
  x: { label: "X / Twitter", icon: "at-sign" },
  facebook: { label: "Facebook", icon: "users" },
  linkedin: { label: "LinkedIn", icon: "briefcase" },
  tiktok: { label: "TikTok", icon: "music-2" },
  youtube: { label: "YouTube", icon: "play" },
  telegram: { label: "Telegram", icon: "send" },
  app_store: { label: "Apple App Store", icon: "smartphone" },
  play_store: { label: "Google Play", icon: "smartphone" },
  website: { label: "Website", icon: "globe" },
  other: { label: "Other", icon: "circle-dashed" },
};

export const STATUS = {
  open: "Open",
  in_progress: "In progress",
  takedown_requested: "Takedown requested",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const ACTIVITY_STYLE = {
  brand_created: ["building-2", "var(--green)"],
  brand_updated: ["pencil", "var(--cyan)"],
  brand_deleted: ["trash-2", "var(--dim)"],
  scan_completed: ["scan-search", "var(--cyan)"],
  threat_detected: ["siren", "var(--critical)"],
  scan_deleted: ["trash-2", "var(--dim)"],
  investigation_opened: ["folder-plus", "var(--high)"],
  investigation_updated: ["folder-pen", "var(--blue)"],
  investigation_closed: ["folder-check", "var(--low)"],
  investigation_deleted: ["trash-2", "var(--dim)"],
  demo_loaded: ["database", "var(--green)"],
};

/* ---------- DOM helpers ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function icons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

export const debounce = (fn, ms = 250) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

/* ---------- Formatting ---------- */
export function timeAgo(iso) {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso);
}

export function formatDate(iso, withTime = false) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" });
}

export const riskBadge = (level) => `<span class="badge risk-${esc(level)}">${esc(level)}</span>`;
export const statusBadge = (status) => `<span class="badge st-${esc(status)}">${esc(STATUS[status] ?? status)}</span>`;

export function scoreBar(score, level) {
  return `<span class="score risk-${esc(level)}"><span class="score-bar"><span style="width:${Math.max(3, score)}%"></span></span><b>${score}</b></span>`;
}

export function platformPill(platform) {
  const p = PLATFORMS[platform];
  if (!p) return "";
  return `<span class="platform-pill"><i data-lucide="${p.icon}"></i>${esc(p.label)}</span>`;
}

export function candidateTarget(s) {
  return s.candidateDomain || (s.candidateHandle ? `@${s.candidateHandle}` : s.candidateAppPublisher || "—");
}

export function emptyState({ icon = "radar", title, text, actions = "" }) {
  return `<div class="empty fade-in"><div class="e-icon"><i data-lucide="${icon}"></i></div><h4>${esc(title)}</h4><p>${esc(text)}</p>${actions ? `<div class="actions">${actions}</div>` : ""}</div>`;
}

export const loadingBlock = (text = "Loading…") => `<div class="loading-block"><span class="spinner"></span>${esc(text)}</div>`;

/* ---------- API ---------- */
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body;
    this.fields = body?.fields || body?.details?.fields || {};
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: "Network error — check your connection" });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/* ---------- Toasts ---------- */
export function toast(title, message = "", type = "success") {
  let host = $(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const style = { success: ["circle-check", "var(--green)"], error: ["circle-alert", "var(--critical)"], info: ["info", "var(--cyan)"], warn: ["triangle-alert", "var(--medium)"] }[type];
  const el = document.createElement("div");
  el.className = "toast";
  el.style.setProperty("--accent", style[1]);
  el.innerHTML = `<i data-lucide="${style[0]}"></i><div><strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ""}</div>`;
  host.appendChild(el);
  icons();
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 260);
  }, 4200);
}

/* ---------- Modals ---------- */
export function openModal(id) {
  const m = document.getElementById(id);
  m.classList.add("open");
  setTimeout(() => m.querySelector("input, select, textarea, button.btn-primary, button.btn-danger")?.focus(), 30);
}
export function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

document.addEventListener("click", (e) => {
  const closer = e.target.closest("[data-close]");
  if (closer) closer.closest(".modal-backdrop")?.classList.remove("open");
  else if (e.target.classList?.contains("modal-backdrop")) e.target.classList.remove("open");
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $$(".modal-backdrop.open").forEach((m) => m.classList.remove("open"));
});

/** Promise-based confirmation dialog. */
export function confirmDialog({ title, text, confirmLabel = "Delete" }) {
  let host = document.getElementById("confirm-modal");
  if (!host) {
    host = document.createElement("div");
    host.id = "confirm-modal";
    host.className = "modal-backdrop";
    document.body.appendChild(host);
  }
  host.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true">
      <div class="confirm-icon"><i data-lucide="triangle-alert"></i></div>
      <h3 style="font-size:20px">${esc(title)}</h3>
      <p class="muted" style="margin:8px 0 0">${esc(text)}</p>
      <div class="form-actions"><button class="btn btn-ghost" data-act="cancel">Cancel</button><button class="btn btn-danger" data-act="ok"><i data-lucide="trash-2"></i>${esc(confirmLabel)}</button></div>
    </div>`;
  icons();
  openModal("confirm-modal");
  return new Promise((resolve) => {
    const done = (v) => {
      host.classList.remove("open");
      host.removeEventListener("click", onClick);
      resolve(v);
    };
    const onClick = (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act) done(act === "ok");
      else if (e.target === host) done(false);
    };
    host.addEventListener("click", onClick);
  });
}

/* ---------- Forms ---------- */
export function clearErrors(form) {
  $$(".field.invalid", form).forEach((f) => f.classList.remove("invalid"));
}

export function showErrors(form, fields = {}) {
  clearErrors(form);
  let first;
  for (const [name, message] of Object.entries(fields)) {
    const input = form.elements[name];
    const field = input?.closest(".field");
    if (!field) continue;
    field.classList.add("invalid");
    let err = $(".error", field);
    if (!err) {
      err = document.createElement("div");
      err.className = "error";
      field.appendChild(err);
    }
    err.textContent = message;
    first ??= input;
  }
  first?.focus();
  return Object.keys(fields).length > 0;
}

export function formData(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
}

export async function withBusy(button, label, fn) {
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span>${esc(label)}`;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    icons();
  }
}

/* ---------- Shell ---------- */
export function mountShell(page, { title }) {
  const app = $("#app");
  const content = app.innerHTML;
  app.className = "shell";
  app.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <a href="/" class="brand-mark"><span class="logo"><i data-lucide="shield-check"></i></span><span><strong>PIXEL PIRATES</strong><small>Risk Operations</small></span></a>
      <div class="nav-label">Operations</div>
      <nav class="nav">
        ${NAV.map((n) => `<a href="${n.href}" class="${n.page === page ? "active" : ""}"><i data-lucide="${n.icon}"></i>${n.label}${n.countKey ? `<span class="count" data-count="${n.countKey}" hidden></span>` : ""}</a>`).join("")}
      </nav>
      <div class="nav-label">Project</div>
      <nav class="nav"><a href="/"><i data-lucide="house"></i>Home</a><a href="/#how"><i data-lucide="book-open"></i>How it works</a></nav>
      <div class="sidebar-foot">
        <div class="status"><span class="pulse"></span>Engine online</div>
        Pixel Pirates · HackXLerate 2026
      </div>
    </aside>
    <div class="overlay" id="overlay"></div>
    <div class="main">
      <header class="topbar">
        <button class="btn btn-ghost icon-btn menu-btn" id="menu-btn" aria-label="Open menu"><i data-lucide="menu"></i></button>
        <form class="search" id="global-search" role="search">
          <i data-lucide="search"></i>
          <input type="search" name="q" placeholder="Search scans, domains, handles…" aria-label="Search scans" />
          <kbd>/</kbd>
        </form>
        <div class="topbar-actions">
          <a class="btn btn-primary btn-sm hide-sm" href="/scanner"><i data-lucide="scan-search"></i>New scan</a>
          <div class="notif">
            <button class="btn btn-ghost icon-btn" id="notif-btn" aria-label="Notifications"><i data-lucide="bell"></i><span class="dot" id="notif-dot" hidden></span></button>
            <div class="dropdown" id="notif-panel">
              <header><h4>Notifications</h4><a href="/dashboard#activity" class="mono" style="font-size:12px">View all</a></header>
              <ul class="activity" id="notif-list">${loadingBlock()}</ul>
            </div>
          </div>
          <span class="session-name" id="session-name"></span>
          <button class="avatar" id="signout-btn" type="button" aria-label="Sign out" title="Sign out">PP</button>
        </div>
      </header>
      <main class="content" id="content">${content}</main>
    </div>`;
  document.title = `${title} · Pixel Pirates`;

  const sidebar = $("#sidebar");
  const overlay = $("#overlay");
  const toggle = (open) => {
    sidebar.classList.toggle("open", open);
    overlay.classList.toggle("open", open);
  };
  $("#menu-btn").addEventListener("click", () => toggle(true));
  overlay.addEventListener("click", () => toggle(false));

  const searchForm = $("#global-search");
  const params = new URLSearchParams(location.search);
  if (page === "scanner" && params.get("q")) searchForm.q.value = params.get("q");
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = searchForm.q.value.trim();
    location.href = `/scanner${q ? `?q=${encodeURIComponent(q)}` : ""}#history`;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchForm.q.focus();
    }
  });

  const panel = $("#notif-panel");
  $("#notif-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      localStorage.setItem("ds-notif-seen", new Date().toISOString());
      $("#notif-dot").hidden = true;
    }
  });
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target)) panel.classList.remove("open");
  });

  $("#signout-btn").addEventListener("click", async () => {
    try {
      await api("/auth/signout", { method: "POST" });
      location.replace("/signin");
    } catch {
      toast("Could not sign out", "Check your connection and try again.", "error");
    }
  });
  checkSession();
  icons();
}

async function checkSession() {
  try {
    const { user } = await api("/auth/session");
    if (!user) {
      location.replace(`/signin?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
      return;
    }
    const name = user.fullName || user.email;
    $("#session-name").textContent = name;
    const avatar = $("#signout-btn");
    avatar.textContent = name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
    avatar.title = `Sign out (${name})`;
    loadNotifications();
  } catch {
    toast("Workspace unavailable", "We could not verify your session. Refresh when your connection is restored.", "error");
  }
}

export function activityItem(a) {
  const [icon, color] = ACTIVITY_STYLE[a.type] ?? ["activity", "var(--cyan)"];
  return `<li style="--accent:${color}"><span class="a-icon"><i data-lucide="${icon}"></i></span><div><p>${esc(a.message)}</p><time datetime="${esc(a.createdAt)}" title="${esc(formatDate(a.createdAt, true))}">${timeAgo(a.createdAt)}</time></div></li>`;
}

async function loadNotifications() {
  const list = $("#notif-list");
  try {
    const [items, stats] = await Promise.all([api("/activity?limit=8"), api("/stats")]);
    list.innerHTML = items.length ? items.map(activityItem).join("") : `<li class="muted" style="padding:16px 8px">No activity yet. Register a brand to get started.</li>`;
    const seen = localStorage.getItem("ds-notif-seen");
    $("#notif-dot").hidden = !items.some((i) => !seen || new Date(i.createdAt) > new Date(seen));
    setNavCounts(stats.totals);
    icons();
  } catch {
    list.innerHTML = `<li class="muted" style="padding:16px 8px">Notifications unavailable.</li>`;
  }
}

export function setNavCounts(totals) {
  $$("[data-count]").forEach((el) => {
    const n = totals?.[el.dataset.count] ?? 0;
    el.textContent = n;
    el.hidden = !n;
  });
}

export function refreshShell() {
  loadNotifications();
}
