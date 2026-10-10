import { $, $$, api, clearErrors, closeModal, confirmDialog, debounce, emptyState, esc, formData, formatDate, icons, mountShell, openModal, refreshShell, showErrors, timeAgo, toast, withBusy } from "./core.js";

mountShell("brands", { title: "Brands" });

const DOMAIN_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;
const normalizeDomain = (v) => v.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^@/]*@/, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");

let brands = [];
let filter = "all";
const form = $("#brand-form");

function validate(data) {
  const errors = {};
  if (!data.name) errors.name = "Brand name is required";
  if (!data.domain) errors.domain = "Official domain is required";
  else if (!DOMAIN_RE.test(normalizeDomain(data.domain))) errors.domain = "Enter a valid domain, e.g. example.com";
  if (!data.socialHandle) errors.socialHandle = "Official social handle is required";
  else if (!/^@?[a-z0-9._-]{2,50}$/i.test(data.socialHandle) && !data.socialHandle.includes("/")) errors.socialHandle = "Handles may contain letters, numbers, dots, dashes and underscores";
  if (!data.appPublisher) errors.appPublisher = "Official app publisher is required";
  if (data.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contactEmail)) errors.contactEmail = "Enter a valid email address";
  const dup = brands.find((b) => b.id !== Number(data.id) && (b.name.toLowerCase() === data.name.toLowerCase() || b.domain === normalizeDomain(data.domain || "")));
  if (dup && !errors.name && !errors.domain) {
    if (dup.name.toLowerCase() === data.name.toLowerCase()) errors.name = "This brand is already registered";
    else errors.domain = `Already registered to ${dup.name}`;
  }
  return errors;
}

function visible() {
  const sort = $("#brand-sort").value;
  let list = brands.filter((b) => (filter === "threats" ? b.threatCount > 0 : filter === "clean" ? b.scanCount > 0 && b.threatCount === 0 : filter === "unscanned" ? b.scanCount === 0 : true));
  const by = {
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    name: (a, b) => a.name.localeCompare(b.name),
    threats: (a, b) => b.threatCount - a.threatCount || b.scanCount - a.scanCount,
  }[sort];
  return list.sort(by);
}

function render() {
  const host = $("#brand-table");
  const q = $("#brand-search").value.trim();
  const list = visible();
  if (!brands.length && !q) {
    host.innerHTML = emptyState({
      icon: "building-2",
      title: "No brands registered yet",
      text: "Register your first official brand. Scans compare suspicious candidates against these assets.",
      actions: `<button class="btn btn-primary" data-new><i data-lucide="plus"></i>Register brand</button>`,
    });
  } else if (!list.length) {
    host.innerHTML = emptyState({ icon: "search-x", title: "No matching brands", text: "Try a different search term or filter." });
  } else {
    host.innerHTML = `<table><thead><tr><th>Brand</th><th>Official social</th><th class="hide-xs">App publisher</th><th>Exposure</th><th class="hide-xs">Registered</th><th></th></tr></thead><tbody>
      ${list
        .map(
          (b) => `<tr class="fade-in">
          <td><div class="cell-title">${esc(b.name)}</div><div class="cell-sub"><a href="https://${esc(b.domain)}" target="_blank" rel="noopener noreferrer">${esc(b.domain)}</a></div>${b.contactEmail ? `<div class="cell-sub dim">${esc(b.contactEmail)}</div>` : ""}</td>
          <td class="mono">@${esc(b.socialHandle)}</td>
          <td class="hide-xs">${esc(b.appPublisher)}</td>
          <td>${b.scanCount ? `<span class="badge ${b.threatCount ? "risk-critical" : "risk-low"}">${b.threatCount} high-risk</span><div class="cell-sub" style="margin-top:4px">${b.scanCount} scan${b.scanCount === 1 ? "" : "s"}</div>` : `<span class="badge neutral plain">Not scanned</span>`}</td>
          <td class="hide-xs"><div title="${esc(formatDate(b.createdAt, true))}">${formatDate(b.createdAt)}</div>${b.updatedAt !== b.createdAt && new Date(b.updatedAt) - new Date(b.createdAt) > 1000 ? `<div class="cell-sub dim">edited ${timeAgo(b.updatedAt)}</div>` : ""}</td>
          <td><div class="row-actions">
            <a class="btn btn-sm" href="/scanner?brand=${b.id}" title="Scan for ${esc(b.name)}"><i data-lucide="scan-search"></i><span class="hide-xs">Scan</span></a>
            <button class="btn btn-ghost btn-sm icon-btn" data-edit="${b.id}" aria-label="Edit ${esc(b.name)}"><i data-lucide="pencil"></i></button>
            <button class="btn btn-ghost btn-sm icon-btn" data-delete="${b.id}" aria-label="Delete ${esc(b.name)}"><i data-lucide="trash-2"></i></button>
          </div></td></tr>`,
        )
        .join("")}</tbody></table>`;
  }
  icons();
}

