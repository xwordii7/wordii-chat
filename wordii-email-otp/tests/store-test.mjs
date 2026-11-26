import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let source = await readFile(
  new URL("../src/store.js", import.meta.url),
  "utf8"
);

source = source.replace(
  'import { DurableObject } from "cloudflare:workers";',
  'class DurableObject {}'
);

source = source.replace(
  '"./otp.js"',
  JSON.stringify(new URL("../src/otp.js", import.meta.url).href)
);

const { OTPStore } = await import(
  "data:text/javascript;base64," +
  Buffer.from(source).toString("base64")
);

function makeStore() {
  const data = new Map();

  const storage = {
    async transaction(fn) {
      return fn({
        async get(key) {
          return structuredClone(data.get(key));
        },
        async put(key, value) {
          data.set(key, structuredClone(value));
        }
      });
    }
  };

  return {
    store: new OTPStore(
      { storage },
      { OTP_HMAC_SECRET: "test-secret-".repeat(8) }
    ),
    data
  };
}

const uid = "test-user";
const email = "test@example.com";

const { store, data } = makeStore();

const r = await store.reserve(uid, email);
assert(r.ok);
assert(/^\d{6}$/.test(r.otp));

assert(!(await store.reserve(uid, email)).ok);
console.log("PASS: Resend cooldown");

assert(await store.attachCode(
  uid, email, r.nonce, "mock-action-code"
));

assert(!(await store.verify(
  uid, "wrong@example.com", r.otp
)).ok);
console.log("PASS: Email binding");

const result = await store.verify(uid, email, r.otp);
assert(result.ok);
assert.equal(result.oobCode, "mock-action-code");

assert((await store.verify(uid, email, r.otp)).ok);
console.log("PASS: Temporary failure recovery");

assert(await store.complete(uid, r.nonce));
assert(!(await store.verify(uid, email, r.otp)).ok);
console.log("PASS: OTP invalidation");

const second = makeStore();
const r2 = await second.store.reserve(uid, email);

await second.store.attachCode(
  uid, email, r2.nonce, "mock-code"
);

const wrong = r2.otp === "000000" ? "111111" : "000000";

for (let i = 0; i < 5; i++) {
  assert(!(await second.store.verify(uid, email, wrong)).ok);
}

assert(!(await second.store.verify(uid, email, r2.otp)).ok);
console.log("PASS: Five-attempt limit");

const third = makeStore();
const r3 = await third.store.reserve(uid, email);

const expired = third.data.get("account");
expired.expiresAt = Date.now() - 1;
third.data.set("account", expired);

assert(!(await third.store.verify(uid, email, r3.otp)).ok);
console.log("PASS: OTP expiry");

console.log("ALL MOCK STORAGE TESTS PASSED");
