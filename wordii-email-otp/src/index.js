import { verifyFirebaseToken } from "./auth.js";
import {
  getFirebaseUser,
  createVerificationCode,
  markEmailVerified
} from "./firebase.js";
import { sendOTPEmail } from "./mailer.js";
import { OTPStore } from "./store.js";
import { validOTP } from "./otp.js";

export { OTPStore };

const allowedOrigins = new Set([
  "https://wordii-chat.web.app",
  "https://wordii-chat.firebaseapp.com",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost"
]);

function reply(request, data, status = 200) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type"
  });

  const origin = request.headers.get("Origin");

  if (allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return new Response(
    status === 204 ? null : JSON.stringify(data),
    { status, headers }
  );
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const origin = request.headers.get("Origin");

    if (origin && !allowedOrigins.has(origin)) {
      return reply(request, {
        ok: false,
        error: "Origin not allowed"
      }, 403);
    }

    if (request.method === "OPTIONS") {
      return reply(request, null, 204);
    }

    if (path === "/health" && request.method === "GET") {
      return reply(request, {
        ok: true,
        service: "Wordii Email OTP",
        version: "1.0.0"
      });
    }

    if (
      request.method !== "POST" ||
      !["/send", "/verify"].includes(path)
    ) {
      return reply(request, {
        ok: false,
        error: "Not found"
      }, 404);
    }

    if (
      env.OTP_ENABLED !== "true" &&
      !env.OTP_TEST_UID
    ) {
      return reply(request, {
        ok: false,
        error: "OTP service is under testing"
      }, 503);
    }

    let identity;

    try {
      identity = await verifyFirebaseToken(request, env);
    } catch {
      return reply(request, {
        ok: false,
        error: "Unauthorized"
      }, 401);
    }

    try {
      if (
        env.OTP_ENABLED !== "true" &&
        identity.uid !== env.OTP_TEST_UID
      ) {
        return reply(request, {
          ok: false,
          error: "OTP service is under testing"
        }, 503);
      }

      const user = await getFirebaseUser(env, identity.uid);

      if (
        !Number.isFinite(identity.authTime) ||
        identity.authTime > Math.floor(Date.now() / 1000) ||
        identity.authTime < Number(user.validSince || 0)
      ) {
        return reply(request, {
          ok: false,
          error: "Session expired. Please log in again."
        }, 401);
      }

      if (
        !user.email ||
        user.email !== identity.email
      ) {
        return reply(request, {
          ok: false,
          error: "Account email mismatch"
        }, 403);
      }

      if (user.emailVerified === true) {
        return reply(request, {
          ok: true,
          verified: true
        });
      }

      const id = env.OTP_STORE.idFromName(
        "account:" + identity.uid
      );

      const store = env.OTP_STORE.get(id);

      if (path === "/send") {
        const reservation = await store.reserve(
          identity.uid,
          user.email
        );

        if (!reservation.ok) {
          return reply(request, reservation, 429);
        }

        const globalId = env.OTP_STORE.idFromName(
          "global-email-quota"
        );

        const globalStore = env.OTP_STORE.get(globalId);
        const quota = await globalStore.reserveGlobal();

        if (!quota.ok) {
          return reply(request, {
            ok: false,
            error: "Daily email limit reached"
          }, 429);
        }

        const oobCode = await createVerificationCode(
          env,
          identity.uid,
          user.email
        );

        const attached = await store.attachCode(
          identity.uid,
          user.email,
          reservation.nonce,
          oobCode
        );

        if (!attached) {
          return reply(request, {
            ok: false,
            error: "Request expired. Please resend."
          }, 409);
        }

        await sendOTPEmail(
          env,
          user.email,
          reservation.otp
        );

        return reply(request, {
          ok: true,
          expiresIn: 300,
          resendAfter: 30
        });
      }

      const reader = request.body?.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      let size = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          size += value.byteLength;

          if (size > 1024) {
            await reader.cancel();
            return reply(request, {
              ok: false,
              error: "Request too large"
            }, 413);
          }

          raw += decoder.decode(value, { stream: true });
        }

        raw += decoder.decode();
      }

      if (raw.length > 1024) {
        return reply(request, {
          ok: false,
          error: "Invalid request"
        }, 400);
      }

      let body;

      try {
        body = JSON.parse(raw);
      } catch {
        return reply(request, {
          ok: false,
          error: "Invalid request"
        }, 400);
      }

      if (!validOTP(body?.otp)) {
        return reply(request, {
          ok: false,
          error: "Enter a 6-digit code"
        }, 400);
      }

      const result = await store.verify(
        identity.uid,
        user.email,
        body.otp
      );

      if (!result.ok) {
        return reply(request, result, 400);
      }

      try {
        await markEmailVerified(
          env,
          identity.uid,
          user.email,
          result.oobCode
        );
      } catch (error) {
        await store.releaseVerification(
          identity.uid,
          result.nonce
        );
        throw error;
      }

      await store.complete(
        identity.uid,
        result.nonce
      );

      return reply(request, {
        ok: true,
        verified: true
      });

    } catch {
      return reply(request, {
        ok: false,
        error: "Service temporarily unavailable"
      }, 503);
    }
  }
};