async function load() {
  const q = $("#brand-search").value.trim();
  try {
    brands = await api(`/brands${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    render();
  } catch (err) {
    $("#brand-table").innerHTML = emptyState({ icon: "wifi-off", title: "Couldn't load brands", text: err.message });
    icons();
  }
}

function openForm(brand) {
  form.reset();
  clearErrors(form);
  form.id.value = brand?.id ?? "";
  if (brand) for (const k of ["name", "domain", "socialHandle", "appPublisher", "contactEmail"]) form[k].value = brand[k] ?? "";
  $("#brand-modal-title").textContent = brand ? `Edit ${brand.name}` : "Register a brand";
  $("#brand-submit").innerHTML = brand ? `<i data-lucide="save"></i>Save changes` : `<i data-lucide="shield-check"></i>Register brand`;
  icons();
  openModal("brand-modal");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = formData(form);
  if (showErrors(form, validate(data))) return;
  const id = data.id;
  delete data.id;
  await withBusy($("#brand-submit"), id ? "Saving…" : "Registering…", async () => {
    try {
      const saved = await api(id ? `/brands/${id}` : "/brands", { method: id ? "PUT" : "POST", body: data });
      closeModal("brand-modal");
      toast(id ? "Brand updated" : "Brand registered", `${saved.name} · ${saved.domain}`);
      await load();
      refreshShell();
    } catch (err) {
      if (!showErrors(form, err.fields)) toast("Could not save brand", err.message, "error");
    }
  });
});

document.addEventListener("click", async (e) => {
  if (e.target.closest("[data-new]")) return openForm();
  const editId = e.target.closest("[data-edit]")?.dataset.edit;
  if (editId) return openForm(brands.find((b) => b.id === Number(editId)));
  const delId = e.target.closest("[data-delete]")?.dataset.delete;
  if (delId) {
    const b = brands.find((x) => x.id === Number(delId));
    const ok = await confirmDialog({
      title: `Delete ${b.name}?`,
      text: `This permanently removes the brand${b.scanCount ? ` and its ${b.scanCount} scan result${b.scanCount === 1 ? "" : "s"} and related investigations` : ""}. This can't be undone.`,
      confirmLabel: "Delete brand",
    });
    if (!ok) return;
    try {
      await api(`/brands/${b.id}`, { method: "DELETE" });
      toast("Brand deleted", b.name, "info");
      await load();
      refreshShell();
    } catch (err) {
      toast("Could not delete brand", err.message, "error");
    }
  }
});

$("#add-btn").addEventListener("click", () => openForm());
$("#brand-search").addEventListener("input", debounce(load, 250));
$("#brand-sort").addEventListener("change", render);
$$("#brand-filter .chip").forEach((chip) =>
  chip.addEventListener("click", () => {
    $$("#brand-filter .chip").forEach((c) => c.classList.toggle("active", c === chip));
    filter = chip.dataset.filter;
    render();
  }),
);

await load();
if (new URLSearchParams(location.search).get("new")) {
  openForm();
  history.replaceState(null, "", "/brands");
}
