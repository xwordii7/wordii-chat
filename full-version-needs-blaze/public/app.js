import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";
import { encodeMessage, decodeMessage, isSymbolMessage } from "./codec.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastTimer;
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600); }
function fatal(e) { $("#splash").innerHTML = `<div class="logo-big">Wordii<span>Chat</span></div><p class="muted">Could not start: ${esc(e.message || e)}</p>`; }
async function act(fn, btn) { if (btn) btn.disabled = true; try { await fn(); } catch (e) { toast(e.message || "Something went wrong"); } finally { if (btn) btn.disabled = false; } }
function copy(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  legacyCopy(text);
}
function legacyCopy(text) { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }

if (firebaseConfig.apiKey.startsWith("PASTE")) { fatal(new Error("Open public/firebase-config.js and paste your Firebase config.")); throw new Error("Missing Firebase config"); }
const app = initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app), fns = getFunctions(app);
const call = (name, data = {}) => httpsCallable(fns, name)(data).then((r) => r.data);

let uid = null, me = null, items = {}, chats = [], conn = null, started = false;
const friends = {}, friendUnsubs = {};

// ---------- auth + profile ----------
let authStarted = false;
onAuthStateChanged(auth, (u) => {
  if (!u) { signInAnonymously(auth).catch(fatal); return; }
  if (authStarted) return;
  authStarted = true; uid = u.uid;
  onSnapshot(doc(db, "users", uid), (s) => {
    $("#splash").classList.add("hidden");
    if (!s.exists()) { me = null; $("#app").classList.add("hidden"); $("#onboard").classList.remove("hidden"); return; }
    me = s.data();
    $("#onboard").classList.add("hidden"); $("#app").classList.remove("hidden");
    if (!started) { started = true; startApp(); }
    renderAll();
  }, fatal);
});

$("#refInput").value = (new URLSearchParams(location.search).get("ref") || "").toUpperCase();
$("#createBtn").onclick = (e) => act(async () => {
  await call("createProfile", { name: $("#nameInput").value, referral: $("#refInput").value });
}, e.currentTarget);

// ---------- app start ----------
function startApp() {
  onSnapshot(collection(db, "shopItems"), (s) => { items = {}; s.forEach((d) => (items[d.id] = d.data())); renderAll(); });
  onSnapshot(query(collection(db, "chats"), where("members", "array-contains", uid)), (s) => {
    chats = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    chats.forEach(watchFriend); renderChats();
  }, (e) => toast(e.message));
  onSnapshot(doc(db, "users", uid, "private", "connect"), (s) => { conn = s.exists() ? s.data() : null; renderCode(); maybeRefreshCode(); });
  claimDaily();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") claimDaily(true); });
  setInterval(heartbeat, 60000);
  setInterval(tickCode, 1000);
  setInterval(tickMessages, 400);
}
function claimDaily(silent) {
  call("claimDaily").then((r) => { if (r.claimed) toast(`Daily streak ${r.streak}! +4 points`); }).catch((e) => { if (!silent) toast(e.message); });
}
function heartbeat() { if (document.visibilityState === "visible" && document.hasFocus()) call("heartbeat").catch(() => {}); }
function watchFriend(chat) {
  const fid = chat.members.find((m) => m !== uid);
  if (!fid || friendUnsubs[fid]) return;
  friendUnsubs[fid] = onSnapshot(doc(db, "users", fid), (s) => { friends[fid] = s.data(); renderChats(); renderChatTitle(); });
}

// ---------- tabs ----------
$$(".bottom button").forEach((b) => (b.onclick = () => {
  $$(".bottom button").forEach((x) => x.classList.toggle("on", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== "tab-" + b.dataset.tab));
}));
function showTab(name) { $(`.bottom button[data-tab="${name}"]`).click(); }

// ---------- render helpers ----------
function badgeHTML(i) {
  if (!i) return "";
  return i.img ? `<img class="badge" src="${esc(i.img)}" alt="">` : `<span class="badge ${i.anim ? "anim-" + esc(i.anim) : ""}">${esc(i.emoji)}</span>`;
}
function avatarHTML(u, big) {
  const logo = items[u?.equipped?.logo], th = items[u?.equipped?.theme];
  const style = th ? ` style="--accent:${esc(th.color)}"` : "";
  return `<div class="avatar ${big ? "big" : ""}"${style}>${logo ? esc(logo.emoji) : esc(((u?.username || "?@")[1] || "?").toUpperCase())}</div>`;
}
function renderAll() { renderStats(); renderChats(); renderShop(); renderProfile(); }
function renderStats() { if (me) $("#topStats").textContent = `Lv ${me.level} · ${me.points} pts · 🔥 ${me.streak}`; }

