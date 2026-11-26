const PROD = process.env.NODE_ENV === "production";

/** Send a sign-in code through Resend. Without a key outside production, the code is printed to the server log. */
export async function sendCode(email, code) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (PROD) throw new Error("RESEND_API_KEY is not set");
    console.log(`[dev] Sign-in code for ${email}: ${code}`);
    return;
  }
  const from = process.env.EMAIL_FROM || "Cookie Repo <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: `${code} is your Cookie Repo code`,
      text: `Your Cookie Repo sign-in code is ${code}\n\nIt works for 10 minutes. If you didn't try to sign in, you can ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;font-size:16px;color:#1b2230">
        <p>Your Cookie Repo sign-in code is</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
        <p style="color:#5a6373">It works for 10 minutes. If you didn't try to sign in, you can ignore this email.</p></div>`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
