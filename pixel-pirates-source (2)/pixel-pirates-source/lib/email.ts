import { HttpError } from "./http.js";

export async function sendSecurityCode(email: string, code: string, purpose: "verification" | "recovery") {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new HttpError(503, "Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM before using account email flows.");
  }

  const isVerification = purpose === "verification";
  const subject = isVerification ? "Verify your Pixel Pirates account" : "Pixel Pirates account recovery code";
  const heading = isVerification ? "Verify your email address" : "Reset your password";
  const explanation = isVerification
    ? "Enter this one-time code to verify your primary email address."
    : "Enter this one-time code to verify your recovery request. If a verified backup email is on your account, a copy was also sent there. Access to at least one of those inboxes is required.";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      html: `<div style="font-family:Arial,sans-serif;color:#182230;max-width:560px;margin:auto"><h1 style="font-size:22px">${heading}</h1><p>${explanation}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes and can only be used once. If you did not request it, you can ignore this email.</p></div>`,
      text: `${heading}\n\n${explanation}\n\nCode: ${code}\n\nThis code expires in 10 minutes and can only be used once.`,
    }),
  });
  if (!response.ok) {
    console.error("Security email delivery failed", response.status);
    throw new HttpError(503, "We could not deliver the email right now. Please try again later.");
  }
}
