// Wordii Chat - trusted backend. All points, shop, referral and connect logic lives here.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const DAILY = 4, MINUTE = 1, REFERRAL = 50, MAX_REFERRALS = 20;
const CODE_TTL = 10 * 60 * 1000;

const CATALOG = [
  { id: "logo_bolt", name: "Bolt Logo", type: "logo", slot: "logo", price: 80, rarity: "common", emoji: "⚡" },
  { id: "logo_ghost", name: "Ghost Logo", type: "logo", slot: "logo", price: 90, rarity: "common", emoji: "👻" },
  { id: "logo_crown", name: "Crown Logo", type: "logo", slot: "logo", price: 150, rarity: "rare", emoji: "👑" },
  { id: "design_dusk", name: "Dusk Card", type: "design", slot: "design", price: 100, rarity: "common", bg: "linear-gradient(135deg,#2a0a4a,#0a0612)" },
  { id: "design_neon", name: "Neon Violet Card", type: "design", slot: "design", price: 220, rarity: "epic", bg: "linear-gradient(135deg,#7b2cff,#ff2bd6)" },
  { id: "design_aurora", name: "Aurora Card", type: "design", slot: "design", price: 350, rarity: "legendary", bg: "linear-gradient(135deg,#00e5ff,#7b2cff,#ff2bd6)" },
  { id: "theme_violet", name: "Royal Violet", type: "theme", slot: "theme", price: 120, rarity: "rare", color: "#a855f7" },
  { id: "theme_cyber", name: "Cyber Cyan", type: "theme", slot: "theme", price: 260, rarity: "epic", color: "#22e0ff" },
  { id: "theme_gold", name: "Midas Gold", type: "theme", slot: "theme", price: 500, rarity: "legendary", color: "#ffc83d" },
  { id: "badge_fire", name: "Fire Badge", type: "emoji", slot: "badge", price: 80, rarity: "common", emoji: "🔥" },
  { id: "badge_star", name: "Star Badge", type: "emoji", slot: "badge", price: 90, rarity: "common", emoji: "⭐" },
  { id: "badge_gem", name: "Gem Badge", type: "emoji", slot: "badge", price: 200, rarity: "rare", emoji: "💎" },
  { id: "gif_spin", name: "Spinning Vortex", type: "gif", slot: "badge", price: 300, rarity: "epic", emoji: "🌀", anim: "spin" },
  { id: "gif_pulse", name: "Pulse Heart", type: "gif", slot: "badge", price: 380, rarity: "epic", emoji: "💜", anim: "pulse" },
  { id: "gif_bounce", name: "Rocket Bounce", type: "gif", slot: "badge", price: 450, rarity: "legendary", emoji: "🚀", anim: "bounce" },
];

const need = (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Please sign in first.");
  return req.auth.uid;
};
const levelOf = (earned) => Math.floor(earned / 10) + 1;
const dayStr = (d) => d.toISOString().slice(0, 10); // UTC day

// Adds points + level inside a transaction (call after all reads).
function award(tx, ref, u, amount, type, extra = {}) {
  const totalEarned = (u.totalEarned || 0) + amount;
  tx.update(ref, { points: (u.points || 0) + amount, totalEarned, level: levelOf(totalEarned), ...extra });
  tx.set(db.collection("rewards").doc(), { uid: ref.id, type, amount, at: FieldValue.serverTimestamp() });
}

async function ensureShop() {
  const first = await db.collection("shopItems").doc(CATALOG[0].id).get();
  if (first.exists) return;
  const b = db.batch();
  CATALOG.forEach((i) => b.set(db.collection("shopItems").doc(i.id), i));
  await b.commit();
}

async function makeCode(uid) {
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(db.doc(`users/${uid}`));
    if (!userSnap.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    const privRef = db.doc(`users/${uid}/private/connect`);
    const old = await tx.get(privRef);
    const cands = [];
    while (cands.length < 6) {
      const c = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      if (!cands.includes(c)) cands.push(c);
    }
    const refs = cands.map((c) => db.collection("connectCodes").doc(c));
    const snaps = await tx.getAll(...refs);
    const i = snaps.findIndex((s) => !s.exists || s.data().expiresAt < Date.now());
    if (i < 0) throw new HttpsError("unavailable", "Try again in a moment.");
    if (old.exists && old.data().code) tx.delete(db.collection("connectCodes").doc(old.data().code));
    const expiresAt = Date.now() + CODE_TTL;
    tx.set(refs[i], { uid, expiresAt });
    tx.set(privRef, { code: cands[i], expiresAt });
    return { code: cands[i], expiresAt };
  });
}

