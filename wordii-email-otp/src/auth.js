import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

export async function verifyFirebaseToken(request, env) {
  const header = request.headers.get("Authorization") || "";

  if (!header.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = header.slice(7).trim();
  const project = env.FIREBASE_PROJECT_ID;

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${project}`,
    audience: project,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "auth_time"]
  });

  if (
    !payload.sub ||
    payload.sub.length > 128 ||
    !payload.email ||
    payload.firebase?.sign_in_provider === "anonymous"
  ) {
    throw new Error("Invalid account");
  }

  return {
    uid: payload.sub,
    authTime: payload.auth_time,
    email: payload.email,
    verified: payload.email_verified === true
  };
}
