import { DurableObject } from "cloudflare:workers";
import {
  OTP_CONFIG,
  generateOTP,
  hashOTP,
  createNonce,
  safeEqual,
  validOTP
} from "./otp.js";

export class OTPStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
  }

  async reserve(uid, email) {
    const now = Date.now();
    const otp = generateOTP();
    const nonce = createNonce();

    const hash = await hashOTP(
      this.env.OTP_HMAC_SECRET,
      uid, email, nonce, otp
    );

    return this.ctx.storage.transaction(async tx => {
      const old = await tx.get("account") || {};

      if (old.verifyingUntil > now) {
        return {
          ok: false,
          error: "Verification in progress. Please wait."
        };
      }

      const history = (old.history || [])
        .filter(t => now - t < 86400000);

      if (old.lastSent && now - old.lastSent < OTP_CONFIG.resendMs) {
        return {
          ok: false,
          error: "Please wait before resending"
        };
      }

      if (
        history.length >= OTP_CONFIG.maxSendsPerDay ||
        history.filter(t => now - t < 3600000).length
          >= OTP_CONFIG.maxSendsPerHour
      ) {
        return {
          ok: false,
          error: "Email limit reached"
        };
      }

      history.push(now);

      await tx.put("account", {
        uid,
        email,
        nonce,
        hash,
        history,
        attempts: 0,
        lastSent: now,
        expiresAt: now + OTP_CONFIG.expiryMs,
        used: false
      });

      return { ok: true, otp, nonce };
    });
  }


  async attachCode(uid, email, nonce, oobCode) {
    return this.ctx.storage.transaction(async tx => {
      const data = await tx.get("account");

      if (!data || data.used ||
          data.uid !== uid ||
          data.email !== email ||
          data.nonce !== nonce ||
          Date.now() >= data.expiresAt) {
        return false;
      }

      data.oobCode = oobCode;
      await tx.put("account", data);
      return true;
    });
  }

  async complete(uid, nonce) {
    return this.ctx.storage.transaction(async tx => {
      const data = await tx.get("account");

      if (!data || data.uid !== uid ||
          data.nonce !== nonce) return false;

      data.used = true;
      delete data.verifyingUntil;
      delete data.hash;
      delete data.oobCode;

      await tx.put("account", data);
      return true;
    });
  }

  async verify(uid, email, otp) {
    if (!validOTP(otp)) {
      return { ok: false, error: "Invalid code format" };
    }

    return this.ctx.storage.transaction(async tx => {
      const data = await tx.get("account");

      if (
        !data ||
        data.used ||
        data.uid !== uid ||
        data.email !== email ||
        Date.now() >= data.expiresAt
      ) {
        return {
          ok: false,
          error: "Code expired or unavailable"
        };
      }



      if (data.verifyingUntil > Date.now()) {
        return {
          ok: false,
          error: "Verification already in progress"
        };
      }

      if (data.attempts >= OTP_CONFIG.maxAttempts) {
        return {
          ok: false,
          error: "Attempt limit reached"
        };
      }

      const hash = await hashOTP(
        this.env.OTP_HMAC_SECRET,
        uid, email, data.nonce, otp
      );

      if (!safeEqual(hash, data.hash)) {
        data.attempts++;
        await tx.put("account", data);

        return {
          ok: false,
          error: "Incorrect verification code",
          remaining: Math.max(
            0,
            OTP_CONFIG.maxAttempts - data.attempts
          )
        };
      }

      if (!data.oobCode) {
        return {
          ok: false,
          error: "Code not ready. Please resend."
        };
      }

      data.verifyingUntil = Date.now() + 30000;
      await tx.put("account", data);

      return {
        ok: true,
        oobCode: data.oobCode,
        nonce: data.nonce
      };
    });
  }

  async releaseVerification(uid, nonce) {
    return this.ctx.storage.transaction(async tx => {
      const data = await tx.get("account");

      if (!data || data.used ||
          data.uid !== uid ||
          data.nonce !== nonce) return false;

      delete data.verifyingUntil;
      await tx.put("account", data);
      return true;
    });
  }

  async reserveGlobal() {
    const now = Date.now();

    return this.ctx.storage.transaction(async tx => {
      const history = (
        await tx.get("globalHistory") || []
      ).filter(t => now - t < 86400000);

      if (history.length >= OTP_CONFIG.globalDailyLimit) {
        return { ok: false };
      }

      history.push(now);
      await tx.put("globalHistory", history);

      return { ok: true };
    });
  }
}
