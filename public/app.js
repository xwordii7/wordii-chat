import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, linkWithCredential, EmailAuthProvider, signInWithEmailAndPassword, signOut, sendEmailVerification, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, getCountFromServer, setDoc, updateDoc, deleteDoc, writeBatch, increment, collection, query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { encodeMessage, decodeMessage, isSymbolMessage } from "./codec.js";
import { links, turnServers, vapidPublicKey } from "./links.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let toastTimer;
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600); }
function fatal(e) { $("#splash").classList.remove("hidden"); $("#splash").innerHTML = `<div class="logo-big">Wordii<span>Chat</span></div><p class="muted">Could not start: ${esc(e.message || e)}</p>`; }
function authMsg(c) {
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return "Wrong username or password.";
  if (c.includes("operation-not-allowed")) return "Turn on Email/Password in Firebase Authentication first.";
  if (c.includes("weak-password")) return "Password must be at least 6 characters.";
  if (/email-already-in-use|credential-already-in-use/.test(c)) return "This Gmail already has an account. Use Log in.";
  if (c.includes("too-many-requests")) return "Too many tries. Wait a few minutes.";
  return "Sign-in problem (" + c + ")";
}
function friendly(e) {
  if (String(e.code || "").startsWith("auth/")) return authMsg(e.code);
  return e.code === "permission-denied" ? "Not allowed (check the code or try again)." : e.message || "Something went wrong";
}
const vb = (u) => (u?.admin === true ? '<span class="abadge" title="Admin">★</span>' : "") + (u?.verified === true ? '<span class="vbadge" title="Verified">✔</span>' : "");
async function act(fn, btn) { if (btn) btn.disabled = true; try { await fn(); } catch (e) { toast(friendly(e)); } finally { if (btn) btn.disabled = false; } }
function legacyCopy(text) { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
function copy(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  legacyCopy(text);
}

if (firebaseConfig.apiKey.startsWith("PASTE")) { fatal(new Error("Open public/firebase-config.js and paste your Firebase config.")); throw new Error("Missing Firebase config"); }
const app = initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app);

let uid = null, me = null, chats = [], started = false, firstChats = true;
let lastSeenLevel = null;
const friends = {}, friendUnsubs = {};

// Level celebration appears only on a real level increase during this session.
function showLevelCelebration(level) {
  let panel = document.getElementById("wordiiLevelCelebration");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "wordiiLevelCelebration";
    panel.innerHTML = `<div class="wordii-level-card" role="dialog" aria-modal="true" aria-label="Level up"><div class="wordii-level-spark">✦ ✨ ✦</div><div class="wordii-level-trophy">🏆</div><div class="wordii-level-title">LEVEL UP!</div><div class="wordii-level-number"></div><p>Your journey just got brighter.</p><button type="button" class="btn wordii-level-close">Continue</button></div>`;
    document.body.appendChild(panel);
    panel.querySelector("button").addEventListener("click", () => panel.classList.remove("visible"));
    panel.addEventListener("click", (e) => { if (e.target === panel) panel.classList.remove("visible"); });
  }
  panel.querySelector(".wordii-level-number").textContent = `LEVEL ${level}`;
  panel.classList.add("visible");
}

// ---------- auth + profile ----------
let authStarted = false;
onAuthStateChanged(auth, (u) => {
  if (!u) { signInAnonymously(auth).catch(fatal); return; }
  if (authStarted) return;
  authStarted = true; uid = u.uid;
  onSnapshot(doc(db, "users", uid), (s) => {
    $("#splash").classList.add("hidden");
    if (!s.exists()) { me = null; $("#app").classList.add("hidden"); $("#onboard").classList.remove("hidden"); return; }
    const incoming = s.data();
    const currentLevel = Number(incoming.level) || 1;
    if (lastSeenLevel !== null && currentLevel > lastSeenLevel) showLevelCelebration(currentLevel);
    lastSeenLevel = currentLevel;
    me = incoming;
    $("#onboard").classList.add("hidden"); $("#app").classList.remove("hidden");
    if (!started) { started = true; startApp(); }
    renderProfile(); checkGate();
  }, fatal);
});

async function createProfile(raw) {
  const name = raw.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,15}$/.test(name)) throw new Error("Name must be 3-15 letters, numbers or _.");
  for (let i = 0; i < 8; i++) {
    const tag = String(100 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900));
    const key = `${name}-${tag}`;
    const b = writeBatch(db);
    b.set(doc(db, "usernames", key), { uid, createdAt: serverTimestamp() });
    b.set(doc(db, "users", uid), { username: `@${name}#${tag}`, usernameKey: key, createdAt: serverTimestamp() });
    try { await b.commit(); return key; } catch (e) { if (e.code !== "permission-denied") throw e; }
  }
  throw new Error("That name is busy. Try another one.");
}
// ---------- sign up / log in with Gmail (so you can recover your account) ----------
const emailFor = (key) => `${key}@wordii-chat.web.app`; // only for OLD accounts made before Gmail login
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const isFakeEmail = (e) => !!e && e.endsWith("@wordii-chat.web.app");
function keyFromUsername(raw) {
  const u = raw.trim().toLowerCase().replace(/^@/, "");
  const m = u.match(/^([a-z0-9_]{3,15})#(\d{3})$/);
  if (m) return `${m[1]}-${m[2]}`;
  if (/^[a-z0-9_]{3,15}$/.test(u)) return u;
  throw new Error("Type your username like @name#123, or use your Gmail.");
}
async function linkEmail(email, password) {
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid Gmail address.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");
  await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password));
  await sendEmailVerification(auth.currentUser).catch(() => {});
  checkGate();
}
const needsVerify = () => { const u = auth.currentUser; return !!u && !u.isAnonymous && !!u.email && !isFakeEmail(u.email) && !u.emailVerified; };
function checkGate() {
  const need = needsVerify();
  $("#verifyGate").classList.toggle("hidden", !need);
  if (need) $("#vgText").textContent = `We sent a link to ${auth.currentUser.email}. Open it, then tap "I verified".`;
}
$("#vgDone").onclick = (e) => act(async () => {
  await auth.currentUser.reload(); await auth.currentUser.getIdToken(true);
  if (needsVerify()) throw new Error("Not verified yet. Open the link in your email first.");
  checkGate(); toast("Gmail verified ✅"); renderProfile();
}, e.currentTarget);
$("#vgResend").onclick = (e) => act(async () => { await sendEmailVerification(auth.currentUser); toast("Email sent again. Check Spam too."); }, e.currentTarget);
$("#vgOut").onclick = () => signOut(auth).then(() => location.reload());
function setMode(m) {
  $("#paneNew").classList.toggle("hidden", m !== "new"); $("#paneLogin").classList.toggle("hidden", m !== "login");
  $("#modeNew").classList.toggle("on", m === "new"); $("#modeLogin").classList.toggle("on", m === "login");
  $("#paneAdmin").classList.add("hidden");
}
$("#modeNew").onclick = () => setMode("new");
$("#modeLogin").onclick = () => setMode("login");
$("#adminLink").onclick = (e) => { e.preventDefault(); $("#paneAdmin").classList.toggle("hidden"); };
$("#createBtn").onclick = (e) => act(async () => {
  const email = $("#newEmail").value.trim().toLowerCase(), pw = $("#newPw").value;
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid Gmail address.");
  if (pw.length < 6) throw new Error("Password must be at least 6 characters.");
  await createProfile($("#nameInput").value);
  try { await linkEmail(email, pw); } catch (err) { toast("Account made, but Gmail not saved: " + friendly(err)); }
  renderProfile();
}, e.currentTarget);
$("#loginBtn").onclick = (e) => act(async () => {
  const v = $("#loginName").value.trim();
  const email = EMAIL_RE.test(v) ? v.toLowerCase() : emailFor(keyFromUsername(v));
  await signInWithEmailAndPassword(auth, email, $("#loginPw").value);
  location.reload();
}, e.currentTarget);
$("#forgotLink").onclick = (e) => {
  e.preventDefault();
  const email = (prompt("Enter the Gmail you signed up with") || "").trim().toLowerCase();
  if (!email) return;
  act(async () => {
    if (!EMAIL_RE.test(email)) throw new Error("Enter a valid Gmail address.");
    await sendPasswordResetEmail(auth, email);
    toast("If this Gmail has an account, a reset link was sent. Check Spam too.");
  });
};
// Existing admins use their saved Firebase Gmail/password, never the creation key.
$("#adminLoginBtn").onclick = (e) => act(async () => {
  const email = $("#adminLoginEmail").value.trim().toLowerCase();
  const password = $("#adminLoginPw").value;
  if (!EMAIL_RE.test(email)) throw new Error("Enter your existing admin Gmail.");
  if (!password) throw new Error("Enter your admin password.");
  const result = await signInWithEmailAndPassword(auth, email, password);
  const profile = await getDoc(doc(db, "users", result.user.uid));
  if (!profile.exists() || profile.data().admin !== true) {
    // Do not revoke a valid regular account; this screen only permits admins.
    await signOut(auth);
    throw new Error("This Gmail does not have an admin profile. Use regular Log in.");
  }
  location.reload();
}, e.currentTarget);
$("#adminForgotLink").onclick = (e) => {
  e.preventDefault();
  act(async () => {
    const email = $("#adminLoginEmail").value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error("Enter your admin Gmail above first.");
    await sendPasswordResetEmail(auth, email);
    toast("If the account exists, a reset email was sent. Check Spam too.");
  });
};
$("#adminBtn").onclick = (e) => act(async () => {
  const key = $("#adminName").value.trim().toLowerCase().replace(/^@/, ""), adminKey = $("#adminKey").value.trim();
  const email = $("#adminEmail").value.trim().toLowerCase(), pw = $("#adminPw").value;
  if (!/^[a-z0-9_]{3,15}$/.test(key)) throw new Error("Admin username: 3-15 letters, numbers or _ (no number tag).");
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid Gmail address.");
  if (pw.length < 6) throw new Error("Password must be at least 6 characters.");
  const b = writeBatch(db);
  b.set(doc(db, "usernames", key), { uid, createdAt: serverTimestamp(), adminKey });
  b.set(doc(db, "users", uid), { username: "@" + key, usernameKey: key, verified: true, admin: true, createdAt: serverTimestamp() });
  try { await b.commit(); } catch (err) { throw err.code === "permission-denied" ? new Error("Wrong admin key, or that admin name is already taken.") : err; }
  try { await linkEmail(email, pw); } catch (err) { toast("Admin made, but Gmail not saved: " + friendly(err)); }
  renderProfile();
}, e.currentTarget);

