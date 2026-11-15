"use strict";
// Wordii Chat push server (runs free on Render). It watches Firestore and sends
// phone notifications (Web Push) for new messages, chat requests and incoming calls,
// even when the app is closed. It never sees message text (messages are only symbols).
const express = require("express");
const admin = require("firebase-admin");
const webpush = require("web-push");
const fs = require("fs");

function loadServiceAccount() {
  const env = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (env) {
    try { return JSON.parse(env); } catch (e) {}
    try { return JSON.parse(Buffer.from(env, "base64").toString("utf8")); } catch (e) {}
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
  }
  for (const p of ["/etc/secrets/serviceAccount.json", "./serviceAccount.json"]) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new Error("Firebase service account not found. Add it as a Render Secret File named serviceAccount.json.");
}

admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
const db = admin.firestore();

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error("Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Render > Environment.");
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://wordii-chat.web.app", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ---- tiny web server: Render needs it, and a pinger hits /health to keep it awake ----
const app = express();
app.get("/", (req, res) => res.send("Wordii push server is running"));
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now() }));
app.listen(process.env.PORT || 3000, () => console.log("listening"));

// ---- helpers ----
const START = Date.now(), CATCHUP = 2 * 60 * 1000; // after a restart, still notify things from the last 2 minutes
const names = new Map();
async function nameOf(uid) {
  const hit = names.get(uid);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.n;
  const d = (await db.doc(`users/${uid}`).get()).data() || {};
  const n = d.displayName || d.username || "Someone";
  names.set(uid, { n, t: Date.now() });
  return n;
}
async function pushTo(uid, payload) {
  const ref = db.doc(`users/${uid}/private/push`);
  const subs = ((await ref.get()).data() || {}).subs || [];
  if (!subs.length) return;
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(s, JSON.stringify(payload), { TTL: payload.call ? 45 : 3600, urgency: "high" });
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) dead.push(s.endpoint);
      else console.warn("push failed", e.statusCode || e.message);
    }
  }));
  if (dead.length) await ref.set({ subs: subs.filter((s) => !dead.includes(s.endpoint)) });
}
const safe = (p) => p.catch((e) => console.error(e && e.message ? e.message : e));

// ---- new messages (the app stamps lastAt/lastBy on the chat for every message) ----
const lastSeenAt = new Map();
db.collection("chats").onSnapshot((snap) => {
  snap.docChanges().forEach((ch) => safe((async () => {
    if (ch.type === "removed") return;
    const d = ch.doc.data(), id = ch.doc.id, ms = d.lastAt && d.lastAt.toMillis ? d.lastAt.toMillis() : 0;
    const prev = lastSeenAt.get(id);
    lastSeenAt.set(id, ms);
    if (!d.lastBy || !ms) return;
    const isNew = prev === undefined ? ms > START - CATCHUP : ms > prev;
    if (!isNew) return;
    const sender = await nameOf(d.lastBy);
    const payload = d.group ? { title: d.name || "Group", body: `${sender}: new message`, tag: id } : { title: sender, body: "New message", tag: id };
    for (const m of d.members || []) if (m !== d.lastBy) safe(pushTo(m, payload));
  })()));
}, (e) => console.error("chats listener:", e.message));

// ---- chat requests ----
let reqReady = false;
db.collection("requests").onSnapshot((snap) => {
  snap.docChanges().forEach((ch) => safe((async () => {
    if (ch.type !== "added") return;
    const d = ch.doc.data(), t = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0;
    if (!reqReady && t < START - CATCHUP) return;
    await pushTo(d.to, { title: "Chat request", body: `${await nameOf(d.from)} wants to chat`, tag: "req" });
  })()));
  reqReady = true;
}, (e) => console.error("requests listener:", e.message));

// ---- incoming calls ----
db.collection("calls").where("status", "==", "ringing").onSnapshot((snap) => {
  snap.docChanges().forEach((ch) => safe((async () => {
    if (ch.type !== "added") return;
    const d = ch.doc.data(), t = d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0;
    if (Date.now() - t > 40000) return;
    await pushTo(d.callee, { title: `Incoming ${d.type === "video" ? "video" : "voice"} call`, body: `${await nameOf(d.caller)} is calling you`, tag: "call", call: true });
  })()));
}, (e) => console.error("calls listener:", e.message));

process.on("unhandledRejection", (e) => console.error("unhandled:", e));
