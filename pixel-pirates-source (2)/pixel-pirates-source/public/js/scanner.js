import { $, $$, PLATFORMS, api, candidateTarget, clearErrors, confirmDialog, debounce, emptyState, esc, formData, formatDate, icons, mountShell, platformPill, refreshShell, riskBadge, scoreBar, showErrors, statusBadge, timeAgo, toast, withBusy } from "./core.js";

mountShell("scanner", { title: "Risk Scanner" });

const form = $("#scan-form");
const resultEl = $("#result");
const params = new URLSearchParams(location.search);
const levels = new Set((params.get("level") ?? "").split(",").filter(Boolean));
let brands = [];
let history = [];

const SIGNAL_ICON = { name: "type", domain: "globe", handle: "at-sign", app: "smartphone", content: "message-square-warning", trust: "badge-check" };
const STEPS = ["Normalising candidate identifiers", "Comparing domain against official registry", "Checking handle for lookalike patterns", "Verifying app publisher", "Scanning text for scam language", "Computing risk score"];

form.candidatePlatform.innerHTML += Object.entries(PLATFORMS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join("");
$("#history-search").value = params.get("q") ?? "";
$$("#level-chips .chip").forEach((c) => c.classList.toggle("active", levels.has(c.dataset.level)));

/* ---------- Result panel ---------- */
function idle() {
  resultEl.innerHTML = `<div class="empty" style="padding-top:70px">
    <div class="radar"></div>
    <h4>Scanner standing by</h4>
    <p>Pick a brand and enter the suspicious candidate. Pixel Pirates checks for typosquats, homoglyphs, combosquats, fake handles, rogue publishers and scam language.</p>
  </div>`;
}

function scanning() {
  resultEl.innerHTML = `<div class="radar" style="margin-top:40px"></div><div class="scan-steps" style="padding-top:0">${STEPS.map((s, i) => `<div class="scan-step" data-step="${i}"><span class="ind"><i data-lucide="circle"></i></span>${s}</div>`).join("")}</div>`;
  icons();
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      $$(".scan-step", resultEl).forEach((el, idx) => {
        el.classList.toggle("done", idx < i);
        el.classList.toggle("active", idx === i);
        el.querySelector(".ind").innerHTML = idx < i ? `<i data-lucide="check"></i>` : idx === i ? `<span class="spinner" style="width:14px;height:14px"></span>` : `<i data-lucide="circle"></i>`;
      });
      icons();
      if (i++ < STEPS.length) setTimeout(tick, 170);
      else resolve();
    };
    tick();
  });
}