// ---------- app start ----------
function startApp() {
  onSnapshot(query(collection(db, "chats"), where("members", "array-contains", uid)), (s) => {
    chats = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    chats.forEach(watchFriend);
    if (!firstChats && s.docChanges().some((c) => c.type === "added" && !c.doc.metadata.hasPendingWrites)) toast("New friend connected 🎉");
    if (!firstChats) s.docChanges().forEach((ch) => {
      if (ch.type !== "modified" || ch.doc.metadata.hasPendingWrites) return;
      const c = { id: ch.doc.id, ...ch.doc.data() };
      if (!c.lastBy || c.lastBy === uid) return;
      if (activeChat?.id === c.id && document.visibilityState === "visible") markRead(c.id);
      else notify(`New message from ${nameOf(person(c.lastBy))}${c.group ? " in " + c.name : ""}`, c.id);
    });
    firstChats = false;
    if (activeChat && document.visibilityState === "visible") markRead(activeChat.id);
    renderChats(); renderBadges(); renderPV();
  }, (e) => toast(friendly(e)));
  myCode = loadCode();
  if (!myCode) maybeNewCode();
  renderCode();
  setInterval(tickCode, 1000);
  setInterval(tickMessages, 400);
  claimDaily();
  setInterval(minuteTick, 61000);
  startStatus();
  startInbox();
  startFollows();
  presenceTick(); setInterval(presenceTick, 60000);
  startCalls();
  syncPush();
  setInterval(() => { renderChats(); renderChatTitle(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") presenceTick(); });
  if (auth.currentUser?.isAnonymous) setTimeout(() => toast("Set a password in Profile to keep your username safe"), 5000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") claimDaily(); });
}
function watchFriend(chat) {
  if (chat.group) { chat.members.filter((m) => m !== uid).forEach(watchPerson); return; }
  const fid = chat.members.find((m) => m !== uid);
  if (!fid || friendUnsubs[fid]) return;
  friendUnsubs[fid] = onSnapshot(doc(db, "users", fid), (s) => { friends[fid] = s.data(); renderChats(); renderChatTitle(); });
}

// ---------- tabs ----------
$$(".bottom button").forEach((b) => (b.onclick = () => {
  $$(".bottom button").forEach((x) => x.classList.toggle("on", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== "tab-" + b.dataset.tab));
}));
const showTab = (name) => $(`.bottom button[data-tab="${name}"]`).click();

// ---------- render ----------
const nameOf = (u) => u?.displayName || u?.username || "…";
const avatarHTML = (u, big) => {
  const inner = u?.avatar && String(u.avatar).startsWith("data:image/jpeg;base64,")
    ? `<img src="${esc(u.avatar)}" alt="">` : esc(((u?.username || "?@")[1] || "?").toUpperCase());
  return `<div class="avatar ${big ? "big" : ""}">${inner}</div>`;
};
function renderChats() {
  const box = $("#chatList");
  if (!chats.length) { box.innerHTML = `<div class="card center muted">No chats yet.<br>Open <b>Connect</b> and swap codes with a friend.</div>`; return; }
  box.innerHTML = [...chats].sort(byLast).map((c) => {
    if (c.group) return `<div class="row" data-chat="${esc(c.id)}"><div class="avwrap">${avatarHTML({ username: "@" + c.name })}</div><div class="grow"><b>👥 ${esc(c.name)}</b><span class="muted">${c.members.length} members</span></div>${isUnread(c) ? '<span class="dot"></span>' : ""}›</div>`;
    const f = friends[c.members.find((m) => m !== uid)];
    return `<div class="row" data-chat="${esc(c.id)}">${avWithDot(f)}<div class="grow"><b>${esc(nameOf(f))}${vb(f)}</b><span class="muted">${isOnline(f) ? '<span class="on">● Active now</span>' : esc(f?.username || "") + " · Lv " + (f?.level || 1)}</span></div>${isUnread(c) ? '<span class="dot"></span>' : ""}›</div>`;
  }).join("");
}
$("#chatList").addEventListener("click", (e) => { const r = e.target.closest("[data-chat]"); if (r) openChat(chats.find((c) => c.id === r.dataset.chat)); });
function renderProfile() {
  if (!me) return;
  $("#topStats").textContent = `Lv ${me.level || 1} · ${me.points || 0} pts`;
  if (!$("#settings").classList.contains("hidden")) renderSettings();
  const row = (go, icon, title, sub) => `<div class="wrow" data-go="${go}"><div class="wi">${icon}</div><div><b>${title}</b><span>${sub}</span></div></div>`;
  $("#profile").innerHTML = `
    <div class="you-top ${hasBanner(me) ? "has-banner" : ""}" ${hasBanner(me) ? `style="background:${bannerCss(me)}"` : ""}>
      <div class="you-icons"><button class="icon" data-go="invite" aria-label="Share">🔗</button><button class="icon" data-go="edit" aria-label="Edit">✏️</button></div>
      <div class="bio-bubble" data-go="edit">${esc(me.bio || "Add a bio")}</div>
      <div class="you-ava">${avatarHTML(me, true)}<button class="plus" data-go="edit" aria-label="Change logo">+</button></div>
      <h2>${esc(nameOf(me))}${vb(me)}</h2>
      ${me.displayName ? `<p class="muted">${esc(me.username)}</p>` : ""}
      <p class="tiny">${me.followersCount || 0} followers · ${following.size} following (only you can see who)</p>
    </div>
    <div class="wlist">
      ${row("points", "🏆", "Points & level", `Level ${me.level || 1} · ${me.points || 0} points · 🔥 ${me.streak || 0}`)}
      ${row("edit", "👤", "Edit profile", "Name, bio, logo, banner")}
      ${row("account", "🔑", "Account", auth.currentUser?.isAnonymous ? "Add your Gmail to protect this account" : "Gmail, password, log out")}
      ${row("privacy", "🔒", "Privacy", `${me.isPublic ? "Public" : "Private"} account · online status`)}
      ${row("chats", "💬", "Chats", "Theme, chat background")}
      ${row("notif", "🔔", "Notifications", "Message alerts on or off")}
      ${row("lang", "🌐", "App language", "English")}
      ${row("subs", "💎", "Subscriptions", "Explore premium benefits")}
      ${row("updates", "🚀", "App Updates", "Check for new versions")}
      ${row("invite", "👥", "Invite a friend", "Share Wordii Chat")}
      ${me.admin ? row("admin", "🛡️", "Admin tools", "Give or remove blue ✔ badges") + row("dash", "📊", "Admin dashboard", "See who is using the app") + row("gifts", "🎁", "Level gifts", "Add, edit or remove rewards") : ""}
    </div>
    ${followCard()}
    <p class="tiny" style="padding:6px 10px">Symbol messages are <b>obfuscation, not encryption</b>.</p>`;
}

// ---------- friend codes ----------
const CODE_KEY = "wordii_code";
let myCode = null, codeBusy = false, lastTry = 0;
function loadCode() {
  try { const c = JSON.parse(localStorage.getItem(CODE_KEY)); if (c && c.uid === uid && c.expires > Date.now()) return c; } catch {}
  return null;
}
async function newCode() {
  if (myCode) deleteDoc(doc(db, "connectCodes", myCode.code)).catch(() => {});
  for (let i = 0; i < 6; i++) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    const expires = Date.now() + 10 * 60 * 1000;
    try {
      await setDoc(doc(db, "connectCodes", code), { uid, expiresAt: Timestamp.fromMillis(expires) });
      myCode = { code, expires, uid };
      try { localStorage.setItem(CODE_KEY, JSON.stringify(myCode)); } catch {}
      renderCode(); return;
    } catch (e) { if (e.code !== "permission-denied") throw e; }
  }
  throw new Error("Could not make a code. Check your phone's date and time, then try again.");
}
function maybeNewCode() {
  if (codeBusy || Date.now() - lastTry < 5000) return;
  codeBusy = true; lastTry = Date.now();
  newCode().catch((e) => toast(friendly(e))).finally(() => (codeBusy = false));
}
function renderCode() { $("#myCode").textContent = myCode && myCode.expires > Date.now() ? myCode.code.slice(0, 3) + " " + myCode.code.slice(3) : "······"; }
function tickCode() {
  if (!myCode || myCode.expires <= Date.now()) { renderCode(); $("#codeTimer").textContent = "Making a new code…"; maybeNewCode(); return; }
  const s = Math.floor((myCode.expires - Date.now()) / 1000);
  $("#codeTimer").textContent = `Expires in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
$("#newCodeBtn").onclick = (e) => act(newCode, e.currentTarget);

async function connect(code) {
  if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code.");
  const s = await getDoc(doc(db, "connectCodes", code));
  if (!s.exists() || s.data().expiresAt.toMillis() < Date.now()) throw new Error("Code is wrong or expired.");
  const other = s.data().uid;
  if (other === uid) throw new Error("You can't use your own code.");
  const members = [uid, other].sort();
  const id = members.join("_");
  const ref = doc(db, "chats", id);
  if (!(await getDoc(ref)).exists()) await setDoc(ref, { members, via: code, createdAt: serverTimestamp() });
  return { id, members };
}
$("#connectBtn").onclick = (e) => act(async () => {
  const c = await connect($("#friendCode").value.trim());
  $("#friendCode").value = ""; toast("Connected! 🎉"); showTab("chats"); openChat(c);
}, e.currentTarget);

// ---------- chat ----------
let activeChat = null, unsubMsgs = null, msgs = [], msgMap = {}, reveal = {}, decoded = {};
function openChat(c) {
  if (!c) return;
  closeChat(); activeChat = c; reveal = {}; decoded = {}; msgs = []; msgMap = {};
  markRead(c.id);
  watchFriend(c);
  $("#chat").classList.remove("hidden"); renderChatTitle(); updateHideBtn(); startTyping(c);
  unsubMsgs = onSnapshot(query(collection(db, "chats", c.id, "messages"), orderBy("createdAt", "desc"), limit(40)), (s) => {
    msgs = s.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
    msgMap = Object.fromEntries(msgs.map((m) => [m.id, m]));
    processReveals(new Set(s.docs.filter((d) => d.metadata.hasPendingWrites).map((d) => d.id)));
    renderMessages();
  }, (e) => toast(friendly(e)));
}
function closeChat() { if (rec) { recCancelled = true; rec.stop(); } if (unsubTyping) unsubTyping(); unsubTyping = null; typingAt = {}; if (unsubMsgs) unsubMsgs(); unsubMsgs = null; activeChat = null; $("#chat").classList.add("hidden"); }
$("#backBtn").onclick = closeChat;
function renderChatTitle() {
  if (!activeChat) return;
  $("#callBtn").classList.toggle("hidden", !!activeChat.group); $("#vidBtn").classList.toggle("hidden", !!activeChat.group);
  if (activeChat.group) { $("#chatTitle").innerHTML = `<div class="avwrap">${avatarHTML({ username: "@" + activeChat.name })}</div><span>${esc(activeChat.name)}<br><small class="presence">${activeChat.members.length} members</small></span>`; return; }
  const f = friends[activeChat.members.find((m) => m !== uid)];
  $("#chatTitle").innerHTML = `${avWithDot(f)}<span>${esc(nameOf(f))}${vb(f)}<br><small class="presence ${isOnline(f) ? "on" : ""}">${esc(presenceText(f))}</small></span>`;
}
// Own messages: readable for 10 s only right after you send them.
// Received messages: readable for 10 s from the moment you first see them, then stars.
function processReveals(newOwn) {
  const now = Date.now(), visible = document.visibilityState === "visible";
  msgs.forEach((m) => {
    if (m.id in reveal) return;
    if (m.senderId === uid) { reveal[m.id] = newOwn.has(m.id) ? now + 10000 : 0; return; }
    if (activeChat?.group) { if (visible) reveal[m.id] = now + 10000; return; }
    if (m.seenAt) { reveal[m.id] = m.seenAt.toMillis() + 10000; return; }
    if (!visible || !activeChat) return;
    reveal[m.id] = now + 10000;
    updateDoc(doc(db, "chats", activeChat.id, "messages", m.id), { seenAt: serverTimestamp() }).catch(() => {});
  });
}
document.addEventListener("visibilitychange", () => {
  if (activeChat && document.visibilityState === "visible") { processReveals(new Set()); tickMessages(); }
});
function renderMessages() {
  const box = $("#msgs");
  box.innerHTML = msgs.map((m) => {
    const t = m.createdAt?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "";
    return `<div class="msg ${m.senderId === uid ? "mine" : "theirs"}" data-id="${esc(m.id)}">${activeChat?.group && m.senderId !== uid ? `<small class="sname">${esc(nameOf(person(m.senderId)))}${vb(person(m.senderId))}</small>` : ""}<div class="bubble ${m.img ? "imgmsg" : m.aud ? "audmsg" : ""}"></div><time>${t}${m.senderId === uid && m.seenAt ? " · Seen" : ""}</time></div>`;
  }).join("");
  tickMessages();
  box.scrollTop = box.scrollHeight;
}
const plain = (m) => (decoded[m.id] ??= decodeMessage(m.text) ?? "⚠ unreadable message");
function tickMessages() {
  if (!activeChat) return;
  const now = Date.now();
  $$("#msgs .msg").forEach((el) => {
    const m = msgMap[el.dataset.id]; if (!m) return;
    const open = !hideOn() || (reveal[m.id] || 0) > now, b = el.querySelector(".bubble");
    if (m.aud !== undefined) {
      if (b.dataset.s !== "aud") {
        b.dataset.s = "aud"; b.textContent = "";
        const a = document.createElement("audio"); a.controls = true; a.preload = "metadata"; a.className = "voice";
        a.src = String(m.aud).startsWith("data:audio/") ? m.aud : ""; b.append(a);
      }
      b.classList.add("open"); return;
    }
    if (m.img !== undefined) {
      const want = open && String(m.img).startsWith("data:image/jpeg;base64,") ? "img" : "hid";
      if (b.dataset.s !== want) {
        b.dataset.s = want; b.textContent = "";
        if (want === "img") { const i = new Image(); i.src = m.img; i.className = "photo"; b.append(i); }
        else b.textContent = m.senderId === uid ? "📷 Photo · tap to view" : "📷 ★★★★★";
      }
      b.classList.toggle("open", open); return;
    }
    const txt = open ? plain(m) : (m.senderId === uid ? m.text : "★".repeat(Math.max(3, Math.min(plain(m).length, 20))));
    if (b.textContent !== txt) b.textContent = txt;
    b.classList.toggle("open", open);
  });
}
let lp = null, longDone = false;
const mbox = $("#msgs");
mbox.addEventListener("contextmenu", (e) => e.preventDefault());
mbox.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".msg"); if (!el) return; longDone = false;
  lp = setTimeout(() => {
    longDone = true; const m = msgMap[el.dataset.id];
    if (m.img !== undefined) { toast("Photos can't be copied as symbols"); return; }
    copy(m.text); toast("Symbol message copied");
  }, 600);
});
["pointerup", "pointerleave", "pointercancel", "pointermove"].forEach((ev) => mbox.addEventListener(ev, () => clearTimeout(lp)));
mbox.addEventListener("click", (e) => {
  if (longDone) { longDone = false; return; }
  const el = e.target.closest(".msg"); if (!el) return;
  const m = msgMap[el.dataset.id];
  if (m.senderId !== uid) { toast("Received messages show only once"); return; }
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
  sendMsg({ text: encodeMessage(text) })
    .catch((err) => { toast(friendly(err)); input.value = text; });
});

// ---------- photos, logo, display name ----------
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => rej(new Error("Could not read that image. Try a JPG or PNG."));
    im.src = url;
  });
}
async function compress(file, { max = 1024, square = false, quality = 0.7, limitLen = 350000 } = {}) {
  if (!file.type.startsWith("image/")) throw new Error("Only photos work for now (videos need the paid plan).");
  const im = await loadImage(file);
  let sx = 0, sy = 0, sw = im.width, sh = im.height;
  if (square) { const m = Math.min(sw, sh); sx = (sw - m) / 2; sy = (sh - m) / 2; sw = sh = m; }
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas"); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
  let q = quality, out;
  do { out = c.toDataURL("image/jpeg", q); q -= 0.1; } while (out.length > limitLen && q > 0.2);
  if (out.length > limitLen) throw new Error("That photo is too big. Try another one.");
  return out;
}
$("#attachBtn").onclick = () => $("#fileInput").click();
$("#fileInput").addEventListener("change", (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f || !activeChat) return;
  act(async () => {
    toast("Sending photo…");
    const img = await compress(f, { max: 1024, quality: 0.7, limitLen: 350000 });
    await sendMsg({ img });
  });
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#logoBtn")) $("#logoInput").click();
  const sv = e.target.closest("#saveName");
  if (sv) act(async () => {
    const name = $("#dnInput").value.trim().slice(0, 30);
    await updateDoc(doc(db, "users", uid), { displayName: name });
    toast("Name saved");
  }, sv);
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "logoInput") return;
  const f = e.target.files[0]; e.target.value = "";
  if (f) act(async () => {
    const avatar = await compress(f, { max: 128, square: true, quality: 0.8, limitLen: 40000 });
    await updateDoc(doc(db, "users", uid), { avatar });
    toast("Logo updated");
  });
});

// ---------- points and levels (rules on the server check every change) ----------
const levelFor = (points) => Math.floor(points / 10) + 1;
let dailyBusy = false;
async function claimDaily() {
  if (!me || dailyBusy) return;
  const day = Math.floor(Date.now() / 86400000), last = me.lastDay ?? -1;
  if (last >= day) return;
  dailyBusy = true;
  try {
    const streak = last === day - 1 ? (me.streak || 0) + 1 : 1, points = (me.points || 0) + 4;
    await updateDoc(doc(db, "users", uid), { points, level: levelFor(points), streak, lastDay: day });
    toast(`Daily streak ${streak}! +4 points`);
  } catch (e) { toast("Daily points: " + friendly(e)); }
  dailyBusy = false;
}
async function minuteTick() {
  if (!me || document.visibilityState !== "visible" || !document.hasFocus()) return;
  const last = me.lastMinuteAt?.toMillis?.() || 0;
  if (Date.now() - last < 56000) return;
  const points = (me.points || 0) + 1;
  try { await updateDoc(doc(db, "users", uid), { points, level: levelFor(points), lastMinuteAt: serverTimestamp() }); }
  catch (e) { console.warn("minute point failed", e); }
}

// ---------- YouTube / Instagram corner icons ----------
const ytUrl = (v) => (/^https?:\/\//.test(v) ? v : `https://www.youtube.com/@${v.replace(/^@/, "")}`);
const igUrl = (v) => (/^https?:\/\//.test(v) ? v : `https://www.instagram.com/${v.replace(/^@/, "")}`);
const YT_SVG = `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="1" y="5" width="22" height="14" rx="4" fill="#ff0033"/><path d="M10 9l5 3-5 3z" fill="#fff"/></svg>`;
const IG_SVG = `<svg viewBox="0 0 24 24" width="20" height="20"><defs><linearGradient id="igg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#feda75"/><stop offset=".5" stop-color="#d62976"/><stop offset="1" stop-color="#4f5bd5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#igg)"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.2" fill="#fff"/></svg>`;
function socialLinks() {
  const out = [];
  if (links.youtube) out.push(`<a href="${esc(ytUrl(links.youtube))}" target="_blank" rel="noopener noreferrer" aria-label="YouTube">${YT_SVG}</a>`);
  if (links.instagram) out.push(`<a href="${esc(igUrl(links.instagram))}" target="_blank" rel="noopener noreferrer" aria-label="Instagram">${IG_SVG}</a>`);
  return out;
}
const followCard = () => { const l = socialLinks(); return l.length ? `<div class="card"><b>Follow the creator</b><div id="socials" style="margin-top:10px">${l.join("")}</div></div>` : ""; };
$("#socials").innerHTML = socialLinks().join("");

// ---------- status ----------
const ST_BG = ["linear-gradient(135deg,#7b2cff,#c026d3)", "linear-gradient(135deg,#0ea5e9,#6366f1)", "linear-gradient(135deg,#10b981,#0e7490)", "linear-gradient(135deg,#f59e0b,#ef4444)", "linear-gradient(135deg,#ec4899,#8b5cf6)", "linear-gradient(135deg,#1e293b,#475569)", "linear-gradient(135deg,#14b8a6,#22c55e)", "linear-gradient(135deg,#f43f5e,#fb923c)"];
let myStatuses = [], feedStatuses = [], stBg = 0;
const stTime = (st) => st.createdAt?.toMillis?.() ?? Date.now();
const stAlive = (st) => stTime(st) + 86400000 > Date.now();
const stIsPhoto = (st) => st.img !== undefined && String(st.img).startsWith("data:image/jpeg;base64,");
function ago(ms) { const m = Math.floor((Date.now() - ms) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`; }
function startStatus() {
  loadClose();
  onSnapshot(query(collection(db, "statuses"), where("ownerUid", "==", uid)), (s) => {
    myStatuses = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    myStatuses.filter((x) => !stAlive(x)).forEach((x) => deleteDoc(doc(db, "statuses", x.id)).catch(() => {}));
    renderStatus();
  }, (e) => toast(friendly(e)));
  onSnapshot(query(collection(db, "statuses"), where("viewers", "array-contains", uid)), (s) => {
    feedStatuses = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (feedLoaded) s.docChanges().forEach((ch) => {
      const d = ch.doc.data();
      if (ch.type === "added" && !ch.doc.metadata.hasPendingWrites && d.mentions?.includes(uid))
        getDoc(doc(db, "users", d.ownerUid)).then((u) => notify(`${nameOf(u.data())} mentioned you in their status`, "st")).catch(() => {});
    });
    feedLoaded = true;
    renderStatus();
  }, (e) => toast(friendly(e)));
}
const mineAlive = () => myStatuses.filter(stAlive).sort((a, b) => stTime(a) - stTime(b));
function friendGroups() {
  const g = {};
  feedStatuses.filter(stAlive).forEach((st) => { if (friends[st.ownerUid]) (g[st.ownerUid] ||= []).push(st); });
  Object.values(g).forEach((l) => l.sort((a, b) => stTime(a) - stTime(b)));
  return g;
}
function thumb(st) {
  return stIsPhoto(st) ? `<div class="st-thumb"><img src="${esc(st.img)}" alt=""></div>`
    : `<div class="st-thumb" style="background:${ST_BG[st.bg] || ST_BG[0]}">${esc((st.text || "").slice(0, 14))}</div>`;
}
function renderStatus() {
  const mine = mineAlive();
  $("#myStatusList").innerHTML = mine.map((st) => `<div class="row" data-my="${esc(st.id)}">${thumb(st)}<div class="grow"><b>${esc(ago(stTime(st)))}</b><span class="muted">Tap to view${st.close ? " · Close friends" : ""} · <span id="sc_${esc(st.id)}">${esc(statCount(st.id))}</span></span></div><button class="del" data-del="${esc(st.id)}" aria-label="Delete">🗑</button></div>`).join("");
  const g = friendGroups(), owners = Object.keys(g).sort((a, b) => stTime(g[b].at(-1)) - stTime(g[a].at(-1)));
  $("#friendStatus").innerHTML = owners.length ? owners.map((o) => `<div class="row" data-owner="${esc(o)}">${avatarHTML(friends[o])}<div class="grow"><b>${esc(nameOf(friends[o]))}${vb(friends[o])}</b><span class="muted">${g[o].length} update${g[o].length > 1 ? "s" : ""} · ${esc(ago(stTime(g[o].at(-1))))}</span></div>›</div>`).join("")
    : `<div class="card center muted">No friend updates right now.</div>`;
  loadStatCounts(mine);
}
$("#tab-status").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) { act(() => deleteDoc(doc(db, "statuses", del.dataset.del)), del); return; }
  const my = e.target.closest("[data-my]");
  if (my) { const list = mineAlive(); openSV(list, Math.max(0, list.findIndex((x) => x.id === my.dataset.my))); return; }
  const ow = e.target.closest("[data-owner]");
  if (ow) openSV(friendGroups()[ow.dataset.owner] || []);
});

let sv = { list: [], i: 0, t: null };
function openSV(list, i = 0) { if (!list.length) return; sv = { list, i, t: null }; $("#statusView").classList.remove("hidden"); drawSV(); }
function closeSV() { clearTimeout(sv.t); $("#statusView").classList.add("hidden"); }
function drawSV() {
  clearTimeout(sv.t);
  const st = sv.list[sv.i]; if (!st) { closeSV(); return; }
  const owner = st.ownerUid === uid ? me : friends[st.ownerUid];
  $("#svTop").innerHTML = `${avatarHTML(owner)}<div><b>${esc(nameOf(owner))}${vb(owner)}</b><br><small>${esc(ago(stTime(st)))} · ${sv.i + 1}/${sv.list.length}</small></div>`;
  const body = $("#svBody"); body.textContent = "";
  if (stIsPhoto(st)) { const im = new Image(); im.src = st.img; im.className = "sv-img"; body.append(im); body.style.background = "#000"; }
  else { body.style.background = ST_BG[st.bg] || ST_BG[0]; const d = document.createElement("div"); d.className = "sv-text"; d.textContent = st.text || ""; body.append(d); }
  drawSVBar(st);
  sv.t = setTimeout(() => { sv.i++; drawSV(); }, 6000);
}
$("#svBody").addEventListener("click", () => { sv.i++; drawSV(); });
$("#svClose").onclick = closeSV;

function drawColors() {
  $("#stPreview").style.background = ST_BG[stBg];
  $("#stColors").innerHTML = ST_BG.map((g, i) => `<button type="button" data-c="${i}" class="${i === stBg ? "on" : ""}" style="background:${g}" aria-label="Colour ${i + 1}"></button>`).join("");
}
$("#stColors").addEventListener("click", (e) => { const b = e.target.closest("[data-c]"); if (b) { stBg = +b.dataset.c; drawColors(); } });
$("#stTextBtn").onclick = () => { stBg = 0; $("#stText").value = ""; drawColors(); $("#statusCompose").classList.remove("hidden"); $("#stText").focus(); };
$("#stCancel").onclick = () => $("#statusCompose").classList.add("hidden");
const viewersNow = () => chats.map((c) => c.members.find((m) => m !== uid)).filter(Boolean);
$("#stPost").onclick = (e) => act(async () => {
  const text = $("#stText").value.trim();
  if (!text) throw new Error("Write something first.");
  await addDoc(collection(db, "statuses"), { ownerUid: uid, ...stAudience(), text, bg: stBg, createdAt: serverTimestamp() });
  $("#statusCompose").classList.add("hidden"); toast("Status posted"); clearMentions();
}, e.currentTarget);
$("#stPhotoBtn").onclick = () => $("#stFile").click();
$("#stFile").addEventListener("change", (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  act(async () => {
    toast("Posting…");
    const img = await compress(f, { max: 1024, quality: 0.7, limitLen: 350000 });
    await addDoc(collection(db, "statuses"), { ownerUid: uid, ...stAudience(), img, createdAt: serverTimestamp() });
    toast("Status posted"); clearMentions();
  });
});

// ---------- password + log out (Profile tab) ----------
document.addEventListener("click", (e) => {
  const pb = e.target.closest("#pwBtn");
  if (pb) act(async () => {
    await linkEmail($("#emInput").value.trim().toLowerCase(), $("#pwInput").value);
    toast("Saved. Check your Gmail and tap the link 📧"); document.activeElement?.blur(); renderProfile();
  }, pb);
  if (e.target.closest("#logoutBtn")) {
    const msg = auth.currentUser?.isAnonymous
      ? "This account has NO password. If you log out you will lose it forever. Log out anyway?"
      : "Log out? You can log back in with your username and password.";
    if (confirm(msg)) signOut(auth).then(() => location.reload());
  }
});

// ---------- sending (stamps the chat so the other person gets an unread dot + notification) ----------
async function sendMsg(payload) {
  const b = writeBatch(db);
  b.set(doc(collection(db, "chats", activeChat.id, "messages")), { senderId: uid, ...payload, createdAt: serverTimestamp() });
  b.update(doc(db, "chats", activeChat.id), { lastAt: serverTimestamp(), lastBy: uid });
  await b.commit();
}

// ---------- unread, notifications, inbox ----------
let incoming = [], outgoing = [], notifs = [], reads = {};
const people = {}, personUnsubs = {};
const person = (id) => people[id] || friends[id];
const lastMs = (c) => c.lastAt?.toMillis?.() || 0;
const byLast = (a, b) => lastMs(b) - lastMs(a);
const isUnread = (c) => !!c.lastBy && c.lastBy !== uid && lastMs(c) > (reads[c.id] || 0) && !(activeChat?.id === c.id && document.visibilityState === "visible");
function saveReads() { try { localStorage.setItem("wordii_reads_" + uid, JSON.stringify(reads)); } catch {} }
function markRead(id) {
  const c = chats.find((x) => x.id === id);
  reads[id] = Math.max(Date.now(), c ? lastMs(c) : 0); saveReads(); renderBadges(); renderChats();
}
function watchPerson(id) {
  if (!id || personUnsubs[id]) return;
  personUnsubs[id] = onSnapshot(doc(db, "users", id), (s) => { people[id] = s.data(); renderInbox(); renderSearch(); }, () => {});
}
function addNotif(text) {
  notifs.unshift({ t: Date.now(), text }); notifs = notifs.slice(0, 15);
  try { localStorage.setItem("wordii_notifs_" + uid, JSON.stringify(notifs)); } catch {}
  renderInbox();
}
function notify(text, tag) {
  addNotif(text);
  if (pref("notif", "on") === "off") return;
  if (document.visibilityState === "visible") { toast(text); return; }
  if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then((r) => r.showNotification("Wordii Chat", { body: text, icon: "icon-192.png", badge: "icon-192.png", tag: tag || "wordii", renotify: true })).catch(() => {});
  }
}
function renderBadges() {
  const un = chats.filter(isUnread).length, n = incoming.length + un, bc = $("#bellCount");
  bc.textContent = n > 9 ? "9+" : n; bc.classList.toggle("hidden", !n);
  $('.bottom button[data-tab="chats"]').classList.toggle("has-dot", un > 0);
  document.title = n ? `(${n}) Wordii Chat` : "Wordii Chat";
}
function startInbox() {
  try { reads = JSON.parse(localStorage.getItem("wordii_reads_" + uid)) || {}; } catch { reads = {}; }
  try { notifs = JSON.parse(localStorage.getItem("wordii_notifs_" + uid)) || []; } catch { notifs = []; }
  let firstIn = true;
  onSnapshot(query(collection(db, "requests"), where("to", "==", uid)), (s) => {
    incoming = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    incoming.forEach((r) => watchPerson(r.from));
    if (!firstIn) s.docChanges().forEach((ch) => {
      if (ch.type === "added" && !ch.doc.metadata.hasPendingWrites)
        getDoc(doc(db, "users", ch.doc.data().from)).then((d) => notify(`${nameOf(d.data())} wants to chat`, "req")).catch(() => {});
    });
    firstIn = false; renderBadges(); renderInbox(); renderSearch();
  }, (e) => toast(friendly(e)));
  onSnapshot(query(collection(db, "requests"), where("from", "==", uid)), (s) => {
    outgoing = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    outgoing.forEach((r) => watchPerson(r.to));
    renderInbox(); renderSearch();
  }, (e) => toast(friendly(e)));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && activeChat) markRead(activeChat.id); });
  renderBadges();
}
const pairId = (other) => [uid, other].sort().join("_");
async function sendRequest(to, note) {
  const id = pairId(to);
  if (chats.some((c) => c.id === id)) throw new Error("You are already connected.");
  if (incoming.some((r) => r.id === id)) throw new Error("They already sent you a request. Open 🔔 to accept.");
  await setDoc(doc(db, "requests", id), { from: uid, to, note: (note || "").slice(0, 100), createdAt: serverTimestamp() });
}
async function acceptRequest(r) {
  const b = writeBatch(db);
  b.set(doc(db, "chats", r.id), { members: [uid, r.from].sort(), via: "request", createdAt: serverTimestamp() });
  b.delete(doc(db, "requests", r.id));
  await b.commit();
}
function renderInbox() {
  const el = $("#inboxBody"); if (!el || $("#inbox").classList.contains("hidden")) return;
  let h = "";
  if ("Notification" in window && Notification.permission === "default") h += `<button id="notifBtn" class="btn sm" style="margin:6px 0">🔔 Turn on phone notifications</button>`;
  else if ("Notification" in window && Notification.permission === "denied") h += `<p class="tiny">Phone notifications are blocked. Allow them in your phone's app settings.</p>`;
  h += `<h3 class="sec">Chat requests</h3>`;
  h += incoming.length ? incoming.map((r) => { const p = person(r.from); return `<div class="row nopoint">${avatarHTML(p)}<div class="grow"><b>${esc(nameOf(p))}${vb(p)}</b><span class="muted">${esc(r.note || "wants to chat")}</span></div><button class="btn sm" data-acc="${esc(r.id)}">Accept</button><button class="del" data-dec="${esc(r.id)}" aria-label="Decline">✕</button></div>`; }).join("") : `<p class="tiny">No requests.</p>`;
  h += `<h3 class="sec">Sent requests</h3>`;
  h += outgoing.length ? outgoing.map((r) => { const p = person(r.to); return `<div class="row nopoint">${avatarHTML(p)}<div class="grow"><b>${esc(nameOf(p))}${vb(p)}</b><span class="muted">Waiting for approval</span></div><button class="del" data-cancel="${esc(r.id)}" aria-label="Cancel">✕</button></div>`; }).join("") : `<p class="tiny">None.</p>`;
  const un = chats.filter(isUnread);
  if (un.length) h += `<h3 class="sec">New messages</h3>` + un.map((c) => { const f = c.group ? { username: "@" + c.name, displayName: c.name } : friends[c.members.find((m) => m !== uid)]; return `<div class="row" data-openchat="${esc(c.id)}">${avatarHTML(f)}<div class="grow"><b>${esc(nameOf(f))}${vb(f)}</b><span class="muted">New message</span></div><span class="dot"></span></div>`; }).join("");
  h += `<h3 class="sec">Recent</h3>` + (notifs.length ? notifs.map((n) => `<p class="tiny">${esc(ago(n.t))} · ${esc(n.text)}</p>`).join("") : `<p class="tiny">Nothing yet.</p>`);
  el.innerHTML = h;
}
$("#bellBtn").onclick = () => { $("#inbox").classList.remove("hidden"); renderInbox(); };
$("#inboxClose").onclick = () => $("#inbox").classList.add("hidden");
$("#inboxBody").addEventListener("click", (e) => {
  const acc = e.target.closest("[data-acc]");
  if (acc) { const r = incoming.find((x) => x.id === acc.dataset.acc); if (r) act(async () => { await acceptRequest(r); toast("Connected! 🎉"); }, acc); return; }
  const rm = e.target.closest("[data-dec],[data-cancel]");
  if (rm) { act(() => deleteDoc(doc(db, "requests", rm.dataset.dec || rm.dataset.cancel)), rm); return; }
  const op = e.target.closest("[data-openchat]");
  if (op) { $("#inbox").classList.add("hidden"); openChat(chats.find((x) => x.id === op.dataset.openchat)); return; }
  if (e.target.closest("#notifBtn")) Notification.requestPermission().then(() => renderInbox());
});

// ---------- username search ----------
let lastResults = [], searchTimer;
async function searchPeople(text) {
  const q = text.trim().toLowerCase().replace(/^@/, "").replace("#", "-");
  if (q.length < 2) return [];
  const snap = await getDocs(query(collection(db, "users"), where("usernameKey", ">=", q), where("usernameKey", "<=", q + "\uf8ff"), limit(10)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.id !== uid);
}
$("#searchInput").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    try { lastResults = await searchPeople($("#searchInput").value); } catch (e) { toast(friendly(e)); lastResults = []; }
    renderSearch();
  }, 350);
});
function renderSearch() {
  renderPV();
  const box = $("#searchResults"); if (!box) return;
  if ($("#searchInput").value.trim().length < 2) { box.innerHTML = ""; return; }
  if (!lastResults.length) { box.innerHTML = `<p class="tiny">No one found.</p>`; return; }
  box.innerHTML = lastResults.map((u) => {
    const id = pairId(u.id);
    const btn = chats.some((c) => c.id === id) ? `<button class="btn sm ghost" data-sopen="${esc(id)}">Open</button>`
      : outgoing.some((r) => r.id === id) ? `<button class="btn sm ghost" disabled>Requested</button>`
      : incoming.some((r) => r.id === id) ? `<button class="btn sm" data-sacc="${esc(id)}">Accept</button>`
      : u.isPublic ? `<button class="btn sm" data-smsg="${esc(u.id)}">Message</button>` : `<button class="btn sm" data-sreq="${esc(u.id)}">Request</button>`;
    return `<div class="row nopoint">${avatarHTML(u)}<div class="grow" data-sprof="${esc(u.id)}"><b>${esc(nameOf(u))}${vb(u)}</b><span class="muted">${esc(u.username)}</span></div>${btn}</div>`;
  }).join("");
}
$("#searchResults").addEventListener("click", (e) => {
  const rq = e.target.closest("[data-sreq]");
  if (rq) { const note = prompt("Say hi (optional, max 100 letters)", ""); if (note === null) return;
    act(async () => { await sendRequest(rq.dataset.sreq, note); toast("Request sent. You can chat after they accept."); }, rq); return; }
  const ac = e.target.closest("[data-sacc]");
  if (ac) { const r = incoming.find((x) => x.id === ac.dataset.sacc); if (r) act(async () => { await acceptRequest(r); toast("Connected! 🎉"); }, ac); return; }
  const op = e.target.closest("[data-sopen]");
  if (op) openChat(chats.find((c) => c.id === op.dataset.sopen));
});

// ================= v10: profile view, follow, settings, theme, status views, close friends =================
function pref(k, d) { try { return localStorage.getItem("wordii_" + k) ?? d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem("wordii_" + k, v); } catch {} }
function applyTheme() { const t = pref("theme", "auto"); if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; }
function applyChatBg() { $("#chat").dataset.bg = pref("chatbg", "0"); }
applyTheme(); applyChatBg();

const hasBanner = (u) => !!(u?.banner && String(u.banner).startsWith("data:image/jpeg;base64,"));
const bannerCss = (u) => (hasBanner(u) ? `linear-gradient(#0006,#000a),url('${esc(u.banner)}') center/cover` : "");

// --- bio + banner ---
document.addEventListener("click", (e) => {
  if (e.target.closest("#openSettings")) { $("#settings").classList.remove("hidden"); renderSettings(); return; }
  if (e.target.closest("#bannerBtn")) { $("#bannerInput").click(); return; }
  const sb = e.target.closest("#saveBio");
  if (sb) act(async () => {
    await updateDoc(doc(db, "users", uid), { bio: $("#bioInput").value.trim().slice(0, 150) });
    toast("Bio saved"); document.activeElement?.blur(); renderProfile();
  }, sb);
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "bannerInput") return;
  const f = e.target.files[0]; e.target.value = "";
  if (f) act(async () => {
    const banner = await compress(f, { max: 720, quality: 0.6, limitLen: 90000 });
    await updateDoc(doc(db, "users", uid), { banner }); toast("Banner updated");
  });
});

// --- follow ---
const following = new Set();
function startFollows() {
  onSnapshot(query(collection(db, "follows"), where("follower", "==", uid)), (s) => {
    following.clear(); s.docs.forEach((d) => following.add(d.data().target));
    renderProfile(); renderPV();
  }, (e) => toast(friendly(e)));
}
async function toggleFollow(target, isF) {
  const b = writeBatch(db), fid = uid + "_" + target;
  if (isF) { b.delete(doc(db, "follows", fid)); b.update(doc(db, "users", target), { followersCount: increment(-1) }); }
  else { b.set(doc(db, "follows", fid), { follower: uid, target, createdAt: serverTimestamp() }); b.update(doc(db, "users", target), { followersCount: increment(1) }); }
  await b.commit();
}
async function startPublicChat(other) {
  const members = [uid, other].sort(), id = members.join("_");
  if (!(await getDoc(doc(db, "chats", id))).exists()) await setDoc(doc(db, "chats", id), { members, via: "public", createdAt: serverTimestamp() });
  return { id, members };
}

// --- someone's profile (tap their name in a chat, or a search result) ---
let pvUnsub = null, pvId = null;
function openProfileView(id) {
  if (!id || id === uid) return;
  closePV(); pvId = id; $("#profileView").classList.remove("hidden"); renderPV();
  pvUnsub = onSnapshot(doc(db, "users", id), (s) => { people[id] = s.data(); renderPV(); }, () => {});
}
function closePV() { if (pvUnsub) pvUnsub(); pvUnsub = null; pvId = null; $("#profileView").classList.add("hidden"); }
function renderPV() {
  if (!pvId) return;
  const u = people[pvId], body = $("#pvBody");
  if (!u) { body.innerHTML = `<p class="tiny" style="padding:16px">Loading…</p>`; return; }
  const id = pairId(pvId), connected = chats.some((c) => c.id === id), isF = following.has(pvId);
  const msg = connected ? `<button class="btn" data-pv="open">💬 Open chat</button>`
    : u.isPublic ? `<button class="btn" data-pv="msg">💬 Message</button>`
    : outgoing.some((r) => r.id === id) ? `<button class="btn ghost" disabled>Request sent</button>`
    : incoming.some((r) => r.id === id) ? `<button class="btn" data-pv="acc">Accept request</button>`
    : `<button class="btn" data-pv="req">✉️ Send request</button>`;
  body.innerHTML = `<div class="pv-banner" ${hasBanner(u) ? `style="background:${bannerCss(u)}"` : ""}></div><div class="pv-ava">${avatarHTML(u, true)}</div>
    <div class="pv-info"><h2>${esc(nameOf(u))}${vb(u)}</h2><p class="muted">${esc(u.username)}</p><p class="presence ${isOnline(u) ? "on" : ""}">${esc(presenceText(u))}</p>
    ${u.bio ? `<p class="bio">${esc(u.bio)}</p>` : `<p class="tiny">No bio yet.</p>`}
    <p><b>${u.followersCount || 0}</b> <span class="muted">followers</span></p>
    <p class="tiny">${u.isPublic ? "🌍 Public account" : "🔒 Private account"}</p>
    <button class="btn ${isF ? "ghost" : ""}" data-pv="follow">${isF ? "Following ✓" : "Follow"}</button>${msg}</div>`;
}
$("#pvBack").onclick = closePV;
$("#chatTitle").addEventListener("click", () => {
  if (!activeChat) return;
  if (activeChat.group) toast("Members: " + activeChat.members.map((m) => (m === uid ? "You" : nameOf(person(m)))).join(", "));
  else openProfileView(activeChat.members.find((m) => m !== uid));
});
$("#pvBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pv]"); if (!b) return;
  const id = pvId, a = b.dataset.pv;
  act(async () => {
    if (a === "follow") await toggleFollow(id, following.has(id));
    else if (a === "open") { closePV(); openChat(chats.find((c) => c.id === pairId(id))); }
    else if (a === "msg") { const c = await startPublicChat(id); closePV(); openChat(c); }
    else if (a === "req") { const note = prompt("Say hi (optional, max 100 letters)", ""); if (note === null) return; await sendRequest(id, note); toast("Request sent. You can chat after they accept."); }
    else if (a === "acc") { const r = incoming.find((x) => x.id === pairId(id)); if (r) { await acceptRequest(r); toast("Connected! 🎉"); } }
  }, b);
});
$("#searchResults").addEventListener("click", (e) => {
  const pf = e.target.closest("[data-sprof]"); if (pf) { openProfileView(pf.dataset.sprof); return; }
  const ms = e.target.closest("[data-smsg]");
  if (ms) act(async () => { const c = await startPublicChat(ms.dataset.smsg); openChat(c); }, ms);
});