// ---------- chats list ----------
function renderChats() {
  const box = $("#chatList"); if (!box) return;
  if (!chats.length) { box.innerHTML = `<div class="card center muted">No chats yet.<br>Open <b>Connect</b> and swap codes with a friend.</div>`; return; }
  box.innerHTML = chats.map((c) => {
    const fid = c.members.find((m) => m !== uid), f = friends[fid];
    return `<div class="row" data-chat="${esc(c.id)}">${avatarHTML(f)}<div class="grow"><b>${esc(f?.username || "…")}${badgeHTML(items[f?.equipped?.badge])}</b><span class="muted">Level ${esc(f?.level ?? "")}</span></div>›</div>`;
  }).join("");
}
$("#chatList").addEventListener("click", (e) => { const r = e.target.closest("[data-chat]"); if (r) openChat(chats.find((c) => c.id === r.dataset.chat)); });

// ---------- connect ----------
let refreshing = false, lastTry = 0;
function maybeRefreshCode() {
  if (!me || refreshing || (conn && conn.expiresAt > Date.now()) || Date.now() - lastTry < 5000) return;
  refreshing = true; lastTry = Date.now();
  call("refreshCode").catch((e) => toast(e.message)).finally(() => (refreshing = false));
}
function renderCode() { const ok = conn && conn.code && conn.expiresAt > Date.now(); $("#myCode").textContent = ok ? conn.code.slice(0, 3) + " " + conn.code.slice(3) : "······"; }
function tickCode() {
  if (!conn || conn.expiresAt <= Date.now()) { renderCode(); $("#codeTimer").textContent = "Making a new code…"; maybeRefreshCode(); return; }
  const s = Math.floor((conn.expiresAt - Date.now()) / 1000);
  $("#codeTimer").textContent = `Expires in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
$("#newCodeBtn").onclick = (e) => act(() => call("refreshCode"), e.currentTarget);
$("#connectBtn").onclick = (e) => act(async () => {
  const r = await call("connectWithCode", { code: $("#friendCode").value });
  $("#friendCode").value = ""; toast("Connected! 🎉"); showTab("chats");
}, e.currentTarget);

// ---------- shop ----------
const TYPES = [["logo", "Profile logos"], ["design", "Profile designs"], ["theme", "Rare profile themes"], ["emoji", "Emoji badges"], ["gif", "Animated badges"]];
function preview(i) {
  if (i.type === "design") return `<div class="pv" style="background:${esc(i.bg)}"></div>`;
  if (i.type === "theme") return `<div class="pv" style="background:${esc(i.color)}"></div>`;
  return `<div class="pv">${badgeHTML(i)}</div>`;
}
function renderShop() {
  if (!me) return;
  $("#shop").innerHTML = TYPES.map(([type, label]) => {
    const list = Object.entries(items).filter(([, i]) => i.type === type).sort((a, b) => a[1].price - b[1].price);
    if (!list.length) return "";
    return `<div class="shop-sec"><h3>${label}</h3><div class="grid">${list.map(([id, i]) => {
      const owned = (me.owned || []).includes(id), on = me.equipped?.[i.slot] === id;
      const btn = on ? `<button class="btn sm" disabled>Equipped ✓</button>`
        : owned ? `<button class="btn sm ghost" data-act="equip" data-id="${esc(id)}">Equip</button>`
        : `<button class="btn sm" data-act="buy" data-id="${esc(id)}" ${me.points < i.price ? "style='opacity:.6'" : ""}>${i.price} pts</button>`;
      return `<div class="item r-${esc(i.rarity)}">${preview(i)}<b>${esc(i.name)}</b><small>${esc(i.rarity)}</small>${btn}</div>`;
    }).join("")}</div></div>`;
  }).join("") || `<div class="card center muted">Loading shop…</div>`;
}
$("#shop").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-id]"); if (!b) return;
  act(async () => {
    if (b.dataset.act === "buy") { await call("buyItem", { itemId: b.dataset.id }); toast("Purchased! Tap Equip to use it."); }
    else { await call("equipItem", { itemId: b.dataset.id }); toast("Equipped ✨"); }
  }, b);
});

// ---------- profile ----------
function renderProfile() {
  if (!me) return;
  const design = items[me.equipped?.design], theme = items[me.equipped?.theme];
  const owned = (me.owned || []).map((id) => items[id]).filter(Boolean);
  const link = `${location.origin}/?ref=${me.referralCode}`;
  $("#profile").innerHTML = `
    <div class="hero" style="${theme ? "--accent:" + esc(theme.color) + ";" : ""}${design ? "background:" + esc(design.bg) : ""}">
      ${avatarHTML(me, true)}
      <h2>${esc(me.username)}${badgeHTML(items[me.equipped?.badge])}</h2>
      <div class="stats"><div><b>${me.level}</b><span>Level</span></div><div><b>${me.points}</b><span>Points</span></div><div><b>🔥 ${me.streak}</b><span>Streak</span></div><div><b>${me.totalEarned}</b><span>Earned</span></div></div>
      <div class="bar"><i style="width:${(me.totalEarned % 10) * 10}%"></i></div>
      <p class="tiny">${10 - (me.totalEarned % 10)} more points to Level ${me.level + 1}</p>
    </div>
    <div class="card"><b>Owned items</b><div class="chips" style="margin-top:10px">${owned.length ? owned.map((i) => `<span>${i.emoji ? esc(i.emoji) + " " : ""}${esc(i.name)}</span>`).join("") : "<span class='muted'>Nothing yet. Visit the Shop.</span>"}</div></div>
    <div class="card"><b>Refer &amp; earn 50 points</b>
      <p class="muted">Your code: <b style="color:var(--neon);letter-spacing:2px">${esc(me.referralCode)}</b></p>
      <button class="btn sm" data-copy="${esc(me.referralCode)}">Copy code</button> <button class="btn sm ghost" data-copy="${esc(link)}">Copy invite link</button>
      <p class="tiny">You get points when a new friend creates an account using your code.</p></div>
    <div class="card tiny">Earn points: +4 daily streak, +1 per active minute. Every 10 points earned = 1 level. Symbol messages are obfuscation, not encryption.</div>`;
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-copy]"); if (b) { copy(b.dataset.copy); toast("Copied"); } });

// ---------- chat ----------
let activeChat = null, unsubMsgs = null, msgs = [], msgMap = {}, reveal = {}, decoded = {};
function openChat(c) {
  if (!c) return;
  closeChat(); activeChat = c; reveal = {}; decoded = {}; msgs = []; msgMap = {};
  $("#chat").classList.remove("hidden"); renderChatTitle();
  unsubMsgs = onSnapshot(query(collection(db, "chats", c.id, "messages"), orderBy("createdAt", "asc"), limit(200)), (s) => {
    const until = Date.now() + 10000;
    s.docs.forEach((d) => { if (!(d.id in reveal)) reveal[d.id] = until; });
    msgs = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    msgMap = Object.fromEntries(msgs.map((m) => [m.id, m]));
    renderMessages();
  }, (e) => toast(e.message));
}
function closeChat() { if (unsubMsgs) unsubMsgs(); unsubMsgs = null; activeChat = null; $("#chat").classList.add("hidden"); }
$("#backBtn").onclick = closeChat;
function renderChatTitle() {
  if (!activeChat) return;
  const f = friends[activeChat.members.find((m) => m !== uid)];
  $("#chatTitle").innerHTML = `${avatarHTML(f)}<span>${esc(f?.username || "…")}${badgeHTML(items[f?.equipped?.badge])}</span>`;
}
function renderMessages() {
  const box = $("#msgs"), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = msgs.map((m) => {
    const t = m.createdAt?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "";
    return `<div class="msg ${m.senderId === uid ? "mine" : "theirs"}" data-id="${esc(m.id)}"><div class="bubble"></div><time>${t}</time></div>`;
  }).join("");
  tickMessages(true);
  if (atBottom || msgs.length) box.scrollTop = box.scrollHeight;
}
function plain(m) { return (decoded[m.id] ??= decodeMessage(m.text) ?? "⚠ unreadable message"); }
function tickMessages() {
  if (!activeChat) return;
  const now = Date.now();
  $$("#msgs .msg").forEach((el) => {
    const m = msgMap[el.dataset.id]; if (!m) return;
    const open = (reveal[m.id] || 0) > now, b = el.firstChild, txt = open ? plain(m) : m.text;
    if (b.textContent !== txt) b.textContent = txt;
    b.classList.toggle("open", open);
  });
}
let lp = null, longDone = false;
const mbox = $("#msgs");
mbox.addEventListener("contextmenu", (e) => e.preventDefault());
mbox.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".msg"); if (!el) return; longDone = false;
  lp = setTimeout(() => { longDone = true; copy(msgMap[el.dataset.id].text); toast("Symbol message copied"); }, 600);
});
["pointerup", "pointerleave", "pointercancel", "pointermove"].forEach((ev) => mbox.addEventListener(ev, () => clearTimeout(lp)));
mbox.addEventListener("click", (e) => {
  if (longDone) { longDone = false; return; }
  const el = e.target.closest(".msg"); if (!el) return;
  reveal[el.dataset.id] = Date.now() + 10000; tickMessages();
});

const input = $("#msgInput");
input.addEventListener("input", () => { // pasting a valid symbol message auto-decodes it
  if (isSymbolMessage(input.value)) { const t = decodeMessage(input.value); if (t !== null) { input.value = t; toast("Symbol message decoded"); } }
});
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || !activeChat) return;
  input.value = "";
  addDoc(collection(db, "chats", activeChat.id, "messages"), { senderId: uid, text: encodeMessage(text), createdAt: serverTimestamp() })
    .catch((err) => { toast(err.message); input.value = text; });
});