function showResult(s) {
  const circumference = 2 * Math.PI * 80;
  const targets = [
    s.candidateDomain && ["globe", s.candidateDomain],
    s.candidateHandle && ["at-sign", `@${s.candidateHandle}`],
    s.candidateAppPublisher && ["smartphone", s.candidateAppPublisher],
  ].filter(Boolean);
  const caseAction = s.investigationId
    ? `<a class="btn" href="/investigations?case=${s.investigationId}"><i data-lucide="folder-open"></i>View investigation</a>`
    : `<button class="btn ${s.riskLevel === "high" || s.riskLevel === "critical" ? "btn-primary" : ""}" id="open-case"><i data-lucide="folder-plus"></i>Open investigation</button>`;

  resultEl.innerHTML = `<div class="fade-in">
    <div class="card-head"><h3><i data-lucide="file-scan"></i>Scan report <span class="mono dim" style="font-size:12px">#${s.id}</span></h3><span class="sub" title="${esc(formatDate(s.createdAt, true))}">${esc(s.brandName)} · ${timeAgo(s.createdAt)}</span></div>
    <div class="gauge-wrap">
      <div class="gauge risk-${s.riskLevel}">
        <svg viewBox="0 0 180 180"><circle class="track" cx="90" cy="90" r="80"/><circle class="val" cx="90" cy="90" r="80" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"/></svg>
        <div class="g-center"><div><b data-score>0</b><small>RISK SCORE</small></div></div>
      </div>
      <div class="verdict">
        ${riskBadge(s.riskLevel)} ${s.investigationStatus ? statusBadge(s.investigationStatus) : ""}
        <h3>${esc(s.verdict)}</h3>
        <p><strong style="color:var(--text)">${esc(s.candidateName)}</strong>${s.candidatePlatform ? ` · ${platformPill(s.candidatePlatform)}` : ""}</p>
        <div class="target-list">${targets.map(([i, v]) => `<div><i data-lucide="${i}"></i><code>${esc(v)}</code></div>`).join("")}</div>
      </div>
    </div>
    <div class="card-head" style="margin-bottom:10px"><h3 style="font-size:14px"><i data-lucide="list-checks"></i>Detection signals</h3><span class="sub">${s.signals.filter((x) => x.weight > 0).length} risk · ${s.signals.filter((x) => x.weight < 0).length} trust</span></div>
    <ul class="signals">${s.signals
      .map((sig, i) => {
        const cls = sig.weight < 0 ? "risk-low" : sig.weight >= 25 ? "risk-critical" : sig.weight >= 15 ? "risk-high" : sig.weight > 0 ? "risk-medium" : "neutral";
        return `<li class="signal" style="animation-delay:${i * 60}ms"><span class="s-icon ${cls}"><i data-lucide="${SIGNAL_ICON[sig.category] ?? "dot"}"></i></span><div><strong>${esc(sig.label)}</strong><p>${esc(sig.detail)}</p></div><span class="w ${cls}">${sig.weight > 0 ? "+" : ""}${sig.weight}</span></li>`;
      })
      .join("")}</ul>
    ${s.candidateDescription ? `<div class="divider"></div><div class="field"><span>Analysed text</span></div><p class="muted" style="margin:0;font-size:13.5px;white-space:pre-wrap;word-break:break-word">${esc(s.candidateDescription)}</p>` : ""}
    <div class="form-actions" style="justify-content:flex-start">${caseAction}<button class="btn btn-ghost" id="scan-again"><i data-lucide="rotate-ccw"></i>New scan</button></div>
  </div>`;
  icons();

  requestAnimationFrame(() => {
    resultEl.querySelector(".gauge .val").style.strokeDashoffset = circumference * (1 - s.riskScore / 100);
    const el = resultEl.querySelector("[data-score]");
    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / 1000);
      el.textContent = Math.round(s.riskScore * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  $("#scan-again").addEventListener("click", () => {
    form.reset();
    if (s.brandId) form.brandId.value = s.brandId;
    idle();
    form.candidateName.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $("#open-case")?.addEventListener("click", (e) =>
    withBusy(e.currentTarget, "Opening…", async () => {
      try {
        const inv = await api("/investigations", { method: "POST", body: { scanId: s.id } });
        toast("Investigation opened", inv.title);
        showResult({ ...s, investigationId: inv.id, investigationStatus: inv.status });
        loadHistory();
        refreshShell();
      } catch (err) {
        if (err.status === 409 && err.body?.details?.investigationId) location.href = `/investigations?case=${err.body.details.investigationId}`;
        else toast("Could not open investigation", err.message, "error");
      }
    }),
  );
}

/* ---------- Form ---------- */
function validate(d) {
  const errors = {};
  if (!d.brandId) errors.brandId = "Select a brand";
  if (!d.candidateName) errors.candidateName = "Candidate name is required";
  if (!d.candidateDomain && !d.candidateHandle && !d.candidateAppPublisher && !d.candidateDescription) errors.candidateHandle = "Provide a domain, handle, app publisher or text to analyse";
  return errors;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = formData(form);
  if (showErrors(form, validate(data))) return;
  await withBusy($("#scan-submit"), "Scanning…", async () => {
    const animation = scanning();
    try {
      const [scan] = await Promise.all([api("/scans", { method: "POST", body: data }), animation]);
      showResult(scan);
      const t = scan.riskLevel === "critical" || scan.riskLevel === "high" ? "warn" : "success";
      toast(`${scan.riskLevel.toUpperCase()} risk · ${scan.riskScore}/100`, scan.verdict, t);
      loadHistory();
      refreshShell();
      if (window.innerWidth < 1100) resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      await animation;
      idle();
      if (!showErrors(form, err.fields)) toast("Scan failed", err.message, "error");
    }
  });
});
form.addEventListener("reset", () => setTimeout(() => clearErrors(form)));

$("#example-btn").addEventListener("click", () => {
  const b = brands.find((x) => x.id === Number(form.brandId.value)) ?? brands[0];
  if (!b) return toast("Register a brand first", "Examples are generated from a registered brand", "info");
  form.brandId.value = b.id;
  const label = b.domain.split(".")[0];
  const samples = [
    { candidateName: `${b.name} Support`, candidatePlatform: "instagram", candidateDomain: `${label}-support-login.xyz`, candidateHandle: `${b.socialHandle}_support_official`, candidateAppPublisher: "", candidateDescription: `Your ${b.name} account has been suspended! DM us on WhatsApp with your OTP within 24 hours to restore access.` },
    { candidateName: `${b.name.replace(/o/i, "0")} Rewards`, candidatePlatform: "play_store", candidateDomain: "", candidateHandle: "", candidateAppPublisher: `${b.name} Digital Labs`, candidateDescription: "Download the APK here for instant cashback and a free gift card." },
    { candidateName: b.name, candidatePlatform: "website", candidateDomain: `${label.slice(0, -1)}${label.slice(-1) === "a" ? "e" : "a"}.${b.domain.split(".").slice(1).join(".")}`, candidateHandle: "", candidateAppPublisher: "", candidateDescription: "" },
  ];
  const sample = samples[Math.floor(Math.random() * samples.length)];
  clearErrors(form);
  for (const [k, v] of Object.entries(sample)) form[k].value = v;
  toast("Example filled", "Run the scan to see how it scores", "info");
});

/* ---------- History ---------- */
function renderHistory() {
  const host = $("#history-table");
  $("#history-count").textContent = history.length ? `${history.length} result${history.length === 1 ? "" : "s"}` : "";
  if (!history.length) {
    const filtered = $("#history-search").value || $("#history-brand").value || levels.size;
    host.innerHTML = filtered
      ? emptyState({ icon: "search-x", title: "No scans match these filters", text: "Clear the filters to see your full history." })
      : emptyState({ icon: "radar", title: "No scans yet", text: "Your scan results are stored here so you can revisit and escalate them." });
    return icons();
  }
  host.innerHTML = `<table><thead><tr><th>Candidate</th><th>Brand</th><th>Risk</th><th class="hide-xs">Score</th><th class="hide-xs">Case</th><th class="hide-xs">Scanned</th><th></th></tr></thead><tbody>
    ${history
      .map(
        (s) => `<tr class="clickable" data-id="${s.id}">
        <td><div class="cell-title">${esc(s.candidateName)}</div><div class="cell-sub">${esc(candidateTarget(s))}</div></td>
        <td>${esc(s.brandName)}</td>
        <td>${riskBadge(s.riskLevel)}</td>
        <td class="hide-xs">${scoreBar(s.riskScore, s.riskLevel)}</td>
        <td class="hide-xs">${s.investigationStatus ? statusBadge(s.investigationStatus) : `<span class="dim">—</span>`}</td>
        <td class="hide-xs mono dim" title="${esc(formatDate(s.createdAt, true))}">${timeAgo(s.createdAt)}</td>
        <td><div class="row-actions"><button class="btn btn-ghost btn-sm icon-btn" data-del="${s.id}" aria-label="Delete scan"><i data-lucide="trash-2"></i></button></div></td></tr>`,
      )
      .join("")}</tbody></table>`;
  icons();
}

async function loadHistory() {
  const q = $("#history-search").value.trim();
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if ($("#history-brand").value) qs.set("brandId", $("#history-brand").value);
  if (levels.size) qs.set("level", [...levels].join(","));
  try {
    history = await api(`/scans?${qs}`);
    renderHistory();
  } catch (err) {
    $("#history-table").innerHTML = emptyState({ icon: "wifi-off", title: "Couldn't load history", text: err.message });
    icons();
  }
}

$("#history-table").addEventListener("click", async (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    e.stopPropagation();
    const s = history.find((x) => x.id === Number(del.dataset.del));
    const ok = await confirmDialog({ title: "Delete this scan?", text: `The scan of "${s.candidateName}" will be removed from history. Linked investigations stay open but lose the scan link.`, confirmLabel: "Delete scan" });
    if (!ok) return;
    try {
      await api(`/scans/${s.id}`, { method: "DELETE" });
      toast("Scan deleted", s.candidateName, "info");
      loadHistory();
      refreshShell();
    } catch (err) {
      toast("Could not delete scan", err.message, "error");
    }
    return;
  }
  const row = e.target.closest("tr[data-id]");
  if (row) {
    showResult(history.find((x) => x.id === Number(row.dataset.id)));
    resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

$("#history-search").addEventListener("input", debounce(loadHistory, 250));
$("#history-brand").addEventListener("change", loadHistory);
$$("#level-chips .chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    const l = chip.dataset.level;
    levels.has(l) ? levels.delete(l) : levels.add(l);
    chip.classList.toggle("active", levels.has(l));
    loadHistory();
  }),
);

/* ---------- Init ---------- */
async function init() {
  idle();
  try {
    brands = await api("/brands");
  } catch (err) {
    toast("Couldn't load brands", err.message, "error");
  }
  const options = brands.map((b) => `<option value="${b.id}">${esc(b.name)} — ${esc(b.domain)}</option>`).join("");
  form.brandId.innerHTML = brands.length ? `<option value="">Select a registered brand</option>${options}` : `<option value="">No brands registered yet</option>`;
  $("#history-brand").innerHTML = `<option value="">All brands</option>${options}`;

  if (!brands.length) {
    resultEl.innerHTML = emptyState({
      icon: "building-2",
      title: "Register a brand first",
      text: "The scanner compares candidates against a brand's official domain, handle and app publisher.",
      actions: `<a class="btn btn-primary" href="/brands?new=1"><i data-lucide="plus"></i>Register brand</a>`,
    });
    resultEl.style.paddingTop = "60px";
    icons();
  }

  const preselect = params.get("brand");
  if (preselect && brands.some((b) => b.id === Number(preselect))) form.brandId.value = preselect;
  else if (brands.length === 1) form.brandId.value = brands[0].id;

  await loadHistory();

  const scanId = params.get("scan");
  if (scanId) {
    try {
      showResult(await api(`/scans/${Number(scanId)}`));
    } catch {
      toast("Scan not found", "It may have been deleted", "warn");
    }
  }
  if (location.hash === "#history") $("#history").scrollIntoView();
}

init();