// --- settings ---
const BG_SW = ["#2a1b4d", "radial-gradient(#7b2cff,#1d1040)", "linear-gradient(160deg,#064e5c,#0b1b3a)", "linear-gradient(160deg,#7c2d12,#4c1d95)", "#000"];
let admList = [], admTimer;
let subKey = "";
const SUB_TITLES = { points: "Points & level", edit: "Edit profile", account: "Account", privacy: "Privacy", chats: "Chats", notif: "Notifications", lang: "App language", subs: "Subscriptions", admin: "Admin tools", dash: "Admin dashboard", gifts: "Level gifts", updates: "App Updates" };
function openSub(k) { subKey = k; $("#setTitle").textContent = SUB_TITLES[k] || "Settings"; $("#settings").classList.remove("hidden"); renderSettings(true); }
function shareInvite() {
  const d = { title: "Wordii Chat", text: `Chat with me on Wordii Chat! Find me: ${me.username}`, url: location.origin };
  if (navigator.share) navigator.share(d).catch(() => {}); else { copy(`${d.text} ${d.url}`); toast("Invite copied"); }
}
function renderSettings(force) {
  if (!me || !subKey) return;
  const ae = document.activeElement;
  if (!force && ae && ["INPUT", "TEXTAREA", "SELECT"].includes(ae.tagName) && $("#settingsBody").contains(ae)) return;
  const u = auth.currentUser, email = u?.email && !isFakeEmail(u.email) ? u.email : "";
  const t = pref("theme", "auto"), bg = pref("chatbg", "0"), nOn = pref("notif", "on") === "on";
  const pages = {
    points: () => `<div class="card center"><div class="stats"><div><b>${me.level || 1}</b><span>Level</span></div><div><b>${me.points || 0}</b><span>Points</span></div><div><b>🔥 ${me.streak || 0}</b><span>Streak</span></div></div>
      <div class="bar"><i style="width:${((me.points || 0) % 10) * 10}%"></i></div><p class="tiny">${10 - ((me.points || 0) % 10)} more points to Level ${(me.level || 1) + 1}</p></div>
      <div class="card tiny">Earn points: +4 once a day (streak) and +1 for every active minute. Every 10 points = 1 level.</div>`,
    edit: () => `<div class="card center"><div class="you-ava">${avatarHTML(me, true)}</div><br><button id="logoBtn" class="btn sm ghost" style="margin-top:12px">Change logo</button><input id="logoInput" type="file" accept="image/*" hidden></div>
      <div class="card"><b>Your name</b><p class="tiny">Friends see this name. Your @username stays the same.</p><input id="dnInput" maxlength="30" placeholder="Display name" value="${esc(me.displayName || "")}"><button id="saveName" class="btn">Save name</button></div>
      <div class="card"><b>About you</b><p class="tiny">Your bio and banner show when people open your profile.</p>
        <textarea id="bioInput" maxlength="150" placeholder="Write a short bio">${esc(me.bio || "")}</textarea><button id="saveBio" class="btn">Save bio</button>
        <button id="bannerBtn" class="btn ghost">Change banner</button><input id="bannerInput" type="file" accept="image/*" hidden></div>`,
    account: () => `<div class="card tiny"><b>${esc(me.username)}</b>${vb(me)}<br>${email ? `Gmail: ${esc(email)} ${u.emailVerified ? "✅ verified" : "⚠️ not verified"}` : "No Gmail added yet."}</div>
      ${u?.isAnonymous
        ? `<div class="card"><b>🔐 Protect your account</b><p class="tiny">Add your Gmail and a password. If you delete the app, change phone or forget your password, you can get this account back.</p>
           <input id="emInput" type="email" placeholder="Your Gmail" autocomplete="email" autocapitalize="none"><input id="pwInput" type="password" placeholder="New password (6+ characters)" autocomplete="new-password"><button id="pwBtn" class="btn">Save</button></div>`
        : `<div class="card tiny">✅ Account protected. On a new phone choose <b>Log in</b>. ${isFakeEmail(u?.email) ? "This is an old-style account: log in with your @username + password." : "Forgot your password? Tap <b>Forgot password?</b> on the Log in screen."}</div>`}
      <div class="card"><button class="btn ghost" id="setLogout">Log out</button></div>`,
    privacy: () => `<div class="card"><label class="setrow"><span><b>Public account</b></span><input type="checkbox" id="setPublic" ${me.isPublic ? "checked" : ""}></label>
        <p class="tiny">Public: anyone who finds your username can message you directly. Private: they must send a request and you accept it. Anyone with your 6-digit code can always connect.</p></div>
      <div class="card"><label class="setrow"><span><b>Show when I'm online</b></span><input type="checkbox" id="setShowOnline" ${me.showOnline === false ? "" : "checked"}></label>
        <p class="tiny">Friends see "Active now" while you use the app. Turn it off to hide it (you won't see theirs either way).</p></div>`,
    chats: () => `<div class="card"><b>Theme</b><select id="setTheme"><option value="auto" ${t === "auto" ? "selected" : ""}>Same as my phone</option><option value="dark" ${t === "dark" ? "selected" : ""}>Dark</option><option value="light" ${t === "light" ? "selected" : ""}>Light</option></select>
        <p class="tiny" style="margin-top:12px">Chat background</p>
        <div class="colors">${BG_SW.map((c, i) => `<button type="button" data-bg="${i}" class="${String(i) === bg ? "on" : ""}" style="background:${c}" aria-label="Background ${i + 1}"></button>`).join("")}</div></div>`,
    notif: () => `<div class="card"><label class="setrow"><span><b>Message notifications</b></span><input type="checkbox" id="setNotif" ${nOn ? "checked" : ""}></label>
        <p class="tiny">Alerts inside the app and while it is open or in the background.</p></div>
      <div class="card"><b>Alerts when the app is closed</b>
        <p class="tiny">${pushOn() ? "✅ ON for this phone." : "OFF for this phone."} New messages, chat requests and incoming calls show a notification even if the app is fully closed. (Needs the Wordii push server, see PUSH-SETUP.md.)</p>
        <button class="btn" id="${pushOn() ? "pushOff" : "pushOn"}">${pushOn() ? "Turn off" : "Turn on"}</button></div>`,
    dash: () => `<div class="card center" id="dashStats">Loading…</div><div class="seg"><button data-dtab="active" class="on">Active</button><button data-dtab="new">New</button><button data-dtab="top">Top points</button></div><div id="dashList"></div>`,
    gifts: () => me.admin === true ? `<div class="card"><b>🎁 Manage level gifts</b><p class="tiny">Set a gift name for any level. You can edit or remove it later. Gifts are announcements, not automatically delivered items.</p><label for="giftLevel">Level</label><input id="giftLevel" type="number" min="1" max="10000" placeholder="e.g. 5"><label for="giftName">Gift</label><input id="giftName" maxlength="100" placeholder="e.g. VIP badge"><button id="giftSave" class="btn">Save level gift</button></div><div id="giftList" class="card">Loading gifts…</div>` : `<div class="card">Admin only.</div>`,
    updates: () => `<div class="card">
      <h3>🚀 Wordii Chat Updates</h3>
      <p class="tiny">Check for the latest version of Wordii Chat.</p>
      <button class="btn" id="checkWordiiUpdate">Check for Updates</button>
      <div id="wordiiUpdateResult" style="margin-top:14px"></div>
    </div>`,
    lang: () => `<div class="card tiny">English. Hindi is coming soon.</div>`,
    subs: () => `<div class="card tiny">No paid plans. Everything is free right now.</div>`,
    admin: () => `<div class="card"><b>Give blue ✔ badges</b><p class="tiny">Search a username, then give or remove the verified badge.</p><input id="admSearch" placeholder="Search username" autocapitalize="none" autocomplete="off"><div id="admResults"></div></div>`,
  };
  $("#settingsBody").innerHTML = (pages[subKey] || (() => ""))();
  if (subKey === "admin") renderAdm();
  if (subKey === "dash") loadDash();
  if (subKey === "gifts" && me.admin === true) loadLevelGifts();
}
function renderAdm() {
  const box = $("#admResults"); if (!box) return;
  box.innerHTML = admList.length ? admList.map((u) => `<div class="row nopoint">${avatarHTML(u)}<div class="grow"><b>${esc(nameOf(u))}${vb(u)}</b><span class="muted">${esc(u.username)}</span></div><button class="btn sm ${u.verified ? "ghost" : ""}" data-adm="${esc(u.id)}">${u.verified ? "Remove ✔" : "Give ✔"}</button></div>`).join("") : `<p class="tiny">Type at least 2 letters.</p>`;
}
$("#setBack").onclick = () => $("#settings").classList.add("hidden");
$("#settingsBody").addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "setPublic") act(async () => { await updateDoc(doc(db, "users", uid), { isPublic: t.checked }); toast(t.checked ? "Account is public" : "Account is private"); });
  else if (t.id === "setTheme") { setPref("theme", t.value); applyTheme(); }
  else if (t.id === "setNotif") setPref("notif", t.checked ? "on" : "off");
  else if (t.id === "setShowOnline") act(async () => { await updateDoc(doc(db, "users", uid), { showOnline: t.checked }); toast(t.checked ? "Others can see when you are online" : "Your online status is hidden"); });
});
$("#settingsBody").addEventListener("input", (e) => {
  if (e.target.id !== "admSearch") return;
  clearTimeout(admTimer);
  admTimer = setTimeout(async () => { try { admList = await searchPeople($("#admSearch").value); } catch (err) { toast(friendly(err)); admList = []; } renderAdm(); }, 350);
});
$("#settingsBody").addEventListener("click", (e) => {
  if (e.target.closest("#checkWordiiUpdate")) {
    const result = document.getElementById("wordiiUpdateResult");
    if (!result) return;
    result.textContent = "Checking for updates...";
    fetch("https://api.github.com/repos/xwordii7/wordii-chat/releases/latest")
      .then(async r => {
        if (!r.ok) throw new Error("No published update found yet.");
        return r.json();
      })
      .then(release => {
        const apk = release.assets?.find(a => a.name.endsWith(".apk"));
        result.innerHTML = "";
        const info = document.createElement("p");
        info.textContent = "Latest published version: " + release.tag_name;
        result.appendChild(info);
        if (apk) {
          const link = document.createElement("a");
          link.className = "btn";
          link.href = apk.browser_download_url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Download Update";
          result.appendChild(link);
        } else {
          result.append(" APK not available yet.");
        }
      })
      .catch(err => { result.textContent = err.message; });
    return;
  }
  const bgb = e.target.closest("[data-bg]");
  if (bgb) { setPref("chatbg", bgb.dataset.bg); applyChatBg(); renderSettings(); return; }
  const adm = e.target.closest("[data-adm]");
  if (adm) {
    const u = admList.find((x) => x.id === adm.dataset.adm); if (!u) return;
    act(async () => { await updateDoc(doc(db, "users", u.id), { verified: !u.verified }); u.verified = !u.verified; renderAdm(); toast(u.verified ? "Verified ✔ given" : "Badge removed"); }, adm);
    return;
  }
  if (e.target.closest("#giftSave")) {
    if (me?.admin !== true) { toast("Admin only"); return; }
    const level = Number($("#giftLevel")?.value), gift = $("#giftName")?.value.trim();
    if (!Number.isInteger(level) || level < 1 || level > 10000 || !gift || gift.length > 100) { toast("Enter a valid level and gift"); return; }
    act(async () => { await setDoc(doc(db, "levelRewards", String(level)), { level, gift, updatedAt: serverTimestamp(), updatedBy: uid }); toast("Gift saved"); loadLevelGifts(); }, e.target.closest("#giftSave")); return;
  }
  const giftEdit = e.target.closest("[data-gift-edit]");
  if (giftEdit && me?.admin === true) { $("#giftLevel").value = giftEdit.dataset.giftEdit; $("#giftName").value = giftEdit.dataset.giftName; $("#giftName").focus(); return; }
  const giftRemove = e.target.closest("[data-gift-remove]");
  if (giftRemove && me?.admin === true) {
    const level = giftRemove.dataset.giftRemove;
    if (!confirm(`Remove the gift for level ${level}?`)) return;
    act(async () => { await deleteDoc(doc(db, "levelRewards", level)); toast("Gift removed"); loadLevelGifts(); }, giftRemove); return;
  }
  if (e.target.closest("#setAllow")) Notification.requestPermission().then(() => renderSettings());
  if (e.target.closest("#setInvite")) {
    const d = { title: "Wordii Chat", text: `Chat with me on Wordii Chat! Find me: ${me.username}`, url: location.origin };
    if (navigator.share) navigator.share(d).catch(() => {}); else { copy(`${d.text} ${d.url}`); toast("Invite copied"); }
  }
  if (e.target.closest("#setLogout")) {
    const msg = auth.currentUser?.isAnonymous ? "This account has NO Gmail or password. If you log out you will lose it forever. Log out anyway?" : "Log out? You can log back in with your Gmail and password.";
    if (confirm(msg)) signOut(auth).then(() => location.reload());
  }
});

