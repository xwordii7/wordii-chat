const encoder = new TextEncoder();

export const OTP_CONFIG = Object.freeze({
  expiryMs: 5 * 60 * 1000,
  resendMs: 30 * 1000,
  maxAttempts: 5,
  maxSendsPerHour: 5,
  maxSendsPerDay: 10,
  globalDailyLimit: 250
});

export function generateOTP() {
  const buffer = new Uint32Array(1);
  const range = 1000000;
  const limit = Math.floor(4294967296 / range) * range;

  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);

  return String(buffer[0] % range).padStart(6, "0");
}

export async function hashOTP(secret, uid, email, nonce, otp) {
  if (!secret || secret.length < 32) {
    throw new Error("OTP secret unavailable");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const data = encoder.encode(
    JSON.stringify([uid, email, nonce, otp])
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    data
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  if (a.length !== b.length) return false;

  let result = 0;

  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

export function createNonce() {
  return crypto.randomUUID();
}

export function validOTP(otp) {
  return typeof otp === "string" && /^\d{6}$/.test(otp);
}