exports.createProfile = onCall(async (req) => {
  const uid = need(req);
  const name = String(req.data?.name || "").trim().toLowerCase();
  const refCode = String(req.data?.referral || "").trim().toUpperCase();
  if (!/^[a-z0-9_]{3,15}$/.test(name)) {
    throw new HttpsError("invalid-argument", "Name must be 3-15 letters, numbers or _.");
  }
  await ensureShop();
  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (tx) => {
    if ((await tx.get(userRef)).exists) throw new HttpsError("already-exists", "Profile already exists.");

    const tags = [];
    while (tags.length < 8) {
      const t = String(crypto.randomInt(100, 1000));
      if (!tags.includes(t)) tags.push(t);
    }
    const nameRefs = tags.map((t) => db.collection("usernames").doc(`${name}-${t}`));
    const snaps = await tx.getAll(...nameRefs);
    const idx = snaps.findIndex((s) => !s.exists);
    if (idx < 0) throw new HttpsError("resource-exhausted", "That name is crowded. Try another.");

    let inviter = null;
    if (refCode) {
      const q = await tx.get(db.collection("users").where("referralCode", "==", refCode).limit(1));
      if (!q.empty && q.docs[0].id !== uid && (q.docs[0].data().referralCount || 0) < MAX_REFERRALS) {
        inviter = q.docs[0];
      }
    }

    tx.set(nameRefs[idx], { uid, createdAt: FieldValue.serverTimestamp() });
    tx.set(userRef, {
      username: `@${name}#${tags[idx]}`,
      points: 0, totalEarned: 0, level: 1, streak: 0,
      lastLoginDay: "", lastMinuteAt: 0,
      owned: [], equipped: {},
      referralCode: crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 8),
      referralCount: 0,
      referredBy: inviter ? inviter.id : null,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (inviter) {
      award(tx, inviter.ref, inviter.data(), REFERRAL, "referral", { referralCount: FieldValue.increment(1) });
      tx.set(db.doc(`referrals/${uid}`), {
        inviterUid: inviter.id, inviteeUid: uid, amount: REFERRAL, createdAt: FieldValue.serverTimestamp(),
      });
    }
    return { username: `@${name}#${tags[idx]}` };
  });
});

exports.refreshCode = onCall(async (req) => makeCode(need(req)));

exports.connectWithCode = onCall(async (req) => {
  const uid = need(req);
  const code = String(req.data?.code || "").trim();
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the 6-digit code.");

  const result = await db.runTransaction(async (tx) => {
    const limRef = db.doc(`users/${uid}/private/limits`);
    const codeRef = db.collection("connectCodes").doc(code);
    const [me, lim, codeSnap] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(limRef), tx.get(codeRef)]);
    const now = Date.now();
    let l = lim.exists ? lim.data() : { count: 0, start: now };
    if (now - l.start > 10 * 60 * 1000) l = { count: 0, start: now };
    if (l.count >= 10) return { fail: ["resource-exhausted", "Too many wrong codes. Wait 10 minutes."] };
    if (!me.exists) return { fail: ["failed-precondition", "Create your profile first."] };
    if (!codeSnap.exists || codeSnap.data().expiresAt < now) {
      tx.set(limRef, { count: l.count + 1, start: l.start });
      return { fail: ["not-found", "Code is wrong or expired."] };
    }
    const friend = codeSnap.data().uid;
    if (friend === uid) return { fail: ["invalid-argument", "You can't use your own code."] };

    const chatId = [uid, friend].sort().join("_");
    const chatRef = db.doc(`chats/${chatId}`);
    const chat = await tx.get(chatRef);
    if (!chat.exists) tx.set(chatRef, { members: [uid, friend].sort(), createdAt: FieldValue.serverTimestamp() });
    tx.delete(codeRef);
    tx.set(db.doc(`users/${friend}/private/connect`), { code: "", expiresAt: 0 }, { merge: true });
    tx.set(limRef, { count: 0, start: now });
    return { chatId };
  });
  if (result.fail) throw new HttpsError(...result.fail);
  return result;
});

exports.claimDaily = onCall(async (req) => {
  const uid = need(req);
  const ref = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    const u = s.data();
    const today = dayStr(new Date());
    if (u.lastLoginDay === today) return { claimed: false, streak: u.streak };
    const yesterday = dayStr(new Date(Date.now() - 86400000));
    const streak = u.lastLoginDay === yesterday ? (u.streak || 0) + 1 : 1;
    award(tx, ref, u, DAILY, "daily", { streak, lastLoginDay: today });
    return { claimed: true, streak };
  });
});

// Called by the app once a minute while it is open. Server allows at most 1 point per ~minute.
exports.heartbeat = onCall(async (req) => {
  const uid = need(req);
  const ref = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    const u = s.data();
    const now = Date.now();
    if (now - (u.lastMinuteAt || 0) < 55000) return { awarded: false };
    award(tx, ref, u, MINUTE, "minute", { lastMinuteAt: now });
    return { awarded: true };
  });
});

exports.buyItem = onCall(async (req) => {
  const uid = need(req);
  const item = CATALOG.find((i) => i.id === req.data?.itemId);
  if (!item) throw new HttpsError("not-found", "No such item.");
  const ref = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    const u = s.data();
    if ((u.owned || []).includes(item.id)) throw new HttpsError("already-exists", "You already own this.");
    if ((u.points || 0) < item.price) throw new HttpsError("failed-precondition", "Not enough points.");
    tx.update(ref, { points: u.points - item.price, owned: FieldValue.arrayUnion(item.id) });
    tx.set(db.collection("rewards").doc(), { uid, type: "purchase", amount: -item.price, item: item.id, at: FieldValue.serverTimestamp() });
    return { ok: true };
  });
});

exports.equipItem = onCall(async (req) => {
  const uid = need(req);
  const item = CATALOG.find((i) => i.id === req.data?.itemId);
  if (!item) throw new HttpsError("not-found", "No such item.");
  const ref = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || !(s.data().owned || []).includes(item.id)) {
      throw new HttpsError("permission-denied", "You don't own this item.");
    }
    tx.update(ref, { [`equipped.${item.slot}`]: item.id });
    return { ok: true };
  });
});