// --- picker + close friends ---
let closeIds = [];
function loadClose() { try { closeIds = JSON.parse(localStorage.getItem("wordii_close_" + uid)) || []; } catch { closeIds = []; } updateCloseCount(); }
function saveClose() { try { localStorage.setItem("wordii_close_" + uid, JSON.stringify(closeIds)); } catch {} updateCloseCount(); }
function updateCloseCount() { const el = $("#stCloseCount"); if (el) el.textContent = closeIds.length ? `${closeIds.length} selected` : ""; }
const friendIds = () => chats.filter((c) => !c.group).map((c) => c.members.find((m) => m !== uid)).filter(Boolean);
function stAudienceOld() {
  if (!$("#stClose").checked) return { viewers: friendIds() };
  const v = closeIds.filter((id) => friendIds().includes(id));
  if (!v.length) throw new Error("Choose your close friends first.");
  return { viewers: v, close: true };
}
function openPicker(title, selected, onDone) {
  const ids = friendIds(), set = new Set(selected);
  $("#pkTitle").textContent = title;
  $("#pkList").innerHTML = ids.length ? ids.map((id) => `<label class="row nopoint">${avatarHTML(friends[id])}<div class="grow"><b>${esc(nameOf(friends[id]))}</b></div><input type="checkbox" data-pk="${esc(id)}" ${set.has(id) ? "checked" : ""}></label>`).join("") : `<p class="tiny">Connect with friends first.</p>`;
  $("#picker").classList.remove("hidden");
  $("#pkOk").onclick = () => { const out = [...document.querySelectorAll("#pkList [data-pk]")].filter((x) => x.checked).map((x) => x.dataset.pk); $("#picker").classList.add("hidden"); onDone(out); };
  $("#pkCancel").onclick = () => $("#picker").classList.add("hidden");
}
$("#stPick").onclick = () => openPicker("Close friends", closeIds, (ids) => { closeIds = ids; saveClose(); $("#stClose").checked = ids.length > 0; });

