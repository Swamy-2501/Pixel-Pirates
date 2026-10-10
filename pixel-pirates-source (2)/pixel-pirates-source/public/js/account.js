import { api, esc, icons, showErrors } from "./core.js";

const host = document.querySelector("#account-content");
const params = new URLSearchParams(location.search);
const routeFlow = params.get("flow") || location.pathname.replace(/^\//, "").replace(/\.html$/, "") || "signin";
let flow = routeFlow;
let email = params.get("email") || sessionStorage.getItem("account-email") || "";
let resetToken = "";
let cooldownTimer;

const safeNext = () => {
  const next = params.get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
};
const message = (text = "", kind = "info") => {
  const alert = host.querySelector("[data-message]");
  if (!alert) return;
  alert.textContent = text;
  alert.className = `form-alert ${kind}`;
  alert.hidden = !text;
};
const errorMessage = (error) => error?.status === 0
  ? "We could not reach the service. Check your connection and try again."
  : error?.message || "Something went wrong. Please try again.";

function field(name, label, type, { required = true, autocomplete = "", hint = "", value = "" } = {}) {
  return `<label class="field" for="${name}"><span>${label}${required ? "" : " <em>Optional</em>"}</span><input id="${name}" name="${name}" type="${type}" ${required ? "required" : ""} ${autocomplete ? `autocomplete="${autocomplete}"` : ""} ${type === "password" ? "maxlength=\"128\"" : ""} value="${esc(value)}" aria-describedby="${hint ? `${name}-hint ${name}-error` : `${name}-error`}" /><div class="error" id="${name}-error"></div>${hint ? `<small class="field-hint" id="${name}-hint">${hint}</small>` : ""}</label>`;
}

function layout(title, description, content, footer) {
  host.innerHTML = `<div class="eyebrow">Secure account</div><h1 id="account-title">${title}</h1><p class="account-intro">${description}</p><div class="form-alert" data-message role="status" aria-live="polite" hidden></div>${content}<div class="account-switch">${footer}</div>`;
  icons();
}

function startCooldown(button, seconds = 60) {
  clearInterval(cooldownTimer);
  let remaining = seconds;
  button.disabled = true;
  button.textContent = `Resend available in ${remaining}s`;
  cooldownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(cooldownTimer);
      button.disabled = false;
      button.textContent = "Resend code";
    } else {
      button.textContent = `Resend available in ${remaining}s`;
    }
  }, 1000);
}

function renderSignUp() {
  flow = "signup";
  layout("Create your account", "Use your work identity to protect your brand operations.", `<form id="account-form" novalidate>
    ${field("fullName", "Full name", "text", { autocomplete: "name" })}
    ${field("email", "Primary email", "email", { autocomplete: "email" })}
    ${field("backupEmail", "Backup email", "email", { required: false, autocomplete: "email", hint: "Optional. It is not verified by adding it here and will not receive recovery codes until separately verified." })}
    ${field("password", "Password", "password", { autocomplete: "new-password", hint: "Use at least 12 characters." })}
    ${field("confirmPassword", "Confirm password", "password", { autocomplete: "new-password" })}
    <label class="check-field"><input type="checkbox" name="emailUpdates" /><span>Email me product updates. This choice is optional and does not affect account security emails.</span></label>
    <button class="btn btn-primary account-submit" type="submit"><i data-lucide="user-round-plus"></i>Create account</button>
  </form>`, `Already registered? <a href="/signin">Sign in</a>`);
  const form = host.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const password = form.elements.password.value;
    const confirmPassword = form.elements.confirmPassword.value;
    const errors = {};
    if (!String(values.fullName || "").trim()) errors.fullName = "Enter your full name";
    if (password.length < 12) errors.password = "Use at least 12 characters";
    if (password.length > 128) errors.password = "Password must be 128 characters or fewer";
    if (password !== confirmPassword) errors.confirmPassword = "Passwords do not match";
    if (values.backupEmail && String(values.backupEmail).trim().toLowerCase() === String(values.email).trim().toLowerCase()) errors.backupEmail = "Use a different email address";
    if (Object.keys(errors).length) return showErrors(form, errors);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    message("Creating your account…");
    try {
      const result = await api("/auth/signup", { method: "POST", body: {
        fullName: String(values.fullName).trim(),
        email: String(values.email).trim(),
        backupEmail: String(values.backupEmail || "").trim(),
        password,
        confirmPassword,
        emailUpdates: values.emailUpdates === "on",
      } });
      email = result.email;
      sessionStorage.setItem("account-email", email);
      location.href = `/verify-email?email=${encodeURIComponent(email)}`;
    } catch (error) {
      if (error.fields) showErrors(form, error.fields);
      message(errorMessage(error), "error");
      button.disabled = false;
    }
  });
}

function renderSignIn() {
  flow = "signin";
  layout("Sign in", "Access your private risk operations workspace.", `<form id="account-form" novalidate>
    ${field("email", "Email", "email", { autocomplete: "email", value: email })}
    ${field("password", "Password", "password", { autocomplete: "current-password" })}
    <div class="account-inline"><a href="/forgot-password">Forgot password?</a></div>
    <button class="btn btn-primary account-submit" type="submit"><i data-lucide="log-in"></i>Sign in</button>
  </form>`, `New to Pixel Pirates? <a href="/signup">Create an account</a>`);
  const form = host.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    message("Signing in…");
    try {
      await api("/auth/signin", { method: "POST", body: { email: String(values.email).trim(), password: form.elements.password.value } });
      location.replace(safeNext());
    } catch (error) {
      message(errorMessage(error), "error");
      button.disabled = false;
    }
  });
}

