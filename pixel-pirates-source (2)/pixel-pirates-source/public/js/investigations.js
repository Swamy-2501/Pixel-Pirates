import { $, STATUS, api, clearErrors, closeModal, confirmDialog, emptyState, esc, formData, formatDate, icons, mountShell, openModal, refreshShell, riskBadge, showErrors, statusBadge, timeAgo, toast, withBusy } from "./core.js";

mountShell("investigations", { title: "Investigations" });

const COLUMNS = [
  { key: "open", label: "Open", statuses: ["open"], color: "var(--cyan)" },
  { key: "in_progress", label: "In progress", statuses: ["in_progress"], color: "var(--blue)" },
  { key: "takedown_requested", label: "Takedown requested", statuses: ["takedown_requested"], color: "var(--high)" },
  { key: "closed", label: "Closed", statuses: ["resolved", "dismissed"], color: "var(--low)" },
];
const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

let cases = [];
let current = null;
const caseForm = $("#case-form");
const newForm = $("#new-form");

function filtered() {
  const q = $("#case-search").value.trim().toLowerCase();
  const p = $("#case-priority").value;
  const b = $("#case-brand").value;
  return cases.filter(
    (c) =>
      (!p || c.priority === p) &&
      (!b || String(c.brandId) === b) &&
      (!q || [c.title, c.candidateName, c.candidateDomain, c.candidateHandle, c.brandName, c.notes].some((v) => v?.toLowerCase().includes(q))),
  );
}

function render() {
  const host = $("#board-host");
  if (!cases.length) {
    host.innerHTML = `<div class="card">${emptyState({
      icon: "folder-search",
      title: "No investigations yet",
      text: "When a scan finds a high-risk impersonator, open an investigation from the scan report to track it to takedown.",
      actions: `<a class="btn btn-primary" href="/scanner?level=high,critical#history"><i data-lucide="siren"></i>Review high-risk scans</a>`,
    })}</div>`;
    return icons();
  }
  const list = filtered();
  host.innerHTML = `<div class="board">${COLUMNS.map((col) => {
    const items = list.filter((c) => col.statuses.includes(c.status)).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || new Date(b.updatedAt) - new Date(a.updatedAt));
    return `<section class="column" aria-label="${col.label}">
      <div class="column-head" style="color:${col.color}"><span>${col.label}</span><span class="n">${items.length}</span></div>
      ${items.length ? items.map(card).join("") : `<p class="dim" style="font-size:13px;text-align:center;padding:24px 8px">No cases</p>`}
    </section>`;
  }).join("")}</div>`;
  icons();
}

function card(c) {
  return `<article class="case fade-in" data-id="${c.id}" tabindex="0">
    <div class="top"><span class="badge risk-${c.priority}">${c.priority}</span>${c.status === "dismissed" || c.status === "resolved" ? statusBadge(c.status) : c.riskScore != null ? `<span class="mono dim" style="font-size:12px">score ${c.riskScore}</span>` : ""}</div>
    <h4>${esc(c.title)}</h4>
    ${c.candidateDomain || c.candidateHandle ? `<div class="cell-sub" style="margin-bottom:8px">${esc(c.candidateDomain || `@${c.candidateHandle}`)}</div>` : ""}
    <div class="meta"><span>${esc(c.brandName ?? "—")}</span><span>#${c.id} · ${timeAgo(c.updatedAt)}</span></div>
  </article>`;
}