// --- status: who saw it, likes ---
const viewed = new Set();
async function ensureView(st) {
  if (viewed.has(st.id)) return; viewed.add(st.id);
  try { await setDoc(doc(db, "statuses", st.id, "views", uid), { liked: false, at: serverTimestamp() }); } catch {}
}
function drawSVBar(st) {
  const bar = $("#svBar");
  const sm = $("#svTop small");
  if (sm && st.mentions?.includes(uid)) sm.append(" · 📣 mentioned you");
  if (sm && st.via) sm.append(" · ↪ shared");
  if (st.ownerUid === uid) { bar.innerHTML = `<button class="btn sm ghost" id="svSeen">👁 Seen by</button>`; return; }
  ensureView(st);
  bar.innerHTML = `<button class="btn sm ghost" id="svLike" data-liked="0">♡ Like</button>` + (st.mentions?.includes(uid) ? `<button class="btn sm" id="svReshare">➕ Add to my status</button>` : "");
  getDoc(doc(db, "statuses", st.id, "views", uid)).then((d) => {
    const b = $("#svLike"); if (b && d.exists() && d.data().liked) { b.dataset.liked = "1"; b.textContent = "❤️ Liked"; }
  }).catch(() => {});
}
async function showSeenBy(st) {
  clearTimeout(sv.t);
  const snap = await getDocs(collection(db, "statuses", st.id, "views"));
  const rows = await Promise.all(snap.docs.map(async (d) => ({ u: (await getDoc(doc(db, "users", d.id))).data(), liked: d.data().liked })));
  let p = $("#seenPanel"); if (!p) { p = document.createElement("div"); p.id = "seenPanel"; $("#statusView").append(p); }
  p.innerHTML = `<div class="inbox-head" style="padding:4px 4px 8px"><b>👁 ${rows.length} seen · ❤️ ${rows.filter((r) => r.liked).length}</b><button class="icon" id="seenClose">✕</button></div>` +
    (rows.length ? rows.map((r) => `<div class="row nopoint">${avatarHTML(r.u)}<div class="grow"><b>${esc(nameOf(r.u))}${vb(r.u)}</b></div>${r.liked ? "❤️" : ""}</div>`).join("") : `<p class="tiny">No views yet.</p>`);
  p.classList.remove("hidden");
}
$("#statusView").addEventListener("click", (e) => {
  const st = sv.list[sv.i];
  if (e.target.closest("#seenClose")) { $("#seenPanel").classList.add("hidden"); drawSV(); return; }
  if (e.target.closest("#svSeen") && st) act(() => showSeenBy(st), e.target.closest("#svSeen"));
  const lk = e.target.closest("#svLike");
  if (lk && st) act(async () => {
    const next = lk.dataset.liked !== "1";
    await updateDoc(doc(db, "statuses", st.id, "views", uid), { liked: next });
    lk.dataset.liked = next ? "1" : "0"; lk.textContent = next ? "❤️ Liked" : "♡ Like";
  }, lk);
});

