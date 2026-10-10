import { $, api, activityItem, candidateTarget, emptyState, esc, icons, mountShell, platformPill, riskBadge, scoreBar, setNavCounts, statusBadge, timeAgo, toast, withBusy, refreshShell } from "./core.js";

mountShell("dashboard", { title: "Dashboard" });

const RISK_COLORS = { low: "#1e785b", medium: "#94640d", high: "#a95225", critical: "#b3324f" };
let trendChart, riskChart;

Chart.defaults.color = "#526762";
Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
Chart.defaults.borderColor = "rgba(35,61,56,0.1)";

function countUp(el, target) {
  const start = performance.now();
  const dur = 700;
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))).toLocaleString();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderKpis(t) {
  for (const [key, value] of Object.entries(t)) {
    const el = document.querySelector(`[data-kpi="${key}"]`);
    if (el) countUp(el, value);
  }
  const pct = (n) => (t.scans ? `${Math.round((n / t.scans) * 100)}% of scans` : "No scans yet");
  $('[data-kpi-foot="suspicious"]').textContent = t.scans ? `${pct(t.suspicious)} · medium+` : "Medium risk or above";
  $('[data-kpi-foot="scans"]').textContent = t.scans ? `Avg risk score ${t.avgScore}/100` : "Profiles, domains & apps";
}

function renderOnboarding(t) {
  const host = $("#onboarding");
  if (t.brands && t.scans) return (host.innerHTML = "");
  host.innerHTML = `<div class="card fade-in" style="margin-bottom:18px;border-color:rgba(61,255,162,.3)">
    ${emptyState({
      icon: t.brands ? "scan-search" : "shield-plus",
      title: t.brands ? "Your brands are registered. Run your first scan" : "Your SOC is ready. Let's add some data",
      text: t.brands
        ? "Submit a suspicious profile, domain or app and the dashboard fills in automatically."
        : "Register an official brand to start detecting impersonators, or load a fictional demo dataset to explore every feature.",
      actions: t.brands
        ? `<a class="btn btn-primary" href="/scanner"><i data-lucide="scan-search"></i>Run a scan</a>`
        : `<a class="btn btn-primary" href="/brands?new=1"><i data-lucide="building-2"></i>Register a brand</a><button class="btn" id="demo-btn"><i data-lucide="database"></i>Load demo data</button>`,
    })}</div>`;
  $("#demo-btn")?.addEventListener("click", (e) =>
    withBusy(e.currentTarget, "Loading demo…", async () => {
      try {
        const r = await api("/demo", { method: "POST" });
        toast("Demo data loaded", r.created ? `${r.created} brands and ${r.scans} scans added` : r.message);
        await load();
        refreshShell();
      } catch (err) {
        toast("Could not load demo data", err.message, "error");
      }
    }),
  );
}

function renderTrend(daily) {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const byDay = Object.fromEntries(daily.map((d) => [d.day, d]));
  const labels = days.map((d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  const ctx = $("#trend-chart").getContext("2d");
  const fill = ctx.createLinearGradient(0, 0, 0, 240);
  fill.addColorStop(0, "rgba(34,224,255,0.28)");
  fill.addColorStop(1, "rgba(34,224,255,0)");
  trendChart?.destroy();
  trendChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "All scans", data: days.map((d) => byDay[d]?.total ?? 0), borderColor: "#22e0ff", backgroundColor: fill, fill: true, tension: 0.35, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2 },
        { label: "High-risk", data: days.map((d) => byDay[d]?.threats ?? 0), borderColor: "#ff3d71", backgroundColor: "transparent", tension: 0.35, pointRadius: 0, pointHoverRadius: 5, borderWidth: 2, borderDash: [5, 4] },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#0f192c", borderColor: "rgba(110,190,255,.25)", borderWidth: 1, padding: 10 } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(110,190,255,0.06)" } },
      },
    },
  });
}