function openCase(c) {
  current = c;
  clearErrors(caseForm);
  $("#case-id").textContent = `CASE #${c.id} · opened ${formatDate(c.createdAt, true)}`;
  $("#case-title").textContent = c.title;
  $("#case-sub").innerHTML = `${esc(c.brandName ?? "Unknown brand")} · last updated ${timeAgo(c.updatedAt)}`;
  $("#case-detail").innerHTML = c.scanId
    ? `<dl class="kv">
        <dt>Candidate</dt><dd><strong>${esc(c.candidateName)}</strong></dd>
        ${c.candidateDomain ? `<dt>Domain</dt><dd class="mono">${esc(c.candidateDomain)}</dd>` : ""}
        ${c.candidateHandle ? `<dt>Handle</dt><dd class="mono">@${esc(c.candidateHandle)}</dd>` : ""}
        <dt>Risk</dt><dd>${riskBadge(c.riskLevel)} <span class="mono" style="margin-left:6px">${c.riskScore}/100</span></dd>
        <dt>Verdict</dt><dd>${esc(c.verdict)}</dd>
        <dt>Evidence</dt><dd><a href="/scanner?scan=${c.scanId}">View full scan report →</a></dd>
      </dl>`
    : `<p class="muted" style="margin:0;font-size:14px"><i data-lucide="file-pen" style="width:14px;height:14px;vertical-align:-2px"></i> Manually logged case with no linked scan.</p>`;
  caseForm.title.value = c.title;
  caseForm.status.value = c.status;
  caseForm.priority.value = c.priority;
  caseForm.notes.value = c.notes;
  icons();
  openModal("case-modal");
}

async function load() {
  try {
    cases = await api("/investigations");
    render();
  } catch (err) {
    $("#board-host").innerHTML = `<div class="card">${emptyState({ icon: "wifi-off", title: "Couldn't load investigations", text: err.message })}</div>`;
    icons();
  }
}

$("#board-host").addEventListener("click", (e) => {
  const el = e.target.closest(".case");
  if (el) openCase(cases.find((c) => c.id === Number(el.dataset.id)));
});
$("#board-host").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList.contains("case")) e.target.click();
});

caseForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = formData(caseForm);
  if (data.title.length < 3) return showErrors(caseForm, { title: "Title must be at least 3 characters" });
  await withBusy($("#case-save"), "Saving…", async () => {
    try {
      await api(`/investigations/${current.id}`, { method: "PATCH", body: data });
      closeModal("case-modal");
      toast("Case updated", data.status !== current.status ? `Moved to ${STATUS[data.status]}` : current.title);
      await load();
      refreshShell();
    } catch (err) {
      if (!showErrors(caseForm, err.fields)) toast("Could not save case", err.message, "error");
    }
  });
});

$("#case-delete").addEventListener("click", async () => {
  const c = current;
  closeModal("case-modal");
  const ok = await confirmDialog({ title: `Delete case #${c.id}?`, text: "The investigation and its notes are permanently removed. The linked scan stays in history.", confirmLabel: "Delete case" });
  if (!ok) return openCase(c);
  try {
    await api(`/investigations/${c.id}`, { method: "DELETE" });
    toast("Investigation deleted", c.title, "info");
    await load();
    refreshShell();
  } catch (err) {
    toast("Could not delete case", err.message, "error");
  }
});

$("#new-case").addEventListener("click", () => {
  newForm.reset();
  clearErrors(newForm);
  openModal("new-modal");
});

newForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = formData(newForm);
  const errors = {};
  if (!data.brandId) errors.brandId = "Select a brand";
  if (!data.title || data.title.length < 3) errors.title = "Title must be at least 3 characters";
  if (showErrors(newForm, errors)) return;
  await withBusy($("#new-save"), "Opening…", async () => {
    try {
      const inv = await api("/investigations", { method: "POST", body: data });
      closeModal("new-modal");
      toast("Investigation opened", inv.title);
      await load();
      refreshShell();
    } catch (err) {
      if (!showErrors(newForm, err.fields)) toast("Could not open case", err.message, "error");
    }
  });
});

["#case-search", "#case-priority", "#case-brand"].forEach((sel) => $(sel).addEventListener(sel === "#case-search" ? "input" : "change", render));

async function init() {
  try {
    const brands = await api("/brands");
    const opts = brands.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
    $("#case-brand").innerHTML = `<option value="">All brands</option>${opts}`;
    newForm.brandId.innerHTML = brands.length ? `<option value="">Select a brand</option>${opts}` : `<option value="">Register a brand first</option>`;
  } catch {
    /* brand filters are optional */
  }
  await load();
  const id = Number(new URLSearchParams(location.search).get("case"));
  const c = cases.find((x) => x.id === id);
  if (c) openCase(c);
}

init();