// ================= v11: WhatsApp-style rows, online status =================
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]"); if (!g) return;
  if (g.dataset.go === "invite") shareInvite(); else openSub(g.dataset.go);
});
const isOnline = (u) => !!u && u.showOnline !== false && !!u.lastSeen?.toMillis && Date.now() - u.lastSeen.toMillis() < 100000;
function presenceText(u) {
  if (!u || u.showOnline === false || !u.lastSeen?.toMillis) return "";
  return isOnline(u) ? "Active now" : "Last seen " + ago(u.lastSeen.toMillis());
}
const avWithDot = (u) => `<div class="avwrap">${avatarHTML(u)}${isOnline(u) ? '<i class="pdot"></i>' : ""}</div>`;
function presenceTick() {
  if (!me || me.showOnline === false || document.visibilityState !== "visible") return;
  updateDoc(doc(db, "users", uid), { lastSeen: serverTimestamp() }).catch(() => {});
}

// ================= v12: hide toggle, typing, voice, groups, status mentions, calls, admin dashboard =================
// --- symbol hiding on/off (per chat, per phone) ---
const hideOn = () => !activeChat || pref("hide_" + activeChat.id, "on") === "on";
function updateHideBtn() { const b = $("#hideBtn"); b.textContent = hideOn() ? "🙈" : "👁️"; b.title = hideOn() ? "Hiding is ON" : "Hiding is OFF"; }
$("#hideBtn").onclick = () => {
  if (!activeChat) return;
  setPref("hide_" + activeChat.id, hideOn() ? "off" : "on"); updateHideBtn(); tickMessages();
  toast(hideOn() ? "Hiding ON: messages turn into symbols / stars" : "Hiding OFF: messages stay readable");
};