function renderVerification() {
  flow = "verify-email";
  layout("Verify your email", `Enter the six-digit code sent to <strong>${esc(email || "your primary email")}</strong>. It expires in 10 minutes.`, `<form id="account-form" novalidate>
    ${field("code", "Verification code", "text", { autocomplete: "one-time-code", hint: "The code is valid once. Check your spam folder if it is not in your inbox." })}
    <button class="btn btn-primary account-submit" type="submit"><i data-lucide="badge-check"></i>Verify email</button>
    <button class="btn btn-ghost resend-button" type="button">Resend code</button>
  </form>`, `Wrong address? <a href="/signup">Create a new account</a>`);
  const form = host.querySelector("form");
  form.elements.code.maxLength = 6;
  form.elements.code.inputMode = "numeric";
  const resend = form.querySelector(".resend-button");
  resend.addEventListener("click", async () => {
    try {
      await api("/auth/resend-verification", { method: "POST", body: { email } });
      message("If the account needs verification, a new code has been sent.");
      startCooldown(resend);
    } catch (error) { message(errorMessage(error), "error"); }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = form.elements.code.value.trim();
    if (!/^\d{6}$/.test(code)) return showErrors(form, { code: "Enter the six-digit code" });
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/auth/verify-email", { method: "POST", body: { email, code } });
      location.replace("/dashboard");
    } catch (error) {
      if (error.fields) showErrors(form, error.fields);
      message(errorMessage(error), "error");
      button.disabled = false;
    }
  });
}

function renderForgot() {
  flow = "forgot-password";
  layout("Recover your account", "We will send a short-lived recovery code to your registered primary email and, if verified, your backup email.", `<p class="recovery-note">Access to at least one registered recovery inbox is required. You do not need both inboxes.</p><form id="account-form" novalidate>
    ${field("email", "Primary email", "email", { autocomplete: "email", value: email })}
    <button class="btn btn-primary account-submit" type="submit"><i data-lucide="mail"></i>Send recovery code</button>
  </form>`, `Remembered your password? <a href="/signin">Back to sign in</a>`);
  const form = host.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    email = form.elements.email.value.trim();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    message("Requesting recovery code…");
    try {
      const result = await api("/auth/forgot-password", { method: "POST", body: { email } });
      sessionStorage.setItem("account-email", email);
      renderRecoveryCode();
      message(result.message);
    } catch (error) {
      message(errorMessage(error), "error");
      button.disabled = false;
    }
  });
}

function renderRecoveryCode() {
  flow = "recovery-code";
  layout("Enter your recovery code", `If an eligible account matches <strong>${esc(email)}</strong>, a code was sent to its primary email and any verified backup email. It expires in 10 minutes.`, `<form id="account-form" novalidate>
    ${field("code", "Recovery code", "text", { autocomplete: "one-time-code" })}
    <button class="btn btn-primary account-submit" type="submit"><i data-lucide="key-round"></i>Verify code</button>
    <button class="btn btn-ghost resend-button" type="button">Resend code</button>
  </form>`, `Need to start over? <a href="/forgot-password">Use another email</a>`);
  const form = host.querySelector("form");
  form.elements.code.maxLength = 6;
  form.elements.code.inputMode = "numeric";
  const resend = form.querySelector(".resend-button");
  resend.addEventListener("click", async () => {
    try {
      const result = await api("/auth/forgot-password", { method: "POST", body: { email } });
      message(result.message);
      startCooldown(resend);
    } catch (error) { message(errorMessage(error), "error"); }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = form.elements.code.value.trim();
    if (!/^\d{6}$/.test(code)) return showErrors(form, { code: "Enter the six-digit code" });
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const result = await api("/auth/verify-reset", { method: "POST", body: { email, code } });
      resetToken = result.resetToken;
      renderNewPassword();
      message("Code verified. Choose a new password.");
    } catch (error) {
      if (error.fields) showErrors(form, error.fields);
      message(errorMessage(error), "error");
      button.disabled = false;
    }
  });
}

function renderNewPassword() {
  flow = "new-password";
  layout("Choose a new password", "Your recovery code was accepted. Set a new password to finish.", `<form id="account-form" novalidate>
    ${field("password", "New password", "password", { autocomplete: "new-password", hint: "Use at least 12 characters." })}
    ${field("confirmPassword", "Confirm new password", "password", { autocomplete: "new-password" })}
    <button class="btn btn-primary account-submit" type="submit"><i data-lucide="lock-keyhole"></i>Update password</button>
  </form>`, `Changed your mind? <a href="/signin">Back to sign in</a>`);
  const form = host.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = form.elements.password.value;
    const confirmPassword = form.elements.confirmPassword.value;
    const errors = {};
    if (password.length < 12) errors.password = "Use at least 12 characters";
    if (password.length > 128) errors.password = "Password must be 128 characters or fewer";
    if (password !== confirmPassword) errors.confirmPassword = "Passwords do not match";
    if (Object.keys(errors).length) return showErrors(form, errors);
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await api("/auth/reset-password", { method: "POST", body: { resetToken, password, confirmPassword } });
      resetToken = "";
      layout("Password updated", "Your existing sessions have been signed out. Sign in again using your new password.", `<a class="btn btn-primary account-submit" href="/signin">Continue to sign in</a>`, "");
    } catch (error) {
      if (error.fields) showErrors(form, error.fields);
      message(errorMessage(error), "error");
      button.disabled = false;
    }
  });
}

if (["signin", "signup"].includes(flow)) {
  api("/auth/session").then(({ user }) => { if (user) location.replace("/dashboard"); }).catch(() => {});
}

switch (flow) {
  case "signup": renderSignUp(); break;
  case "verify-email": renderVerification(); break;
  case "forgot-password": renderForgot(); break;
  case "reset-password": renderForgot(); break;
  default: renderSignIn();
}
