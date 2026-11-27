import { SignJWT, importPKCS8 } from "jose";

async function getAccessToken(env) {
  const sa = JSON.parse(env.FIREBASE_OTP_SERVICE_ACCOUNT);

  if (sa.project_id !== env.FIREBASE_PROJECT_ID) {
    throw new Error("Firebase project mismatch");
  }

  const key = await importPKCS8(sa.private_key, "RS256");

  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/identitytoolkit"
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);

  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    }
  );

  if (!response.ok) {
    throw new Error("Firebase authorization failed");
  }

  const data = await response.json();
  return data.access_token;
}

async function firebaseRequest(env, action, body) {
  const token = await getAccessToken(env);
  const project = env.FIREBASE_PROJECT_ID;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:${action}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    throw new Error("Firebase account operation failed");
  }

  return response.json();
}

export async function getFirebaseUser(env, uid) {
  const result = await firebaseRequest(env, "lookup", {
    localId: [uid]
  });

  const user = result.users?.[0];

  if (!user || user.disabled) {
    throw new Error("Account unavailable");
  }

  return user;
}


export async function createVerificationCode(env, uid, email) {
  const user = await getFirebaseUser(env, uid);

  if (user.email !== email || user.emailVerified === true) {
    throw new Error("Account state changed");
  }

  const result = await firebaseRequest(env, "sendOobCode", {
    requestType: "VERIFY_EMAIL",
    email,
    returnOobLink: true
  });

  const code = result.oobCode ||
    new URL(result.oobLink).searchParams.get("oobCode");

  if (!code) {
    throw new Error("Verification code unavailable");
  }

  return code;
}

export async function markEmailVerified(env, uid, email, oobCode) {
  const user = await getFirebaseUser(env, uid);

  if (user.email !== email) {
    throw new Error("Account email changed");
  }

  if (user.emailVerified === true) {
    return true;
  }

  if (!oobCode) {
    throw new Error("Missing verification action code");
  }

  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:update?key=" +
      encodeURIComponent(env.FIREBASE_API_KEY),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ oobCode })
    }
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const reason = String(data.error?.message || "UNKNOWN")
      .split(" ")[0];

    console.error("Firebase verification failed", {
      status: response.status,
      reason: /^[A-Z0-9_]+$/.test(reason) ? reason : "UNKNOWN"
    });

    const latest = await getFirebaseUser(env, uid);

    if (latest.email === email &&
        latest.emailVerified === true) {
      return true;
    }

    throw new Error("Firebase action code rejected");
  }

  const confirmed = await getFirebaseUser(env, uid);

  if (
    confirmed.email !== email ||
    confirmed.emailVerified !== true
  ) {
    throw new Error("Verification confirmation failed");
  }

  return true;
}