// --- typing indicator ---
let unsubTyping = null, typingAt = {}, lastTypingWrite = 0;
function startTyping(c) {
  if (unsubTyping) unsubTyping(); typingAt = {};
  unsubTyping = onSnapshot(collection(db, "chats", c.id, "typing"), (s) => {
    typingAt = {}; s.docs.forEach((d) => { if (d.id !== uid) typingAt[d.id] = d.data().at?.toMillis?.() || 0; }); renderTyping();
  }, () => {});
}
function renderTyping() {
  const el = $("#typingBar"); if (!el || rec) return;
  const now = Date.now(), who = Object.keys(typingAt).filter((id) => now - typingAt[id] < 5000);
  if (!who.length) { el.replaceChildren(); return; }
  const label = activeChat?.group ? who.map((id) => nameOf(person(id))).join(", ") + " is typing" : "typing";
  el.innerHTML = `<span class="wordii-typing-pill"><span class="wordii-typing-label">${esc(label)}</span><span class="wordii-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></span>`;
}
function sendTyping() {
  if (!activeChat || Date.now() - lastTypingWrite < 2500) return;
  lastTypingWrite = Date.now();
  setDoc(doc(db, "chats", activeChat.id, "typing", uid), { at: serverTimestamp() }).catch(() => {});
}
input.addEventListener("input", () => { if (input.value) sendTyping(); });
setInterval(renderTyping, 1000);

// --- voice messages (small recordings stored in the database) ---
let rec = null, recChunks = [], recTimerId = null, recStartAt = 0, recCancelled = false;
function setRecUI(on) { $("#micBtn").textContent = on ? "⏹" : "🎤"; $("#recCancel").classList.toggle("hidden", !on); if (!on) $("#typingBar").textContent = ""; }
async function startRec() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("Voice messages are not supported on this phone or browser.");
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { throw new Error("Allow the microphone to send voice messages."); }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) || "";
  rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 16000 });
  recChunks = []; recCancelled = false;
  rec.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop()); clearInterval(recTimerId);
    const secs = Math.max(1, Math.round((Date.now() - recStartAt) / 1000)), chunks = recChunks, type = rec?.mimeType || mime || "audio/webm";
    rec = null; setRecUI(false);
    if (recCancelled || !activeChat) return;
    try {
      const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(new Blob(chunks, { type })); });
      if (dataUrl.length > 380000) throw new Error("That voice message is too long.");
      await sendMsg({ aud: dataUrl, dur: Math.min(secs, 60) });
    } catch (e) { toast(friendly(e)); }
  };
  rec.start(); recStartAt = Date.now(); setRecUI(true);
  recTimerId = setInterval(() => { const s = Math.round((Date.now() - recStartAt) / 1000); $("#typingBar").textContent = `🔴 Recording ${s}s … tap ⏹ to send`; if (s >= 60) rec?.stop(); }, 500);
}
$("#micBtn").onclick = () => act(async () => { if (rec) rec.stop(); else await startRec(); });
$("#recCancel").onclick = () => { recCancelled = true; rec?.stop(); };

// --- groups ---
$("#newGroupBtn").onclick = () => openPicker("Choose group members (2 or more)", [], (ids) => {
  if (ids.length < 2) { toast("Choose at least 2 friends."); return; }
  const name = (prompt("Group name", "") || "").trim().slice(0, 40); if (!name) return;
  act(async () => {
    const members = [uid, ...ids].slice(0, 20), ref = doc(collection(db, "chats"));
    await setDoc(ref, { members, group: true, name, owner: uid, via: "group", createdAt: serverTimestamp() });
    toast("Group created 🎉"); openChat({ id: ref.id, members, group: true, name });
  });
});

// --- status mentions ---
let mentionIds = [], feedLoaded = false;
function updateMentionCount() { $("#stMentionCount").textContent = mentionIds.length ? `${mentionIds.length} mentioned` : ""; }
function clearMentions() { mentionIds = []; updateMentionCount(); }
$("#stMention").onclick = () => openPicker("Mention friends (they can add it to their status)", mentionIds, (ids) => { mentionIds = ids.slice(0, 10); updateMentionCount(); });
function stAudience() {
  let out;
  if (!$("#stClose").checked) out = { viewers: friendIds() };
  else {
    const v = closeIds.filter((id) => friendIds().includes(id));
    if (!v.length) throw new Error("Choose your close friends first.");
    out = { viewers: v, close: true };
  }
  if (mentionIds.length) { out.mentions = [...mentionIds]; out.viewers = [...new Set([...out.viewers, ...mentionIds])]; }
  return out;
}
document.addEventListener("click", (e) => {
  const rs = e.target.closest("#svReshare"), st = sv.list[sv.i];
  if (!rs || !st) return;
  act(async () => {
    const base = stIsPhoto(st) ? { img: st.img } : { text: st.text, bg: st.bg };
    await addDoc(collection(db, "statuses"), { ownerUid: uid, viewers: friendIds(), ...base, via: st.via || st.ownerUid, createdAt: serverTimestamp() });
    toast("Added to your status ✅");
  }, rs);
});
const statCounts = {};
const statCount = (id) => statCounts[id]?.t || "";
async function loadStatCounts(list) {
  for (const st of list) {
    const c = statCounts[st.id]; if (c && Date.now() - c.at < 20000) continue;
    statCounts[st.id] = { at: Date.now(), t: c?.t || "" };
    try {
      const col = collection(db, "statuses", st.id, "views");
      const [v, l] = await Promise.all([getCountFromServer(col), getCountFromServer(query(col, where("liked", "==", true)))]);
      const t = `👁 ${v.data().count} · ❤ ${l.data().count}`;
      statCounts[st.id] = { at: Date.now(), t };
      const el = document.getElementById("sc_" + st.id); if (el) el.textContent = t;
    } catch {}
  }
}

// Admin gift catalogue: authorization MUST also be enforced in Firestore rules.
async function loadLevelGifts() {
  const box = $("#giftList"); if (!box || me?.admin !== true) return;
  try {
    const snapshot = await getDocs(query(collection(db, "levelRewards"), orderBy("level", "asc"), limit(200)));
    if (!box.isConnected) return;
    box.innerHTML = snapshot.empty ? `<p class="muted">No level gifts yet.</p>` : snapshot.docs.map(d => {
      const v = d.data(), level = Number(v.level);
      if (!Number.isInteger(level) || level < 1) return "";
      return `<div class="gift-row"><div><b>Level ${level}</b><p class="muted">${esc(v.gift)}</p></div><div class="gift-actions"><button type="button" class="btn sm ghost" data-gift-edit="${level}" data-gift-name="${esc(v.gift)}">Edit</button><button type="button" class="btn sm ghost" data-gift-remove="${level}">Remove</button></div></div>`;
    }).join("");
  } catch (e) { box.textContent = friendly(e); }
}

// --- admin dashboard ---
let dashTab = "active";
async function loadDash() {
  const users = collection(db, "users"), now = Date.now(), midnight = new Date().setHours(0, 0, 0, 0);
  try {
    const [all, online, day, today] = await Promise.all([
      getCountFromServer(users),
      getCountFromServer(query(users, where("lastSeen", ">", Timestamp.fromMillis(now - 100000)))),
      getCountFromServer(query(users, where("lastSeen", ">", Timestamp.fromMillis(now - 86400000)))),
      getCountFromServer(query(users, where("createdAt", ">", Timestamp.fromMillis(midnight)))),
    ]);
    const el = $("#dashStats");
    if (el) el.innerHTML = `<div class="stats"><div><b>${all.data().count}</b><span>Users</span></div><div><b>${online.data().count}</b><span>Online now</span></div><div><b>${day.data().count}</b><span>Active 24h</span></div><div><b>${today.data().count}</b><span>New today</span></div></div>`;
  } catch (e) { const el = $("#dashStats"); if (el) el.textContent = friendly(e); }
  loadDashList();
}
async function loadDashList() {
  const box = $("#dashList"); if (!box) return;
  const users = collection(db, "users");
  const q = dashTab === "new" ? query(users, orderBy("createdAt", "desc"), limit(30))
    : dashTab === "top" ? query(users, orderBy("points", "desc"), limit(30))
    : query(users, orderBy("lastSeen", "desc"), limit(30));
  try {
    const rows = (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() }));
    box.innerHTML = rows.length ? rows.map((u) => `<div class="row nopoint">${avWithDot(u)}<div class="grow"><b>${esc(nameOf(u))}${vb(u)}</b><span class="muted">${esc(u.username)} · Lv ${u.level || 1} · ${u.points || 0} pts · 🔥 ${u.streak || 0} · ${u.followersCount || 0} followers<br>${esc(presenceText(u) || "no activity yet")}</span></div></div>`).join("") : `<p class="tiny">Nothing yet.</p>`;
  } catch (e) { box.innerHTML = `<p class="tiny">${esc(friendly(e))}</p>`; }
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-dtab]"); if (!t) return;
  dashTab = t.dataset.dtab; $$("[data-dtab]").forEach((x) => x.classList.toggle("on", x === t)); loadDashList();
});