function renderRisk(dist, total) {
  $("#donut-total").textContent = total;
  const levels = ["critical", "high", "medium", "low"];
  $("#risk-legend").innerHTML = levels.map((l) => `<span class="risk-${l}"><i></i><span class="muted" style="text-transform:capitalize">${l}</span> <b>${dist[l]}</b></span>`).join("");
  riskChart?.destroy();
  riskChart = new Chart($("#risk-chart"), {
    type: "doughnut",
    data: {
      labels: levels.map((l) => l[0].toUpperCase() + l.slice(1)),
      datasets: [{ data: total ? levels.map((l) => dist[l]) : [1], backgroundColor: total ? levels.map((l) => RISK_COLORS[l]) : ["rgba(110,190,255,0.1)"], borderColor: "#0b1322", borderWidth: 3, hoverOffset: 6 }],
    },
    options: { maintainAspectRatio: false, cutout: "74%", plugins: { legend: { display: false }, tooltip: { enabled: total > 0, backgroundColor: "#0f192c" } } },
  });
}

function renderRecentScans(scans) {
  const host = $("#recent-scans");
  if (!scans.length) {
    host.innerHTML = emptyState({ icon: "radar", title: "No scans yet", text: "Scan results appear here as soon as you analyse a candidate.", actions: `<a class="btn btn-primary btn-sm" href="/scanner"><i data-lucide="scan-search"></i>New scan</a>` });
    return;
  }
  host.innerHTML = `<table><thead><tr><th>Candidate</th><th class="hide-xs">Brand</th><th>Risk</th><th class="hide-xs">Score</th><th class="hide-xs">Status</th><th class="hide-xs">When</th></tr></thead><tbody>
    ${scans
      .map(
        (s) => `<tr class="clickable" data-href="/scanner?scan=${s.id}">
        <td><div class="cell-title">${esc(s.candidateName)}</div><div class="cell-sub">${esc(candidateTarget(s))}</div>${s.candidatePlatform ? `<div style="margin-top:3px">${platformPill(s.candidatePlatform)}</div>` : ""}</td>
        <td class="hide-xs">${esc(s.brandName)}</td>
        <td>${riskBadge(s.riskLevel)}</td>
        <td class="hide-xs">${scoreBar(s.riskScore, s.riskLevel)}</td>
        <td class="hide-xs">${s.investigationStatus ? statusBadge(s.investigationStatus) : `<span class="badge neutral plain">Scanned</span>`}</td>
        <td class="hide-xs mono dim">${timeAgo(s.createdAt)}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  host.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", () => (location.href = tr.dataset.href)));
}

function renderTopBrands(rows) {
  const host = $("#top-brands");
  if (!rows.length) {
    host.innerHTML = `<p class="muted" style="margin:0;font-size:14px">Register brands to see which are targeted most.</p>`;
    return;
  }
  const max = Math.max(1, ...rows.map((r) => r.threats));
  host.innerHTML = rows
    .map((r) => `<div class="row"><span>${esc(r.name)}</span><span class="mono dim">${r.threats} high-risk / ${r.total}</span><div class="track"><span style="width:${(r.threats / max) * 100}%"></span></div></div>`)
    .join("");
}

function renderActivity(items) {
  $("#activity-list").innerHTML = items.length ? items.map(activityItem).join("") : `<li class="muted" style="font-size:14px">No activity recorded yet.</li>`;
}

async function load() {
  try {
    const stats = await api("/stats");
    renderKpis(stats.totals);
    renderOnboarding(stats.totals);
    renderTrend(stats.daily);
    renderRisk(stats.distribution, stats.totals.scans);
    renderRecentScans(stats.recentScans);
    renderTopBrands(stats.topBrands);
    renderActivity(stats.recentActivity);
    setNavCounts(stats.totals);
    icons();
  } catch (err) {
    $("#recent-scans").innerHTML = emptyState({ icon: "wifi-off", title: "Couldn't load dashboard", text: err.message, actions: `<button class="btn btn-sm" onclick="location.reload()">Retry</button>` });
    toast("Dashboard unavailable", err.message, "error");
    icons();
  }
}

$("#refresh-btn").addEventListener("click", (e) => withBusy(e.currentTarget, "Refreshing…", async () => {
  await load();
  refreshShell();
}));

load();
