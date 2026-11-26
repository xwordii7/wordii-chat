export async function sendOTPEmail(env, email, otp) {
  if (!/^\d{6}$/.test(otp)) {
    throw new Error("Invalid OTP format");
  }

  const html = `
  <div style="background:#101010;padding:24px;font-family:Arial,sans-serif">
    <div style="max-width:480px;margin:auto;background:#191919;border-radius:16px;padding:28px;color:#ffffff;text-align:center">

      <h1 style="color:#ff304f;margin-bottom:4px">
        WORDII CHAT
      </h1>

      <p style="color:#aaaaaa">
        ACCOUNT SECURITY
      </p>

      <hr style="border:0;border-top:1px solid #333">

      <h2>Verify your email</h2>

      <p>Use the verification code below to verify your Wordii Chat account.</p>

      <div style="background:#262626;border:1px solid #ff304f;border-radius:12px;padding:20px;font-size:36px;font-weight:bold;letter-spacing:8px;color:#ff304f">
        ${otp}
      </div>

      <p>This code expires in 5 minutes.</p>

      <p style="color:#ffb74d;font-size:13px">
        Never share this verification code with anyone.
      </p>

      <p style="color:#aaaaaa;font-size:12px">
        If you did not request this code, you can safely ignore this email.
      </p>

      <hr style="border:0;border-top:1px solid #333">

      <p>Team Wordii Chat</p>

      <a href="https://wordii-hub.web.app"
         style="color:#ff304f">
         Official Website
      </a>

      <p style="color:#777;font-size:11px">
        © 2026 Wordii Chat
      </p>
    </div>
  </div>`;

  const response = await fetch(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: env.SENDER_NAME,
          email: env.SENDER_EMAIL
        },
        to: [{ email }],
        subject: "Wordii Chat - Email Verification",
        htmlContent: html,
        textContent: `Your Wordii Chat verification code is ${otp}. Valid for 5 minutes. Never share this code.`
      })
    }
  );

  if (!response.ok) {
    throw new Error("Email delivery request failed");
  }

  return true;
}