// --- calls (voice + video, WebRTC; Firestore is only the "switchboard") ---
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }, ...turnServers] };
let call = null, incomingCall = null, incomingUnsub = null, ringCtx = null, ringTimer = null;
function startRing() {
  stopRing();
  const beep = () => {
    try { const o = ringCtx.createOscillator(), g = ringCtx.createGain(); o.frequency.value = 480; g.gain.value = 0.15; o.connect(g); g.connect(ringCtx.destination); o.start(); o.stop(ringCtx.currentTime + 0.35); } catch {}
    navigator.vibrate?.([400, 200, 400]);
  };
  try { ringCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  beep(); ringTimer = setInterval(beep, 1500);
}
function stopRing() { clearInterval(ringTimer); ringTimer = null; try { ringCtx?.close(); } catch {} ringCtx = null; navigator.vibrate?.(0); }
async function getMedia(type) {
  try { return await navigator.mediaDevices.getUserMedia({ audio: true, video: type === "video" ? { facingMode: "user" } : false }); }
  catch { throw new Error("Allow the microphone" + (type === "video" ? " and camera" : "") + " to make calls."); }
}
function setCallState(t) { $("#callState").textContent = t; }
function openCallUI(peerId, type, state) {
  watchPerson(peerId);
  const p = person(peerId);
  $("#callUI").className = type === "video" ? "" : "audio";
  $("#callAva").innerHTML = avatarHTML(p, true); $("#callName").textContent = nameOf(p);
  $("#cCam").classList.toggle("hidden", type !== "video");
  $("#cMute").textContent = "🎙️"; $("#cCam").textContent = "📷"; setCallState(state);
}
function newPC() {
  const pc = new RTCPeerConnection(ICE);
  pc.ontrack = (e) => { const rv = $("#remoteVideo"); if (rv.srcObject !== e.streams[0]) rv.srcObject = e.streams[0]; };
  pc.onconnectionstatechange = () => {
    if (!call || call.pc !== pc) return;
    if (pc.connectionState === "connected" && !call.connected) {
      call.connected = true; clearTimeout(call.timeout); call.t0 = Date.now();
      call.tick = setInterval(() => { const s = Math.floor((Date.now() - call.t0) / 1000); setCallState(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`); }, 1000);
    }
    if (pc.connectionState === "failed") endCall(true, "Could not connect (your network may block calls)");
  };
  return pc;
}
function endCall(sendEnd, msg) {
  if (!call) return;
  const c = call; call = null;
  clearTimeout(c.timeout); clearInterval(c.tick); c.unsubs.forEach((u) => u());
  try { c.pc.close(); } catch {}
  c.stream?.getTracks().forEach((t) => t.stop());
  $("#remoteVideo").srcObject = null; $("#localVideo").srcObject = null;
  if (sendEnd) updateDoc(doc(db, "calls", c.id), { status: c.role === "caller" && !c.connected ? "cancelled" : "ended" }).catch(() => {});
  setCallState(msg || "Call ended"); setTimeout(() => { if (!call) $("#callUI").classList.add("hidden"); }, 1200);
}
function watchCandidates(callId, which, pc, unsubs) {
  unsubs.push(onSnapshot(collection(db, "calls", callId, which), (s) => s.docChanges().forEach((ch) => {
    if (ch.type === "added") pc.addIceCandidate(JSON.parse(ch.doc.data().c)).catch(() => {});
  }), () => {}));
}
async function startCall(type) {
  if (!activeChat || activeChat.group || call) return;
  if (!window.RTCPeerConnection) throw new Error("Calls are not supported on this phone or browser.");
  const peer = activeChat.members.find((m) => m !== uid);
  const stream = await getMedia(type), pc = newPC();
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  const callRef = doc(collection(db, "calls"));
  call = { id: callRef.id, pc, stream, type, role: "caller", peer, unsubs: [], connected: false, answered: false };
  openCallUI(peer, type, "Calling…"); $("#localVideo").srcObject = stream;
  const pending = []; let ready = false;
  const sendCand = (c) => addDoc(collection(db, "calls", callRef.id, "callerCandidates"), { c }).catch(() => {});
  pc.onicecandidate = (e) => { if (!e.candidate) return; const c = JSON.stringify(e.candidate); if (ready) sendCand(c); else pending.push(c); };
  try {
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    await setDoc(callRef, { caller: uid, callee: peer, type, status: "ringing", offer: { type: offer.type, sdp: offer.sdp }, createdAt: serverTimestamp() });
  } catch (e) { endCall(false, "Could not start the call"); throw e; }
  ready = true; pending.forEach(sendCand);
  call.unsubs.push(onSnapshot(callRef, async (s) => {
    const d = s.data(); if (!d || !call || call.id !== callRef.id) return;
    if (d.answer && !call.answered) { call.answered = true; setCallState("Connecting…"); try { await pc.setRemoteDescription(d.answer); } catch {} }
    if (["declined", "ended", "cancelled"].includes(d.status)) endCall(false, d.status === "declined" ? "Declined" : "Call ended");
  }));
  watchCandidates(callRef.id, "calleeCandidates", pc, call.unsubs);
  call.timeout = setTimeout(() => { if (call && !call.connected) endCall(true, "No answer"); }, 40000);
}
async function acceptCall(d) {
  hideIncoming();
  let stream;
  try { stream = await getMedia(d.type); } catch (e) { updateDoc(doc(db, "calls", d.id), { status: "declined" }).catch(() => {}); throw e; }
  const pc = newPC();
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  call = { id: d.id, pc, stream, type: d.type, role: "callee", peer: d.caller, unsubs: [], connected: false };
  openCallUI(d.caller, d.type, "Connecting…"); $("#localVideo").srcObject = stream;
  pc.onicecandidate = (e) => { if (e.candidate) addDoc(collection(db, "calls", d.id, "calleeCandidates"), { c: JSON.stringify(e.candidate) }).catch(() => {}); };
  try {
    await pc.setRemoteDescription(d.offer);
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    await updateDoc(doc(db, "calls", d.id), { status: "accepted", answer: { type: answer.type, sdp: answer.sdp } });
  } catch (e) { endCall(true, "Could not answer"); throw e; }
  watchCandidates(d.id, "callerCandidates", pc, call.unsubs);
  call.unsubs.push(onSnapshot(doc(db, "calls", d.id), (s) => {
    const x = s.data(); if (call && x && ["ended", "cancelled"].includes(x.status)) endCall(false, "Call ended");
  }, () => {}));
  call.timeout = setTimeout(() => { if (call && !call.connected) endCall(true, "Could not connect"); }, 30000);
}
function showIncoming(d) {
  incomingCall = d; watchPerson(d.caller);
  const draw = () => { const p = person(d.caller); $("#incAva").innerHTML = avatarHTML(p, true); $("#incName").textContent = nameOf(p); };
  draw(); setTimeout(() => { if (incomingCall?.id === d.id) draw(); }, 800);
  $("#incType").textContent = d.type === "video" ? "Incoming video call…" : "Incoming voice call…";
  $("#incoming").classList.remove("hidden"); startRing();
  notify(`Incoming ${d.type} call`, "call");
  incomingUnsub = onSnapshot(doc(db, "calls", d.id), (s) => { if (!s.exists() || s.data().status !== "ringing") hideIncoming(); }, () => {});
  setTimeout(() => { if (incomingCall?.id === d.id) hideIncoming(); }, 45000);
}
function hideIncoming() { stopRing(); if (incomingUnsub) incomingUnsub(); incomingUnsub = null; incomingCall = null; $("#incoming").classList.add("hidden"); }
function startCalls() {
  onSnapshot(query(collection(db, "calls"), where("callee", "==", uid), where("status", "==", "ringing")), (s) => {
    s.docChanges().forEach((ch) => {
      if (ch.type !== "added") return;
      const d = { id: ch.doc.id, ...ch.doc.data() };
      if (Date.now() - (d.createdAt?.toMillis?.() || Date.now()) > 45000) return;
      if (call || incomingCall) { updateDoc(doc(db, "calls", d.id), { status: "declined" }).catch(() => {}); return; }
      showIncoming(d);
    });
  }, () => {});
}
$("#incDecline").onclick = () => { const d = incomingCall; hideIncoming(); if (d) updateDoc(doc(db, "calls", d.id), { status: "declined" }).catch(() => {}); };
$("#incAccept").onclick = (e) => { const d = incomingCall; if (d) act(() => acceptCall(d), e.currentTarget); };
$("#callBtn").onclick = (e) => act(() => startCall("audio"), e.currentTarget);
$("#vidBtn").onclick = (e) => act(() => startCall("video"), e.currentTarget);
$("#cMute").onclick = () => { const t = call?.stream?.getAudioTracks()[0]; if (!t) return; t.enabled = !t.enabled; $("#cMute").textContent = t.enabled ? "🎙️" : "🔇"; };
$("#cCam").onclick = () => { const t = call?.stream?.getVideoTracks()[0]; if (!t) return; t.enabled = !t.enabled; $("#cCam").textContent = t.enabled ? "📷" : "🚫"; };
$("#cEnd").onclick = () => endCall(true, "Call ended");

// ================= v13: phone push notifications (app closed) =================
const pushOn = () => pref("push", "off") === "on" && "Notification" in window && Notification.permission === "granted";
const b64ToU8 = (b64) => { const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!vapidPublicKey && !vapidPublicKey.startsWith("PASTE");
async function savePushSub(sub) {
  const j = sub.toJSON(), entry = { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
  const ref = doc(db, "users", uid, "private", "push");
  const cur = (await getDoc(ref)).data()?.subs || [];
  await setDoc(ref, { subs: [entry, ...cur.filter((x) => x.endpoint !== entry.endpoint)].slice(0, 5) });
}
async function getSub() {
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(vapidPublicKey) });
}
async function enablePush() {
  if (!pushSupported()) throw new Error("Push alerts are not supported on this phone/browser.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked. Allow them in your phone's app settings.");
  await savePushSub(await getSub()); setPref("push", "on");
}
async function disablePush() {
  setPref("push", "off");
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) {
      const ep = sub.endpoint; await sub.unsubscribe();
      const ref = doc(db, "users", uid, "private", "push"), cur = (await getDoc(ref)).data()?.subs || [];
      await setDoc(ref, { subs: cur.filter((x) => x.endpoint !== ep) });
    }
  } catch {}
}
async function syncPush() { if (pushOn() && pushSupported()) { try { await savePushSub(await getSub()); } catch {} } }
document.addEventListener("click", (e) => {
  const on = e.target.closest("#pushOn"), off = e.target.closest("#pushOff");
  if (on) act(async () => { await enablePush(); toast("Alerts when closed: ON ✅"); renderSettings(true); }, on);
  if (off) act(async () => { await disablePush(); toast("Alerts when closed: OFF"); renderSettings(true); }, off);
});

// Wordii Chat - Android Back Button Navigation
(function setupAndroidBackButton() {
  let lastBack = 0;

  function visible(id) {
    const el = document.getElementById(id);
    return el && !el.classList.contains("hidden");
  }

  function handleBack() {
    if (visible("callUI")) {
      document.getElementById("cEnd")?.click();
      return;
    }

    if (visible("picker")) {
      document.getElementById("pkCancel")?.click();
      return;
    }

    if (visible("statusView")) {
      closeSV();
      return;
    }

    if (visible("profileView")) {
      closePV();
      return;
    }

    if (visible("settings")) {
      document.getElementById("setBack")?.click();
      return;
    }

    if (visible("inbox")) {
      document.getElementById("inboxClose")?.click();
      return;
    }

    if (visible("chat")) {
      closeChat();
      showTab("chats");
      return;
    }

    if (visible("app")) {
      const now = Date.now();

      if (now - lastBack < 2000) {
        window.Capacitor?.Plugins?.App?.exitApp();
      } else {
        lastBack = now;
        toast("Press back again to exit");
      }
      return;
    }

    toast("Please finish signing in");
  }

  function register() {
    const nativeApp = window.Capacitor?.Plugins?.App;

    if (nativeApp?.addListener) {
      nativeApp.addListener("backButton", handleBack);
    } else {
      window.addEventListener("popstate", handleBack);
    }
  }

  register();
})();
