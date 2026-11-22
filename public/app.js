import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, linkWithCredential, EmailAuthProvider, signInWithEmailAndPassword, signOut, sendEmailVerification, sendPasswordResetEmail, verifyBeforeUpdateEmail, PhoneAuthProvider, RecaptchaVerifier } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, getDocs, runTransaction, getCountFromServer, setDoc, updateDoc, deleteDoc, writeBatch, increment, collection, query, where, orderBy, limit, startAfter, onSnapshot, addDoc, serverTimestamp, Timestamp, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { getStorage, ref as storageRef, uploadBytes, getBlob } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
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
  return e.code === "permission-denied" ? "Firebase permission denied. Check Story rules and login." : (e.code ? "[" + e.code + "] " : "") + (e.message || "Something went wrong");
}
// Wordii v1.5.2: original role badge artwork. Flags still come only from stored user permissions.
const wdRoleIcon = (asset, label) => `<img class="wd-role-icon" src="wordii-badges/${asset}_icon.png" alt="${label} badge" title="${label}" loading="lazy" decoding="async">`;
const vb = (u) => (u?.admin === true ? wdRoleIcon('admin', 'Admin') : '') + (u?.preAdmin === true ? wdRoleIcon('pre_admin', 'Pre-Admin') : '') + (u?.premium === true ? wdRoleIcon('premium_user', 'Premium User') : '') + (u?.verified === true ? wdRoleIcon('verified_user', 'Verified User') : '');
const canBTP = () => me?.admin === true || me?.preAdmin === true;
// Wordii Ad Controls v1: client-side eligibility only. SDK must enforce this at every ad request.
// Do not award EXP here; rewarded EXP requires verified server-side completion.
const WORDII_AD_IDS = Object.freeze({
  app: 'ca-app-pub-5814222285253168~5537679277',
  banner: 'ca-app-pub-5814222285253168/3032815766',
  native: 'ca-app-pub-5814222285253168/4777589383',
  rewarded: 'ca-app-pub-5814222285253168/8525262700',
  appOpen: 'ca-app-pub-5814222285253168/5899099368',
  interstitial: 'ca-app-pub-5814222285253168/1719734094'
});
function wordiiStaffAdsEnabled(user = me) {
  if (!user?.admin && !user?.preAdmin) return true;
  if (!uid) return false;
  try { return localStorage.getItem('wordii_staff_ads_' + uid) === 'on'; }
  catch (_) { return false; }
}
function wordiiAdPolicy(user = me) {
  const staff = user?.admin === true || user?.preAdmin === true;
  if (staff && !wordiiStaffAdsEnabled(user)) return { enabled:false, tier:'staff-off', intervalMs:Infinity };
  if (user?.premium === true && !staff) return { enabled:true, tier:'premium', intervalMs:30*60*1000 };
  return { enabled:true, tier:staff?'staff-opt-in':'standard', intervalMs:15*60*1000 };
}
// Future native AdMob bridge MUST consult this before banner/native/app-open/interstitial loads.
// Never place ads inside message composer or during a conversation.
window.wordiiAdPolicy = () => wordiiAdPolicy();

// Wordii AdMob production bridge: real ad unit IDs. No client-side XP grants.
// Real impressions and revenue depend on AdMob approval and policy compliance.
let wordiiAdMobInit = null;
let wordiiTestBannerShown = false;
function wordiiNativeAdMob() {
  return window.Capacitor?.isNativePlatform?.() ? window.Capacitor?.Plugins?.AdMob : null;
}
function wordiiAdTestAllowed() {
  return !!(me && uid && !me.suspended && wordiiAdPolicy().enabled &&
    !document.querySelector('#settings')?.classList.contains('hidden') && (subKey === 'ads' || subKey === 'points') &&
    document.querySelector('#chat')?.classList.contains('hidden'));
}
async function wordiiInitTestAds() {
  const sdk = wordiiNativeAdMob();
  if (!sdk) throw new Error('Ads require the updated Android APK.');
  if (!wordiiAdMobInit) {
    wordiiAdMobInit = sdk.initialize({ initializeForTesting: false, maxAdContentRating: 'General' })
      .catch(err => { wordiiAdMobInit = null; throw err; });
  }
  await wordiiAdMobInit;
  return sdk;
}
async function wordiiHideTestBanner() {
  if (!wordiiTestBannerShown) return;
  wordiiTestBannerShown = false;
  try { await wordiiNativeAdMob()?.removeBanner(); } catch (err) { console.warn('Ad banner cleanup:', err); }
}
async function wordiiShowTestBanner() {
  if (!wordiiAdTestAllowed()) throw new Error('Ads are disabled for this account or screen.');
  const sdk = await wordiiInitTestAds();
  if (!wordiiAdTestAllowed()) return;
  await sdk.showBanner({ adId: WORDII_AD_IDS.banner, isTesting: false, position: 'BOTTOM_CENTER' });
  wordiiTestBannerShown = true;
}
async function wordiiShowTestRewarded() {
  if (!wordiiAdTestAllowed()) throw new Error('Ads are disabled for this account or screen.');
  const sdk = await wordiiInitTestAds();
  if (!wordiiAdTestAllowed()) return;
  await sdk.prepareRewardVideoAd({ adId: WORDII_AD_IDS.rewarded, isTesting: false });
  if (!wordiiAdTestAllowed()) return;
  await sdk.showRewardVideoAd();
  // EXP intentionally disabled until verified AdMob SSV backend exists.
}

const canGreenTheme = (u) => u?.admin === true || u?.preAdmin === true || u?.premium === true;
const wordiiStoryRole = (u) => u?.admin === true || u?.preAdmin === true ? 'story-gold-flame' : u?.premium === true ? 'story-purple-flame' : '';

async function act(fn, btn) { if (btn) btn.disabled = true; try { await fn(); } catch (e) { toast(friendly(e)); } finally { if (btn) btn.disabled = false; } }
function legacyCopy(text) { const t = document.createElement("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
function copy(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  legacyCopy(text);
}

if (firebaseConfig.apiKey.startsWith("PASTE")) { fatal(new Error("Open public/firebase-config.js and paste your Firebase config.")); throw new Error("Missing Firebase config"); }
const app = initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app);

// Admin-managed in-app branding; not the installed Android launcher icon.
const WORDII_DEFAULT_LOGO = "wordii-logo-e.png";
let wordiiBrandLogo = WORDII_DEFAULT_LOGO;
function wordiiApplyBrandLogo(src) {
  wordiiBrandLogo = src || WORDII_DEFAULT_LOGO;
  document.querySelectorAll('img[src="wordii-logo-e.png"], img[data-wordii-brand]').forEach(el => {
    el.dataset.wordiiBrand = "1";
    if (el.getAttribute("src") !== wordiiBrandLogo) el.src = wordiiBrandLogo;
  });
}
// Official bot announcements shown while Wordii is open. No background push is claimed.
onSnapshot(doc(db,'wordiiConfig','botAnnouncement'),snap=>{
  const data=snap.data();if(!data?.text||!data.updatedAt||!auth.currentUser||pref('notif','on')!=='on')return;
  const stamp=data.updatedAt.seconds+'-'+data.updatedAt.nanoseconds;
  if(sessionStorage.getItem('wd-bot-announcement')===stamp)return;
  sessionStorage.setItem('wd-bot-announcement',stamp);
  // Announcements are read in the Wordii Assistant conversation, not as startup popups.
},()=>{});
onSnapshot(doc(db, "wordiiConfig", "appBranding"), snap => {
  const v = snap.exists() ? snap.data().logo : "";
  wordiiApplyBrandLogo(typeof v === "string" && /^data:image\/jpeg;base64,/.test(v) ? v : WORDII_DEFAULT_LOGO);
}, () => {});
async function wordiiSaveBrand(file) {
  if (me?.admin !== true) throw new Error("Admin only");
  const logo = await compress(file, {max:256,square:true,quality:0.65,limitLen:85000});
  await setDoc(doc(db,"wordiiConfig","appBranding"), {logo,updatedAt:serverTimestamp(),updatedBy:uid});
  wordiiApplyBrandLogo(logo);
}
document.addEventListener("change", e => {
  if (e.target.id === "wdBrandFile" && e.target.files[0]) {
    const f=e.target.files[0];
    compress(f,{max:256,square:true,quality:0.65,limitLen:85000}).then(v=>{const img=document.getElementById("wdBrandPreview");if(img)img.src=v;}).catch(err=>toast(friendly(err)));
  }
});
document.addEventListener("click", e => {
  if(e.target.closest("#wdOpenCode")){ $("#settings").classList.add("hidden"); showTab("connect"); $("#myCode")?.scrollIntoView({block:"center"}); }
  if (e.target.closest("#wdBrandSave")) act(async()=>{
    const f=document.getElementById("wdBrandFile")?.files?.[0];
    if(!f)throw new Error("Choose a logo image first");
    await wordiiSaveBrand(f);toast("Logo applied for everyone");
  },e.target.closest("#wdBrandSave"));
  if (e.target.closest("#wdBrandReset")) act(async()=>{
    if(me?.admin!==true)throw new Error("Admin only");
    await setDoc(doc(db,"wordiiConfig","appBranding"),{logo:"",updatedAt:serverTimestamp(),updatedBy:uid});
    wordiiApplyBrandLogo(WORDII_DEFAULT_LOGO);toast("Logo E restored");
  },e.target.closest("#wdBrandReset"));
});

const WORDII_WEB_VERSION = "1.5.20";

// APK updater: installed Android version is authoritative; the web bundle version is not.
const WORDII_RELEASES_API = "https://api.github.com/repos/xwordii7/wordii-chat/releases/latest";
let wordiiUpdateCheckPending = null;
function wordiiSemver(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:$|[-+])/i);
  return match ? match.slice(1,4).map(Number) : null;
}
function wordiiVersionCompare(a,b) {
  const x=wordiiSemver(a), y=wordiiSemver(b);
  if (!x || !y) return null;
  for (let i=0;i<3;i++) if (x[i]!==y[i]) return x[i]>y[i]?1:-1;
  return 0;
}
function wordiiIsNativeAndroid() {
  return window.Capacitor?.isNativePlatform?.() === true && window.Capacitor?.getPlatform?.() === "android";
}
async function wordiiInstalledVersion() {
  if (!wordiiIsNativeAndroid()) return null;
  const plugin=window.Capacitor?.Plugins?.App;
  if (!plugin?.getInfo) throw Error("Android app version could not be read. Update the APK first.");
  const info=await plugin.getInfo();
  if (info.id !== "com.wordii.chat") throw Error("Unexpected Android package ID.");
  if (!wordiiSemver(info.version)) throw Error("Installed APK version is invalid.");
  return info.version;
}
function wordiiUpdateModal(release, apk, installed) {
  let overlay=document.getElementById("wordiiApkUpdateModal");
  if (!overlay) {
    overlay=document.createElement("div");
    overlay.id="wordiiApkUpdateModal";
    overlay.className="wordii-apk-update-overlay";
    overlay.innerHTML='<div class="wordii-apk-update-card" role="dialog" aria-modal="true" aria-labelledby="wordiiApkUpdateTitle"><div class="wordii-apk-update-icon">🚀</div><h2 id="wordiiApkUpdateTitle">Update Available</h2><p id="wordiiApkUpdateDescription"></p><div class="wordii-apk-update-actions"><button type="button" class="btn ghost" id="wordiiApkLater">Later</button><a class="btn" id="wordiiApkDownload" target="_blank" rel="noopener noreferrer">Download Update</a></div><p class="tiny">Android will ask you to approve installation. Your account stays unchanged.</p></div>';
    document.body.append(overlay);
    overlay.querySelector("#wordiiApkLater").addEventListener("click",()=>overlay.remove());
  }
  overlay.querySelector("#wordiiApkUpdateDescription").textContent=`Wordii Chat v${release.tag_name.replace(/^v/i, "")} is available. Installed APK: v${installed}.`;
  overlay.querySelector("#wordiiApkDownload").href=apk.browser_download_url;
}
async function wordiiCheckForApkUpdate({manual=false,result=null}={}) {
  if (wordiiUpdateCheckPending) return wordiiUpdateCheckPending;
  const task=(async()=>{
    const installed=await wordiiInstalledVersion();
    if (!installed && !manual) return;
    const response=await fetch(WORDII_RELEASES_API,{headers:{Accept:"application/vnd.github+json"},cache:"no-store"});
    if (!response.ok) throw Error(response.status===403?"GitHub rate limit reached. Try again later.":"Could not check GitHub Releases (HTTP "+response.status+").");
    const release=await response.json();
    const version=release.tag_name;
    if (!wordiiSemver(version)) throw Error("Latest release has no valid version tag.");
    const apk=(release.assets||[]).find(a=>typeof a.name==="string" && /\.apk$/i.test(a.name) && /^https:\/\/github\.com\/xwordii7\/wordii-chat\/releases\/download\//.test(a.browser_download_url||""));
    if (!apk) {
      if (result) result.textContent=`Release ${version} has no downloadable APK asset yet.`;
      return;
    }
    if (!installed) {
      if (result) result.textContent="This is the web version. APK updates are checked automatically in the Android app.";
      return;
    }
    const comparison=wordiiVersionCompare(version,installed);
    if (comparison===null) throw Error("Cannot compare the installed and released APK versions.");
    if (comparison<=0) {
      if (result) result.textContent=`✅ APK is up to date (v${installed}).`;
      return;
    }
    if (result) result.textContent=`Update available: ${version} (installed v${installed}).`;
    wordiiUpdateModal(release,apk,installed);
  })();
  wordiiUpdateCheckPending=task;
  try { await task; }
  catch(error) { if (result) result.textContent=error.message||"Update check failed."; else console.warn("Wordii APK update check:",error.message||error); }
  finally { wordiiUpdateCheckPending=null; }
}
// Check once per app launch and again when Android returns to the foreground.
function wordiiStartUpdateChecks() {
  if (!wordiiIsNativeAndroid()) return;
  wordiiCheckForApkUpdate();
  const plugin=window.Capacitor?.Plugins?.App;
  plugin?.addListener?.("appStateChange",state=>{
    if (state.isActive && !document.getElementById("wordiiApkUpdateModal")) wordiiCheckForApkUpdate();
  });
}
if (document.readyState==="loading") document.addEventListener("DOMContentLoaded",wordiiStartUpdateChecks,{once:true});
else wordiiStartUpdateChecks();

// Wordii Media API authentication self-test. Never logs or displays the ID token.
async function wordiiTestMediaAuth() {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) { toast("Log in with your registered account first."); return; }
  try {
    const token = await user.getIdToken();
    const res = await fetch("https://wordii-media-api.officialwordii.workers.dev/auth-check", {
      method: "GET", headers: { "Authorization": "Bearer " + token }
    });
    const result = await res.json();
    toast(res.ok && result.authenticated === true ? "Media API login verified!" : "Media API test: " + (result.error || res.status));
  } catch (error) { toast("Media API test failed: " + (error.message || error)); }
}




let uid = null, me = null, chats = [], started = false, firstChats = true;
let lastSeenLevel = null;
let suspensionShown = false;
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
  if (!u) {
    if (wordiiOneSignalStarted && wordiiOneSignal()) {
      wordiiOneSignal().logout();
      wordiiOneSignalUser = null;
    }
    signInAnonymously(auth).catch(fatal);
    return;
  }
  if (authStarted) return;
  authStarted = true; uid = u.uid;
  onSnapshot(doc(db, "users", uid), (s) => {
    $("#splash").classList.add("hidden");
    if (!s.exists()) { me = null; $("#app").classList.add("hidden"); $("#onboard").classList.remove("hidden"); return; }
    const incoming = s.data();
    if (incoming.suspended === true) {
      me = incoming;
    wordiiInitOneSignal();
    wordiiSyncOneSignalUser();
      showSuspendedAccount();
      return;
    }
    if (suspensionShown) { document.getElementById('wordiiSuspended')?.remove(); suspensionShown = false; }

    const currentLevel = Number(incoming.level) || 1;
    if (lastSeenLevel !== null && currentLevel > lastSeenLevel) showLevelCelebration(currentLevel);
    lastSeenLevel = currentLevel;
    me = incoming;
    if (!wordiiAdPolicy().enabled) void wordiiHideTestBanner();
    $("#onboard").classList.add("hidden"); $("#app").classList.remove("hidden");
    if (!started) { started = true; startApp(); wordiiOpenSharedProfile(); }
    renderProfile(); checkGate();
  }, fatal);
});

function showSuspendedAccount() {
  suspensionShown = true;
  $('#splash').classList.add('hidden');
  $('#app').classList.add('hidden');
  $('#onboard').classList.add('hidden');
  let panel = document.getElementById('wordiiSuspended');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'wordiiSuspended';
    panel.innerHTML = `<div class="wd-suspend-card" role="dialog" aria-modal="true" aria-label="Account suspended"><div style="font-size:40px">🔒</div><h2>Account Suspended</h2><p>Your Wordii Chat account is currently suspended. You cannot chat or use the app.</p><p id="wdSuspendId"></p><div class="wd-suspend-actions"><button type="button" class="btn ghost" id="wdSuspendLogout">Log out</button><button type="button" class="btn" id="wdSuspendAppeal">Appeal</button></div><div id="wdAppealBox" class="hidden"><textarea id="wdAppealText" maxlength="500" rows="4" placeholder="Explain why your account should be restored (10–500 characters)"></textarea><button type="button" class="btn" id="wdAppealSend">Send appeal</button></div><p class="tiny" id="wdAppealNotice"></p></div>`;
    document.body.append(panel);
    panel.querySelector('#wdSuspendLogout').onclick = () => signOut(auth).then(() => location.reload());
    panel.querySelector('#wdSuspendAppeal').onclick = () => panel.querySelector('#wdAppealBox').classList.toggle('hidden');
    panel.querySelector('#wdAppealSend').onclick = e => act(async () => {
      const message = panel.querySelector('#wdAppealText').value.trim();
      if (message.length < 10 || message.length > 500) throw Error('Appeal must be 10–500 characters');
      await setDoc(doc(db, 'suspensionAppeals', uid), {uid, message, status:'pending', createdAt:serverTimestamp()});
      panel.querySelector('#wdAppealNotice').textContent = 'Appeal sent to Admin. Please wait for review.';
      panel.querySelector('#wdAppealBox').classList.add('hidden');
    }, e.currentTarget);
  }
  panel.querySelector('#wdSuspendId').textContent = `Account: ${me?.username || uid}`;
}

async function createProfile(raw) {
  const name = raw.trim().toLowerCase().replace(/^@/, "");
  if (!/^[a-z0-9_]{3,15}$/.test(name))
    throw new Error("Username must be 3-15 letters, numbers or _.");

  const key = name;
  const usernameRef = doc(db, "usernames", key);
  const userRef = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(usernameRef);
    const existingProfile = await tx.get(userRef);
    if (existingProfile.exists())
      throw new Error("This account already has a username.");
    if (existing.exists())
      throw new Error("Username already taken. Try another username.");

    tx.set(usernameRef, { uid, createdAt: serverTimestamp() });
    tx.set(userRef, {
      username: "@" + name,
      usernameKey: key,
      createdAt: serverTimestamp()
    });
  });

  return key;
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
// Three-step signup UI. Existing Firebase registration remains unchanged.
let wdSignupStep=0;
function wdRenderSignup(){
  document.querySelectorAll('#paneNew .wd-signup-step').forEach((el,i)=>el.classList.toggle('hidden',i!==wdSignupStep));
  const labels=['Username','Email','Password'];
  const progress=document.getElementById('wdSignupProgress');if(progress)progress.textContent=`Step ${wdSignupStep+1} of 3 · ${labels[wdSignupStep]}`;
  document.getElementById('wdSignupBack')?.classList.toggle('hidden',wdSignupStep===0);
  document.getElementById('wdSignupNext')?.classList.toggle('hidden',wdSignupStep===2);
  document.getElementById('createBtn')?.classList.toggle('hidden',wdSignupStep!==2);
}
document.getElementById('wdSignupNext')?.addEventListener('click',()=>{
  if(wdSignupStep===0 && !/^[a-zA-Z0-9_]{3,15}$/.test(document.getElementById('nameInput').value.trim())){toast('Use 3–15 letters, numbers or underscores.');return;}
  if(wdSignupStep===1 && !EMAIL_RE.test(document.getElementById('newEmail').value.trim())){toast('Enter a valid Gmail address.');return;}
  wdSignupStep=Math.min(2,wdSignupStep+1);wdRenderSignup();
});
document.getElementById('wdSignupBack')?.addEventListener('click',()=>{wdSignupStep=Math.max(0,wdSignupStep-1);wdRenderSignup();});
wdRenderSignup();
$("#modeNew").onclick = () => setMode("new");
$("#modeLogin").onclick = () => setMode("login");
$("#adminLink").onclick = (e) => { e.preventDefault(); $("#paneAdmin").classList.toggle("hidden"); };
$("#createBtn").onclick = (e) => act(async () => {
  const email = $("#newEmail").value.trim().toLowerCase(), pw = $("#newPw").value;
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid Gmail address.");
  if (pw.length < 6) throw new Error("Password must be at least 6 characters.");
  const username = $("#nameInput").value;
  const currentUser = auth.currentUser;

  if (currentUser.isAnonymous) {
    await linkEmail(email, pw);
  } else if (currentUser.email?.toLowerCase() !== email) {
    throw new Error("This session is linked to another Gmail. Log out and use the correct account.");
  }

  await createProfile(username);
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
// New admin registration is disabled.
// Existing admins can still log in using Admin Login.
const adminCreateBtn = $("#adminBtn");
if (adminCreateBtn) {
  adminCreateBtn.disabled = true;
  adminCreateBtn.hidden = true;
}

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
    if (activeChat) renderChatTitle();
    renderWordiiGroupInfo();
  }, (e) => toast(friendly(e)));
  myCode = loadCode();
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
// Premium navigation mirrors existing working tabs; Calls opens the available call list.
function syncPremiumTabs(name) {
  $$(".premium-tabs button").forEach(b => b.classList.toggle("on", b.dataset.premiumTab === name));
}
$$('.premium-tabs button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.premiumTab === 'calls') {
    $$('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-calls'));
    $$('.bottom button').forEach(x => x.classList.remove('on'));
    syncPremiumTabs('calls');
    renderCallFriends();
  } else showTab(b.dataset.premiumTab);
}));
$$('.bottom button').forEach(b => b.addEventListener('click', () => syncPremiumTabs(b.dataset.tab)));

function renderCallFriends(){
  const box=$('#callFriends');if(!box)return;
  const direct=chats.filter(c=>!c.group && c.members?.includes(uid));
  box.innerHTML=direct.length ? direct.map(c=>{
    const f=friends[c.members.find(id=>id!==uid)];
    return `<div class="row call-friend">${avatarHTML(f)}<div class="grow"><b>${esc(nameOf(f))}</b><span class="muted">${isOnline(f)?'Online':'Connected'}</span></div><button class="call-launch" data-call-id="${esc(c.id)}" data-call-type="audio" aria-label="Voice call">♧</button><button class="call-launch" data-call-id="${esc(c.id)}" data-call-type="video" aria-label="Video call">▣</button></div>`;
  }).join('') : '<div class="card center muted">No connected friends yet. Open Connect to add a friend.</div>';
}
$('#callFriends').addEventListener('click',e=>{
  const btn=e.target.closest('[data-call-id]');if(!btn)return;
  const c=chats.find(c=>c.id===btn.dataset.callId);if(!c)return;
  openChat(c);
  act(()=>startCall(btn.dataset.callType),btn);
});

$('#storyRail').addEventListener('click', e => {
  // The plus control always creates a new story, even when stories already exist.
  if (e.target.closest('[data-add-story]')) { openWordiiStory(); return; }
  const item=e.target.closest('[data-story-owner]');
  if (!item) return;
  if (item.dataset.storyOwner === 'me') { const mine=mineAlive(); if(mine.length) openSV(mine); else openWordiiStory(); return; }
  openSV(friendGroups()[item.dataset.storyOwner] || []);
});
function renderStoryRail() {
  const rail=$('#storyRail'); if (!rail) return;
  const myAvatar=me ? avatarHTML(me) : '<div class="avatar">W</div>';
  const groups=friendGroups();
  const others=Object.entries(friends).filter(([id,f]) => !!f && (groups[id] || []).length).slice(0,12);
  rail.innerHTML=`<button type="button" class="story" data-story-owner="me" aria-label="View my status"><span class="story-circle ${wordiiStoryRole(me)}">${myAvatar}<i data-add-story="true" role="button" aria-label="Add another status" title="Add status">+</i></span><small>My status</small></button>` +
    others.map(([id,f]) => `<button type="button" class="story" data-story-owner="${esc(id)}"><span class="story-circle ${wordiiStoryRole(f)}">${avatarHTML(f)}</span><small>${esc(nameOf(f)).slice(0,13)}</small></button>`).join('');
}


// ---------- render ----------
const nameOf = (u) => u?.displayName || u?.username || "…";
const avatarHTML = (u, big) => {
  const inner = u?.avatar && String(u.avatar).startsWith("data:image/jpeg;base64,")
    ? `<img src="${esc(u.avatar)}" alt="">` : esc(((u?.username || "?@")[1] || "?").toUpperCase());
  return `<div class="avatar ${big ? "big" : ""}">${inner}</div>`;
};
function renderChats() {
  const box = $("#chatList");
  renderStoryRail();
  if (!chats.length) { box.innerHTML = `<div class="card center muted">No chats yet.<br>Open <b>Connect</b> and swap codes with a friend.</div>`; return; }
  box.innerHTML = [...chats].sort(byLast).map((c) => {
    if (c.group) return `<div class="row" data-chat="${esc(c.id)}"><div class="avwrap">${avatarHTML({ username: "@" + c.name, avatar: c.avatar })}</div><div class="grow"><b>👥 ${esc(c.name)}</b><span class="muted">${c.members.length} members</span></div>${isUnread(c) ? '<span class="dot"></span>' : ""}</div>`;
    const f = friends[c.members.find((m) => m !== uid)];
    return `<div class="row" data-chat="${esc(c.id)}">${avWithDot(f)}<div class="grow"><b>${esc(nameOf(f))}${vb(f)}</b><span class="muted">${isOnline(f) ? '<span class="on">● Active now</span>' : esc(f?.username || "") + " · Lv " + (f?.level || 1)}</span></div>${isUnread(c) ? '<span class="dot"></span>' : ""}</div>`;
  }).join("");
}
$("#chatList").addEventListener("click", (e) => { const r = e.target.closest("[data-chat]"); if (r) openChat(chats.find((c) => c.id === r.dataset.chat)); });
function renderProfile() {
  if (!me) return;
  const levelBadge=document.getElementById("wdLevelBtn"); if(levelBadge)levelBadge.textContent=`Lv ${me.level || 1}`;
  $("#topStats").textContent = `Lv ${me.level || 1} · ${me.points || 0} pts`;
  if (!$("#settings").classList.contains("hidden")) renderSettings();
  const row = (go, icon, title, sub) => `<div class="wrow" data-go="${go}"><div class="wi">${icon}</div><div><b>${title}</b><span>${sub}</span></div></div>`;
  window.wordiiProfileV2Data = () => ({
    name:nameOf(me), username:me.username||"", bio:me.bio||"",
    avatar:me.avatar||"", banner:hasBanner(me)?bannerCss(me):"",
    admin:me.admin===true, preAdmin:me.preAdmin===true, premium:me.premium===true, verified:me.verified===true, isPublic:me.isPublic===true, location:me.location||"", level:me.level||1, points:me.points||0,
    followers:me.followersCount||0, following:following.size,
    coupleCode:me.coupleCode||me.coupleBadgeCode||"",
    online:isOnline(me)
  });
  $("#profile").innerHTML = `
    <div class="you-top ${hasBanner(me) ? "has-banner" : ""}" ${hasBanner(me) ? `style="background:${bannerCss(me)}"` : ""}>
      <div class="you-icons"><button class="icon" data-go="invite" aria-label="Share">🔗</button><button class="icon" data-go="edit" aria-label="Edit">✏️</button></div>
      <div class="bio-bubble" data-go="edit">${esc(me.bio || "Add a bio")}</div>
      <div class="you-ava">${avatarHTML(me, true)}<button class="plus" data-go="edit" aria-label="Change logo">+</button></div>
      <div class="wd-profile-eyebrow">✦ WORDII PROFILE</div><h2>${esc(nameOf(me))}${vb(me)}</h2>
      ${me.displayName ? `<p class="muted">${esc(me.username)}</p>` : ""}
      <button type="button" class="btn ghost" data-go="followers">👥 ${me.followersCount || 0} followers · View list</button><p class="tiny">${following.size} following</p>
    </div>
    <div class="wlist">
      <div class="wrow" id="wordiiMyProfileOpen" role="button" tabindex="0"><div class="wi">👤</div><div><b>My Profile</b><span>View your profile, posts and badges</span></div></div>
      ${row("points", "🏆", "Points & level", `Level ${me.level || 1} · ${me.points || 0} points · 🔥 ${me.streak || 0}`)}
      ${row("edit", "👤", "Edit profile", "Name, bio, logo, banner")}
      ${row("account", "🔑", "Account", auth.currentUser?.isAnonymous ? "Add your Gmail to protect this account" : "Gmail, password, log out")}
      ${row("privacy", "🔒", "Privacy", `${me.isPublic ? "Public" : "Private"} account · online status`)}
      ${row("chats", "💬", "Chats", "Theme, chat background")}
      ${row("notif", "🔔", "Notifications", "Message alerts on or off")}
      ${row("lang", "🌐", "App language", "English")}
      ${row("subs", "💎", "Subscriptions", "Explore premium benefits")}
      ${row("couple", "💞", "Couple Badge", "Partner connection · disconnect · badge status")}
      ${row("appearance", "🎨", "Appearance", "Light and dark themes")}
      ${row("ads", "📢", "Ad Preferences", "Manage ad visibility")}
      ${row("assistant", "🤖", "Wordii Assistant", "Help and app commands")}
      ${me?.admin === true ? row("brand", "🎨", "App Logo Manager", "Change the in-app logo for everyone") : ""}
      ${row("updates", "🚀", "App Updates", "Check for new versions")}
      ${row("codeSettings", "🔑", "My Connection Code", "Generate a temporary code to connect")}
      ${row("invite", "👥", "Invite a friend", "Share Wordii Chat")}
      ${canBTP() ? row("admin", "🛡️", "BTP badge panel", "Manage verified, premium and staff badges") + (me.admin ? row("dash", "📊", "Admin dashboard", "See who is using the app") + row("musicAdmin", "🎵", "Manage Music", "Publish licensed status clips") : "") + row("gifts", "🎁", "Level gifts", "Add, edit or remove rewards") : ""}
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
  if (!myCode || myCode.expires <= Date.now()) { myCode = null; renderCode(); $("#codeTimer").textContent = "Tap Generate Code to connect"; return; }
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
let wdHistoryDocs = [], wdHistoryBusy = false, wdHistoryEnd = false;
let wdHistoryInitial = true;
function wdMergeHistory(liveDocs) {
  const all = new Map();
  for (const d of wdHistoryDocs) all.set(d.id, d);
  for (const d of liveDocs) all.set(d.id, d);
  msgs = [...all.values()].map(d => ({id:d.id,...d.data()}))
    .sort((a,b) => {
      const at=a.createdAt?.toMillis?.() || 0;
      const bt=b.createdAt?.toMillis?.() || 0;
      return at-bt || a.id.localeCompare(b.id);
    });
  msgMap = Object.fromEntries(msgs.map(m=>[m.id,m]));
}
async function wdLoadOlderMessages() {
  if (!activeChat || wdHistoryBusy || wdHistoryEnd || !wdHistoryDocs.length) return;
  wdHistoryBusy = true;
  const chatId = activeChat.id, generation = wordiiChatGeneration;
  const box = document.getElementById("msgs");
  const height = box.scrollHeight, top = box.scrollTop;
  try {
    const oldest = wdHistoryDocs[wdHistoryDocs.length-1];
    const snap = await getDocs(query(
      collection(db,"chats",chatId,"messages"),
      orderBy("createdAt","desc"),startAfter(oldest),limit(40)
    ));
    if (!activeChat || activeChat.id !== chatId ||
        generation !== wordiiChatGeneration) return;
    if (snap.empty || snap.size < 40) wdHistoryEnd = true;
    wdHistoryDocs.push(...snap.docs);
    wdMergeHistory([]);
    processReveals(new Set());
    renderMessages();
    box.scrollTop = top + box.scrollHeight-height;
  } catch(e) { toast(friendly(e)); }
  finally { wdHistoryBusy = false; }
}
document.getElementById("msgs").addEventListener("scroll",function(){
  if (this.scrollTop < 100) wdLoadOlderMessages();
});

let wordiiChatGeneration = 0, wordiiReply = null;
const wordiiDrafts = new Map();
function wordiiReplyClear(){wordiiReply=null;const p=document.getElementById("wordiiReplyPreview");if(p){p.textContent="";p.classList.add("hidden");}}
function wordiiReplyStart(id){const m=msgMap[id];if(!m||!activeChat)return;wordiiReply={id:m.id,chatId:activeChat.id,senderId:m.senderId,preview:m.text?(decodeMessage(m.text)||"Message").slice(0,100):m.img?"Photo":m.videoPath?"Video":"Voice message"};const p=document.getElementById("wordiiReplyPreview");p.classList.remove("hidden");p.textContent="↩ Reply to "+(m.senderId===uid?"you":"message")+" · "+wordiiReply.preview+"  ✕";document.getElementById("msgInput").focus();}
document.getElementById("wordiiReplyPreview")?.addEventListener("click",wordiiReplyClear);
function openChat(c) {
  if (!c) return;
  closeChat(); activeChat = c; reveal = {}; decoded = {}; msgs = []; msgMap = {};
  wdHistoryDocs=[];wdHistoryBusy=false;wdHistoryEnd=false;wdHistoryInitial=true;
  const generation=++wordiiChatGeneration;
  $("#msgs").replaceChildren();
  $("#msgInput").value=wordiiDrafts.get(c.id)||"";
  markRead(c.id);
  watchFriend(c);
  $("#chat").classList.remove("hidden"); renderChatTitle(); updateHideBtn(); startTyping(c);
  unsubMsgs = onSnapshot(query(collection(db, "chats", c.id, "messages"), orderBy("createdAt", "desc"), limit(40)), (s) => {
    if(!activeChat||activeChat.id!==c.id||generation!==wordiiChatGeneration)return;
    const box=document.getElementById("msgs");
    const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<100;
    if(wdHistoryInitial){
      wdHistoryDocs=s.docs.slice();
      wdHistoryEnd=s.size<40;
    }else{
      const older=wdHistoryDocs.filter(d=>!s.docs.some(x=>x.id===d.id));
      wdHistoryDocs=[...s.docs,...older];
    }
    wdMergeHistory([]);
    processReveals(new Set(s.docs.filter(d=>d.metadata.hasPendingWrites).map(d=>d.id)));
    renderMessages();
    if(wdHistoryInitial||nearBottom)box.scrollTop=box.scrollHeight;
    wdHistoryInitial=false;
  }, (e) => toast(friendly(e)));
}
function closeChat() { if(activeChat){wordiiDrafts.set(activeChat.id,$("#msgInput").value);wordiiChatGeneration++;} wordiiReplyClear(); $("#msgs").replaceChildren(); $("#msgInput").value=""; msgs=[];msgMap={}; if(typeof wdSelectionStop === "function")wdSelectionStop(); if (rec) { recCancelled = true; rec.stop(); } if (unsubTyping) unsubTyping(); unsubTyping = null; typingAt = {}; if (unsubMsgs) unsubMsgs(); unsubMsgs = null; activeChat = null; $("#chat").classList.add("hidden"); }
$("#backBtn").onclick = closeChat;
function renderChatTitle() {
  if (!activeChat) return;
  const latest = chats.find(c => c.id === activeChat.id);
  if (latest) activeChat = latest;
  $("#callBtn").classList.toggle("hidden", !!activeChat.group); $("#vidBtn").classList.toggle("hidden", !!activeChat.group);
  if (activeChat.group) { $("#chatTitle").innerHTML = `<div class="avwrap">${avatarHTML({ username: "@" + activeChat.name, avatar: activeChat.avatar })}</div><span>${esc(activeChat.name)}<br><small class="presence">${activeChat.members.length} members</small></span>`; return; }
  const f = friends[activeChat.members.find((m) => m !== uid)];
  $("#chatTitle").innerHTML = `${avWithDot(f)}<span>${esc(nameOf(f))}${vb(f)}<br><small class="presence ${isOnline(f) ? "on" : ""}">${(me?.blockedUsers||[]).includes(f?.uid||activeChat.members.find(m=>m!==uid))?"🚫 Blocked · Unblock from chat menu":esc(presenceText(f))}</small></span>`;
}
// Own messages: readable for 10 s only right after you send them.
// Received messages: readable for 10 s from the moment you first see them, then stars.
// Premium privacy preference is device-local; never advertise as server-enforced invisibility.
function premiumInvisible() {
  try { return !!(uid && me?.premium && localStorage.getItem('wordii_invisible_' + uid) === 'on'); }
  catch { return false; }
}
function savePremiumInvisible(on) {
  if (!uid) return;
  try { localStorage.setItem('wordii_invisible_' + uid, on ? 'on' : 'off'); } catch {}
}
function processReveals(newOwn) {
  const now = Date.now(), visible = document.visibilityState === "visible";
  msgs.forEach((m) => {
    if (m.id in reveal) return;
    if (m.senderId === uid) { reveal[m.id] = newOwn.has(m.id) ? now + 10000 : 0; return; }
    if (activeChat?.group) { if (visible) reveal[m.id] = now + 10000; return; }
    if (m.seenAt) { reveal[m.id] = m.seenAt.toMillis() + 10000; return; }
    if (!visible || !activeChat) return;
    reveal[m.id] = now + 10000;
    if (!premiumInvisible()) updateDoc(doc(db, "chats", activeChat.id, "messages", m.id), { seenAt: serverTimestamp() }).catch(() => {});
  });
}
document.addEventListener("visibilitychange", () => {
  if (activeChat && document.visibilityState === "visible") { processReveals(new Set()); tickMessages(); }
});
function renderMessages() {
  const box = $("#msgs");
  box.innerHTML = msgs.filter(m=>!wdHiddenIds().has(m.id)).map((m) => {
    const t = m.createdAt?.toDate?.().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) || "";
    return `<div class="msg ${m.senderId === uid ? "mine" : "theirs"}" data-id="${esc(m.id)}">${m.replyTo?`<div class="wd-reply-quote">↩ ${esc(nameOf(person(msgMap[m.replyTo]?.senderId) || (msgMap[m.replyTo]?.senderId === uid ? me : null)) || "Message")} · ${esc((msgMap[m.replyTo]?.text ? (decodeMessage(msgMap[m.replyTo].text) || "Message") : msgMap[m.replyTo]?.img ? "📷 Photo" : msgMap[m.replyTo]?.videoPath ? "🎥 Video" : "Message").slice(0,90))}</div>`:""}${m.reactions && Object.keys(m.reactions).length ? `<div class="wd-reactions">${Object.values(m.reactions).map(x=>esc(x)).join(" ")}</div>` : ""}${activeChat?.group && m.senderId !== uid ? `<small class="sname">${esc(nameOf(person(m.senderId)))}${vb(person(m.senderId))}</small>` : ""}<div class="bubble ${m.img ? "imgmsg" : m.aud ? "audmsg" : m.videoPath ? "videomsg" : ""}"></div><time>${t}${m.senderId === uid && m.seenAt ? " · Seen" : ""}${m.editedAt ? " · Edited" : ""}</time></div>`;
  }).join("");
  tickMessages();
  wdSelectionSync();
  if (wdHistoryInitial) box.scrollTop = box.scrollHeight;
}
const plain = (m) => (decoded[m.id] ??= decodeMessage(m.text) ?? "⚠ unreadable message");
function tickMessages() {
  if (!activeChat) return;
  const now = Date.now();
  $$("#msgs .msg").forEach((el) => {
    const m = msgMap[el.dataset.id]; if (!m) return;
    const open = !hideOn() || (reveal[m.id] || 0) > now, b = el.querySelector(".bubble");
    if (m.videoPath) {
      if (b.dataset.s !== m.videoPath) {
        b.dataset.s = m.videoPath; b.replaceChildren();
        const player = document.createElement('video');
        player.controls = true; player.playsInline = true; player.preload = 'none';
        player.style.cssText = 'max-width:100%;max-height:300px;border-radius:12px';
        const load = document.createElement('button'); load.type='button'; load.className='btn sm';load.textContent='▶ Load video';
        const save = document.createElement('button');save.type='button';save.className='btn sm ghost';save.textContent='⬇ Download';
        let blobUrl=null;
        const fetchVideo = async () => {
          if (!blobUrl) { const blob=await getBlob(storageRef(getStorage(),m.videoPath));blobUrl=URL.createObjectURL(blob);player.src=blobUrl; }
          return blobUrl;
        };
        load.onclick=()=>act(async()=>{await fetchVideo();load.remove();await player.play().catch(()=>{});},load);
        save.onclick=()=>act(async()=>{const url=await fetchVideo();const link=document.createElement('a');link.href=url;link.download='wordii-video.'+(m.videoPath.endsWith('.webm')?'webm':'mp4');document.body.append(link);link.click();link.remove();},save);
        b.append(player,load,save);
      }
      b.classList.add('open');return;
    }
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
function wordiiClosePhoto(){
  const overlay=document.getElementById('wdPhotoViewer');
  if(overlay)overlay.classList.remove('visible');
}
function wordiiShowPhoto(src) {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(src)) return;
  let overlay=document.getElementById('wdPhotoViewer');
  if (!overlay) {
    overlay=document.createElement('div');overlay.id='wdPhotoViewer';
    overlay.innerHTML='<button type="button" aria-label="Close photo">✕</button><img alt="Chat photo">';
    document.body.append(overlay);
    const img=overlay.querySelector('img');
    let scale=1,tx=0,ty=0,lastTap=0;const pointers=new Map();let startDistance=0,startScale=1,dragX=0,dragY=0;
    const paint=()=>{img.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`;};
    const reset=()=>{scale=1;tx=0;ty=0;pointers.clear();paint();};
    overlay.addEventListener('click',e=>{if(e.target!==img){wordiiClosePhoto();reset();}});
    img.addEventListener('dblclick',e=>{e.preventDefault();scale=scale>1?1:2.5;tx=ty=0;paint();});
    img.addEventListener('pointerdown',e=>{e.preventDefault();img.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});dragX=e.clientX;dragY=e.clientY;if(pointers.size===2){const [a,b]=[...pointers.values()];startDistance=Math.hypot(a.x-b.x,a.y-b.y);startScale=scale;}});
    img.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const [a,b]=[...pointers.values()];scale=Math.max(1,Math.min(5,startScale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,startDistance)));if(scale===1)tx=ty=0;}else if(scale>1){tx+=e.clientX-old.x;ty+=e.clientY-old.y;}paint();});
    const end=e=>{pointers.delete(e.pointerId);if(pointers.size===1){const pt=[...pointers.values()][0];dragX=pt.x;dragY=pt.y;}};
    img.addEventListener('pointerup',end);img.addEventListener('pointercancel',end);
    overlay.wordiiReset=reset;
  }
  overlay.wordiiReset?.();overlay.querySelector('img').src=src;overlay.classList.add('visible');
}

let lp = null, longDone = false;
const mbox = $("#msgs");
mbox.addEventListener("contextmenu", (e) => e.preventDefault());
mbox.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".msg"); if (!el) return; longDone = false;
  lp = setTimeout(() => {
    longDone = true; wordiiShowMessageMenu(el.dataset.id);
  }, 600);
});
["pointerup", "pointerleave", "pointercancel", "pointermove"].forEach((ev) => mbox.addEventListener(ev, () => clearTimeout(lp)));
mbox.addEventListener("click", (e) => {
  if (longDone) { longDone = false; return; }
  const el = e.target.closest(".msg"); if (!el) return;
  if(wdSelectionMode){wdSelected.has(el.dataset.id)?wdSelected.delete(el.dataset.id):wdSelected.add(el.dataset.id);wdSelectionSync();return;}
  const m = msgMap[el.dataset.id];
  if (m.img && String(m.img).startsWith("data:image/")) {
    if (e.target.closest("img.photo")) { wordiiShowPhoto(m.img); return; }
  }
  if (m.senderId !== uid) {
    if (m.img && String(m.img).startsWith("data:image/")) {
      reveal[el.dataset.id] = Date.now() + 10000;
      tickMessages();
      return;
    }
    toast("Received messages show only once"); return;
  }
  reveal[el.dataset.id] = Date.now() + 10000; tickMessages();
});


async function wordiiSetReaction(id,emoji){
 const c=activeChat;if(!c||!msgMap[id])return;
 const allowed=['❤️','😂','😮','😢','👍','🔥'];
 if(emoji!==null&&!allowed.includes(emoji))return;
 try{
  const ref=doc(db,'chats',c.id,'messages',id);
  await runTransaction(db,async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists())throw Error('Message unavailable');
   const current=snap.data().reactions||{};
   if(typeof current!=='object'||Array.isArray(current))throw Error('Invalid reactions');
   const next={...current};
   if(emoji===null||next[uid]===emoji)delete next[uid];
   else next[uid]=emoji;
   if(Object.keys(next).length>50)throw Error('Reaction limit reached');
   tx.update(ref,{reactions:next});
  });
 }catch(e){toast(friendly(e));}
}
function wordiiEditDialog(initial){
 return new Promise(resolve=>{
  document.getElementById('wdEditOverlay')?.remove();
  const overlay=document.createElement('div');overlay.id='wdEditOverlay';overlay.className='wd-edit-overlay';
  overlay.innerHTML=`<section class="wd-edit-panel" role="dialog" aria-modal="true" aria-labelledby="wdEditHeading"><div class="wd-edit-mark">✎</div><h3 id="wdEditHeading">Edit message</h3><p>Update your message. Everyone in this chat will see the change.</p><textarea id="wdEditText" maxlength="800" rows="4" aria-label="Message text"></textarea><div class="wd-edit-count" id="wdEditCount"></div><div class="wd-edit-actions"><button type="button" class="wd-edit-cancel">Cancel</button><button type="button" class="wd-edit-save">Save changes</button></div></section>`;
  document.body.append(overlay);
  const field=overlay.querySelector('textarea'),count=overlay.querySelector('#wdEditCount');field.value=initial;
  const update=()=>{count.textContent=field.value.length+' / 800';overlay.querySelector('.wd-edit-save').disabled=!field.value.trim()||field.value.trim()===initial||field.value.length>800;};
  const close=v=>{overlay.remove();document.removeEventListener('keydown',onKey);resolve(v);};
  const onKey=e=>{if(e.key==='Escape')close(null);if((e.ctrlKey||e.metaKey)&&e.key==='Enter')close(field.value);};
  document.addEventListener('keydown',onKey);field.addEventListener('input',update);
  overlay.querySelector('.wd-edit-cancel').onclick=()=>close(null);
  overlay.querySelector('.wd-edit-save').onclick=()=>{if(field.value.trim())close(field.value);};
  overlay.addEventListener('click',e=>{if(e.target===overlay)close(null);});update();field.focus();field.setSelectionRange(field.value.length,field.value.length);
 });
}
async function wordiiEditMessage(id){
 const m=msgMap[id],chatId=activeChat?.id;
 if(!m||!chatId||m.senderId!==uid||!m.text)return;
 const previous=plain(m);
 const changed=await wordiiEditDialog(previous);
 if(changed===null||changed.trim()===previous)return;
 const next=changed.trim();
 if(!next||next.length>800){toast('Message must be 1–800 characters');return;}
 try{
  await updateDoc(doc(db,'chats',chatId,'messages',id),{text:encodeMessage(next),editedAt:serverTimestamp()});
  delete decoded[id];toast('Message edited');
 }catch(e){toast(friendly(e));}
}
function wordiiShowMessageMenu(id){
 const m=msgMap[id];if(!m)return;
 let menu=document.getElementById('wordiiMessageMenu');if(!menu){menu=document.createElement('div');menu.id='wordiiMessageMenu';menu.className='wd-message-menu';document.body.append(menu);}
 menu.replaceChildren();
 const add=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{menu.remove();fn();};menu.append(b);};
 const reactions=document.createElement('div');reactions.className='wd-reaction-picker';
 for(const emoji of ['❤️','😂','😮','😢','👍','🔥']){
   const b=document.createElement('button');b.type='button';b.textContent=emoji;
   b.onclick=()=>{menu.remove();wordiiSetReaction(id,emoji);};reactions.append(b);
 }
 menu.append(reactions);
 if(m.reactions?.[uid])add('Remove reaction',()=>wordiiSetReaction(id,null));
 add('↩ Reply',()=>wordiiReplyStart(id));
 if(m.text&&m.senderId===uid)add('✎ Edit message',()=>wordiiEditMessage(id));
 if(m.text)add('Copy message',()=>navigator.clipboard?.writeText(plain(m)).then(()=>toast('Copied')).catch(()=>toast('Copy unavailable')));
 add('Select / Delete',()=>wdSelectionStart(id));
 add('Cancel',()=>{});
}
document.addEventListener('pointerdown',e=>{const menu=document.getElementById('wordiiMessageMenu');if(menu&&!menu.contains(e.target)&&!e.target.closest('#msgs .msg'))menu.remove();});
let wordiiSwipeStart=null;
mbox.addEventListener('touchstart',e=>{const el=e.target.closest('.msg');if(!el||e.touches.length!==1)return;wordiiSwipeStart={id:el.dataset.id,x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
mbox.addEventListener('touchend',e=>{if(!wordiiSwipeStart||!e.changedTouches.length)return;const s=wordiiSwipeStart;wordiiSwipeStart=null;const dx=e.changedTouches[0].clientX-s.x,dy=e.changedTouches[0].clientY-s.y;if(dx>75&&Math.abs(dy)<55){clearTimeout(lp);longDone=true;wordiiReplyStart(s.id);}}, {passive:true});

const input = $("#msgInput");
input.addEventListener("input",()=>{if(activeChat)wordiiDrafts.set(activeChat.id,input.value);});
input.addEventListener("input", () => { // pasting a valid symbol message auto-decodes it
  if (isSymbolMessage(input.value)) { const t = decodeMessage(input.value); if (t !== null) { input.value = t; toast("Symbol message decoded"); } }
});
$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim(); if (!text) return; if (!activeChat) { toast("Chat not ready. Reopen the conversation."); console.error("WORDII_SEND: activeChat missing"); return; }
  const chatId=activeChat.id;const reply=wordiiReply?.chatId===chatId?wordiiReply:null;
  input.value="";wordiiDrafts.set(chatId,"");wordiiReplyClear();
  sendMsg({text:encodeMessage(text),...(reply?{replyTo:reply.id}: {})},chatId)
    .catch((err)=>{toast(friendly(err));if(activeChat?.id===chatId&&!input.value){input.value=text;wordiiDrafts.set(chatId,text);}});
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
    if (f.type === 'video/mp4' || f.type === 'video/webm') {
      if (f.size > 20 * 1024 * 1024) throw Error('Video must be 20 MB or smaller.');
      const chatId=activeChat.id;
      const messageId=doc(collection(db,'chats',chatId,'messages')).id;
      const extension=f.type==='video/mp4'?'mp4':'webm';
      const path=`chat-video/${chatId}/${uid}/${messageId}/clip.${extension}`;
      toast('Uploading video…');
      await uploadBytes(storageRef(getStorage(),path),f,{contentType:f.type});
      await sendMsg({videoPath:path},chatId);
      toast('Video sent');
    } else {
      toast('Sending photo…');
      const img=await compress(f,{max:800,quality:0.62,limitLen:220000});
      await sendMsg({img});
    }
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
  return st.videoPath ? `<div class="st-thumb" style="display:grid;place-items:center;background:#101b27;color:white;font-size:24px">▶ Video</div>` : stIsPhoto(st) ? `<div class="st-thumb"><img src="${esc(st.img)}" alt=""></div>`
    : `<div class="st-thumb" style="background:${ST_BG[st.bg] || ST_BG[0]}">${esc((st.text || "").slice(0, 14))}</div>`;
}
function renderStatus() {
  const mine = mineAlive();
  $("#myStatusList").innerHTML = mine.map((st) => `<div class="row" data-my="${esc(st.id)}">${thumb(st)}<div class="grow"><b>${esc(ago(stTime(st)))}</b><span class="muted">Tap to view${st.close ? " · Close friends" : ""} · <span id="sc_${esc(st.id)}">${esc(statCount(st.id))}</span></span></div><button class="del" data-del="${esc(st.id)}" aria-label="Delete">🗑</button></div>`).join("");
  const g = friendGroups(), owners = Object.keys(g).sort((a, b) => stTime(g[b].at(-1)) - stTime(g[a].at(-1)));
  $("#friendStatus").innerHTML = owners.length ? owners.map((o) => `<div class="row" data-owner="${esc(o)}">${avatarHTML(friends[o])}<div class="grow"><b>${esc(nameOf(friends[o]))}${vb(friends[o])}</b><span class="muted">${g[o].length} update${g[o].length > 1 ? "s" : ""} · ${esc(ago(stTime(g[o].at(-1))))}</span></div>›</div>`).join("")
    : `<div class="card center muted">No friend updates right now.</div>`;
  loadStatCounts(mine);
  renderStoryRail();
  if(pvId && !document.getElementById("profileView")?.classList.contains("hidden")) wdPVRefreshStoryRing();
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
let wordiiStoryTimerToken = 0;
let wordiiStoryHold = false;
let wordiiStoryRemaining = 0;
let wordiiStoryDeadline = 0;
let wordiiStoryPointer = null;
let wordiiVideoObjectUrl = null;
function openSV(list, i = 0) {
  if (!list.length) return;
  clearTimeout(sv.t);
  wordiiStoryHold = false;
  wordiiStoryTimerToken++;
  stopWordiiStoryAudio();
  sv = { list: [...list], i: Math.max(0, Math.min(i, list.length - 1)), t: null };
  $("#statusView").classList.remove("hidden");
  drawSV();
}
function wordiiGoStatus(direction=1) {
  if (!sv.list.length || $("#statusView").classList.contains("hidden")) return;
  sv.i += direction;
  if (sv.i < 0) sv.i = 0;
  if (sv.i >= sv.list.length) { closeSV(); return; }
  drawSV();
}
function wordiiScheduleStatusNext(token, duration) {
  clearTimeout(sv.t);
  wordiiStoryRemaining = duration;
  wordiiStoryDeadline = Date.now() + duration;
  if(wordiiStoryHold)return;
  sv.t = setTimeout(() => {
    if (token !== wordiiStoryTimerToken || $("#statusView").classList.contains("hidden")) return;
    if (document.getElementById("seenPanel") && !document.getElementById("seenPanel").classList.contains("hidden")) {
      wordiiScheduleStatusNext(token, 1000);
      return;
    }
    wordiiGoStatus(1);
  }, duration);
}

function closeSV() { document.getElementById('wordiiStatusProgress')?.classList.remove('paused');wordiiStoryHold=false;wordiiStoryPointer=null;clearTimeout(wordiiStoryPointerTimer);wordiiStoryTimerToken++; if(wordiiVideoObjectUrl){URL.revokeObjectURL(wordiiVideoObjectUrl);wordiiVideoObjectUrl=null;} stopWordiiStoryAudio(); clearTimeout(sv.t); $("#statusView").classList.add("hidden"); }
function drawSV() {
  wordiiStoryHold=false;wordiiStoryPointer=null;
  document.getElementById('wordiiStatusProgress')?.classList.remove('paused');
  const timerToken = ++wordiiStoryTimerToken;
  stopWordiiStoryAudio();
  if(wordiiVideoObjectUrl){URL.revokeObjectURL(wordiiVideoObjectUrl);wordiiVideoObjectUrl=null;}
  clearTimeout(sv.t);
  document.getElementById("seenPanel")?.classList.add("hidden");
  const st = sv.list[sv.i]; if (!st) { closeSV(); return; }
  const progress=document.getElementById('wordiiStatusProgress');
  if(progress){progress.replaceChildren();sv.list.forEach((_,i)=>{const bar=document.createElement('span');bar.className=i<sv.i?'done':i===sv.i?'current':'';progress.append(bar);});}
  const owner = st.ownerUid === uid ? me : friends[st.ownerUid];
  $("#svTop").innerHTML = `${avatarHTML(owner)}<div><b>${esc(nameOf(owner))}${vb(owner)}</b><br><small>${esc(ago(stTime(st)))} · ${sv.i + 1}/${sv.list.length}</small></div>`;
  let options = document.getElementById("wordiiStatusMore");
  if (!options) { options = document.createElement("button"); options.id="wordiiStatusMore"; options.type="button"; options.textContent="⋮"; options.setAttribute("aria-label","Status options"); document.getElementById("statusView").append(options); }
  options.classList.toggle("hidden",st.ownerUid!==uid);
  const body = $("#svBody"); body.textContent = "";
  if(st.videoPath){
    body.style.background='#000';
    const v=document.createElement('video');v.controls=true;v.playsInline=true;v.autoplay=true;v.style.cssText='width:100%;height:100%;object-fit:contain';body.append(v);
    const expected=st.id;
    getBlob(storageRef(getStorage(),st.videoPath)).then(blob=>{
      if(timerToken!==wordiiStoryTimerToken || sv.list[sv.i]?.id!==expected)return;
      wordiiVideoObjectUrl=URL.createObjectURL(blob);v.src=wordiiVideoObjectUrl;
      v.onended=()=>{if(timerToken===wordiiStoryTimerToken && sv.list[sv.i]?.id===expected)wordiiGoStatus(1);};
      v.onerror=()=>{if(timerToken===wordiiStoryTimerToken)wordiiGoStatus(1);};
      if(!wordiiStoryHold)v.play().catch(()=>{});
    }).catch(err=>{toast('Video unavailable: '+friendly(err));if(timerToken===wordiiStoryTimerToken){clearTimeout(sv.t);wordiiScheduleStatusNext(timerToken,2500);}});
  }
  else if (stIsPhoto(st)) { const im = new Image(); im.src = st.img; im.className = "sv-img"; body.append(im); body.style.background = "#000"; if(st.overlayText){const d=document.createElement("div");d.className="story-view-caption";d.textContent=st.overlayText;d.style.color=/^#[0-9a-fA-F]{6}$/.test(st.overlayColor||"")?st.overlayColor:"#ffffff";body.append(d);} }
  else { body.style.background = ST_BG[st.bg] || ST_BG[0]; const d = document.createElement("div"); d.className = "sv-text"; d.textContent = st.text || ""; body.append(d); }
  playWordiiStoryAudio(st, body);
  drawSVBar(st);
  if(!st.videoPath) wordiiScheduleStatusNext(timerToken,
    st.musicId||st.audioPath ? Math.max(6000,Math.min(30000,Number(st.musicDuration||15)*1000)) : 6000);
}
// Press and hold a story to pause it; release to resume the remaining time.
// Excludes interactive controls so video seeking and buttons still work.
const wordiiStoryBody = document.getElementById('svBody');
function wordiiStoryPause(){
  if(wordiiStoryHold || document.getElementById('statusView').classList.contains('hidden'))return;
  wordiiStoryHold=true;
  wordiiStoryRemaining=Math.max(100,wordiiStoryDeadline-Date.now());
  clearTimeout(sv.t);
  wordiiStoryBody.querySelector('video')?.pause();
  if(wordiiStatusAudio)wordiiStatusAudio.pause();
  document.getElementById('wordiiStatusProgress')?.classList.add('paused');
}
function wordiiStoryResume(){
  if(!wordiiStoryHold)return;
  wordiiStoryHold=false;
  document.getElementById('wordiiStatusProgress')?.classList.remove('paused');
  const v=wordiiStoryBody.querySelector('video');
  if(v){v.play().catch(()=>{});}else{wordiiScheduleStatusNext(wordiiStoryTimerToken,wordiiStoryRemaining);}
  if(wordiiStatusAudio)wordiiStatusAudio.play().catch(()=>{});
}
wordiiStoryBody.addEventListener('pointerdown',e=>{
  if(e.target.closest('button, audio, video, input, a'))return;
  wordiiStoryPointer={id:e.pointerId,x:e.clientX,y:e.clientY,at:Date.now(),held:false};
  clearTimeout(wordiiStoryPointerTimer);
  wordiiStoryPointerTimer=setTimeout(()=>{
    if(wordiiStoryPointer?.id===e.pointerId){wordiiStoryPointer.held=true;wordiiStoryPause();}
  },250);
});
let wordiiStoryPointerTimer=null;
for(const event of ['pointerup','pointercancel','pointerleave'])wordiiStoryBody.addEventListener(event,()=>{
  clearTimeout(wordiiStoryPointerTimer);
  if(wordiiStoryPointer?.held){wordiiStorySuppressClick=true;wordiiStoryResume();}
  wordiiStoryPointer=null;
});
let wordiiStorySuppressClick=false;
// Tap left third to go back; tap right two thirds to skip ahead.
$("#svBody").addEventListener("click", (e) => {
  if(wordiiStorySuppressClick){wordiiStorySuppressClick=false;return;}
  if(e.target.closest("button, audio, video, input, a")) return;
  if(document.getElementById("seenPanel") && !document.getElementById("seenPanel").classList.contains("hidden")) return;
  const rect=e.currentTarget.getBoundingClientRect();
  wordiiGoStatus(e.clientX - rect.left < rect.width * .32 ? -1 : 1);
});
let wordiiStatusTouch=null;
$("#statusView").addEventListener("touchstart",e=>{if(e.touches.length===1)wordiiStatusTouch={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
$("#statusView").addEventListener("touchend",e=>{if(!wordiiStatusTouch||!e.changedTouches.length)return;const dy=e.changedTouches[0].clientY-wordiiStatusTouch.y;wordiiStatusTouch=null;const st=sv.list[sv.i];if(dy< -75&&st?.ownerUid===uid)showSeenBy(st).catch(err=>toast(friendly(err)));},{passive:true});
$("#svClose").onclick = closeSV;
document.getElementById("statusView").addEventListener("click",async e=>{
  if(!e.target.closest("#wordiiStatusMore"))return;
  const st=sv.list[sv.i];if(!st||st.ownerUid!==uid)return;
  clearTimeout(sv.t);stopWordiiStoryAudio();
  if(!confirm("Delete this status permanently?")){drawSV();return;}
  try{await deleteDoc(doc(db,"statuses",st.id));sv.list.splice(sv.i,1);if(sv.i>=sv.list.length)sv.i=0;drawSV();toast("Status deleted");}catch(err){toast(friendly(err));drawSV();}
});

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
$("#stVideoBtn").onclick = () => $("#wordiiStatusVideoFile").click();
$("#wordiiStatusVideoFile").addEventListener('change',async e=>{
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  if(!['video/mp4','video/webm'].includes(file.type)){toast('Choose MP4 or WebM video');return;}
  if(file.size>20*1024*1024){toast('Video must be under 20 MB');return;}
  const btn=$("#stVideoBtn");btn.disabled=true;
  try{
    const statusRef=doc(collection(db,'statuses'));
    const ext=file.type==='video/mp4'?'mp4':'webm';
    const path=`status-video/${uid}/${statusRef.id}/clip.${ext}`;
    const audience=stAudience();
    try { await uploadBytes(storageRef(getStorage(),path),file,{contentType:file.type}); } catch(uploadErr) { throw new Error('Video storage upload failed. Firebase Storage is unavailable or denied. Try sharing without device music until media storage is connected.'); }
    await setDoc(statusRef,{ownerUid:uid,...audience,videoPath:path,createdAt:serverTimestamp()});
    toast('Video status posted');clearMentions();
  }catch(err){toast(friendly(err));}finally{btn.disabled=false;}
});
$("#stFile").addEventListener("change", async e=>{const f=e.target.files[0];e.target.value="";if(!f)return;if(!f.type.startsWith("image/")){toast("Choose an image. Video needs storage integration.");return;}try{const img=await compress(f,{max:1024,quality:0.7,limitLen:350000});openStoryEdit(img);}catch(err){toast(friendly(err));}});

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
async function sendMsg(payload, targetChatId=activeChat?.id) {
  if(!targetChatId)throw new Error("No chat selected");
  const targetChat=chats.find(c=>c.id===targetChatId)|| (activeChat?.id===targetChatId?activeChat:null);
  if(!targetChat)throw new Error("Chat changed. Try again.");
  if(!targetChat.group){const other=targetChat.members.find(x=>x!==uid);if((me?.blockedUsers||[]).includes(other))throw new Error("Unblock this contact before sending");if((friends[other]?.blockedUsers||[]).includes(uid))throw new Error("This contact is not accepting your messages");}

  const b = writeBatch(db);
  const wordiiMessageRef = doc(collection(db, "chats", targetChatId, "messages"));
  b.set(wordiiMessageRef, { senderId: uid, ...payload, createdAt: serverTimestamp() });
  b.update(doc(db, "chats", targetChatId), { lastAt: serverTimestamp(), lastBy: uid });
  await b.commit();

  // WORDII_FCM_SEND_V1
  // Fire-and-forget: push failure must not block a sent message.
  if (auth.currentUser && !auth.currentUser.isAnonymous) {
    auth.currentUser.getIdToken().then(async token => {
      const res = await fetch("https://wordii-push.xwordii7.workers.dev/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
          chatId: targetChatId,
          messageId: wordiiMessageRef.id
        })
      });
      const result = await res.json();
      if (!res.ok || result.error) {
        console.warn("Wordii Push error:", res.status, result);
        toast("Push error: " + (result.error || res.status));
      } else {
        console.log("Wordii Push result:", result);
        // WORDII_PUSH_RESULT_TOAST_V2
      }
    }).catch(err => console.warn("Push request failed:", err));
  }
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
let lastResults = [], searchTimer, searchSequence = 0, searchBusy = false, searchError = "";
async function searchPeople(text) {
  const raw = text.trim().toLowerCase().replace(/^@/, "");
  if (raw.length < 2) return [];
  // Username documents are indexed with usernameKey. Legacy @name#123
  // accounts use name-123, while newer accounts use just name.
  const key = raw.replace(/#(\d{1,3})$/, "-$1");
  const usersRef = collection(db, "users");
  const results = new Map();
  const snap = await getDocs(query(usersRef, where("usernameKey", ">=", key), where("usernameKey", "<=", key + "\uf8ff"), limit(25)));
  snap.docs.forEach(d => { if (d.id !== uid) results.set(d.id, {id:d.id, ...d.data()}); });
  // Exact tagged username may be in older profiles without a usernameKey.
  if (raw.includes("#") && results.size === 0) {
    const old = await getDocs(query(usersRef, where("username", "==", "@" + raw), limit(10)));
    old.docs.forEach(d => { if (d.id !== uid) results.set(d.id, {id:d.id, ...d.data()}); });
  }
  return [...results.values()].sort((x,y) => (x.username || "").localeCompare(y.username || "")).slice(0,25);
}
async function performUserSearch() {
  const value = $("#searchInput").value;
  const seq = ++searchSequence;
  if (value.trim().length < 2) { lastResults=[]; searchBusy=false; searchError=""; renderSearch(); return; }
  searchBusy=true; searchError=""; renderSearch();
  try {
    const results = await searchPeople(value);
    if (seq !== searchSequence) return;
    lastResults=results;
  } catch(e) {
    if (seq !== searchSequence) return;
    lastResults=[]; searchError=friendly(e);
  } finally {
    if (seq === searchSequence) { searchBusy=false; renderSearch(); }
  }
}
$("#searchInput").addEventListener("input", () => {
  clearTimeout(searchTimer);
  const seq = ++searchSequence;
  if ($("#searchInput").value.trim().length < 2) { lastResults=[]; searchBusy=false; searchError=""; renderSearch(); return; }
  searchBusy=true; searchError=""; renderSearch();
  searchTimer=setTimeout(() => { if (seq === searchSequence) performUserSearch(); }, 350);
});
$("#searchInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(searchTimer); performUserSearch(); } });
function renderSearch() {
  renderPV();
  const box = $("#searchResults"); if (!box) return;
  if ($("#searchInput").value.trim().length < 2) { box.innerHTML = ""; return; }
  if (searchBusy) { box.innerHTML = `<p class="tiny" role="status">Searching all Wordii users…</p>`; return; }
  if (searchError) { box.innerHTML = `<p class="tiny" role="alert">${esc(searchError)}</p>`; return; }
  if (!lastResults.length) { box.innerHTML = `<p class="tiny">No registered username found. Check spelling or type the full @name#123.</p>`; return; }
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

const hasBanner = (u) => !!(u?.banner && /^data:image\/(?:jpeg|png|webp);base64,/i.test(String(u.banner)));
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
    await updateDoc(doc(db, "users", uid), { banner });
    const preview = document.getElementById("wdBannerPreview");
    if (preview) { preview.src = banner; preview.hidden = false; }
    if (me) me.banner = banner;
    toast("Banner updated"); renderProfile();
  });
});

// --- follow ---

// v1.4.3: group information, owner-managed group picture and cover.
function openWordiiGroupInfo() {
  if (!activeChat?.group) return;
  const el = document.getElementById('wordiiGroupInfo');
  el.classList.remove('hidden');
  renderWordiiGroupInfo();
}
function renderWordiiGroupInfo() {
  const el = document.getElementById('wordiiGroupInfo');
  if (el.classList.contains('hidden') || !activeChat?.group) return;
  const c = chats.find(x => x.id === activeChat.id) || activeChat;
  const owner = c.owner === uid;
  document.getElementById('wordiiGroupBody').innerHTML = `
    <div class="wg-banner" ${hasBanner(c) ? `style="background:${bannerCss(c)}"` : ''}></div>
    <div class="wg-avatar">${avatarHTML({username:'@'+c.name,avatar:c.avatar},true)}</div>
    <h2>${esc(c.name)}</h2><p class="tiny">${c.members.length} members</p>
    ${owner ? `<div class="wg-actions"><button type="button" data-wg="avatar" class="btn">Change group DP</button><button type="button" data-wg="banner" class="btn ghost">Change banner</button><button type="button" data-wg="removeAvatar" class="btn ghost">Remove DP</button><button type="button" data-wg="removeBanner" class="btn ghost">Remove banner</button></div>` : '<p class="tiny">Only the group creator can change its pictures.</p>'}
    <h3>Members</h3>${c.members.map(id => `<div class="row nopoint">${avatarHTML(person(id))}<div class="grow">${esc(id===uid?'You':nameOf(person(id)))}</div></div>`).join('')}`;
}
document.getElementById('wordiiGroupBack').addEventListener('click',()=>document.getElementById('wordiiGroupInfo').classList.add('hidden'));
document.getElementById('wordiiGroupBody').addEventListener('click', e=>{
  const action=e.target.closest('[data-wg]')?.dataset.wg;
  if (!action || !activeChat?.group) return;
  const c=chats.find(x=>x.id===activeChat.id)||activeChat;
  if (c.owner!==uid) return toast('Only the group creator can edit this group');
  if(action==='avatar'||action==='banner') {
    const input=document.getElementById('wordiiGroupFile'); input.dataset.field=action; input.click();
  } else if(action==='removeAvatar'||action==='removeBanner') {
    act(async()=>{await updateDoc(doc(db,'chats',c.id),{[action==='removeAvatar'?'avatar':'banner']:''});toast('Group photo removed');});
  }
});
document.getElementById('wordiiGroupFile').addEventListener('change',e=>{
  const input=e.target, file=input.files?.[0], field=input.dataset.field; input.value='';
  if(!file || !activeChat?.group || !['avatar','banner'].includes(field))return;
  const id=activeChat.id;
  act(async()=>{
    const value=await compress(file,field==='avatar'?{max:128,square:true,quality:.8,limitLen:40000}:{max:720,quality:.6,limitLen:90000});
    await updateDoc(doc(db,'chats',id),{[field]:value});toast('Group '+(field==='avatar'?'DP':'banner')+' updated');
  });
});

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

// Public profiles show follower identities; private profiles show them only to their owner.
async function wordiiShowFollowers(target) {
  const userSnap = await getDoc(doc(db, 'users', target));
  if (!userSnap.exists()) throw Error('Profile not found');
  if (target !== uid && userSnap.data().isPublic !== true) { toast('Follower list is private'); return; }
  let overlay = document.getElementById('wdFollowersOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'wdFollowersOverlay'; overlay.className = 'wd-followers-overlay';
    overlay.innerHTML = `<section class="wd-followers-sheet" role="dialog" aria-modal="true" aria-label="Followers"><header class="wd-followers-header"><button type="button" data-wdf-close aria-label="Close followers">←</button><div><strong>Followers</strong><small>Wordii community</small></div><span>👥</span></header><div class="wd-followers-list" id="wdFollowersList"></div></section>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-wdf-close]')) { overlay.remove(); return; }
      const row = e.target.closest('[data-wdf-user]');
      if (row) { const id = row.dataset.wdfUser; overlay.remove(); if (id === uid) { document.querySelector('[data-tab="profile"]')?.click(); } else openProfileView(id); }
    });
  }
  const list = overlay.querySelector('#wdFollowersList');
  list.innerHTML = '<p class="wd-followers-empty">Loading followers…</p>';
  try {
    const snap = await getDocs(query(collection(db, 'follows'), where('target', '==', target), limit(100)));
    const rows = await Promise.all(snap.docs.map(async d => {
      const followerId = d.data().follower;
      if (!followerId) return null;
      try { const u = await getDoc(doc(db, 'users', followerId)); return u.exists() ? {id:followerId, data:u.data()} : null; } catch { return null; }
    }));
    if (!overlay.isConnected) return;
    const valid = rows.filter(Boolean);
    list.innerHTML = valid.length ? valid.map(({id,data:u}) => `<button type="button" class="wd-follower-row" data-wdf-user="${esc(id)}"><span class="wd-follower-avatar">${avatarHTML(u)}</span><span class="wd-follower-details"><strong>${esc(nameOf(u))}${vb(u)}</strong><small>${esc(u.username || 'Wordii user')}</small></span><span class="wd-follower-chevron">›</span></button>`).join('') : '<div class="wd-followers-empty">👥<h3>No followers yet</h3><p>When someone follows this profile, they will appear here.</p></div>';
  } catch (err) { if (overlay.isConnected) list.innerHTML = '<p class="wd-followers-empty">Unable to load followers. Please try again.</p>'; throw err; }
}
// --- someone's profile (tap their name in a chat, or a search result) ---
let pvUnsub = null, pvId = null;
function openProfileView(id) {
  if (!id || id === uid) return;
  closePV(); pvId = id; $("#profileView").classList.remove("hidden"); renderPV();
  pvUnsub = onSnapshot(doc(db, "users", id), (s) => { people[id] = s.data(); renderPV(); }, () => {});
}
function closePV() { if (pvUnsub) pvUnsub(); pvUnsub = null; pvId = null; $("#profileView").classList.add("hidden"); }
// Wordii Character on Level — admin-controlled, Firestore-backed compact PNG.
async function wdLevelCharacterRender(target){
  try{
    const snap=await getDoc(doc(db,'levelCharacters',target));
    if(pvId!==target||!snap.exists())return;
    const png=snap.data().png;
    if(typeof png!=='string'||!png.startsWith('data:image/png;base64,'))return;
    const badge=document.querySelector('#profileView .wd-pv-level');
    if(!badge)return;
    badge.querySelector('.wd-level-character')?.remove();
    const image=document.createElement('img');
    image.className='wd-level-character';image.alt='Level character';image.src=png;
    badge.prepend(image);badge.classList.add('wd-level-seat');
  }catch(err){console.warn('Level character unavailable:',err.code||err.message);}
}
window.wordiiLevelCharacterForCurrent = async function(){
  if(!uid)return '';
  try{const snap=await getDoc(doc(db,'levelCharacters',uid));return snap.data()?.png||'';}
  catch{return '';}
};
function wdBindLevelCharacterSettings(){
  const input=document.getElementById('wdLevelFile'),preview=document.getElementById('wdLevelPreview');
  input?.addEventListener('change',()=>{
    const f=input.files?.[0];if(!f)return;
    if(f.type!=='image/png'){toast('Choose a transparent PNG');input.value='';return;}
    preview.src=URL.createObjectURL(f);preview.style.display='block';
  });
  async function targetUid(){
    const username=document.getElementById('wdLevelUser')?.value.trim();
    if(!username||username.length>80)throw Error('Enter an exact username');
    const found=await getDocs(query(collection(db,'users'),where('username','==',username),limit(2)));
    if(found.size!==1)throw Error('Username not found or ambiguous');
    return found.docs[0].id;
  }
  async function compactPNG(file){
    if(!file||file.type!=='image/png'||file.size>3*1024*1024)throw Error('Choose a PNG under 3 MB');
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;await img.decode();
      const canvas=document.createElement('canvas');const ratio=Math.min(1,256/Math.max(img.width,img.height));
      canvas.width=Math.max(1,Math.round(img.width*ratio));canvas.height=Math.max(1,Math.round(img.height*ratio));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/png');
      if(data.length>160000)throw Error('PNG too detailed. Use a simpler transparent image under 120 KB after compression');
      return data;
    }finally{URL.revokeObjectURL(url);}
  }
  document.getElementById('wdLevelAssign')?.addEventListener('click',e=>act(async()=>{
    if(me?.admin!==true)throw Error('Admin only');
    const target=await targetUid();const png=await compactPNG(input.files?.[0]);
    await setDoc(doc(db,'levelCharacters',target),{png,updatedBy:uid,updatedAt:serverTimestamp()});
    toast('Level character assigned');
  },e.currentTarget));
  document.getElementById('wdLevelRemove')?.addEventListener('click',e=>act(async()=>{
    if(me?.admin!==true)throw Error('Admin only');
    const target=await targetUid();await deleteDoc(doc(db,'levelCharacters',target));
    toast('Level character removed');
  },e.currentTarget));
}
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
  const isAdminProfile = u.admin === true;
  const coverStyle = hasBanner(u) ? `background:${bannerCss(u)}` : (isAdminProfile ? "background-image:linear-gradient(0deg,#08050944,#08050900),url('/profile-v2/admin-banner.jpg')" : "");

  const profileAvatar = u.avatar && /^data:image\/(?:jpeg|png|webp);base64,/i.test(String(u.avatar))
    ? `<img src="${esc(u.avatar)}" alt="Profile avatar">`
    : (isAdminProfile ? '<img src="/profile-v2/admin-avatar.jpg" alt="Admin avatar">' : avatarHTML(u, true));

  const coupleCode = u.coupleCode || u.coupleBadgeCode || "";

  body.innerHTML = `
    <div class="pv-banner" style="${coverStyle}"></div>
    <div class="pv-ava">${profileAvatar}</div>
    <div class="pv-info wd-public-profile-v2">
      <div class="wd-profile-eyebrow">✦ WORDII PROFILE</div>
      <div class="wd-pv-name-row"><h2>${esc(nameOf(u))}${vb(u)}</h2><span class="wd-pv-level wd-level-seat">${isAdminProfile ? '<img class="wd-level-character" src="/profile-v2/admin-level-character.png" alt="Xwordii sitting character">' : ''}<span>✦ Lv. ${Number(u.level) || 1}</span></span></div>
      <div class="wd-pv-badges">
        ${isAdminProfile ? '<span class="wd-admin-v2"><span class="wd-admin-crest"><img src="/profile-v2/admin-royal-crest.svg" alt="Royal W crest"></span><span>ADMIN</span></span>' : ''}
        ${u.preAdmin===true ? '<span class="wd-preadmin-v2">◆ PRE-ADMIN</span>' : ''}
        ${u.premium===true ? '<span class="wd-premium-v2">✦ PREMIUM</span>' : ''}
        ${u.verified===true ? '<span class="wd-verified-v2">✧ VERIFIED</span>' : ''}
      </div>
      <p class="muted wd-pv-username">${esc(u.username || "")}</p>
      <p class="presence ${isOnline(u) ? "on" : ""}">${esc(presenceText(u))}</p>
      ${coupleCode ? `<div class="wmp-couple"><span class="wmp-heart">♡</span> Couple · ${esc(coupleCode)}</div>` : ""}
      <div class="wmp-stats">
        <div><b>—</b><small>Posts</small></div>
        <div><b>${Number(u.followersCount) || 0}</b><small>Followers</small></div>
        <button type="button" class="wd-pv-stat" data-pv="following"><b id="wdPvFollowingCount">${Number.isFinite(Number(u.followingCount)) ? Number(u.followingCount) : "—"}</b><small>Following</small></button>
      </div>
      <div class="wd-pv-actions">
        <button class="btn ${isF ? "ghost" : ""}" data-pv="follow">${isF ? "Following ✓" : "Follow"}</button>
        ${msg}
        <button class="btn ghost wd-pv-share" type="button" data-pv="share" aria-label="Share profile">↗</button>
        <button class="btn ghost wd-pv-qr" type="button" data-pv="qr" aria-label="Profile QR code">▦</button>
      </div>
      <p class="bio">${esc(u.bio || "No bio yet.")}</p>
      <button type="button" class="btn ghost" data-pv="followers">👥 ${Number(u.followersCount) || 0} followers · View list</button>
      <p class="tiny wd-pv-privacy">${u.isPublic ? "🌍 Public account" : "🔒 Private account"}</p>
      <div class="wd-pv-meta">
        <span>📍 ${esc(u.location || (isAdminProfile ? "India" : "Location not set"))}</span>
        ${isAdminProfile ? '<a href="https://wordii-hub.web.app" target="_blank" rel="noopener noreferrer">🔗 wordii-hub.web.app</a>' : ''}
        <span>▦ Joined ${u.createdAt?.toDate?.()?.toLocaleDateString(undefined,{month:"short",year:"numeric"}) || "Unavailable"}</span>
      </div>
      <div class="wmp-quick">
        <button type="button" data-wd-pv-shortcut="badges"><i>♛</i>Badges</button>
        <button type="button" data-wd-pv-shortcut="level"><i>▂▅▇</i>Level</button>
        <button type="button" data-wd-pv-shortcut="points"><i>◉</i>Points</button>
        <button type="button" data-wd-pv-shortcut="collection"><i>✦</i>Collection</button>
        <button type="button" data-wd-pv-shortcut="couple"><i>♡</i>Couple</button>
      </div>
      <div class="wmp-tabs">
        <button class="active" type="button" data-pv-tab="posts">▦ Posts</button>
        <button type="button" data-pv-tab="status">▷ Status</button>
        <button type="button" data-pv-tab="about">ⓘ About</button>
      </div>
      <div class="wmp-panel">Posts publishing is not enabled yet.</div>
    </div>`;
  wdLevelCharacterRender(pvId);
  wdPVFollowingCount(pvId);
  wdPVAvatarSetup();
}

async function wdPVFollowingCount(target) {
  const el=document.getElementById("wdPvFollowingCount");
  if(!el)return;
  try {
    const snap=await getDocs(query(collection(db,"follows"),where("follower","==",target),limit(100)));
    if(pvId===target && el.isConnected)el.textContent=snap.size===100?"100+":String(snap.size);
  }catch(err){
    console.warn("Following count not readable:",err.code||err.message);
    if(pvId===target && el.isConnected){
      const saved=people[target]?.followingCount;
      el.textContent=Number.isFinite(Number(saved)) && saved!=null ? String(saved) : "—";
      el.title="Following count not available";
    }
  }
}
async function wdPVFollowingList(target) {
  const snap=await getDoc(doc(db,"users",target));
  if(!snap.exists())throw Error("User not found");
  if(target!==uid && snap.data().isPublic!==true){toast("Following list is private");return;}
  document.getElementById("wdPVSheet")?.remove();
  const sheet=document.createElement("div");
  sheet.id="wdPVSheet";sheet.className="wd-followers-overlay";
  sheet.innerHTML=`<section class="wd-followers-sheet"><header class="wd-followers-header">
  <button data-wd-close>←</button><strong>Following</strong></header>
  <div class="wd-followers-list">Loading…</div></section>`;
  document.body.appendChild(sheet);
  sheet.onclick=e=>{
    if(e.target===sheet||e.target.closest("[data-wd-close]")){sheet.remove();return;}
    const row=e.target.closest("[data-wd-user]");
    if(row){const id=row.dataset.wdUser;sheet.remove();if(id!==uid)openProfileView(id);}
  };
  const list=sheet.querySelector(".wd-followers-list");
  try{
    const q=await getDocs(query(collection(db,"follows"),where("follower","==",target),limit(100)));
    const users=await Promise.all(q.docs.map(async d=>{
      const id=d.data().target;
      if(!id)return null;
      try{const r=await getDoc(doc(db,"users",id));return r.exists()?{id,u:r.data()}:null;}
      catch{return null;}
    }));
    if(!sheet.isConnected)return;
    list.innerHTML=users.filter(Boolean).map(({id,u})=>`
      <button class="wd-follower-row" data-wd-user="${esc(id)}">
      <span class="wd-follower-avatar">${avatarHTML(u)}</span>
      <span class="wd-follower-details"><strong>${esc(nameOf(u))}${vb(u)}</strong>
      <small>${esc(u.username||"")}</small></span></button>`).join("")
      ||'<p class="wd-followers-empty">Not following anyone yet.</p>';
  }catch{if(sheet.isConnected)list.textContent="Could not load following.";}
}
function wdPVVisibleStatus(target){
  return feedStatuses.filter(st=>st.ownerUid===target&&stAlive(st));
}

function wdPVFeaturePage(feature,target) {
  const u=people[target];
  if(!u)return;
  const names={
    badges:"Badges",level:"Level",
    points:"Points",collection:"Collection",
    couple:"Couple Badge"
  };
  if(!names[feature])return;

  document.getElementById("wdPVFeature")?.remove();
  const sheet=document.createElement("section");
  sheet.id="wdPVFeature";
  sheet.className="wd-about-full";

  let content="";
  if(feature==="level"){
    content=`<div class="wd-about-line"><span>⭐ Current level</span>
      <b>Level ${Number(u.level)||1}</b></div>`;
  }else if(feature==="points"){
    content=`<div class="wd-about-line"><span>◉ Total points</span>
      <b>${Number(u.points)||0}</b></div>`;
  }else if(feature==="couple"){
    const code=u.coupleCode||u.coupleBadgeCode;
    const partnerId=u.couplePartnerUid||u.couplePartnerId||u.partnerUid;
    const partner=partnerId ? people[partnerId] : null;
    const avatar1=avatarHTML(u,true);
    const avatar2=partner ? avatarHTML(partner,true) : '<span>?</span>';
    content=code ? `
      <div class="wd-couple-scene">
        <div class="wd-couple-stars">✦ · ✧ · ✦</div>
        <div class="wd-couple-pair">
          <div class="wd-couple-person">
            <div class="wd-couple-avatar">${avatar1}</div>
            <strong>${esc(nameOf(u))}</strong>
          </div>
          <div class="wd-couple-heart">♡</div>
          <div class="wd-couple-person">
            <div class="wd-couple-avatar">${avatar2}</div>
            <strong>${partner?esc(nameOf(partner)):"Partner"}</strong>
          </div>
        </div>
        <div class="wd-couple-code">Couple ♡ ${esc(String(code))}</div>
        <p>Two Accounts · One Connection</p>
      </div>` :
      '<div class="wd-about-line">No Couple Badge assigned.</div>';
  }else if(feature==="badges"){
    const badges=[];
    if(u.admin===true)badges.push("👑 Admin");
    if(u.preAdmin===true)badges.push("🛡️ Pre-Admin");
    if(u.premium===true)badges.push("💎 Premium");
    if(u.verified===true)badges.push("☑️ Verified");
    if(u.coupleCode||u.coupleBadgeCode)badges.push("💞 Couple");
    content=badges.length
      ?badges.map(b=>`<div class="wd-about-line">${b}</div>`).join("")
      :'<div class="wd-about-line">No badges found in profile data.</div>';
  }else{
    content='<div class="wd-about-line">No public collection data available.</div>';
  }

  sheet.innerHTML=`<header>
    <button type="button" id="wdPVFeatureBack">←</button>
    <strong>${names[feature]}</strong></header>
    <main>${content}</main>`;
  document.body.appendChild(sheet);
  sheet.querySelector("#wdPVFeatureBack").onclick=()=>sheet.remove();
}

function wdPVAbout(target){
  const u=people[target];if(!u)return;
  document.getElementById("wdPVAbout")?.remove();
  const sheet=document.createElement("section");
  sheet.id="wdPVAbout";sheet.className="wd-about-full";
  const joined=u.createdAt?.toDate?.();
  const date=joined&&!isNaN(joined.getTime())?
    joined.toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"}):"Unavailable";
  const count=Number.isInteger(u.usernameChangeCount)?
    String(u.usernameChangeCount)+" recorded changes":"History unavailable";
  sheet.innerHTML=`<header><button id="wdPVAboutBack">←</button><strong>About this account</strong></header>
  <main>
  <div class="wd-about-line"><span>📅 Joined</span><b>${esc(date)}</b></div>
  <div class="wd-about-line"><span>👤 Username</span><b>${esc(u.username||"")}</b></div>
  <div class="wd-about-line"><span>🔄 Username changes</span><b>${esc(count)}</b></div>
  <div class="wd-about-line"><span>📝 Bio</span><p>${esc(u.bio||"No bio yet")}</p></div>
  <div class="wd-about-line"><span>⭐ Level</span><b>${Number(u.level)||1}</b></div>
  <div class="wd-about-line"><span>🔒 Account</span><b>${u.isPublic?"Public":"Private"}</b></div>
  </main>`;
  document.body.appendChild(sheet);
  sheet.querySelector("#wdPVAboutBack").onclick=()=>sheet.remove();
}
function wdPVTab(tab){
  const body=$("#pvBody"),panel=body.querySelector(".wmp-panel");
  if(!panel)return;
  body.querySelectorAll("[data-pv-tab]").forEach(b=>b.classList.toggle("active",b.dataset.pvTab===tab));
  if(tab==="status"){
    const list=wdPVVisibleStatus(pvId);
    panel.innerHTML=list.length?list.map((st,i)=>`
      <button class="wd-pv-status-item" data-wd-status="${i}">
      ${thumb(st)}<span>${esc(ago(stTime(st)))}</span></button>`).join("")
      :'<p class="muted">No visible active statuses.</p>';
  }else panel.textContent="Posts publishing is not enabled yet.";
}
function wdPVRefreshStoryRing(){
  const avatar=document.querySelector("#profileView #pvBody .pv-ava");
  if(!avatar||!pvId)return;
  const u=people[pvId]||{};
  const active=wdPVVisibleStatus(pvId).length>0;
  const eligible=u.admin===true||u.preAdmin===true||u.premium===true||u.verified===true||!!(u.coupleCode||u.coupleBadgeCode);
  avatar.classList.toggle("wd-status-active",active);
  avatar.classList.toggle("wd-flame",active&&eligible);
  avatar.classList.toggle("wd-flame-admin",active&&u.admin===true);
}
function wdPVAvatarSetup(){
  const avatar=$("#pvBody").querySelector(".pv-ava");
  if(!avatar||!pvId)return;
  const target=pvId,u=people[target];
  const hasBadge=!!(u.admin===true||u.preAdmin===true||u.premium===true||
    u.verified===true||u.coupleCode||u.coupleBadgeCode);
  const active=wdPVVisibleStatus(target).length>0;
  wdPVRefreshStoryRing();
  let timer,held=false;
  avatar.onpointerdown=e=>{
    if(e.button!==0)return;
    held=false;
    timer=setTimeout(()=>{
      held=true;
      const img=avatar.querySelector("img");
      if(!img){toast("Profile photo unavailable");return;}
      const overlay=document.createElement("div");
      overlay.className="wd-dp-preview";overlay.id="wdDPZoom";
      overlay.innerHTML='<button aria-label="Close">✕</button><img alt="Profile photo">';
      overlay.querySelector("img").src=img.src;
      document.body.appendChild(overlay);
      overlay.querySelector("button").onclick=()=>overlay.remove();
      let dist=0,scale=1;
      const photo=overlay.querySelector("img");
      photo.addEventListener("touchmove",ev=>{
        if(ev.touches.length!==2)return;
        ev.preventDefault();
        const a=ev.touches[0],b=ev.touches[1];
        const d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
        if(dist)scale=Math.max(1,Math.min(4,scale*d/dist));
        dist=d;photo.style.transform=`scale(${scale})`;
      },{passive:false});
      photo.addEventListener("touchend",()=>dist=0);
    },550);
  };
  avatar.onpointerup=()=>clearTimeout(timer);
  avatar.onpointercancel=()=>clearTimeout(timer);
  avatar.onpointerleave=()=>clearTimeout(timer);
  avatar.oncontextmenu=e=>e.preventDefault();
  avatar.onclick=()=>{
    if(held){held=false;return;}
    const list=wdPVVisibleStatus(target);
    if(list.length)openSV(list);else toast("No visible active status");
  };
}

$("#pvBack").onclick = closePV;
$("#chatTitle").addEventListener("click", () => {
  if (!activeChat) return;
  if (activeChat.group) openWordiiGroupInfo();
  else openProfileView(activeChat.members.find((m) => m !== uid));
});
$("#pvBody").addEventListener("click", (e) => {
  const tab=e.target.closest("[data-pv-tab]");
  if(tab){if(tab.dataset.pvTab==="about")wdPVAbout(pvId);else wdPVTab(tab.dataset.pvTab);return;}
  const st=e.target.closest("[data-wd-status]");
  if(st){openSV(wdPVVisibleStatus(pvId),Number(st.dataset.wdStatus)||0);return;}
  const shortcut=e.target.closest("[data-wd-pv-shortcut]");
  if(shortcut){
    const feature=shortcut.dataset.wdPvShortcut;
    wdPVFeaturePage(feature,pvId);
    return;
  }
  const b = e.target.closest("[data-pv]"); if (!b) return;
  const id = pvId, a = b.dataset.pv;
  act(async () => {
    if (a === "share" || a === "qr") {
      const user=people[id];
      const link="https://wordii-hub.web.app/?profile="+encodeURIComponent(user?.username||id);
      if(a==="share"){
        if(navigator.share){
          try { await navigator.share({title:"Wordii Chat Profile",url:link}); }
          catch(e){if(e.name!=="AbortError")throw e;}
        }else{
          await navigator.clipboard.writeText(link);
          toast("Profile link copied");
        }
      }else{
        const win=window.open("https://api.qrserver.com/v1/create-qr-code/?size=300x300&data="+encodeURIComponent(link),"_blank","noopener");
        if(!win)toast("Allow popups to view QR code");
      }
      return;
    }
    if (a === "followers") { await wordiiShowFollowers(id); return; }
    if (a === "following") { await wdPVFollowingList(id); return; }
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

// Optional SMS verification: link the phone credential to the signed-in account.
// No phone number is stored in public Firestore user profiles.
let wdPhoneVerifier=null, wdPhoneVerificationId=null;
function wordiiPhoneStatus(message) { const el=document.getElementById('wdPhoneStatus');if(el)el.textContent=message; }
async function wordiiSendPhoneOTP() {
  const user=auth.currentUser;
  if(!user || user.isAnonymous)throw Error('Please protect your account with Gmail first.');
  if(user.phoneNumber)throw Error('This account already has a verified phone.');
  const number=String(document.getElementById('wdPhoneNumber')?.value||'').replace(/[\s()-]/g,'');
  if(!/^\+[1-9]\d{7,14}$/.test(number))throw Error('Enter a valid number with country code, e.g. +91XXXXXXXXXX.');
  wdPhoneVerificationId=null;
  if(wdPhoneVerifier){try{wdPhoneVerifier.clear();}catch{} wdPhoneVerifier=null;}
  const holder=document.getElementById('wdPhoneCaptcha');
  if(!holder)throw Error('Open Settings → Account again.');
  holder.innerHTML='';
  wdPhoneVerifier=new RecaptchaVerifier(auth,holder,{size:'normal'});
  await wdPhoneVerifier.render();
  wordiiPhoneStatus('Complete the security check to receive your SMS.');
  const provider=new PhoneAuthProvider(auth);
  wdPhoneVerificationId=await provider.verifyPhoneNumber(number,wdPhoneVerifier);
  document.getElementById('wdPhoneOtpBox')?.classList.remove('hidden');
  wordiiPhoneStatus('SMS sent. Enter the OTP to verify your number.');
}
async function wordiiConfirmPhoneOTP() {
  if(!wdPhoneVerificationId)throw Error('OTP not sent yet. Complete reCAPTCHA and tap Send OTP.');
  const otp=String(document.getElementById('wdPhoneOtp')?.value||'').trim();
  if(!/^\d{6}$/.test(otp))throw Error('Enter the 6-digit OTP.');
  const user=auth.currentUser;
  if(!user || user.isAnonymous)throw Error('Log in with your protected account.');
  const credential=PhoneAuthProvider.credential(wdPhoneVerificationId,otp);
  await linkWithCredential(user,credential);
  await user.reload();
  wdPhoneVerificationId=null;
  if(wdPhoneVerifier){try{wdPhoneVerifier.clear();}catch{}wdPhoneVerifier=null;}
  toast('Phone number verified');
  if(subKey==='account')renderSettings(true);
}

// --- settings ---
const BG_SW = ["#2a1b4d", "radial-gradient(#7b2cff,#1d1040)", "linear-gradient(160deg,#064e5c,#0b1b3a)", "linear-gradient(160deg,#7c2d12,#4c1d95)", "#000"];
let admList = [], admTimer;
let subKey = "";
const SUB_TITLES = { ads: "Ad Preferences", musicAdmin: "Manage Music", overview: "Profile options", couple: "Couple Badge", appearance: "Appearance", points: "Points & level", edit: "Edit profile", account: "Account", privacy: "Privacy", chats: "Chats", notif: "Notifications", lang: "App language", subs: "Subscriptions", admin: "BTP badge panel", dash: "Admin dashboard", gifts: "Level gifts", updates: "App Updates", assistant: "Wordii Assistant", brand: "App Branding" };
function openSub(k) { if (k !== "ads") void wordiiHideTestBanner(); subKey = k; $("#setTitle").textContent = SUB_TITLES[k] || "Settings"; $("#settings").classList.remove("hidden"); renderSettings(true); }
function wordiiProfileShareURL(){
  const name = String(me?.username || '').replace(/^@/, '');
  const u = new URL('https://wordii-chat.web.app/');
  if (/^[a-z0-9_]{3,15}$/i.test(name)) u.searchParams.set('profile', name.toLowerCase());
  return u.href;
}
function wordiiOpenSharedProfile(){
  const name = new URLSearchParams(location.search).get('profile');
  if (!name || !/^[a-z0-9_]{3,15}$/i.test(name)) return;
  history.replaceState(null, '', location.pathname);
  if (me?.username?.replace(/^@/, '').toLowerCase() === name.toLowerCase()) {
    renderProfile(); toast('This is your profile'); return;
  }
  getDoc(doc(db, 'usernames', name.toLowerCase())).then(s => {
    const target = s.data()?.uid;
    if (target) openProfileView(target);
    else toast('Shared profile not found');
  }).catch(e => toast(friendly(e)));
}
function wordiiAssistantHTML(){
  return `<div class="card"><h3>🤖 Wordii Assistant</h3><p class="tiny">Official offline help assistant. It does not read your chats.</p><div id="wdBotLog" aria-live="polite" style="max-height:320px;overflow:auto;display:grid;gap:8px;margin:12px 0"></div><form id="wdBotForm" style="display:flex;gap:8px"><input id="wdBotInput" maxlength="120" placeholder="Type /help" aria-label="Bot command" required style="min-width:0;flex:1"><button class="btn" type="submit">Send</button></form><p class="tiny">Try /help, /level, /profile, /rules, /updates, /support.</p><div class="wd-bot-quick"><button class="btn sm ghost" type="button" data-bot-cmd="/help">/help</button><button class="btn sm ghost" type="button" data-bot-cmd="/support">/support</button><button class="btn sm ghost" type="button" data-bot-cmd="/level">/level</button></div><div id="wdBotAnnouncement" class="wd-bot-announcement">Loading official announcement…</div>${me?.admin===true?`<div class="wd-bot-admin"><b>🤖 Admin Bot Settings</b><p class="tiny">Configure a custom /welcome reply for users. Only Admin can save it.</p><textarea id="wdBotWelcomeText" maxlength="500" placeholder="Custom welcome message"></textarea><button type="button" class="btn" id="wdBotWelcomeSave">Save bot reply</button><hr><b>📣 Official announcement</b><textarea id="wdBotAnnouncementText" maxlength="500" placeholder="Message for all Wordii users"></textarea><button type="button" class="btn" id="wdBotPublish">Publish announcement</button><p class="tiny">Appears in the assistant and in-app notification while the app is open. Background push needs a separate server.</p></div>`:''}</div>`;
}
let wordiiBotWelcome = "Welcome to Wordii Chat! Type /help for commands.";
function wordiiBotReply(raw){
  if(raw.trim().toLowerCase() === "/start" || raw.trim().toLowerCase() === "/welcome")return wordiiBotWelcome;
  const cmd=raw.trim().toLowerCase().split(/\s+/)[0];
  if(cmd==='/help'||cmd==='help') return 'Commands: /start, /welcome, /help, /level, /profile, /rules, /updates, /support';
  if(cmd==='/level') return `🏆 Level ${me?.level||1} · ${me?.points||0} points`;
  if(cmd==='/profile') return `👤 ${me?.username||'Unknown'} · ${wordiiProfileShareURL()}`;
  if(cmd==='/rules') return 'Be respectful. No harassment, spam or sharing private information without permission.';
  if(cmd==='/updates') return `Installed web build: v${WORDII_WEB_VERSION}. Check Settings → App Updates for the latest APK.`;
  if(cmd==='/support') return 'For help, open Settings → Account or contact the Wordii Chat administrator. Never share passwords or OTPs.';
  return 'I can help with Wordii Chat commands. Type /help to see options.';
}
function wordiiBindAssistant(){
  const log=document.getElementById('wdBotLog'),form=document.getElementById('wdBotForm');
  if(!log||!form)return;
  const add=(who,message)=>{const el=document.createElement('div');el.className='card';el.style.margin='0';const title=document.createElement('b');title.textContent=who;const content=document.createElement('p');content.style.whiteSpace='pre-wrap';content.style.overflowWrap='anywhere';content.textContent=message;el.append(title,content);log.append(el);log.scrollTop=log.scrollHeight;};
  add('Wordii Assistant',wordiiBotWelcome);
  log.closest('.card')?.querySelectorAll('[data-bot-cmd]').forEach(b=>b.onclick=()=>{const v=b.dataset.botCmd;add('You',v);add('Wordii Assistant',wordiiBotReply(v));});
  const welcomeRef=doc(db,'wordiiConfig','botWelcome');
  getDoc(welcomeRef).then(snap=>{if(snap.exists()){wordiiBotWelcome=snap.data().text;const field=document.getElementById('wdBotWelcomeText');if(field)field.value=wordiiBotWelcome;}}).catch(()=>{});
  document.getElementById('wdBotWelcomeSave')?.addEventListener('click',e=>act(async()=>{if(me?.admin!==true)throw Error('Admin only');const text=document.getElementById('wdBotWelcomeText').value.trim();if(!text||text.length>500)throw Error('Enter a reply under 500 characters');await setDoc(welcomeRef,{text,updatedAt:serverTimestamp(),updatedBy:uid});wordiiBotWelcome=text;toast('Bot reply saved');},e.currentTarget));
  const announcementRef=doc(db,'wordiiConfig','botAnnouncement');
  const unsub=onSnapshot(announcementRef,snap=>{
    if(subKey!=='assistant'){unsub();return;}
    const data=snap.data(),box=document.getElementById('wdBotAnnouncement');
    if(box)box.textContent=data?.text ? '📣 Official: '+data.text : 'No official announcement yet.';
  },()=>{const box=document.getElementById('wdBotAnnouncement');if(box)box.textContent='Announcements unavailable.';});
  document.getElementById('wdBotPublish')?.addEventListener('click',async e=>{
    const b=e.currentTarget,content=document.getElementById('wdBotAnnouncementText')?.value.trim();
    if(!content){toast('Write an announcement first.');return;}
    await act(async()=>{if(me?.admin!==true)throw Error('Admin only');await setDoc(announcementRef,{text:content,updatedAt:serverTimestamp(),updatedBy:uid});toast('Announcement published');},b);
  });
  form.addEventListener('submit',e=>{e.preventDefault();const input=document.getElementById('wdBotInput');const value=input.value.trim();if(!value)return;add('You',value);add('Wordii Assistant',wordiiBotReply(value));input.value='';});
}
function shareInvite() {
  const d = { title: "Wordii Chat", text: `Chat with me on Wordii Chat! Find me: ${me.username}`, url: wordiiProfileShareURL() };
  if (navigator.share) navigator.share(d).catch(() => {}); else { copy(`${d.text} ${d.url}`); toast("Invite copied"); }
}
function renderSettings(force) {
  if (!me || !subKey) return;
  const ae = document.activeElement;
  if (!force && ae && ["INPUT", "TEXTAREA", "SELECT"].includes(ae.tagName) && $("#settingsBody").contains(ae)) return;
  const u = auth.currentUser, email = u?.email && !isFakeEmail(u.email) ? u.email : "";
  const t = pref("theme", "auto"), bg = pref("chatbg", "0"), nOn = pref("notif", "on") === "on";
  const pages = {
    assistant: () => wordiiAssistantHTML(),
    ads: () => `<div class="card"><h3>📢 Ad Preferences</h3>
      ${canBTP() ? `<label class="setrow"><span><b>Show Ads</b><small>Admin and Pre-Admin: OFF by default</small></span><input type="checkbox" id="wdStaffAds" ${wordiiStaffAdsEnabled() ? 'checked' : ''}></label><p class="tiny">Turn ON only if you want to see ads. You can switch OFF anytime. This choice is saved on this device.</p>` : `<p class="tiny">${me?.premium ? 'Premium: fewer ads, with longer breaks.' : 'Standard: limited ads with breaks.'}</p>`}
      <p class="tiny">Ads are optional on this screen. Live ads depend on AdMob approval. No EXP is awarded for rewarded ads yet.</p>
      <div class="row-btns"><button type="button" class="btn sm" id="wdTestBanner">Show banner</button><button type="button" class="btn sm ghost" id="wdHideBanner">Hide banner</button><button type="button" class="btn sm" id="wdTestRewarded">Watch rewarded ad</button></div>
      <p class="tiny">Real AdMob IDs configured. Earnings begin only if AdMob approves ad serving; no XP rewards yet.</p></div>`,

    overview: () => `<div class="wd-settings-overview"><div class="wd-settings-person"><div class="wd-settings-avatar">${avatarHTML(me)}</div><div><strong>${esc(me.displayName || me.username)}</strong><p class="tiny">${esc(me.username)} · Level ${me.level || 1}</p></div></div>
      ${[['✨','myprofile','My Profile','View your full profile, posts and badges'],['👤','edit','Edit profile','Name, bio, profile photo and banner'],['🏆','points','Points & level','XP, progress and streak'],['🔑','account','Account','Login, email and account security'],['🔒','privacy','Privacy','Online status, public account'],['💬','chats','Chats','Chat wallpaper and theme'],['🎨','appearance','Appearance','Light and dark app theme'],['🔔','notif','Notifications','Message and push alerts'],['🌐','lang','App language','Current language options'],['💎','subs','Subscriptions','Available plans'],['📢','ads','Ad Preferences','Manage ad visibility and frequency'],['🚀','updates','App Updates','Check the app version'],['🤖','assistant','Wordii Assistant','Help, rules and account commands'],...(me?.admin===true ? [['🎨','brand','App Branding','Upload or reset the Wordii logo'],['👑','levelCharacter','Character on Level','Assign a transparent PNG to a username']] : [])].map(([ico,k,label,desc])=>`<button type="button" class="wd-settings-link" data-wd-settings="${k}"><span class="wd-settings-ico">${ico}</span><span><b>${label}</b><small>${desc}</small></span><span class="wd-settings-arrow">›</span></button>`).join('')}</div>`,
    appearance: () => `<div class="card"><b>App theme</b><p class="tiny">Choose a theme for all screens.</p><select id="setTheme"><option value="dark" ${t==='dark'?'selected':''}>Dark</option><option value="light" ${t==='light'?'selected':''}>Light</option>${canGreenTheme(me) ? `<option value="green" ${t==='green'?'selected':''}>White + Green</option>` : ""}<option value="auto" ${t==='auto'?'selected':''}>System default</option></select></div>`,
    points: () => {
      const points = Math.max(0, Number(me.points) || 0);
      const level = Number(me.level) || 1;
      const progress = points % 10;
      return `<section class="wd-rewards">
        <div class="wd-rewards-heading"><div><span class="wd-rewards-kicker">WORDII REWARDS</span><h2>Points & Level</h2><p>Your activity, your progress.</p></div><span class="wd-rewards-crown" aria-hidden="true">🏆</span></div>
        <div class="wd-rewards-hero"><div class="wd-rewards-hero-top"><div><span>CURRENT LEVEL</span><strong>${level.toString().padStart(2,'0')}</strong></div><div class="wd-rewards-total"><span>TOTAL POINTS</span><strong>⚡ ${points}</strong></div></div>
          <div class="wd-rewards-track" role="progressbar" aria-label="Progress to next level" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="10"><i style="width:${progress*10}%"></i></div>
          <div class="wd-rewards-progress-label"><span>Level progress</span><b>${progress} / 10 XP</b></div><p>${10-progress} more points to Level ${level+1}</p></div>
        <div class="wd-rewards-tiles"><div class="wd-rewards-tile"><span>🔥</span><strong>${Math.max(0,Number(me.streak)||0)} Day</strong><small>Daily streak</small></div><div class="wd-rewards-tile"><span>🎁</span><strong>+4 XP</strong><small>Daily streak reward</small></div></div>
        <div class="wd-rewards-info"><b>How to earn points</b><p>+4 once a day for your streak and +1 for every active minute. Every 10 points = 1 level.</p></div>
        <div class="wd-rewards-ad"><div class="wd-rewards-ad-top"><div><b>🎬 Rewarded Ad</b><small>Optional rewarded advertisement</small></div><span class="wd-rewards-chip">XP pending</span></div>
          <button type="button" class="btn wd-rewards-watch" id="wdPointsTestRewarded">▶ Watch Rewarded Ad</button>
          <p>*No XP is awarded yet. Verified rewards will be enabled in a future update.</p></div>
      </section>`;
    },
    edit: () => `<div class="card center"><div class="you-ava">${avatarHTML(me, true)}</div><br><button id="logoBtn" class="btn sm ghost" style="margin-top:12px">Change logo</button><input id="logoInput" type="file" accept="image/*" hidden></div>
      <div class="card"><b>Your name</b><p class="tiny">Friends see this name. Your @username stays the same.</p><input id="dnInput" maxlength="30" placeholder="Display name" value="${esc(me.displayName || "")}"><button id="saveName" class="btn">Save name</button></div>
      <div class="card"><b>About you</b><p class="tiny">Your bio and banner show when people open your profile.</p>
        <textarea id="bioInput" maxlength="150" placeholder="Write a short bio">${esc(me.bio || "")}</textarea><button id="saveBio" class="btn">Save bio</button>
        <img id="wdBannerPreview" alt="Banner preview" src="${hasBanner(me) ? esc(me.banner) : (me?.admin === true ? "/profile-v2/admin-banner.jpg" : "")}" style="display:block;width:100%;max-height:175px;object-fit:cover;border-radius:12px;margin:10px 0" ${hasBanner(me) || me?.admin === true ? "" : "hidden"}><button id="bannerBtn" class="btn ghost">Change banner</button><input id="bannerInput" type="file" accept="image/*" hidden></div>`,
    account: () => `<div class="card tiny"><b>${esc(me.username)}</b>${vb(me)}<br>${email ? `Gmail: ${esc(email)} ${u.emailVerified ? "✅ verified" : "⚠️ not verified"}` : "No Gmail added yet."}</div>
      ${u?.isAnonymous
        ? `<div class="card"><b>🔐 Protect your account</b><p class="tiny">Add your Gmail and a password. If you delete the app, change phone or forget your password, you can get this account back.</p>
           <input id="emInput" type="email" placeholder="Your Gmail" autocomplete="email" autocapitalize="none"><input id="pwInput" type="password" placeholder="New password (6+ characters)" autocomplete="new-password"><button id="pwBtn" class="btn">Save</button></div>`
        : `<div class="card tiny">✅ Account protected. On a new phone choose <b>Log in</b>. ${isFakeEmail(u?.email) ? "This is an old-style account: log in with your @username + password." : "Forgot your password? Tap <b>Forgot password?</b> on the Log in screen."}</div>`}
      ${!u?.isAnonymous && !isFakeEmail(u?.email) ? `<div class="card"><b>✉️ Change email</b><p class="tiny">A verification link will be sent to the new address. You may need to log in again first.</p><input id="changeEmailInput" type="email" placeholder="New email address" autocomplete="email"><button id="changeEmailBtn" class="btn">Send verification link</button><button id="resendEmailBtn" class="btn ghost">Verify current email</button></div>` : ""}
      <div class="card"><b>✏️ Change username</b><p class="tiny">3–15 letters, numbers or underscores. Your chats and badges stay with this account.</p><input id="wdNewUsername" maxlength="15" autocapitalize="none" autocomplete="off" placeholder="New username (without @)"><button type="button" class="btn" id="wdChangeUsername">Save username</button></div>
      <div class="card wd-phone-card"><b>📱 Optional phone verification</b><p class="tiny">${u?.phoneNumber ? `✅ Verified: ${esc(u.phoneNumber)}` : 'Verify your number with a one-time SMS code. You can keep using Wordii without doing this.'}</p>${!u?.phoneNumber ? `<label for="wdPhoneNumber">Phone number with country code</label><input id="wdPhoneNumber" type="tel" inputmode="tel" autocomplete="tel" placeholder="+91XXXXXXXXXX" maxlength="17"><div id="wdPhoneCaptcha"></div><button type="button" class="btn" id="wdPhoneSend">Send OTP</button><div id="wdPhoneOtpBox"><label for="wdPhoneOtp">6-digit SMS code</label><input id="wdPhoneOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="Enter OTP"><button type="button" class="btn" id="wdPhoneConfirm">Verify number</button></div><p id="wdPhoneStatus" class="tiny" role="status"></p>` : '<p class="tiny">Your number is linked to this account.</p>'}<p class="tiny">Never share OTPs. SMS delivery requires Firebase Phone Authentication and billing configuration.</p></div>
      <div class="card"><b>🔒 Privacy & Data Control</b><p class="tiny">Request deletion of your account or selected personal data. Requests are reviewed after ownership verification.</p><a class="btn ghost" style="display:block;text-align:center;margin:10px 0" href="mailto:officialwordii@gmail.com?subject=Wordii%20Chat%20Account%20Deletion">🗑️ Delete My Account</a><a class="btn ghost" style="display:block;text-align:center;margin:10px 0" href="mailto:officialwordii@gmail.com?subject=Wordii%20Chat%20Data%20Deletion%20Only">🔐 Delete My Data Only</a><p class="tiny">Include your username and the data you want deleted. Never send your password or OTP. Your request does not delete data immediately.</p></div>
      <div class="card"><button class="btn ghost" id="setLogout">Log out</button></div>`,
    privacy: () => `<div class="card"><label class="setrow"><span><b>Public account</b></span><input type="checkbox" id="setPublic" ${me.isPublic ? "checked" : ""}></label>
        <p class="tiny">Public: anyone who finds your username can message you directly. Private: they must send a request and you accept it. Anyone with your 6-digit code can always connect.</p></div>
      <div class="card"><label class="setrow"><span><b>Show when I'm online</b></span><input type="checkbox" id="setShowOnline" ${me.showOnline === false ? "" : "checked"}></label>
        <p class="tiny">Friends see "Active now" while you use the app. Turn it off to hide it (you won't see theirs either way).</p></div>
      ${me?.premium ? `<div class="card"><label class="setrow"><span><b>🥷 Anonymous mode (Premium)</b></span><input type="checkbox" id="setPremiumInvisible" ${premiumInvisible() ? "checked" : ""}></label><p class="tiny">Hide new status views and Seen receipts on this device. Likes disabled. Existing views remain.</p></div>` : ``}`,
    chats: () => `<div class="card"><b>Theme</b><select id="setTheme"><option value="auto" ${t === "auto" ? "selected" : ""}>Same as my phone</option><option value="dark" ${t === "dark" ? "selected" : ""}>Dark</option><option value="light" ${t === "light" ? "selected" : ""}>Light</option>${canGreenTheme(me) ? `<option value="green" ${t === "green" ? "selected" : ""}>White + Green</option>` : ""}</select>
        <p class="tiny" style="margin-top:12px">Chat background</p>
        <div class="colors">${BG_SW.map((c, i) => `<button type="button" data-bg="${i}" class="${String(i) === bg ? "on" : ""}" style="background:${c}" aria-label="Background ${i + 1}"></button>`).join("")}</div>${canBTP() || me?.premium ? `<div class="wd-wallpaper-settings"><label for="wdWallpaperFile"><b>🖼️ My gallery wallpaper</b></label><input type="file" id="wdWallpaperFile" accept="image/*"><button type="button" class="btn ghost" id="wdWallpaperClear">Remove custom wallpaper</button><p class="tiny">Saved only on this device. Choose an image under 5 MB.</p></div>` : `<p class="tiny">Gallery wallpaper is a Premium feature.</p>`}</div>`,
    notif: () => `<div class="card"><label class="setrow"><span><b>Message notifications</b></span><input type="checkbox" id="setNotif" ${nOn ? "checked" : ""}></label>
        <p class="tiny">Alerts inside the app and while it is open or in the background.</p></div>
      <div class="card"><b>Alerts when the app is closed</b>
        <p class="tiny">${pushOn() ? "✅ ON for this phone." : "OFF for this phone."} Enable phone notifications. Closed-app alerts require the Wordii secure push sender backend.</p>
        <button class="btn" id="${pushOn() ? "pushOff" : "pushOn"}">${pushOn() ? "Turn off" : "Turn on"}</button></div>`,
    dash: () => `<div class="card center" id="dashStats">Loading…</div><div class="seg"><button data-dtab="active" class="on">Active</button><button data-dtab="new">New</button><button data-dtab="top">Top points</button></div><div id="dashList"></div>`,
    gifts: () => canBTP() ? `<div class="card"><b>🎁 Manage level gifts</b><p class="tiny">Set a gift name for any level. You can edit or remove it later. Gifts are announcements, not automatically delivered items.</p><label for="giftLevel">Level</label><input id="giftLevel" type="number" min="1" max="10000" placeholder="e.g. 5"><label for="giftName">Gift</label><input id="giftName" maxlength="100" placeholder="e.g. VIP badge"><label for="giftExp">Bonus EXP (reward configuration)</label><input id="giftExp" type="number" min="0" max="100000" value="0"><label for="giftPhoto">Prize photo (optional)</label><input id="giftPhoto" type="file" accept="image/*"><p class="tiny">EXP is saved with the prize; automatic crediting to user accounts needs a separate secure server-side feature.</p><button id="giftSave" class="btn">Save level gift</button></div><div id="giftList" class="card">Loading gifts…</div>` : `<div class="card">Admin only.</div>`,
    updates: () => `<div class="card">
      <h3>🚀 Wordii Chat Updates</h3>
      <p class="tiny">Web build v${WORDII_WEB_VERSION} · November 2026</p>
      <p class="tiny">Check for the latest released Android APK. Web app updates are delivered automatically by the hosting provider after deployment.</p>
      <button class="btn" id="checkWordiiUpdate">Check for APK Updates</button>
      ${me?.admin === true ? `<div class="card" style="margin-top:12px"><b>Media connection diagnostic</b><p class="tiny">Firebase login verification is available; Drive/media uploads are not enabled yet.</p><button class="btn sm ghost" type="button" id="wordiiMediaAuthTest">Test Media API login</button></div>` : ''}
      <div id="wordiiUpdateResult" style="margin-top:14px"></div>
    </div>`,
    lang: () => `<div class="card tiny">English. Hindi is coming soon.</div>`,
    musicAdmin: () => me?.admin === true ? wordiiAdminMusicHTML() : `<div class="card">Access denied.</div>`,
    codeSettings: () => `<div class="card"><h3>🔑 Connect by Code</h3><p class="tiny">Code tabhi banega jab Generate Code dabaaoge. Code 10 minutes valid rahega.</p><button type="button" class="btn" id="wdOpenCode">Open Generate Code</button></div>`,
    subs: () => wordiiFullSubscriptionHTML(),
    couple: () => wordiiCouplePage(),
    levelCharacter: () => me?.admin===true ? `<div class="card"><h3>👑 Character on Level</h3><p class="tiny">Admin only · PNG with transparent background · 256px recommended. Characters appear above the Level badge.</p><label>Exact username</label><input id="wdLevelUser" placeholder="@username#123" autocapitalize="none" autocomplete="off"><label>Character PNG</label><input id="wdLevelFile" type="file" accept="image/png"><img id="wdLevelPreview" alt="Character preview" style="display:none;max-width:120px;max-height:120px;object-fit:contain;background:#171019;border-radius:12px"><div class="row-btns"><button class="btn" id="wdLevelAssign" type="button">Assign / Replace</button><button class="btn ghost" id="wdLevelRemove" type="button">Remove</button></div><p class="tiny" id="wdLevelFeedback">Firestore stores a compact PNG (max 160 KB). Do not upload private photos without permission.</p></div>` : `<div class="card">Admin only</div>`,
    brand: () => me?.admin === true ? `<div class="card wd-brand-manager"><h3>🎨 App Logo Manager</h3><p class="tiny">Only full admins can change the in-app logo. Home-screen icon requires a new APK.</p><img id="wdBrandPreview" src="${esc(wordiiBrandLogo)}" alt="Current Wordii logo"><input type="file" id="wdBrandFile" accept="image/png,image/jpeg,image/webp"><div class="row-btns"><button type="button" class="btn" id="wdBrandSave">Apply logo</button><button type="button" class="btn ghost" id="wdBrandReset">Reset to Logo E</button></div></div>` : `<div class="card">Admin only</div>`,
    admin: () => canBTP() ? `<div class="card"><b>🛡️ BTP — Badge & Trust Panel</b><p class="tiny">Search a username. Only Admin can assign Pre-Admin. Premium and Verified badges require payment approval.</p><div class="wd-badge-showcase" aria-label="Wordii role badges"><img src="wordii-badges/admin_full.png" alt="Admin role badge" loading="lazy"><img src="wordii-badges/pre_admin_full.png" alt="Pre-Admin role badge" loading="lazy"><img src="wordii-badges/premium_user_full.png" alt="Premium User role badge" loading="lazy"><img src="wordii-badges/verified_user_full.png" alt="Verified User role badge" loading="lazy"></div><input id="admSearch" placeholder="Search username" autocapitalize="none" autocomplete="off"><div id="admResults"></div></div>${me?.admin ? `<div class="card"><b>📩 Suspension appeals</b><div id="wdAppealAdminList">Loading…</div><button type="button" class="btn ghost" id="wdRefreshAppeals">Refresh appeals</button></div>` : ``}` : `<div class="card">Access denied.</div>`,
  };
  $("#settingsBody").innerHTML = (pages[subKey] || (() => ""))();
  applyWordiiWallpaper();
  if (subKey === "levelCharacter" && me?.admin === true) wdBindLevelCharacterSettings();
  if (subKey === "admin") { renderAdm(); if (me?.admin) loadSuspensionAppeals(); }
  if (subKey === "musicAdmin" && me?.admin === true) wordiiBindAdminMusic();
  if (subKey === "subs") loadWordiiSubscription();
  if (subKey === "couple") { void wordiiCouplePayments(); void wordiiCoupleRefresh(); }
  if (subKey === "assistant") wordiiBindAssistant();
  if (subKey === "dash") loadDash();
  if (subKey === "gifts" && canBTP()) loadLevelGifts();
}
function renderAdm() {
  const box = $("#admResults"); if (!box) return;
  box.innerHTML = admList.length ? admList.map((u) => `<div class="row nopoint">${avatarHTML(u)}<div class="grow"><b>${esc(nameOf(u))}${vb(u)}</b><span class="muted">${esc(u.username)}</span></div><div class="btp-actions">${me?.admin===true ? `<button class="btn sm ghost" data-suspend="${esc(u.id)}">${u.suspended ? 'Unban' : 'Suspend'}</button>` : ''}${me?.admin===true && u.admin!==true && u.id!==uid ? `<button class="btn sm ghost" data-delete-request="${esc(u.id)}">🗑 Request Delete</button>` : ''}${me?.admin===true ? `<button class="btn sm ghost" data-btp="preAdmin" data-user="${esc(u.id)}">${u.preAdmin?'Remove Pre-Admin':'Pre-Admin'}</button>`:''}${canBTP() && u.admin!==true ? `<button class="btn sm ghost" data-btp="verified" data-user="${esc(u.id)}">${u.verified?'Remove Verified':'Give Verified'}</button><button class="btn sm ghost" data-btp="premium" data-user="${esc(u.id)}">${u.premium?'Remove Premium':'Give Premium'}</button>`:''}</div></div>`).join("") : `<p class="tiny">Type at least 2 letters.</p>`;
}
async function loadSuspensionAppeals() {
  const box = $('#wdAppealAdminList');
  if (!box || me?.admin !== true) return;
  try {
    const snap = await getDocs(query(collection(db, 'suspensionAppeals'), limit(50)));
    box.innerHTML = snap.empty ? '<p class="tiny">No appeals yet.</p>' : snap.docs.map(d => {
      const a = d.data();
      return `<div class="card"><b>${esc(a.uid)}</b><p>${esc(a.message)}</p><small>${esc(a.status)}</small>${a.status === 'pending' ? `<button type="button" class="btn sm" data-appeal-restore="${esc(a.uid)}">Restore account</button><button type="button" class="btn sm ghost" data-appeal-reject="${esc(a.uid)}">Reject</button>` : ''}</div>`;
    }).join('');
  } catch(e) { box.textContent = friendly(e); }
}
$("#setBack").onclick = () => { if(subKey!=="overview") openSub("overview"); else { void wordiiHideTestBanner(); $("#settings").classList.add("hidden"); } };
$("#settingsBody").addEventListener("click", e => { const b=e.target.closest("[data-wd-settings]"); if(b) openSub(b.dataset.wdSettings); });
$("#settingsBody").addEventListener("click", e => {
  const b = e.target.closest('#wdTestBanner, #wdHideBanner, #wdTestRewarded');
  if (!b) return;
  b.disabled = true;
  const task = b.id === 'wdTestBanner' ? wordiiShowTestBanner()
    : b.id === 'wdHideBanner' ? wordiiHideTestBanner() : wordiiShowTestRewarded();
  Promise.resolve(task).then(() => {
    if (b.id === 'wdTestRewarded') toast('Ad finished. No EXP awarded.');
  }).catch(err => toast('Ad: ' + String(err?.message || err).slice(0, 120)))
    .finally(() => { b.disabled = false; });
});
// Points page: use the existing Android test-ad flow, never grant client-side EXP.
$("#settingsBody").addEventListener("click", e => {
  const b = e.target.closest("#wdPointsTestRewarded");
  if (!b || b.disabled) return;
  b.disabled = true;
  wordiiShowTestRewarded().then(() => toast("Ad completed. No EXP awarded yet."))
    .catch(err => toast("Rewarded ad unavailable: " + (err?.message || err)))
    .finally(() => { if (b.isConnected) b.disabled = false; });
});
$("#settingsBody").addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "wdStaffAds" && canBTP()) {
    try { localStorage.setItem('wordii_staff_ads_' + uid, t.checked ? 'on' : 'off'); if (!t.checked) void wordiiHideTestBanner(); toast(t.checked ? 'Ads enabled for this device' : 'Ads disabled'); }
    catch (_) { t.checked = false; toast('Could not save ad preference'); }
  }
  else if (t.id === "setPublic") act(async () => { await updateDoc(doc(db, "users", uid), { isPublic: t.checked }); toast(t.checked ? "Account is public" : "Account is private"); });
  else if (t.id === "setTheme") { if (t.value === "green" && !canGreenTheme(me)) { toast("White + Green requires Admin, Pre-Admin or Premium"); t.value="dark"; } const theme=t.value === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : t.value; setPref("theme",t.value); document.documentElement.dataset.wdTheme=theme; document.documentElement.dataset.theme=theme; document.querySelector('meta[name="theme-color"]')?.setAttribute("content",(theme==="light"||theme==="green")?"#ffffff":"#08080b"); }
  else if (t.id === "setNotif") setPref("notif", t.checked ? "on" : "off");
  else if (t.id === "wdWallpaperFile" && (canBTP() || me?.premium)) {
    const file = t.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) { toast("Choose an image under 5 MB"); return; }
    act(async () => {
      const photo = await compress(file, {max: 900, quality: 0.62, limitLen: 950000});
      if (!photo?.startsWith("data:image/")) throw new Error("Could not process wallpaper");
      localStorage.setItem("wordii_wallpaper_" + uid, photo);
      applyWordiiWallpaper();
      toast("Wallpaper saved on this device");
    });
  }
  else if (t.id === "setPremiumInvisible" && me?.premium) {
    savePremiumInvisible(t.checked);
    toast(t.checked ? "Anonymous mode enabled on this device" : "Anonymous mode disabled");
  }
  else if (t.id === "setShowOnline") act(async () => { await updateDoc(doc(db, "users", uid), { showOnline: t.checked }); toast(t.checked ? "Others can see when you are online" : "Your online status is hidden"); });
});
$("#settingsBody").addEventListener("input", (e) => {
  if (e.target.id !== "admSearch") return;
  clearTimeout(admTimer);
  admTimer = setTimeout(async () => { try { admList = await searchPeople($("#admSearch").value); } catch (err) { toast(friendly(err)); admList = []; } renderAdm(); }, 350);
});
$("#settingsBody").addEventListener("click", async (e) => {
  if (e.target.closest("#wdPhoneSend")) {
    const button=e.target.closest("#wdPhoneSend");button.disabled=true;
    try { await wordiiSendPhoneOTP(); } catch(err) { wordiiPhoneStatus(friendly(err)); } finally { button.disabled=false; }
    return;
  }
  if (e.target.closest("#wdPhoneConfirm")) {
    const button=e.target.closest("#wdPhoneConfirm");button.disabled=true;
    try { await wordiiConfirmPhoneOTP(); } catch(err) { wordiiPhoneStatus(friendly(err)); } finally { button.disabled=false; }
    return;
  }
  if (e.target.closest("#wordiiMediaAuthTest")) {
    const button = e.target.closest("#wordiiMediaAuthTest");
    button.disabled = true;
    try { await wordiiTestMediaAuth(); } finally { button.disabled = false; }
    return;
  }
  if (e.target.closest("#checkWordiiUpdate")) {
    const result = document.getElementById("wordiiUpdateResult");
    if (result) {
      result.textContent = "Checking GitHub Releases…";
      wordiiCheckForApkUpdate({manual:true, result});
    }
    return;
  }
  if (await handleWordiiSubscriptionClick(e)) return;
  if (e.target.closest("#wdChangeUsername")) {
    const button=e.target.closest("#wdChangeUsername");
    act(async()=>{
      const key=String($("#wdNewUsername")?.value||"").trim().toLowerCase().replace(/^@/,"");
      if(!/^[a-z0-9_]{3,15}$/.test(key))throw Error("Use 3–15 letters, numbers or underscores.");
      if(!auth.currentUser || auth.currentUser.uid!==uid)throw Error("Log in again.");
      const oldKey=String(me?.usernameKey||me?.username?.replace(/^@/,"")||"").toLowerCase();
      if(key===oldKey)throw Error("This is already your username.");
      const userRef=doc(db,"users",uid),newRef=doc(db,"usernames",key),oldRef=doc(db,"usernames",oldKey);
      await runTransaction(db,async tx=>{
        const [userSnap,newSnap,oldSnap]=await Promise.all([tx.get(userRef),tx.get(newRef),tx.get(oldRef)]);
        if(!userSnap.exists()||userSnap.data().usernameKey!==oldKey)throw Error("Username changed elsewhere. Reopen settings.");
        if(newSnap.exists())throw Error("Username is already taken.");
        if(!oldSnap.exists()||oldSnap.data().uid!==uid)throw Error("Old username record missing. Contact support.");
        tx.set(newRef,{uid,createdAt:serverTimestamp()});
        tx.update(userRef,{
          username:"@"+key,
          usernameKey:key,
          usernameChangeCount:increment(1),
          usernameHistoryTrackingSince:serverTimestamp()
        });
        tx.delete(oldRef);
      });
      me.username="@"+key;me.usernameKey=key;
      renderSettings(true);toast("Username changed successfully");
    },button);
    return;
  }
  if (e.target.closest("#changeEmailBtn")) {
    const newEmail = $("#changeEmailInput")?.value.trim().toLowerCase();
    if (!newEmail || !EMAIL_RE.test(newEmail)) { toast("Enter a valid email address"); return; }
    act(async () => {
      await verifyBeforeUpdateEmail(auth.currentUser, newEmail);
      toast("Verification sent. Check the new email inbox and follow the link.");
    }, e.target.closest("#changeEmailBtn"));
    return;
  }
  if (e.target.closest("#resendEmailBtn")) {
    act(async () => {
      await sendEmailVerification(auth.currentUser);
      toast("Verification email sent. Check your inbox.");
    }, e.target.closest("#resendEmailBtn"));
    return;
  }
  const bgb = e.target.closest("[data-bg]");
  if (bgb) { setPref("chatbg", bgb.dataset.bg); applyChatBg(); renderSettings(); return; }
  if (e.target.closest('#wdRefreshAppeals')) { loadSuspensionAppeals(); return; }
  const deleteRequestBtn = e.target.closest('[data-delete-request]');
  if (deleteRequestBtn) {
    if (me?.admin !== true) return;
    const target = admList.find(x => x.id === deleteRequestBtn.dataset.deleteRequest);
    if (!target || target.id === uid || target.admin === true) { toast('Cannot request deletion of an admin'); return; }
    if (!confirm(`Request PERMANENT deletion of ${target.username}? This is not a suspension.`)) return;
    const typed = prompt(`To confirm, type the exact username: ${target.username}`);
    if (typed !== target.username) { toast('Username did not match. Cancelled.'); return; }
    act(async () => {
      await setDoc(doc(db, 'accountDeletionRequests', target.id), {
        targetUid: target.id, targetUsername: target.username,
        requestedBy: uid, requestedAt: serverTimestamp(), status: 'pending'
      });
      toast('Deletion requested. Admin server execution still required.');
    }, deleteRequestBtn);
    return;
  }
  const suspendBtn = e.target.closest('[data-suspend]');
  if (suspendBtn) {
    if (me?.admin !== true) return;
    const target = admList.find(x => x.id === suspendBtn.dataset.suspend);
    if (!target || target.admin === true || target.id === uid) { toast('Cannot suspend an Admin'); return; }
    const next = target.suspended !== true;
    if (!confirm(`${next ? 'Suspend' : 'Restore'} ${target.username}?`)) return;
    act(async () => {
      await updateDoc(doc(db, 'users', target.id), {suspended: next, suspendedBy: uid, suspendedAt: serverTimestamp()});
      target.suspended = next; renderAdm(); toast(next ? 'Account suspended' : 'Account restored');
    }, suspendBtn);
    return;
  }
  const appealBtn = e.target.closest('[data-appeal-restore], [data-appeal-reject]');
  if (appealBtn && me?.admin === true) {
    const targetId = appealBtn.dataset.appealRestore || appealBtn.dataset.appealReject;
    const restore = !!appealBtn.dataset.appealRestore;
    if (!confirm(`${restore ? 'Restore account' : 'Reject appeal'}?`)) return;
    act(async () => {
      if (restore) await updateDoc(doc(db, 'users', targetId), {suspended:false, suspendedBy:uid, suspendedAt:serverTimestamp()});
      await updateDoc(doc(db, 'suspensionAppeals', targetId), {status:restore?'reviewed':'rejected', reviewedBy:uid, reviewedAt:serverTimestamp()});
      await loadSuspensionAppeals(); toast(restore ? 'Account restored' : 'Appeal rejected');
    }, appealBtn);
    return;
  }
  const btp = e.target.closest("[data-btp]");
  if (btp) {
    const target = admList.find(x => x.id === btp.dataset.user);
    const field = btp.dataset.btp;
    if (!target || !['preAdmin','verified','premium'].includes(field)) return;
    if (!canBTP() || (field === 'preAdmin' && me?.admin !== true)) { toast('Permission denied'); return; }
    if (target.admin === true) { toast('Admin account cannot be changed here'); return; }
    const next = target[field] !== true;
    if (!confirm(`${next?'Give':'Remove'} ${field} badge for ${target.username}?`)) return;
    act(async () => { await updateDoc(doc(db, 'users', target.id), { [field]: next }); target[field] = next; renderAdm(); toast('Badge updated'); }, btp);
    return;
  }
  if (e.target.closest("#giftSave")) {
    if (!canBTP()) { toast("Admin or Pre-Admin only"); return; }
    const level = Number($("#giftLevel")?.value), gift = $("#giftName")?.value.trim();
    if (!Number.isInteger(level) || level < 1 || level > 10000 || !gift || gift.length > 100) { toast("Enter a valid level and gift"); return; }
    const exp = Number($("#giftExp")?.value || 0);
    if (!Number.isInteger(exp) || exp < 0 || exp > 100000) { toast("EXP must be 0–100000"); return; }
    const file = $("#giftPhoto")?.files?.[0];
    act(async () => {
      const giftRef = doc(db, "levelRewards", String(level));
      const old = await getDoc(giftRef);
      let photo = old.exists() ? (old.data().photo || "") : "";
      if (file) {
        if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) throw new Error("Choose an image smaller than 5 MB");
        photo = await compress(file, {max: 480, quality: 0.62, limitLen: 65000});
      }
      await setDoc(giftRef, {level, gift, exp, photo, updatedAt: serverTimestamp(), updatedBy: uid});
      toast("Gift configuration saved"); loadLevelGifts();
    }, e.target.closest("#giftSave")); return;
  }
  const giftEdit = e.target.closest("[data-gift-edit]");
  if (giftEdit && canBTP()) { $("#giftLevel").value = giftEdit.dataset.giftEdit; $("#giftName").value = giftEdit.dataset.giftName; $("#giftExp").value = giftEdit.dataset.giftExp || "0"; $("#giftPhoto").value = ""; $("#giftName").focus(); return; }
  const giftRemove = e.target.closest("[data-gift-remove]");
  if (giftRemove && canBTP()) {
    const level = giftRemove.dataset.giftRemove;
    if (!confirm(`Remove the gift for level ${level}?`)) return;
    act(async () => { await deleteDoc(doc(db, "levelRewards", level)); toast("Gift removed"); loadLevelGifts(); }, giftRemove); return;
  }
  if (e.target.closest("#wdWallpaperClear") && (canBTP() || me?.premium)) {
    localStorage.removeItem("wordii_wallpaper_" + uid);
    applyWordiiWallpaper(); toast("Custom wallpaper removed"); return;
  }
  if (e.target.closest("#setAllow")) Notification.requestPermission().then(() => renderSettings());
  if (e.target.closest("#setInvite")) {
    const d = { title: "Wordii Chat", text: `Chat with me on Wordii Chat! Find me: ${me.username}`, url: wordiiProfileShareURL() };
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
  if (premiumInvisible()) return;
  if (viewed.has(st.id)) return; viewed.add(st.id);
  try { const ref=doc(db,"statuses",st.id,"views",uid);const existing=await getDoc(ref);if(!existing.exists())await setDoc(ref,{liked:false,at:serverTimestamp()}); } catch {}
}
function drawSVBar(st) {
  const bar = $("#svBar");
  const sm = $("#svTop small");
  if (sm && st.mentions?.includes(uid)) sm.append(" · 📣 mentioned you");
  if (sm && st.via) sm.append(" · ↪ shared");
  if (st.ownerUid === uid) { bar.innerHTML = `<button class="btn sm ghost" id="svSeen">👁 Views & ❤️ Likes · Swipe up</button>`; return; }
  ensureView(st);
  bar.innerHTML = (premiumInvisible() ? `<span class="tiny">🥷 Anonymous viewing · Likes disabled</span>` : `<button class="btn sm ghost" id="svLike" data-liked="0">♡ Like</button>`) + (st.mentions?.includes(uid) ? `<button class="btn sm" id="svReshare">➕ Add to my status</button>` : "");
  getDoc(doc(db, "statuses", st.id, "views", uid)).then((d) => {
    const b = $("#svLike"); if (sv.list[sv.i]?.id!==st.id)return; if (b && d.exists() && d.data().liked) { b.dataset.liked = "1"; b.textContent = "❤️ Liked"; }
  }).catch(() => {});
}
async function showSeenBy(st) {
  clearTimeout(sv.t);
  const snap = await getDocs(collection(db, "statuses", st.id, "views"));
  const rows = await Promise.all(snap.docs.map(async (d) => ({ u: (await getDoc(doc(db, "users", d.id))).data(), liked: d.data().liked })));
  let p = $("#seenPanel"); if (!p) { p = document.createElement("div"); p.id = "seenPanel"; $("#statusView").append(p); }
  p.innerHTML = `<div class="inbox-head" style="padding:4px 4px 8px"><b>👁 ${rows.length} views · ❤️ ${rows.filter((r) => r.liked).length} likes</b><button class="icon" id="seenClose">✕</button></div><div class="wd-activity-tabs"><button type="button" data-activity="all">All viewers</button><button type="button" data-activity="liked">Liked ❤️</button></div>` +
    (rows.length ? rows.map((r) => `<div class="row nopoint wd-activity-person" data-liked="${r.liked?"yes":"no"}">${avatarHTML(r.u)}<div class="grow"><b>${esc(nameOf(r.u))}${vb(r.u)}</b></div>${r.liked ? "❤️" : ""}</div>`).join("") : `<p class="tiny">No views yet.</p>`);
  p.classList.remove("hidden");
}
$("#statusView").addEventListener("click", (e) => {
  const st = sv.list[sv.i];
  const tab=e.target.closest("[data-activity]");if(tab){const liked=tab.dataset.activity==="liked";document.querySelectorAll("#seenPanel .wd-activity-person").forEach(row=>row.classList.toggle("hidden",liked&&row.dataset.liked!=="yes"));return;}
  if (e.target.closest("#seenClose")) { $("#seenPanel").classList.add("hidden"); drawSV(); return; }
  if (e.target.closest("#svSeen") && st) act(() => showSeenBy(st), e.target.closest("#svSeen"));
  const lk = e.target.closest("#svLike");
  if (lk && st && premiumInvisible()) { toast("Turn off Anonymous mode to like a status"); return; }
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
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) {
    const open = confirm(
      "Microphone permission is required. Open Wordii Chat App Settings to allow it?"
    );
    if (open) {
      const appId = "com.wordii.chat";
      const url = "intent://settings/#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;scheme=package;package=" + appId + ";end";
      try {
        window.location.href = url;
      } catch (_) {
        alert("Open Android Settings > Apps > Wordii Chat > Permissions > Microphone.");
      }
    }
    throw new Error("Microphone permission is not available. Allow it in App Settings.");
  }
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
  const box = $("#giftList"); if (!box || !canBTP()) return;
  try {
    const snapshot = await getDocs(query(collection(db, "levelRewards"), orderBy("level", "asc"), limit(200)));
    if (!box.isConnected) return;
    box.innerHTML = snapshot.empty ? `<p class="muted">No level gifts yet.</p>` : snapshot.docs.map(d => {
      const v = d.data(), level = Number(v.level);
      if (!Number.isInteger(level) || level < 1) return "";
      return `<div class="gift-row"><div>${v.photo && /^data:image\/(jpeg|png|webp);base64,/.test(v.photo) ? `<img src="${v.photo}" alt="Prize" style="width:56px;height:56px;object-fit:cover;border-radius:10px;float:left;margin-right:10px">` : ""}<b>Level ${level}</b><p class="muted">${esc(v.gift)} · ${Number(v.exp)||0} EXP</p></div><div class="gift-actions"><button type="button" class="btn sm ghost" data-gift-edit="${level}" data-gift-exp="${Number(v.exp)||0}" data-gift-name="${esc(v.gift)}">Edit</button><button type="button" class="btn sm ghost" data-gift-remove="${level}">Remove</button></div></div>`;
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
  $("#callUI").classList.remove("hidden","wd-call-minimized");
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
  setCallState(msg || "Call ended"); $("#callUI").classList.remove("wd-call-minimized"); setTimeout(() => { if (!call) $("#callUI").classList.add("hidden"); }, 1200);
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


// === WORDII ONESIGNAL NATIVE ANDROID ===
const WORDII_ONESIGNAL_APP_ID = "ff9056ae-43a8-4dae-96f7-047e5e56be93";
let wordiiOneSignalStarted = false;
let wordiiOneSignalUser = null;

function wordiiOneSignal() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  return window.plugins?.OneSignal || null;
}

function wordiiInitOneSignal() {
  const os = wordiiOneSignal();
  if (!os || wordiiOneSignalStarted) return false;
  os.initialize(WORDII_ONESIGNAL_APP_ID);
  wordiiOneSignalStarted = true;
  return true;
}

function wordiiSyncOneSignalUser() {
  const os = wordiiOneSignal();
  if (!os || !wordiiOneSignalStarted) return;
  const user = auth.currentUser;
  if (!user || user.isAnonymous || !me || me.suspended === true) {
    if (wordiiOneSignalUser) {
      os.logout();
      wordiiOneSignalUser = null;
    }
    return;
  }
  if (wordiiOneSignalUser !== user.uid) {
    os.login(user.uid);
    wordiiOneSignalUser = user.uid;
  }
}

async function wordiiEnableOneSignal() {
  if (!wordiiInitOneSignal()) throw Error("OneSignal unavailable");
  wordiiSyncOneSignalUser();
  const accepted = await wordiiOneSignal().Notifications.requestPermission(false);
  if (!accepted) throw Error("Allow notifications in Android settings.");
}

function wordiiDisableOneSignal() {
  const os = wordiiOneSignal();
  if (os) os.User.pushSubscription.optOut();
}

// ================= v13: phone push notifications (app closed) =================

const wordiiNativePush = () =>
  !!window.Capacitor?.isNativePlatform?.() &&
  !!window.Capacitor?.Plugins?.PushNotifications;

const pushOn = () => pref("push", "off") === "on";

const b64ToU8 = (b64) => {
  const raw = atob((b64 + "=".repeat((4 - b64.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

const pushSupported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window &&
  !!vapidPublicKey &&
  !vapidPublicKey.startsWith("PASTE");

async function savePushSub(sub) {
  const j = sub.toJSON();
  const entry = {endpoint:j.endpoint,keys:{p256dh:j.keys.p256dh,auth:j.keys.auth}};
  const ref = doc(db,"users",uid,"private","push");
  const cur = (await getDoc(ref)).data()?.subs || [];
  await setDoc(ref,{subs:[entry,...cur.filter(x=>x.endpoint!==entry.endpoint)].slice(0,5)},{merge:true});
}

async function getSub() {
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ||
    reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToU8(vapidPublicKey)});
}

let wordiiPushListenersReady = false;

async function wordiiRegisterNativePush() {
  const plugin = window.Capacitor.Plugins.PushNotifications;
  if (!wordiiPushListenersReady) {
    await plugin.addListener("registration", async token => {
      if (!auth.currentUser || !uid || pref("push","off") !== "on") return;
      try {
        const ref = doc(db,"users",uid,"private","push");
        const old = (await getDoc(ref)).data()?.fcmTokens || [];
        const next = [token.value,...old.filter(t=>t!==token.value)].slice(0,5);
        await setDoc(ref,{fcmTokens:next},{merge:true});
      } catch (e) {
        console.error("FCM token save failed",e);
        toast("Could not save notification token");
      }
    });

    await plugin.addListener("pushNotificationReceived", notification => {
      console.log("Wordii push received", notification);
    });

    await plugin.addListener("registrationError", error => {
      console.error("FCM registration failed",error);
      toast("Notification registration failed");
    });

    await plugin.addListener("pushNotificationActionPerformed", event => {
      const chatId = event.notification?.data?.chatId;
      if (!chatId || typeof chatId !== "string") return;
      const target = chats.find(c=>c.id===chatId);
      if (target) openChat(target);
    });

    wordiiPushListenersReady = true;
  }
  await plugin.createChannel({
    id: "default",
    name: "Wordii Messages",
    description: "New message notifications",
    importance: 5,
    visibility: 1,
    sound: "default",
    vibration: true
  });
  await plugin.register();
}

async function enablePush() {
  if (wordiiOneSignal()) {
    await wordiiEnableOneSignal();
    setPref("push","on");
    return;
  }
  if (wordiiNativePush()) {
    const plugin = window.Capacitor.Plugins.PushNotifications;
    let permission = await plugin.checkPermissions();
    if (permission.receive !== "granted") permission = await plugin.requestPermissions();
    if (permission.receive !== "granted") throw new Error("Allow notifications in Android settings.");
    setPref("push","on");
    await wordiiRegisterNativePush();
    return;
  }
  if (!pushSupported()) throw new Error("Push alerts are not supported on this browser.");
  if (await Notification.requestPermission() !== "granted")
    throw new Error("Notifications are blocked.");
  await savePushSub(await getSub());
  setPref("push","on");
}

async function disablePush() {
  setPref("push","off");
  if (wordiiOneSignal()) {
    wordiiDisableOneSignal();
    return;
  }
  if (wordiiNativePush()) {
    try {
      const ref = doc(db,"users",uid,"private","push");
      const data = (await getDoc(ref)).data() || {};
      await setDoc(ref,{fcmTokens:[]},{merge:true});
      await window.Capacitor.Plugins.PushNotifications.unregister();
    } catch(e) { console.error("FCM disable failed",e); }
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      const ref = doc(db,"users",uid,"private","push");
      const cur = (await getDoc(ref)).data()?.subs || [];
      await setDoc(ref,{subs:cur.filter(x=>x.endpoint!==endpoint)},{merge:true});
    }
  } catch(e) { console.error("Browser push disable failed",e); }
}

async function syncPush() {
  if (!pushOn()) return;
  try {
    if (wordiiOneSignal()) {
      wordiiInitOneSignal();
      wordiiSyncOneSignalUser();
      wordiiOneSignal().User.pushSubscription.optIn();
    } else if (wordiiNativePush()) await wordiiRegisterNativePush();
    else if (pushSupported()) await savePushSub(await getSub());
  } catch(e) { console.error("Push sync failed",e); }
}

document.addEventListener("click",e=>{
  const on=e.target.closest("#pushOn"),off=e.target.closest("#pushOff");
  if(on) act(async()=>{
    await enablePush();
    toast("Notification registration enabled");
    renderSettings(true);
  },on);
  if(off) act(async()=>{
    await disablePush();
    toast("Notifications turned off");
    renderSettings(true);
  },off);
});

// Wordii Chat: centralized Android hardware back navigation.
// Requires @capacitor/app to be installed and synced into the Android project.
(function setupWordiiBackNavigation() {
  let lastBack = 0;
  const visible = (id) => { const el = document.getElementById(id); return !!el && !el.classList.contains("hidden"); };
  function goBack() {
    if(document.getElementById("wdPhotoViewer")?.classList.contains("visible")){wordiiClosePhoto();return;}
    // Close transient overlays before navigating away from the current screen.
    const overlays = ["homeMenu", "chatMoreMenu", "wdGlobalSearch", "wordiiContacts"];
    for (const id of overlays) {
      if (visible(id)) { document.getElementById(id).classList.add("hidden"); return; }
    }
    if (visible("storyEdit")) { document.getElementById("seClose")?.click(); return; }
    if (visible("wdV2Picker")) { document.querySelector("#wdV2Picker .wdv2-head button")?.click(); return; }
    if (visible("wordiiMyProfileV2")) { document.getElementById("wmpBack")?.click(); return; }
    if (visible("wdLevelScreen")) { document.getElementById("wdLevelBack")?.click(); return; }
    if (visible("callUI")) { document.getElementById("cEnd")?.click(); return; }
    if (visible("picker")) { document.getElementById("pkCancel")?.click(); return; }
    if (visible("statusView")) { closeSV(); return; }
    if (visible("profileView")) { closePV(); return; }
    if (visible("settings")) { document.getElementById("setBack")?.click(); return; }
    if (visible("inbox")) { document.getElementById("inboxClose")?.click(); return; }
    if (visible("chat")) { closeChat(); showTab("chats"); return; }
    for (const id of ["tab-profile", "tab-calls", "tab-status", "tab-connect"]) {
      if (visible(id)) { showTab("chats"); return; }
    }
    if (visible("app")) {
      const now = Date.now();
      if (now - lastBack < 2000) {
        window.Capacitor?.Plugins?.App?.exitApp?.();
      } else { lastBack = now; toast("Press back again to exit"); }
      return;
    }
    toast("Please finish signing in");
  }
  // Capacitor's native event must be subscribed to via @capacitor/app.
  function register() {
    const app = window.Capacitor?.Plugins?.App;
    if (app?.addListener) {
      app.addListener("backButton", () => goBack()).catch?.((e) => console.warn("Wordii back listener:", e));
    } else {
      console.warn("Capacitor App plugin unavailable: install @capacitor/app and sync Android");
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", register, { once: true });
  else register();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); goBack(); }
  });
})();

// ---------- Wordii original music library and phone audio ----------
const wordiiTracks = [];
// Hosting-managed catalog: only the hosting publisher can change these assets.
const wordiiBuiltinTracks = [...wordiiTracks];
let wordiiCatalogPromise;
function wordiiTrackURL(t){return t?.file ? 'wordii-music/'+t.file : 'wordii-music/'+t.id+'.wav';}
function wordiiLoadCatalog(){
  if(wordiiCatalogPromise)return wordiiCatalogPromise;
  wordiiCatalogPromise=(async()=>{
    try{
      const r=await fetch('wordii-music/catalog.json',{cache:'no-store'});if(!r.ok)return;
      const catalog=await r.json();
      if(!Array.isArray(catalog.tracks))return;
      const ids=new Set(wordiiBuiltinTracks.map(t=>t.id));
      for(const t of catalog.tracks.slice(0,500)){
        if(!t||typeof t.id!=='string'||!/^[-a-z0-9_]{1,64}$/.test(t.id)||ids.has(t.id)||typeof t.title!=='string'||!t.title.trim()||typeof t.file!=='string'||!/^[-a-zA-Z0-9_]+\.(mp3|wav|m4a|aac|ogg)$/i.test(t.file))continue;
        ids.add(t.id);wordiiTracks.push({id:t.id,title:t.title.slice(0,100),file:t.file});
      }
    }catch(e){wordiiCatalogPromise=null;}
  })();return wordiiCatalogPromise;
}
// Small, licensed MP3 status clips; metadata and audio stored separately.
const WORDII_CLIP_MAX = 2 * 1024 * 1024;
async function wordiiLoadAdminTracks(){
  const snap=await getDocs(query(collection(db,'wordiiAdminMusic'),limit(500)));
  for(let i=wordiiTracks.length-1;i>=0;i--)if(wordiiTracks[i].adminClip)wordiiTracks.splice(i,1);
  for(const d of snap.docs){const t=d.data();if(/^am_[a-zA-Z0-9]+$/.test(d.id)&&typeof t.title==='string')wordiiTracks.push({id:d.id,title:t.title,artist:t.artist,category:t.category,enabled:t.enabled===true,adminClip:true});}
}
const wordiiAudioSourceCache = new Map();
async function wordiiCachedAudioSource(t) {
  if (!t.adminClip) return wordiiTrackURL(t);
  if (!wordiiAudioSourceCache.has(t.id)) {
    const pending = wordiiAudioSource(t).catch(e => {wordiiAudioSourceCache.delete(t.id);throw e;});
    wordiiAudioSourceCache.set(t.id,pending);
  }
  return wordiiAudioSourceCache.get(t.id);
}
async function wordiiAudioSource(t){
  if(!t.adminClip)return wordiiTrackURL(t);
  const meta=await getDoc(doc(db,'wordiiAdminMusic',t.id));
  const path=meta.data()?.storagePath;
  if(typeof path==='string' && /^wordii-admin-music\/am_[A-Za-z0-9]+\.mp3$/.test(path)){
    const blob=await getBlob(storageRef(getStorage(),path));
    return URL.createObjectURL(blob);
  }
  const d=await getDoc(doc(db,'wordiiAdminMusicAudio',t.id));
  const audio=d.data()?.audio;
  if(typeof audio!=='string'||!/^data:audio\/mpeg;base64,[A-Za-z0-9+/=]+$/.test(audio)||audio.length>600100)throw Error('Music is unavailable');
  return audio;
}
function wordiiAdminMusicHTML(){return `<div class="card"><h3>🎵 Manage Music</h3><p class="tiny">Upload original or licensed MP3 clips only. Max 2 MB per clip (website uploads), up to 100 tracks. Published clips are available to registered users.</p><label>Song name</label><input id="wmTitle" maxlength="100"><label>Artist</label><input id="wmArtist" maxlength="80"><label>Category</label><select id="wmCategory"><option>Sad / Lo-fi</option><option>Romantic</option><option>Punjabi</option><option>Other</option></select><input id="wmFile" type="file" accept="audio/mpeg,.mp3"><label><input id="wmRights" type="checkbox"> I have permission to publish this music for users.</label><button id="wmUpload" class="btn">Upload Music</button><div id="wmList">Loading…</div></div>`;}
async function wordiiBindAdminMusic(){
  const list=$('#wmList'),btn=$('#wmUpload');if(!list||!btn||me?.admin!==true)return;
  async function refresh(){try{await wordiiLoadAdminTracks();if(!list.isConnected)return;list.textContent='';for(const t of wordiiTracks.filter(t=>t.adminClip)){const row=document.createElement('div');row.className='card';const title=document.createElement('p');title.textContent=t.title+' · '+t.artist;row.append(title);const toggle=document.createElement('button');toggle.className='btn sm ghost';toggle.textContent=t.enabled?'Disable':'Enable';toggle.onclick=()=>act(async()=>{await updateDoc(doc(db,'wordiiAdminMusic',t.id),{enabled:!t.enabled});await refresh();},toggle);row.append(toggle);const del=document.createElement('button');del.className='btn sm ghost';del.textContent='Delete';del.onclick=()=>act(async()=>{if(!confirm('Delete music? Existing statuses will lose this audio.'))return;const batch=writeBatch(db);batch.delete(doc(db,'wordiiAdminMusic',t.id));batch.delete(doc(db,'wordiiAdminMusicAudio',t.id));await batch.commit();await refresh();},del);row.append(del);list.append(row);}if(!list.children.length)list.textContent='No uploaded music yet.';}catch(e){list.textContent=friendly(e);}}
  btn.onclick=()=>act(async()=>{if(me?.admin!==true)throw Error('Admin only');const title=$('#wmTitle').value.trim(),artist=$('#wmArtist').value.trim(),category=$('#wmCategory').value,f=$('#wmFile').files[0];if(!title||!artist||!f||!$('#wmRights').checked)throw Error('Enter details, select MP3 and confirm rights.');if(!/\.mp3$/i.test(f.name)||f.size<1||f.size>450000)throw Error('For songs up to 2 MB, use wordii-music.web.app. In-app legacy uploads must be under 450 KB.');await wordiiLoadAdminTracks();if(wordiiTracks.filter(t=>t.adminClip).length>=100)throw Error('Library limit reached.');const audio=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve('data:audio/mpeg;base64,'+String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(f);});const id='am_'+doc(collection(db,'wordiiAdminMusic')).id;const batch=writeBatch(db);batch.set(doc(db,'wordiiAdminMusic',id),{title,artist,category,enabled:true});batch.set(doc(db,'wordiiAdminMusicAudio',id),{audio});await batch.commit();toast('Music published');if(btn.isConnected){$('#wmTitle').value='';$('#wmArtist').value='';$('#wmFile').value='';$('#wmRights').checked=false;await refresh();}},btn);
  await refresh();
}
const wordiiEffects = [
  /* WORDII REFERENCE FILTERS V1 — visual approximations, not Instagram AR imports */
  {name:'Normal',css:'none'},
  {name:'Gotham',css:'brightness(.87) contrast(1.28) saturate(.70) sepia(.12)'},
  {name:'Aesthetic Blur',css:'blur(3px) brightness(.95) saturate(.75) contrast(.96)'},
  {name:'Black & White',css:'grayscale(1)'},
  {name:'Vintage',css:'sepia(.75) contrast(.92)'}, {name:'Cinematic',css:'contrast(1.22) saturate(.75) brightness(.9)'},
  {name:'Glow',css:'brightness(1.16) saturate(1.35)'}, {name:'Dream Blur',css:'blur(2px) saturate(1.2)'},
  {name:'Warm Sunset',css:'sepia(.25) saturate(1.3) brightness(1.05)'}, {name:'Cool Blue',css:'hue-rotate(15deg) saturate(.85) contrast(1.1)'},
  {name:'Soft Pastel',css:'contrast(.85) saturate(.8) brightness(1.15)'}, {name:'High Contrast',css:'contrast(1.5) saturate(1.1)'}, {name:'Retro Film',css:'sepia(.35) contrast(1.15) saturate(.7)'}, {name:'Night Mood',css:'brightness(.8) contrast(1.2) saturate(.8)'}
];
let wordiiSelectedMusic=null, wordiiAudioPreview=null, wordiiEffect=0, wordiiStatusAudio=null, wordiiStatusAudioUrl=null;
let wordiiPreviewStopHandler=null;
const wordiiMusicPanel=document.getElementById('stMusicPanel');
function wordiiStopPreview(){if(wordiiAudioPreview&&wordiiPreviewStopHandler){wordiiAudioPreview.removeEventListener('timeupdate',wordiiPreviewStopHandler);wordiiPreviewStopHandler=null;}if(wordiiAudioPreview){wordiiAudioPreview.pause();const oldUrl=wordiiAudioPreview.src;wordiiAudioPreview.removeAttribute('src');wordiiAudioPreview.load();if(oldUrl.startsWith('blob:'))URL.revokeObjectURL(oldUrl);wordiiAudioPreview=null;}}

/* WORDII MUSIC COVER DISPLAY V1 */

/* WORDII MUSIC COVER DRAG V1 */
let wordiiCoverX = 50;
let wordiiCoverY = 25;

{
  const cover = document.getElementById("wordiiMusicCover");
  const preview = document.querySelector(".story-edit-preview");

  if (cover && preview) {
    let activePointer = null;

    cover.addEventListener("pointerdown", e => {
      if (activePointer !== null) return;
      activePointer = e.pointerId;
      cover.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    cover.addEventListener("pointermove", e => {
      if (activePointer !== e.pointerId) return;

      const r = preview.getBoundingClientRect();

      wordiiCoverX = Math.max(15, Math.min(85,
        (e.clientX - r.left) / r.width * 100
      ));

      wordiiCoverY = Math.max(10, Math.min(90,
        (e.clientY - r.top) / r.height * 100
      ));

      cover.style.left = wordiiCoverX + "%";
      cover.style.top = wordiiCoverY + "%";
    });

    const stop = e => {
      if (activePointer !== e.pointerId) return;
      activePointer = null;
      if (cover.hasPointerCapture(e.pointerId))
        cover.releasePointerCapture(e.pointerId);
    };

    cover.addEventListener("pointerup", stop);
    cover.addEventListener("pointercancel", stop);
  }
}


/* WORDII MUSIC COVER RESET V1 */
function wordiiResetMusicCover() {
  wordiiCoverX = 50;
  wordiiCoverY = 25;

  const cover = document.getElementById("wordiiMusicCover");
  if (!cover) return;

  cover.style.left = "50%";
  cover.style.top = "25%";
  cover.hidden = true;
}

/* WORDII OPTIONAL MUSIC COVER V1 */
let wordiiShowMusicCover = true;

document.getElementById("wordiiCoverToggle").onclick = () => {
  wordiiShowMusicCover = !wordiiShowMusicCover;
  wordiiUpdateMusicCover();
};

function wordiiUpdateMusicCover() {
  const cover = document.getElementById("wordiiMusicCover");
  const title = document.getElementById("wordiiMusicCoverTitle");
  if (!cover || !title) return;

  const selected = wordiiSelectedMusic;

  if (!selected) {
    cover.hidden = true;
    return;
  }

  title.textContent = selected.title || selected.name || "Music";
  cover.hidden = false;
}

const wordiiOriginalUpdateMusicCover = wordiiUpdateMusicCover;
wordiiUpdateMusicCover = function(){
  wordiiOriginalUpdateMusicCover();
  const toggle = document.getElementById("wordiiCoverToggle");
  if(toggle){
    toggle.hidden = wordiiSelectedMusic?.type !== "library";
    toggle.textContent = wordiiShowMusicCover ? "♫ Hide Cover" : "♫ Show Cover";
  }
  const cover = document.getElementById("wordiiMusicCover");
  if(cover && (!wordiiShowMusicCover || wordiiSelectedMusic?.type !== "library")) cover.hidden = true;
};


/* WORDII MUSIC COVER AUTO SYNC V1 */
function wordiiMusicLabel(){
  wordiiUpdateMusicCover();document.getElementById('wordiiMusicSelected').textContent=wordiiSelectedMusic?('Selected: '+wordiiSelectedMusic.title):'No music selected';}
function wordiiRenderMusic(){
  const q=document.getElementById('stMusicSearch').value.trim().toLowerCase();
  const results=document.getElementById('stMusicResults');results.textContent='';
  wordiiTracks.filter(t=>(!t.adminClip||t.enabled)&&[t.title,t.artist,t.category].join(' ').toLowerCase().includes(q)).forEach(t=>{
    const b=document.createElement('button');b.type='button';b.textContent='♫ '+t.title+' · '+(t.artist||'Wordii Library');
    if(wordiiSelectedMusic?.id===t.id)b.classList.add('selected');
    b.onclick=async()=>{wordiiStopPreview();const selection={type:'library',id:t.id,title:t.title};wordiiSelectedMusic=selection;wordiiMusicLabel();wordiiRenderMusic();try{const src=await wordiiCachedAudioSource(t);if(wordiiSelectedMusic!==selection||wordiiMusicPanel.classList.contains('hidden'))return;wordiiAudioPreview=new Audio(src);wordiiAudioPreview.volume=.45;wordiiAudioPreview.play().catch(()=>toast('Tap preview to play music'));}catch(e){toast(friendly(e));}};
    results.append(b);
  });
  if(!results.children.length)results.textContent='No matching original tracks.';
}
async function wordiiOpenMusic(){wordiiMusicPanel.classList.remove('hidden');wordiiRenderMusic();wordiiMusicLabel();void wordiiLoadCatalog().then(()=>{if(!wordiiMusicPanel.classList.contains('hidden'))wordiiRenderMusic();});void wordiiLoadAdminTracks().then(()=>{if(!wordiiMusicPanel.classList.contains('hidden'))wordiiRenderMusic();}).catch(e=>console.warn('Music catalog:',e));}
function wordiiCloseMusic(){wordiiStopPreview();wordiiMusicPanel.classList.add('hidden');}
document.getElementById('stMusicBtn').onclick=wordiiOpenMusic;
document.getElementById('stMusicClose').onclick=wordiiCloseMusic;
document.getElementById('stMusicSearch').addEventListener('input',wordiiRenderMusic);
document.getElementById('wordiiAudioFile').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  if(f.size>8*1024*1024){toast('Choose audio under 8 MB');e.target.value='';return;}
  if(!/^audio\/(mpeg|mp4|x-m4a|wav|x-wav|aac)$/.test(f.type)){toast('Use MP3, M4A or WAV audio');e.target.value='';return;}
  wordiiStopPreview();wordiiSelectedMusic={type:'phone',file:f,title:f.name};wordiiMusicLabel();wordiiRenderMusic();wordiiAudioPreview=new Audio(URL.createObjectURL(f));wordiiAudioPreview.volume=.45;wordiiAudioPreview.play().catch(()=>toast('Audio preview could not play'));
};
document.getElementById('wordiiMusicPreviewClip').onclick=()=>{
  if(!wordiiAudioPreview){toast('Select music first');return;}
  const start=Math.max(0,Number(document.getElementById('wordiiMusicStart').value)||0);
  wordiiAudioPreview.pause();
  try{wordiiAudioPreview.currentTime=start;}catch(e){}
  wordiiAudioPreview.play().catch(()=>toast('Tap again to preview music'));
  const preview=wordiiAudioPreview;
  if(wordiiPreviewStopHandler)preview.removeEventListener('timeupdate',wordiiPreviewStopHandler);
  wordiiPreviewStopHandler=()=>{if(preview.currentTime>=start+Math.max(1,Math.min(30,Number(document.getElementById("wordiiMusicDuration")?.value)||15))){preview.pause();preview.removeEventListener('timeupdate',wordiiPreviewStopHandler);wordiiPreviewStopHandler=null;}};
  preview.addEventListener('timeupdate',wordiiPreviewStopHandler);
};
/* WORDII STORY MUSIC TRIM CONTROL V1 — local-only UI enhancement */
(function wordiiMusicTrimControls(){
 const panel=document.getElementById('stMusicPanel');
 const start=document.getElementById('wordiiMusicStart');
 const duration=document.getElementById('wordiiMusicDuration');
 if(!panel||!start||!duration||document.getElementById('wordiiTrimControls'))return;
 const wrap=document.createElement('section');wrap.id='wordiiTrimControls';
 wrap.setAttribute('aria-label','Music clip trim controls');
 wrap.style.cssText='padding:12px;margin:8px 0;border:1px solid rgba(255,255,255,.22);border-radius:12px;color:inherit';
 const heading=document.createElement('div');heading.textContent='♫ Choose your music clip';heading.style.cssText='font-weight:700;margin-bottom:8px';
 const label=document.createElement('label');label.htmlFor='wordiiTrimSlider';label.textContent='Start position';
 const slider=document.createElement('input');slider.id='wordiiTrimSlider';slider.type='range';slider.min='0';slider.max='180';slider.step='.5';slider.value=String(Math.max(0,Number(start.value)||0));slider.style.cssText='width:100%;display:block;margin:12px 0;accent-color:#ff416c';
 const info=document.createElement('output');info.id='wordiiTrimInfo';info.style.cssText='display:block;font-size:13px;margin:6px 0';
 const help=document.createElement('small');help.textContent='Drag to choose where music begins. Preview plays only your chosen clip.';
 wrap.append(heading,label,slider,info,help);
 const existing=document.getElementById('wordiiMusicPreviewClip');
 (existing?.parentElement||panel).insertBefore(wrap,existing||null);
 const format=s=>{s=Math.max(0,Math.floor(Number(s)||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
 function sync(){
   const audio=wordiiAudioPreview;
   const available=Number.isFinite(audio?.duration)&&audio.duration>0?audio.duration:null;
   const length=Math.max(1,Math.min(30,Number(duration.value)||15));
   const max=Math.max(0,(available??180)-length);
   slider.max=String(max);
   let position=Math.max(0,Math.min(max,Number(start.value)||0));
   start.value=String(position);slider.value=String(position);
   info.textContent=`${format(position)} – ${format(position+length)} (${length}s clip)`;
 }
 slider.addEventListener('input',()=>{start.value=slider.value;sync();});
 start.addEventListener('input',sync);duration.addEventListener('input',sync);duration.addEventListener('change',sync);
 panel.addEventListener('click',()=>{queueMicrotask(sync);});
 // Audio is loaded asynchronously after a track is selected.
 panel.addEventListener('loadedmetadata',sync,true);
 sync();
})();
document.getElementById('wordiiMusicDone').onclick=()=>{
  if(!wordiiSelectedMusic){toast('Select music first');return;}
  wordiiCloseMusic();
  toast('Music selected. Tap Share to post.');
};
document.getElementById('wordiiMusicClear').onclick=()=>{wordiiStopPreview();wordiiSelectedMusic=null;document.getElementById('wordiiAudioFile').value='';wordiiMusicLabel();wordiiRenderMusic();};
function wordiiOpenEffects(){
  const list=document.getElementById('wordiiEffectsList');list.textContent='';
  wordiiEffects.forEach((effect,i)=>{
    const b=document.createElement('button');b.type='button';b.className='we-filter-choice';
    b.setAttribute('aria-label',effect.name);b.setAttribute('aria-pressed',String(i===wordiiEffect));
    if(i===wordiiEffect)b.classList.add('selected');
    const thumb=document.createElement('span');thumb.className='we-filter-thumb';
    const photo=document.createElement('img');photo.alt='';photo.src=document.getElementById('seImage').src;photo.style.filter=effect.css;
    thumb.append(photo);const label=document.createElement('span');label.className='we-filter-name';label.textContent=effect.name;
    b.append(thumb,label);
    b.onclick=()=>{wordiiEffect=i;document.getElementById('seImage').style.filter=effect.css;wordiiOpenEffects();};list.append(b);
  });
  document.getElementById('wordiiEffects').classList.remove('hidden');
}
document.getElementById('wordiiEffectsClose').onclick=()=>document.getElementById('wordiiEffects').classList.add('hidden');
function stopWordiiStoryAudio(){if(wordiiStatusAudio){wordiiStatusAudio.pause();wordiiStatusAudio.remove();wordiiStatusAudio=null;}if(wordiiStatusAudioUrl){URL.revokeObjectURL(wordiiStatusAudioUrl);wordiiStatusAudioUrl=null;}}
async function playWordiiStoryAudio(st, body) {
  if (!st.musicId && !st.audioPath) return;
  const expected = st.id;
  const audio = document.createElement('audio');
  audio.className = 'wordii-status-audio';
  audio.preload = 'auto';
  audio.controls = false;
  audio.volume = .55;
  body.append(audio);
  wordiiStatusAudio = audio;
  const active = () => wordiiStatusAudio === audio && sv.list[sv.i]?.id === expected && !$("#statusView").classList.contains("hidden");
  const start = Math.max(0, Number(st.musicStart) || 0);
  const duration = Math.max(1, Math.min(30, Number(st.musicDuration) || 15));
  let finished = false;
  function showPlayButton() {
    if (!active()) return;
    let btn = body.querySelector('.wordii-audio-play-btn');
    if (btn) return;
    btn = document.createElement('button');
    btn.className = 'wordii-audio-play-btn';
    btn.textContent = '♫ Play Music';
    btn.onclick = e => { e.stopPropagation(); if (!active()) return; audio.play().then(() => btn.remove()).catch(() => toast('Music could not play')); };
    body.append(btn);
  }
  try {
    if (st.musicId) {
      let track = wordiiTracks.find(t => t.id === st.musicId);
      if (!track && !/^am_[a-zA-Z0-9]+$/.test(st.musicId)) {
        await wordiiLoadCatalog();
        track = wordiiTracks.find(t => t.id === st.musicId);
      }
      if (/^am_[a-zA-Z0-9]+$/.test(st.musicId)) track = {id:st.musicId, adminClip:true};
      if (!track) return;
      const src = await wordiiCachedAudioSource(track);
      if (!active()) return;
      audio.src = src;
    } else {
      const blob = await getBlob(storageRef(getStorage(), st.audioPath));
      if (!active()) return;
      wordiiStatusAudioUrl = URL.createObjectURL(blob);
      audio.src = wordiiStatusAudioUrl;
    }
    audio.addEventListener('timeupdate', () => {
      if (!active() || finished) return;
      if (audio.currentTime >= start + duration) { finished = true; audio.pause(); }
    });
    let playbackStarted = false;
    const startPlayback = () => {
      if (!active() || finished || playbackStarted) return;
      playbackStarted = true;
      audio.play().catch(() => { playbackStarted = false; showPlayButton(); });
    };
    audio.addEventListener('loadedmetadata', () => {
      if (!active()) return;
      const seek = Number.isFinite(audio.duration) ? Math.min(start, Math.max(0, audio.duration - .1)) : start;
      if (seek > .05) {
        audio.addEventListener('seeked', startPlayback, {once:true});
        try { audio.currentTime = seek; } catch (_) { startPlayback(); }
      } else startPlayback();
    }, {once:true});
    audio.addEventListener('canplay', () => { if(start < .05) startPlayback(); }, {once:true});
    audio.load();
  } catch (e) {
    if (active()) { audio.remove(); toast('Music unavailable: ' + friendly(e)); }
  }
}
// Wordii Story Creator: My Status is the only visible entry point.
let wordiiStoryStream = null;
let wordiiStoryFacing = 'user';
const wsc = document.getElementById('wordiiStoryCamera');
async function startWordiiCamera(){
  const video=document.getElementById('wscVideo');
  const fallback=document.getElementById('wscFallback');
  if(wordiiStoryStream) wordiiStoryStream.getTracks().forEach(t=>t.stop());
  wordiiStoryStream=null;
  try {
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
    wordiiStoryStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:wordiiStoryFacing},audio:false});
    if(wsc.classList.contains('hidden')) { wordiiStoryStream.getTracks().forEach(t=>t.stop()); wordiiStoryStream=null; return; }
    video.srcObject=wordiiStoryStream;
    // Mirror only the selfie preview, not the rear camera.
    video.style.transform=wordiiStoryFacing==='user'?'scaleX(-1)':'none';
    video.hidden=false; fallback.hidden=true;
    document.getElementById('wscNote').textContent='Tap the shutter to capture a photo.';
  } catch(err) {
    video.hidden=true; fallback.hidden=false;
    document.getElementById('wscNote').textContent='Camera unavailable or permission denied. Gallery and text stories still work.';
  }
}
function closeWordiiStory(){
  wsc.classList.add('hidden');
  if(wordiiStoryStream) wordiiStoryStream.getTracks().forEach(t=>t.stop());
  wordiiStoryStream=null;
  document.getElementById('wscVideo').srcObject=null;
}
function openWordiiStory(){wsc.classList.remove('hidden');startWordiiCamera();}
document.getElementById('wscClose').onclick=closeWordiiStory;
document.getElementById('wscSwitch').onclick=()=>{wordiiStoryFacing=wordiiStoryFacing==='user'?'environment':'user';startWordiiCamera();};
document.getElementById('wscCamera').onclick=startWordiiCamera;
document.getElementById('wscGallery').onclick=()=>{closeWordiiStory();document.getElementById('stFile').click();};
document.getElementById('wscText').onclick=()=>{closeWordiiStory();document.getElementById('stTextBtn').click();};
document.getElementById('wscMusic').onclick=()=>{closeWordiiStory();wordiiOpenMusic();};
// Use the existing Status audience state; do not invent a separate privacy setting.
function wordiiStoryAudiencePicker(){
  const old=document.getElementById('wdStoryAudiencePanel');if(old){old.remove();return;}
  const panel=document.createElement('div');panel.id='wdStoryAudiencePanel';panel.className='wd-story-audience-panel';
  panel.innerHTML='<strong>Who can see this story?</strong><button type="button" data-wd-audience="friends">👥 Friends</button><button type="button" data-wd-audience="close">🔒 Close Friends</button><button type="button" data-wd-audience="choose">✏️ Choose Close Friends</button><button type="button" data-wd-audience="cancel">Cancel</button>';
  panel.addEventListener('click',e=>{
    const b=e.target.closest('[data-wd-audience]');if(!b)return;
    const action=b.dataset.wdAudience;
    if(action==='friends')document.getElementById('stClose').checked=false;
    if(action==='close'){
      if(!closeIds.length){document.getElementById('wscNote').textContent='Choose Close Friends first.';return;}
      document.getElementById('stClose').checked=true;
    }
    panel.remove();
    if(action==='choose'){
      closeWordiiStory();document.getElementById('stPick').click();return;
    }
    if(action!=='cancel')document.getElementById('wscNote').textContent=action==='friends'?'Audience: Friends':'Audience: Close Friends';
  });
  document.getElementById('wordiiStoryCamera').append(panel);
}
document.getElementById('wscPrivacy').onclick=wordiiStoryAudiencePicker;
document.getElementById('wscShutter').onclick=()=>{
  const video=document.getElementById('wscVideo');
  if(!wordiiStoryStream || !video.videoWidth){document.getElementById('wscGallery').click();return;}
  const canvas=document.createElement('canvas');
  // Instagram-style portrait crop: match the center of the live cover preview.
  const targetWidth=720,targetHeight=1280,ratio=9/16;
  canvas.width=targetWidth;canvas.height=targetHeight;
  const sourceWidth=video.videoWidth,sourceHeight=video.videoHeight;
  const cropWidth=Math.min(sourceWidth,sourceHeight*ratio);
  const cropHeight=Math.min(sourceHeight,sourceWidth/ratio);
  const sx=(sourceWidth-cropWidth)/2,sy=(sourceHeight-cropHeight)/2;
  const ctx=canvas.getContext('2d');
  if(!ctx){document.getElementById('wscNote').textContent='Camera capture failed. Try Gallery.';return;}
  // Match selfie mirroring to the preview without changing the rear camera.
  if(wordiiStoryFacing==='user') {ctx.translate(canvas.width,0);ctx.scale(-1,1);}
  ctx.drawImage(video,sx,sy,cropWidth,cropHeight,0,0,targetWidth,targetHeight);
  canvas.toBlob(blob=>{
    if(!blob)return;
    try {
      const file=new File([blob],'wordii-story.jpg',{type:'image/jpeg'});
      const dt=new DataTransfer();dt.items.add(file);
      const input=document.getElementById('stFile');input.files=dt.files;
      closeWordiiStory();input.dispatchEvent(new Event('change',{bubbles:true}));
    } catch(err) {document.getElementById('wscNote').textContent='Could not open editor. Please use Gallery.';}
  },'image/jpeg',0.75);
};

// Wordii Story Studio: all decorative layers are exported into the posted JPEG.
let wdLayout="classic",wdSticker="",wdStickerX=50,wdStickerY=50,wdStickerScale=1,wdTextStyle=0,wdDrawing=false,wdHasDrawing=false;
const wdLayouts=["classic","polaroid","film","torn","heart","circle","gradient","minimal"];
const wdStickers=["❤️","✨","🔥","🌸","💫","⭐","🎮","🎉","😍","💖","🌙","☁️"];
const wdStage=document.getElementById("wdEditorStage"),wdCanvas=document.getElementById("wdDrawLayer"),wdStickerLayer=document.getElementById("wdStickerLayer"),wdOptions=document.getElementById("wdEditorOptions");
function wdResizeDrawing(){const r=wdStage.getBoundingClientRect();if(!r.width||!r.height)return;const old=document.createElement('canvas');old.width=wdCanvas.width;old.height=wdCanvas.height;if(old.width&&old.height)old.getContext('2d').drawImage(wdCanvas,0,0);wdCanvas.width=Math.round(r.width*devicePixelRatio);wdCanvas.height=Math.round(r.height*devicePixelRatio);if(old.width&&old.height)wdCanvas.getContext('2d').drawImage(old,0,0,wdCanvas.width,wdCanvas.height);}
function wdResetEditor(){wdPhotoResetLayers();wdLayout="classic";wdSticker="";wdStickerX=50;wdStickerY=50;wdStickerScale=1;wdTextStyle=0;wdDrawing=false;wdHasDrawing=false;wdOptions?.classList.add('hidden');wdStickerLayer?.replaceChildren();if(wdCanvas){wdCanvas.getContext('2d').clearRect(0,0,wdCanvas.width,wdCanvas.height);wdCanvas.classList.remove('wd-drawing');}wdStage?.setAttribute('data-layout','classic');}
function wdSetLayout(v){wdLayout=v;wdStage.dataset.layout=v;wdOptions.classList.add('hidden');wordiiUpdateLayoutSelection();}
function wdStickerRefresh(){wdStickerLayer.replaceChildren();if(!wdSticker)return;const e=document.createElement('span');e.textContent=wdSticker;e.className='wd-sticker';e.style.left=wdStickerX+'%';e.style.top=wdStickerY+'%';e.style.fontSize=(Math.round(48*wdStickerScale))+'px';wdStickerLayer.append(e);}
function wdOptionsShow(items){wdOptions.replaceChildren();items.forEach(([label,fn])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;wdOptions.append(b);});wdOptions.classList.remove('hidden');}
document.getElementById('wdLayoutBtn').onclick=()=>wdOptionsShow(wdLayouts.map(v=>[v[0].toUpperCase()+v.slice(1),()=>wdSetLayout(v)]));
document.getElementById('wdStickerBtn').onclick=()=>wdOptionsShow([...wdStickers.map(v=>[v,()=>{wdSticker=v;wdStickerRefresh();wdOptions.classList.add('hidden');}]),...[["Small",0.65],["Medium",1],["Large",1.6]].map(([name,size])=>[name,()=>{wdStickerScale=size;wdStickerRefresh();wdOptions.classList.add('hidden');}]),['Remove',()=>{wdSticker='';wdStickerRefresh();wdOptions.classList.add('hidden');}]]);
document.getElementById('wdTextStyleBtn').onclick=()=>{wdTextStyle=(wdTextStyle+1)%3;wdStage.dataset.textStyle=String(wdTextStyle);document.getElementById('wdTextStyleBtn').textContent=['Aa Style','Aa Shadow','Aa Highlight'][wdTextStyle];};
document.getElementById('wdDrawBtn').onclick=()=>{wdDrawing=!wdDrawing;wdResizeDrawing();wdCanvas.classList.toggle('wd-drawing',wdDrawing);document.getElementById('wdDrawBtn').classList.toggle('wd-selected',wdDrawing);};
document.getElementById('wdResetBtn').onclick=()=>{wdResetEditor();document.getElementById('wdTextStyleBtn').textContent='Aa Style';wdStage.dataset.textStyle='0';};
let wdPointer=null;
wdCanvas.addEventListener('pointerdown',e=>{if(!wdDrawing)return;e.preventDefault();wdPointer=e.pointerId;wdCanvas.setPointerCapture(e.pointerId);const r=wdCanvas.getBoundingClientRect(),ctx=wdCanvas.getContext('2d');ctx.beginPath();ctx.moveTo((e.clientX-r.left)*wdCanvas.width/r.width,(e.clientY-r.top)*wdCanvas.height/r.height);});
wdCanvas.addEventListener('pointermove',e=>{if(wdPointer!==e.pointerId)return;const r=wdCanvas.getBoundingClientRect(),ctx=wdCanvas.getContext('2d');ctx.lineWidth=5*devicePixelRatio;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#ff3157';ctx.lineTo((e.clientX-r.left)*wdCanvas.width/r.width,(e.clientY-r.top)*wdCanvas.height/r.height);ctx.stroke();wdHasDrawing=true;});
for(const event of ['pointerup','pointercancel'])wdCanvas.addEventListener(event,e=>{if(wdPointer===e.pointerId)wdPointer=null;});
wdStickerLayer.addEventListener('pointerdown',e=>{if(!wdSticker)return;e.preventDefault();wdStickerLayer.setPointerCapture(e.pointerId);});
wdStickerLayer.addEventListener('pointermove',e=>{if(!wdSticker||!wdStickerLayer.hasPointerCapture(e.pointerId))return;const r=wdStickerLayer.getBoundingClientRect();wdStickerX=Math.max(5,Math.min(95,100*(e.clientX-r.left)/r.width));wdStickerY=Math.max(5,Math.min(95,100*(e.clientY-r.top)/r.height));wdStickerRefresh();});
function wdPaintLayout(ctx,w,h){const lw=Math.max(7,w*.025);ctx.save();if(wdLayout==='gradient'){const g=ctx.createLinearGradient(0,0,w,h);g.addColorStop(0,'rgba(235,30,75,.25)');g.addColorStop(1,'rgba(20,10,35,.35)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);}else if(wdLayout==='polaroid'){ctx.strokeStyle='#fff';ctx.lineWidth=lw;ctx.strokeRect(lw,lw,w-2*lw,h-3*lw);ctx.fillStyle='white';ctx.fillRect(0,h-lw*2,w,lw*2);}else if(wdLayout==='film'){ctx.fillStyle='#121018';ctx.fillRect(0,0,w,lw*2);ctx.fillRect(0,h-lw*2,w,lw*2);ctx.fillStyle='white';for(let x=lw;x<w;x+=lw*2){ctx.fillRect(x,lw*.4,lw, lw*.75);ctx.fillRect(x,h-lw*1.2,lw,lw*.75);}}else if(wdLayout==='torn'){ctx.strokeStyle='#fff';ctx.lineWidth=lw*.65;ctx.setLineDash([lw*1.4,lw*.45,lw*.8,lw*.5]);ctx.strokeRect(lw,lw,w-2*lw,h-2*lw);}else if(wdLayout==='circle'||wdLayout==='heart'){ctx.strokeStyle='#fff';ctx.lineWidth=lw;ctx.beginPath();if(wdLayout==='circle')ctx.ellipse(w/2,h/2,w*.43,Math.min(w*.43,h*.42),0,0,Math.PI*2);else{ctx.moveTo(w*.5,h*.75);ctx.bezierCurveTo(-w*.1,h*.35,w*.2,h*.05,w*.5,h*.3);ctx.bezierCurveTo(w*.8,h*.05,w*1.1,h*.35,w*.5,h*.75);}ctx.stroke();}else if(wdLayout==='minimal'){ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=lw*.3;ctx.strokeRect(lw*1.3,lw*1.3,w-2.6*lw,h-2.6*lw);}ctx.restore();}
function wdPaintDrawing(ctx,w,h){if(wdHasDrawing&&wdCanvas.width&&wdCanvas.height){const r=wdStage.getBoundingClientRect();const im=document.getElementById('seImage');const scale=Math.min(r.width/im.naturalWidth,r.height/im.naturalHeight);const dw=im.naturalWidth*scale,dh=im.naturalHeight*scale;ctx.drawImage(wdCanvas,-(r.width-dw)/2/dw*w,-(r.height-dh)/2/dh*h,r.width/dw*w,r.height/dh*h);}}
// WORDII V2 MULTI PHOTO STICKERS - local image layers flattened into published JPEG.
const wdPhotoLayers=[];
let wdSelectedPhotoLayer=null;
const wdPhotoLayerUI=document.createElement('div');
wdPhotoLayerUI.id='wdPhotoLayerUI';
wdStage.append(wdPhotoLayerUI);
const wdPhotoControls=document.createElement('div');
wdPhotoControls.id='wdPhotoControls';
wdPhotoControls.innerHTML='<button type="button" data-wd-photo="add">＋ Photo</button><button type="button" data-wd-photo="smaller">−</button><button type="button" data-wd-photo="larger">＋</button><button type="button" data-wd-photo="rotate">↻</button><button type="button" data-wd-photo="front">↑</button><button type="button" data-wd-photo="delete">Delete</button>';
const wdPhotoInput=document.createElement('input');
wdPhotoInput.type='file';wdPhotoInput.accept='image/*';wdPhotoInput.multiple=true;wdPhotoInput.hidden=true;
document.getElementById('storyEdit').append(wdPhotoInput,wdPhotoControls);
function wdPhotoResetLayers(){wdPhotoLayers.length=0;wdSelectedPhotoLayer=null;wdPhotoLayerUI.replaceChildren();wdPhotoControls.classList.remove('wd-has-selection');}
function wdPhotoSelectLayer(id){wdSelectedPhotoLayer=id;wdPhotoRenderLayers();}
function wdPhotoRenderLayers(){
 wdPhotoLayerUI.replaceChildren();
 wdPhotoControls.classList.toggle('wd-has-selection',wdSelectedPhotoLayer!==null);
 for(const layer of wdPhotoLayers){
  const el=document.createElement('div');el.className='wd-photo-sticker'+(layer.id===wdSelectedPhotoLayer?' wd-active':'');
  el.style.left=layer.x+'%';el.style.top=layer.y+'%';
  el.style.width=layer.size+'%';el.style.transform=`translate(-50%,-50%) rotate(${layer.rotation}deg)`;
  const img=document.createElement('img');img.src=layer.src;img.alt='Photo sticker';img.draggable=false;el.append(img);
  el.addEventListener('pointerdown',e=>{
   e.preventDefault();e.stopPropagation();wdSelectedPhotoLayer=layer.id;
   el.setPointerCapture(e.pointerId);
   const r=wdStage.getBoundingClientRect();const sx=e.clientX,sy=e.clientY,ox=layer.x,oy=layer.y;
   const move=ev=>{if(ev.pointerId!==e.pointerId)return;layer.x=Math.max(0,Math.min(100,ox+(ev.clientX-sx)/r.width*100));layer.y=Math.max(0,Math.min(100,oy+(ev.clientY-sy)/r.height*100));el.style.left=layer.x+'%';el.style.top=layer.y+'%';};
   const end=ev=>{if(ev.pointerId!==e.pointerId)return;el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',end);el.removeEventListener('pointercancel',end);if(el.hasPointerCapture(ev.pointerId))el.releasePointerCapture(ev.pointerId);wdPhotoRenderLayers();};
   el.addEventListener('pointermove',move);el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
   for(const sibling of wdPhotoLayerUI.children)sibling.classList.remove('wd-active');el.classList.add('wd-active');wdPhotoControls.classList.add('wd-has-selection');
  });
  wdPhotoLayerUI.append(el);
 }
}
wdPhotoInput.addEventListener('change',async()=>{
 for(const file of [...wdPhotoInput.files].slice(0,10)){
  if(!file.type.startsWith('image/')||file.size>12*1024*1024){alert('Choose an image under 12 MB');continue;}
  const src=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  const layer={id:Date.now()+Math.random(),src,x:50,y:50,size:42,rotation:0};wdPhotoLayers.push(layer);wdSelectedPhotoLayer=layer.id;
 }
 wdPhotoInput.value='';wdPhotoRenderLayers();
});
wdPhotoControls.addEventListener('click',e=>{
 const action=e.target.closest('[data-wd-photo]')?.dataset.wdPhoto;if(!action)return;
 if(action==='add'){wdPhotoInput.click();return;}
 const i=wdPhotoLayers.findIndex(l=>l.id===wdSelectedPhotoLayer);if(i<0)return;
 const l=wdPhotoLayers[i];
 if(action==='smaller')l.size=Math.max(12,l.size-8);
 if(action==='larger')l.size=Math.min(95,l.size+8);
 if(action==='rotate')l.rotation=(l.rotation+15)%360;
 if(action==='front'){wdPhotoLayers.splice(i,1);wdPhotoLayers.push(l);}
 if(action==='delete'){wdPhotoLayers.splice(i,1);wdSelectedPhotoLayer=null;}
 wdPhotoRenderLayers();
});
async function wdPaintPhotoLayers(ctx,w,h){
 for(const l of wdPhotoLayers){
  const img=new Image();img.src=l.src;
  await img.decode();
  const targetW=w*l.size/100,targetH=targetW*img.naturalHeight/img.naturalWidth;
  ctx.save();ctx.translate(w*l.x/100,h*l.y/100);ctx.rotate(l.rotation*Math.PI/180);
  ctx.drawImage(img,-targetW/2,-targetH/2,targetW,targetH);ctx.restore();
 }
}
function wdPaintSticker(ctx,w,h){if(!wdSticker)return;ctx.save();ctx.font=`${Math.round(w*.14*wdStickerScale)}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(wdSticker,w*wdStickerX/100,h*wdStickerY/100);ctx.restore();}
requestAnimationFrame(()=>{if(wdStage)wdResizeDrawing();});

// Wordii reference-inspired controls: existing publishing logic remains unchanged.
(function wordiiStudioEnhancements(){
 const rail=document.getElementById('wordiiLayoutRail');
 if(rail){
   const names=['Classic','Polaroid','Film','Torn','Heart','Circle','Gradient','Minimal'];
   rail.replaceChildren();
   names.forEach((name,i)=>{
     const b=document.createElement('button');b.type='button';b.className='wordii-layout-tile';
     b.dataset.layout=wdLayouts[i];
     const thumb=document.createElement('span');thumb.className='wordii-layout-thumb';
     const label=document.createElement('small');label.textContent=name;
     b.append(thumb,label);
     b.onclick=()=>{wdSetLayout(wdLayouts[i]);wordiiUpdateLayoutSelection();};
     rail.append(b);
   });
 }
 const chips=document.querySelectorAll('#stMusicPanel [data-duration]');
 const duration=document.getElementById('wordiiMusicDuration');
 function updateDuration(){chips.forEach(b=>b.classList.toggle('active',b.dataset.duration===duration.value));}
 chips.forEach(b=>b.addEventListener('click',()=>{duration.value=b.dataset.duration;duration.dispatchEvent(new Event('change',{bubbles:true}));updateDuration();}));
 duration.addEventListener('change',updateDuration);updateDuration();
 document.querySelectorAll('#stMusicPanel [data-music-filter]').forEach(b=>b.addEventListener('click',()=>{
   document.querySelectorAll('#stMusicPanel [data-music-filter]').forEach(x=>x.classList.toggle('active',x===b));
   const search=document.getElementById('stMusicSearch');search.value=b.dataset.musicFilter;
   search.dispatchEvent(new Event('input',{bubbles:true}));
 }));
})();
function wordiiUpdateLayoutSelection(){document.querySelectorAll('#wordiiLayoutRail [data-layout]').forEach(b=>b.classList.toggle('active',b.dataset.layout===wdLayout));}
wordiiUpdateLayoutSelection();

// Story editor: photo and text are one published status.
let storyEditImage=null,storyEditColor=0;

let wdPhotoZoom=1,wdPhotoX=0,wdPhotoY=0;
function wdPhotoPreview(){
 const img=document.getElementById("seImage");
 if(!img)return;
 img.style.transform=`translate(${wdPhotoX}%,${wdPhotoY}%) scale(${wdPhotoZoom})`;
 img.style.transformOrigin="center center";
}

const storyColors=["#ffffff","#ff4864","#ffe36c","#72eaff","#20d6a3","#ffd700","#c4a7ff","#ff9f43","#111111","#f3a6ff","#00ff7f","#ff595e"];
let wordiiStoryCustomColor=null;
function wordiiStoryTextColor(){return wordiiStoryCustomColor||storyColors[storyEditColor];}
function storyEditRefresh(){const c=document.getElementById("seCaption");c.textContent=document.getElementById("seText").value;c.style.color=wordiiStoryTextColor();}
function wordiiCloseColorPanel(){document.getElementById('wordiiStoryColorPanel')?.remove();}
function wordiiOpenColorPanel(){
  const old=document.getElementById('wordiiStoryColorPanel');if(old){old.remove();return;}
  const panel=document.createElement('div');panel.id='wordiiStoryColorPanel';panel.className='wordii-story-color-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Choose story text colour');
  const heading=document.createElement('div');heading.textContent='Choose text colour';heading.className='wordii-story-color-heading';panel.append(heading);
  const grid=document.createElement('div');grid.className='wordii-story-color-grid';
  storyColors.forEach((hex,i)=>{const b=document.createElement('button');b.type='button';b.className='wordii-story-color-swatch';b.style.background=hex;b.title=hex;b.setAttribute('aria-label','Colour '+hex);b.onclick=()=>{storyEditColor=i;wordiiStoryCustomColor=null;storyEditRefresh();wordiiCloseColorPanel();};grid.append(b);});
  panel.append(grid);
  const label=document.createElement('label');label.textContent='Custom colour ';label.className='wordii-story-color-label';
  const input=document.createElement('input');input.type='color';input.value=wordiiStoryTextColor();input.setAttribute('aria-label','Custom text colour');input.oninput=()=>{wordiiStoryCustomColor=input.value;storyEditRefresh();};label.append(input);panel.append(label);
  const close=document.createElement('button');close.type='button';close.textContent='Done';close.className='wordii-story-color-done';close.onclick=wordiiCloseColorPanel;panel.append(close);
  document.getElementById('seColor').insertAdjacentElement('afterend',panel);
}
function openStoryEdit(img){
wdResetEditor();
wordiiShowMusicCover=true;
wordiiResetMusicCover();
wordiiUpdateMusicCover();

wordiiTextX=50;
wordiiTextY=50;
wordiiTextFont="Arial";
const caption=document.getElementById("seCaption");
caption.style.left="50%";
caption.style.top="50%";
caption.style.transform="translate(-50%,-50%)";
caption.style.fontFamily="Arial";
document.getElementById("seFont").value="Arial";
wdPhotoZoom=1;wdPhotoX=0;wdPhotoY=0;wdPhotoPreview();storyEditImage=img;storyEditColor=0;wordiiStoryCustomColor=null;wordiiCloseColorPanel();wordiiEffect=0;document.getElementById("seImage").style.filter="none";document.getElementById("seImage").src=img;document.getElementById("seText").value="";document.getElementById("storyEdit").classList.remove("hidden");
storyEditRefresh();
requestAnimationFrame(() => {
  const preview = document.querySelector(".story-edit-preview");
  const caption = document.getElementById("seCaption");
  const image = document.getElementById("seImage");

  function centerCaption() {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const r = preview.getBoundingClientRect();
    const scale = Math.min(r.width / image.naturalWidth, r.height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    caption.style.left = ((r.width - w) / 2 + w * wordiiTextX / 100) + "px";
    caption.style.top = ((r.height - h) / 2 + h * wordiiTextY / 100) + "px";
    caption.style.transform = "translate(-50%, -50%)";
  }

  if (image.complete) centerCaption();
  else image.addEventListener("load", centerCaption, {once:true});
});}
function closeStoryEdit(){wordiiCloseColorPanel();document.getElementById("storyEdit").classList.add("hidden");storyEditImage=null;}
document.getElementById("seClose").onclick=closeStoryEdit;
document.getElementById("seText").addEventListener("input",storyEditRefresh);
document.getElementById("seColor").onclick=wordiiOpenColorPanel;

// Wordii Story: draggable text and font preview

/* WORDII STORY TEXT ZOOM V1 */
let wordiiTextSize = 32;

const wordiiSizeSlider = document.getElementById("seTextSize");

if (wordiiSizeSlider) {
  wordiiSizeSlider.addEventListener("input", () => {
    wordiiTextSize = Number(wordiiSizeSlider.value);
    const caption = document.getElementById("seCaption");
    caption.style.fontSize = wordiiTextSize + "px";
  });
}

let wordiiTextX = 50;
let wordiiTextY = 50;
let wordiiTextFont = "Arial";

const wordiiCaption = document.getElementById("seCaption");
const wordiiPreview = document.querySelector(".story-edit-preview");
const wordiiFontSelect = document.getElementById("seFont");

wordiiFontSelect.addEventListener("change", () => {
  wordiiTextFont = wordiiFontSelect.value;
  wordiiCaption.style.fontFamily = `"${wordiiTextFont}", sans-serif`;
  document.fonts?.load(`700 ${wordiiTextSize}px "${wordiiTextFont}"`).catch(()=>{});
});

wordiiCaption.style.pointerEvents = "auto";
wordiiCaption.style.touchAction = "none";


const wdTextPointers=new Map();
let wdTextStartDistance=0;
let wdTextStartSize=32;

wordiiCaption.addEventListener("pointerdown",e=>{
 if(!wordiiCaption.textContent.trim())return;
 e.preventDefault();
 wordiiCaption.setPointerCapture(e.pointerId);
 wdTextPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(wdTextPointers.size===2){
  const [a,b]=[...wdTextPointers.values()];
  wdTextStartDistance=Math.hypot(a.x-b.x,a.y-b.y);
  wdTextStartSize=wordiiTextSize;
 }
});

wordiiCaption.addEventListener("pointermove",e=>{
 if(!wdTextPointers.has(e.pointerId))return;
 e.preventDefault();
 wdTextPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 const r=wordiiPreview.getBoundingClientRect();

 if(wdTextPointers.size===2 && wdTextStartDistance>0){
  const [a,b]=[...wdTextPointers.values()];
  const distance=Math.hypot(a.x-b.x,a.y-b.y);
  wordiiTextSize=Math.max(16,Math.min(120,
   Math.round(wdTextStartSize*distance/wdTextStartDistance)));
  wordiiCaption.style.fontSize=wordiiTextSize+"px";
  const slider=document.getElementById("seTextSize");
  if(slider)slider.value=wordiiTextSize;
 }else if(wdTextPointers.size===1){
  wordiiTextX=Math.max(5,Math.min(95,
   (e.clientX-r.left)/r.width*100));
  wordiiTextY=Math.max(5,Math.min(95,
   (e.clientY-r.top)/r.height*100));
  wordiiCaption.style.left=wordiiTextX+"%";
  wordiiCaption.style.top=wordiiTextY+"%";
  wordiiCaption.style.transform="translate(-50%,-50%)";
 }
});

function wdEndTextPointer(e){
 wdTextPointers.delete(e.pointerId);
 if(wordiiCaption.hasPointerCapture(e.pointerId))
  wordiiCaption.releasePointerCapture(e.pointerId);
 if(wdTextPointers.size<2)wdTextStartDistance=0;
}
wordiiCaption.addEventListener("pointerup",wdEndTextPointer);
wordiiCaption.addEventListener("pointercancel",wdEndTextPointer);


(function wdPhotoGestures(){
 const img=document.getElementById("seImage");
 const pointers=new Map();
 let startDistance=0,startZoom=1;
 let lastX=0,lastY=0;

 img.style.touchAction="none";
 img.addEventListener("pointerdown",e=>{
  e.preventDefault();
  img.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  lastX=e.clientX;lastY=e.clientY;
  if(pointers.size===2){
   const [a,b]=[...pointers.values()];
   startDistance=Math.hypot(a.x-b.x,a.y-b.y);
   startZoom=wdPhotoZoom;
  }
 });
 img.addEventListener("pointermove",e=>{
  if(!pointers.has(e.pointerId))return;
  e.preventDefault();
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pointers.size===2 && startDistance>0){
   const [a,b]=[...pointers.values()];
   wdPhotoZoom=Math.max(1,Math.min(4,
    startZoom*Math.hypot(a.x-b.x,a.y-b.y)/startDistance));
  }else if(pointers.size===1){
   const r=img.getBoundingClientRect();
   wdPhotoX+=(e.clientX-lastX)/Math.max(1,r.width)*100;
   wdPhotoY+=(e.clientY-lastY)/Math.max(1,r.height)*100;
   wdPhotoX=Math.max(-100,Math.min(100,wdPhotoX));
   wdPhotoY=Math.max(-100,Math.min(100,wdPhotoY));
   lastX=e.clientX;lastY=e.clientY;
  }
  wdPhotoPreview();
 });
 const end=e=>{
  pointers.delete(e.pointerId);
  if(img.hasPointerCapture(e.pointerId))
   img.releasePointerCapture(e.pointerId);
  if(pointers.size<2)startDistance=0;
 };
 img.addEventListener("pointerup",end);
 img.addEventListener("pointercancel",end);
})();

document.getElementById("seMusic").onclick=wordiiOpenMusic;
document.getElementById("seEffect").onclick=wordiiOpenEffects;
// Render the caption into the JPEG itself: existing Firestore rules only allow
// ownerUid, viewers, img, close, mentions, via, createdAt for photo stories.
async function storyPhotoWithCaption(src, caption, color, effectCss="none") {
  if (!caption && effectCss === "none" && !wordiiSelectedMusic && wdLayout === "classic" && !wdSticker && !wdHasDrawing && !wdPhotoLayers.length && wdPhotoZoom===1 && wdPhotoX===0 && wdPhotoY===0) return src;
  const im = new Image();
  await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = reject; im.src = src; });
  const canvas = document.createElement('canvas');
  canvas.width = im.naturalWidth; canvas.height = im.naturalHeight;
  const ctx = canvas.getContext('2d'); ctx.filter=effectCss;ctx.save();
  ctx.translate(canvas.width/2+wdPhotoX/100*canvas.width,
                canvas.height/2+wdPhotoY/100*canvas.height);
  ctx.scale(wdPhotoZoom,wdPhotoZoom);
  ctx.drawImage(im,-canvas.width/2,-canvas.height/2);
  ctx.restore();
  ctx.filter="none";
  wdPaintLayout(ctx,canvas.width,canvas.height);
  wdPaintDrawing(ctx,canvas.width,canvas.height);
  wdPaintSticker(ctx,canvas.width,canvas.height);
  await wdPaintPhotoLayers(ctx,canvas.width,canvas.height);
  if (caption) {
    const preview = document.querySelector('.story-edit-preview');
    const pw = Math.max(1,preview.clientWidth), ph=Math.max(1,preview.clientHeight);
    const scale = Math.min(pw/canvas.width, ph/canvas.height);
    const size = Math.max(12,Math.round(wordiiTextSize/Math.max(scale,.001)));
    const fontName = String(wordiiTextFont).replace(/["\\]/g,'');
    ctx.font = `700 ${size}px "${fontName}", sans-serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
    const words=caption.split(/\s+/);const lines=[];let line='';
    for(const word of words){
      const next=line?line+' '+word:word;
      if(ctx.measureText(next).width>canvas.width*.82 && line){lines.push(line);line=word;}else line=next;
    }
    if(line)lines.push(line);
    const shown=lines.slice(0,7), lineHeight=size*1.18;
    const centerX=canvas.width*wordiiTextX/100, centerY=canvas.height*wordiiTextY/100;
    shown.forEach((text,i)=>{
      const y=centerY+(i-(shown.length-1)/2)*lineHeight;
      ctx.lineWidth=Math.max(2,size*.12);ctx.strokeStyle='rgba(0,0,0,.8)';if(wdTextStyle===2){const m=ctx.measureText(text).width;ctx.fillStyle='rgba(15,15,20,.75)';ctx.fillRect(centerX-m/2-size*.2,y-size*.62,m+size*.4,size*1.24);}if(wdTextStyle===1){ctx.shadowColor='#000';ctx.shadowBlur=size*.35;}
      ctx.strokeText(text,centerX,y,canvas.width*.85);
      ctx.fillStyle=color;ctx.fillText(text,centerX,y,canvas.width*.85);ctx.shadowBlur=0;
    });
  }

  /* WORDII MUSIC COVER CANVAS V1 */
  if (wordiiSelectedMusic?.type === "library" && wordiiShowMusicCover) {
    const cover = document.getElementById("wordiiMusicCover");
    const preview = document.querySelector(".story-edit-preview");

    if (cover && preview) {
      const scale = Math.min(
        preview.clientWidth / canvas.width,
        preview.clientHeight / canvas.height
      );

      const visibleW = canvas.width * scale;
      const visibleH = canvas.height * scale;

      const coverW = Math.min(canvas.width * .65, 220 / scale);
      const coverH = Math.min(canvas.height * .15, 74 / scale);

      const x = canvas.width / 2 +
        ((wordiiCoverX - 50) / 100) * preview.clientWidth / scale;

      const y = canvas.height / 2 +
        ((wordiiCoverY - 50) / 100) * preview.clientHeight / scale;

      const left = Math.max(0, Math.min(canvas.width - coverW, x - coverW / 2));
      const top = Math.max(0, Math.min(canvas.height - coverH, y - coverH / 2));

      ctx.fillStyle = "rgba(20,20,28,.88)";
      ctx.beginPath();
      ctx.roundRect(left, top, coverW, coverH, 14 / scale);
      ctx.fill();

      const artSize = coverH * .72;
      ctx.fillStyle = "#e73571";
      ctx.beginPath();
      ctx.roundRect(
        left + coverH * .14,
        top + coverH * .14,
        artSize,
        artSize,
        9 / scale
      );
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold " + Math.round(artSize * .55) + "px sans-serif";
      ctx.fillText("♫", left + coverH * .14 + artSize / 2, top + coverH / 2);

      const title = wordiiSelectedMusic.title || "Wordii Music";
      const textX = left + coverH * 1.05;
      const maxTextW = Math.max(1, coverW - coverH * 1.2);

      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold " + Math.max(12, Math.round(15 / scale)) + "px sans-serif";

      let shownTitle = title;
      while (shownTitle.length > 1 &&
             ctx.measureText(shownTitle).width > maxTextW) {
        shownTitle = shownTitle.slice(0, -1);
      }
      if (shownTitle !== title) shownTitle += "…";

      ctx.fillText(shownTitle, textX, top + coverH * .4, maxTextW);

      ctx.font = Math.max(10, Math.round(11 / scale)) + "px sans-serif";
      ctx.fillStyle = "#dddddd";
      ctx.fillText("Wordii Music", textX, top + coverH * .7, maxTextW);
    }
  }

  for (const quality of [.8,.7,.6,.5,.4]) {
    const out = canvas.toDataURL('image/jpeg', quality);
    if (out.length <= 350000) return out;
  }
  throw new Error('Story image is too large. Choose a smaller photo.');
}
document.getElementById("seShare").onclick=e=>act(async()=>{
  if(!storyEditImage)throw new Error("Choose a photo first.");
  const overlayText=document.getElementById("seText").value.trim();
  /* WORDII FONT EXPORT FIX V1 */
    if (document.fonts && overlayText) {
      try {
        await document.fonts.load(
          `700 ${wordiiTextSize}px "${wordiiTextFont}"`
        );
        await document.fonts.ready;
      } catch(e) {
        console.warn("Font loading:", e);
      }
    }
    const img=await storyPhotoWithCaption(storyEditImage,overlayText,wordiiStoryTextColor(),wordiiEffects[wordiiEffect].css);
  const statusRef=doc(collection(db,"statuses"));
  const data={ownerUid:uid,...stAudience(),img,createdAt:serverTimestamp()};
  if(wordiiSelectedMusic?.type==='library')data.musicId=wordiiSelectedMusic.id;
  if(wordiiSelectedMusic?.type==='phone'){
    const f=wordiiSelectedMusic.file;
    const ext=(f.name.split('.').pop()||'mp3').toLowerCase();
    const safeExt=({mp3:'mp3',m4a:'m4a',aac:'aac',wav:'wav'})[ext];
    if(!safeExt)throw new Error('Use MP3, M4A, AAC or WAV audio.');
    const path=`status-audio/${uid}/${statusRef.id}/track.${safeExt}`;
    try { await uploadBytes(storageRef(getStorage(),path),f,{contentType:f.type}); } catch(uploadErr) { throw new Error('Device music upload failed. Firebase Storage is unavailable or denied. Try sharing without device music until media storage is connected.'); }
    data.audioPath=path;
  }
  if(wordiiSelectedMusic) {
    data.musicStart=Math.max(0,Number(document.getElementById('wordiiMusicStart')?.value)||0);
    data.musicDuration=Math.max(1,Math.min(30,Number(document.getElementById("wordiiMusicDuration")?.value)||15));
  }
  await setDoc(statusRef,data);
  closeStoryEdit();wordiiSelectedMusic=null;wordiiMusicLabel();toast("Story posted. Tap My status to view.");
},e.currentTarget);

// Wordii home actions: use existing account search, group picker, and settings.
(function setupWordiiHomeActions(){
  const menu=document.getElementById('homeMenu'), menuBtn=document.getElementById('homeMenuBtn');
  const searchBtn=document.getElementById('quickSearchBtn'), searchPanel=document.getElementById('hiddenSearchPanel');
  function closeMenu(){menu.classList.add('hidden');menuBtn.setAttribute('aria-expanded','false');}
  function closeSearch(){searchPanel.classList.add('hidden');searchBtn.setAttribute('aria-expanded','false');}
  menuBtn.addEventListener('click',e=>{e.stopPropagation();closeSearch();const opening=menu.classList.contains('hidden');menu.classList.toggle('hidden',!opening);menuBtn.setAttribute('aria-expanded',String(opening));});
  searchBtn.addEventListener('click',e=>{e.stopPropagation();closeMenu();const opening=searchPanel.classList.contains('hidden');if(opening)showTab('chats');searchPanel.classList.toggle('hidden',!opening);searchBtn.setAttribute('aria-expanded',String(opening));if(opening)document.getElementById('searchInput').focus();});
  document.getElementById('menuFindUsers').addEventListener('click',()=>{
    closeMenu();
    showTab('chats');
    searchPanel.classList.remove('hidden');
    searchBtn.setAttribute('aria-expanded','true');
    searchPanel.scrollIntoView({block:'start',behavior:'smooth'});
    const field=document.getElementById('searchInput');
    field.focus();
    if(field.value.trim().length>=2)performUserSearch();
  });
  document.getElementById('menuCreateGroup').addEventListener('click',()=>{closeMenu();document.getElementById('newGroupBtn').click();});
  document.getElementById('menuMyCode').addEventListener('click',()=>{closeMenu();showTab('connect');document.getElementById('myCode').scrollIntoView({block:'center',behavior:'smooth'});});
  document.getElementById('menuSettings')?.addEventListener('click',()=>{closeMenu();document.querySelector('[data-tab="profile"]')?.click();});
  document.addEventListener('click',e=>{if(!menu.contains(e.target)&&!menuBtn.contains(e.target))closeMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMenu();closeSearch();}});
  document.querySelectorAll('.bottom button').forEach(b=>b.addEventListener('click',()=>{closeMenu();closeSearch();}));
})();

/* WORDII REFERENCE HOME CONTROLS V1 */
(function(){
  const $id=id=>document.getElementById(id);
  const fab=$id('wordiiFab'),menu=$id('wordiiFabMenu');
  const close=()=>{menu.classList.add('hidden');fab.setAttribute('aria-expanded','false');};
  fab.addEventListener('click',e=>{e.stopPropagation();close();wordiiOpenContacts();});
  $id('fabConnect').addEventListener('click',()=>{close();showTab('connect');$id('friendCode')?.focus();});
  $id('fabGroup').addEventListener('click',()=>{close();$id('newGroupBtn').click();});
  $id('fabNewChat').addEventListener('click',()=>{close();showTab('chats');document.getElementById('wordiiContacts').classList.remove('hidden');wordiiRenderContacts();});
  $id('homeCameraBtn').addEventListener('click',()=>{close();const camera=$id('wordiiStoryCamera');if(camera&&typeof openWordiiStory==='function')openWordiiStory();else if($id('stPhotoBtn')){showTab('status');$id('stPhotoBtn').click();}else showTab('status');});
  $id('menuProfile').addEventListener('click',()=>{showTab('profile');$id('homeMenu').classList.add('hidden');});
  $id('menuNotifications').addEventListener('click',()=>{$id('homeMenu').classList.add('hidden');$id('bellBtn').click();});
  document.addEventListener('click',e=>{if(!menu.contains(e.target)&&!fab.contains(e.target))close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  const origSync=syncPremiumTabs;
  syncPremiumTabs=function(name){origSync(name);};
  document.querySelectorAll('.premium-tabs button').forEach(b=>{if(b.dataset.premiumTab==='status')b.addEventListener('click',()=>{showTab('status');syncPremiumTabs('status');});});
  const nav=document.querySelector('.bottom');
  nav?.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{close();const current=b.dataset.tab;fab.closest('.wordii-fab-wrap').style.display=current==='chats'?'flex':'none';}));
  document.querySelectorAll('.premium-tabs button').forEach(b=>b.addEventListener('click',()=>{fab.closest('.wordii-fab-wrap').style.display=b.dataset.premiumTab==='chats'?'flex':'none';}));
})();

/* WORDII CONTACT PICKER AND CHAT MENU FIX 2026-11 */
function wordiiOpenContacts(){
  const panel=document.getElementById('wordiiContacts');
  panel.classList.remove('hidden');
  document.getElementById('wcQuery').value='';
  document.getElementById('wcSearchArea').classList.add('hidden');
  wordiiRenderContacts();
}
function wordiiRenderContacts(){
  const q=document.getElementById('wcQuery').value.toLowerCase().trim();
  const ids=friendIds().filter(id=>nameOf(friends[id]).toLowerCase().includes(q));
  document.getElementById('wcCount').textContent=ids.length+' connected contacts';
  const list=document.getElementById('wcList');
  list.replaceChildren();
  for(const id of ids){
    const f=friends[id];const b=document.createElement('button');b.type='button';b.className='wc-contact';
    const ava=document.createElement('span');ava.className='wc-avatar';ava.textContent=(nameOf(f)||'?').slice(0,1).toUpperCase();
    const label=document.createElement('span');label.textContent=nameOf(f);
    b.append(ava,label);
    b.addEventListener('click',()=>act(async()=>{
      document.getElementById('wordiiContacts').classList.add('hidden');
      const chat=await startPublicChat(id);openChat(chat);
    },b));list.append(b);
  }
  if(!ids.length){const p=document.createElement('p');p.className='wc-empty';p.textContent=q?'No matching contacts':'No connected contacts yet. Use Connect by code.';list.append(p);}
}
document.getElementById('wcBack').onclick=()=>document.getElementById('wordiiContacts').classList.add('hidden');
document.getElementById('wcSearch').onclick=()=>{document.getElementById('wcSearchArea').classList.toggle('hidden');document.getElementById('wcQuery').focus();};
document.getElementById('wcMore').onclick=()=>document.getElementById('wcSearchArea').classList.toggle('hidden');
document.getElementById('wcQuery').addEventListener('input',wordiiRenderContacts);
document.getElementById('wcGroup').onclick=()=>{document.getElementById('wordiiContacts').classList.add('hidden');document.getElementById('newGroupBtn').click();};
document.getElementById('wcConnect').onclick=()=>{document.getElementById('wordiiContacts').classList.add('hidden');showTab('connect');document.getElementById('friendCode').focus();};
const wdChatMore=document.getElementById('chatMoreMenu');
function wdCloseChatMenu(){wdChatMore.classList.add('hidden');document.getElementById('chatMoreBtn').setAttribute('aria-expanded','false');}
document.getElementById('chatMoreBtn').onclick=e=>{wdBlockLabel();e.stopPropagation();const opening=wdChatMore.classList.contains('hidden');wdChatMore.classList.toggle('hidden',!opening);document.getElementById('chatMoreBtn').setAttribute('aria-expanded',String(opening));};
document.getElementById('chatMenuHide').onclick=()=>{wdCloseChatMenu();document.getElementById('hideBtn').click();};
// Wordii V2: selection is per chat. Deleting for everyone is sender-only.
let wdSelected=new Set(),wdSelectionMode=false;
function wdSelectionSync(){
  const bar=document.getElementById('wdSelectionBar');bar.classList.toggle('hidden',!wdSelectionMode);
  document.getElementById('wdSelectedCount').textContent=wdSelected.size+' selected';
  document.getElementById('msgs').classList.toggle('wd-selecting',wdSelectionMode);
  document.querySelectorAll('#msgs .msg').forEach(el=>el.classList.toggle('wd-selected',wdSelected.has(el.dataset.id)));
}
function wdSelectionStart(id){wdSelectionMode=true;if(id)wdSelected.add(id);wdSelectionSync();}
function wdSelectionStop(){wdSelected.clear();wdSelectionMode=false;wdSelectionSync();}
document.getElementById('chatMenuDelete').onclick=()=>{wdCloseChatMenu();if(!activeChat)return;wdSelectionStart();toast('Tap messages to select');};
document.getElementById('wdSelectionCancel').onclick=wdSelectionStop;
document.getElementById('wdSelectionDelete').onclick=()=>act(async()=>{
  if(!activeChat||!wdSelected.size)return toast('Select messages first');
  const selected=[...wdSelected].map(id=>msgMap[id]).filter(Boolean);
  const own=selected.every(m=>m.senderId===uid);
  const choice=own?confirm('OK: Delete for everyone (permanently). Cancel: Choose local delete.') : false;
  if(choice){
    const chatId=activeChat.id;
    const batch=writeBatch(db);selected.forEach(m=>batch.delete(doc(db,'chats',chatId,'messages',m.id)));
    await batch.commit();
    // Keep successfully deleted IDs hidden in the current session while Firestore listeners settle.
    const hidden=wdHiddenIds();selected.forEach(m=>hidden.add(m.id));
    setPref('hiddenmsgs_'+chatId,JSON.stringify([...hidden]));
    renderMessages();toast('Deleted for everyone. Verify on your friend’s phone after rules deployment.');
  }else{
    if(!confirm('Hide selected messages only on this device?'))return;
    const hidden=wdHiddenIds();selected.forEach(m=>hidden.add(m.id));setPref('hiddenmsgs_'+activeChat.id,JSON.stringify([...hidden]));renderMessages();toast('Messages hidden on this device');
  }
  wdSelectionStop();
});
function wdHiddenIds(){if(!activeChat)return new Set();try{return new Set(JSON.parse(pref('hiddenmsgs_'+activeChat.id,'[]')));}catch{return new Set();}}
document.getElementById('chatMenuClear').onclick=()=>{
  wdCloseChatMenu();if(!activeChat||!confirm('Clear loaded messages on this device only?'))return;
  const hidden=wdHiddenIds();msgs.forEach(m=>hidden.add(m.id));setPref('hiddenmsgs_'+activeChat.id,JSON.stringify([...hidden]));renderMessages();toast('Chat cleared on this device');
};
function wdBlockLabel(){if(!activeChat||activeChat.group)return;const other=activeChat.members.find(x=>x!==uid);document.getElementById('chatMenuBlock').textContent=(me?.blockedUsers||[]).includes(other)?'Unblock contact':'Block contact';}
document.getElementById('chatMenuBlock').onclick=e=>act(async()=>{
  wdCloseChatMenu();if(!activeChat||activeChat.group)return toast('Only available for individual chats');
  const other=activeChat.members.find(x=>x!==uid);
  if(!other)return toast('Contact not found');
  const blocking=!(me?.blockedUsers||[]).includes(other);
  // Atomic update prevents lost changes when another device updates the block list.
  await updateDoc(doc(db,'users',uid),{blockedUsers:blocking?arrayUnion(other):arrayRemove(other)});
  const ids=new Set(me?.blockedUsers||[]);
  if(blocking)ids.add(other);else ids.delete(other);
  me.blockedUsers=[...ids];
  wdBlockLabel();
  renderChatTitle();
  toast(blocking?'Contact blocked':'Contact unblocked');
},document.getElementById('chatMenuBlock'));
document.addEventListener('click',e=>{if(!wdChatMore.contains(e.target)&&!document.getElementById('chatMoreBtn').contains(e.target))wdCloseChatMenu();});
document.getElementById('backBtn').addEventListener('click',wdCloseChatMenu);
// Notifications must have a visible close button above the scrollable body.

// Wordii V2: level page and light/dark theme
(function(){
  const btn=document.getElementById('wdLevelBtn'),page=document.getElementById('wdLevelScreen');
  btn.onclick=()=>{const lv=Number(me?.level)||1,pts=Number(me?.points)||0,progress=pts%10;
    document.getElementById('wdLevelContent').innerHTML=`<div class="wd-level-orb">${lv}</div><h2>Level ${lv}</h2><p>${pts} XP total · ${Number(me?.streak)||0} day streak</p><div class="wd-xp-track"><i style="width:${progress*10}%"></i></div><p>${progress}/10 XP toward Level ${lv+1}</p><p>+1 XP per active minute, +4 XP daily</p>`;
    page.classList.remove('hidden');};
  function closeLevel(){page.classList.add('hidden');showTab('chats');}
  document.getElementById('wdLevelBack').onclick=closeLevel;
  document.getElementById('wdLevelHome').onclick=closeLevel;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!page.classList.contains('hidden'))closeLevel();});
  function setTheme(v){if(v==="green" && !canGreenTheme(me)) v="dark"; document.documentElement.dataset.wdTheme=v;document.documentElement.dataset.theme=v;setPref('theme',v);document.querySelector('meta[name="theme-color"]')?.setAttribute('content',(v==='light'||v==='green')?'#f7f8fc':'#08080b');}
  setTheme(pref('theme','dark')==='auto'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'):pref('theme','dark'));
  const menu=document.getElementById('homeMenu');
  const themeBtn=document.createElement('button');themeBtn.type='button';themeBtn.id='wdThemeToggle';themeBtn.textContent='☀ Light / Dark mode';
  themeBtn.onclick=()=>{const next=document.documentElement.dataset.wdTheme==='light'?'dark':'light';setTheme(next);themeBtn.textContent=next==='light'?'🌙 Switch to Dark mode':'☀ Switch to Light mode';menu.classList.add('hidden');toast(next==='light'?'Light mode enabled':'Dark mode enabled');};
  themeBtn.textContent=pref('theme','dark')==='light'?'🌙 Switch to Dark mode':'☀ Switch to Light mode';
  if(menu)menu.append(themeBtn);else{document.getElementById('homeMenuBtn').addEventListener('click',()=>{if(!document.getElementById('wdThemeToggle').isConnected){const pop=document.getElementById('homeMenuBtn').parentElement;pop.append(themeBtn);}});}
})();

// Wordii v1.4.1: explicit Profile -> Chats navigation for APK and web.
(function () {
  const back = document.getElementById("wordiiProfileHome");
  if (back) back.addEventListener("click", () => {
    document.getElementById("settings")?.classList.add("hidden");
    showTab("chats");
    document.getElementById("app")?.scrollTo({ top: 0, behavior: "instant" });
  });
})();


// Wordii Verified: manual UPI proof review. Screenshots are stored in private Firestore documents.
let wordiiPlan = {price:30, enabled:false};
let wordiiPremiumPlan={price:50,enabled:false};
function wordiiSubscriptionHTML(){ return wordiiOriginalSubscriptionHTML(); }
function wordiiOldTestSubscriptionHTML(){
  return `<div class="card"><h3>Wordii Verified — ₹30</h3><p>Verified badge after approval.</p></div><div class="card"><h3>Premium Verified — ₹50</h3><p>Premium and verified benefits.</p></div><p class="tiny">Test build: payments are not enabled.</p>`;
}
function wordiiOriginalSubscriptionHTML(){
  const premiumBlock=`<div class="card wordii-subscription"><h3>💎 Premium Verified</h3><p>Premium badge + verified badge and premium features after manual approval.</p><b>₹${wordiiPremiumPlan.price}</b><p class="tiny">Payment screenshot and UTR required. Never share OTP.</p><button type="button" class="btn" id="wordiiPremiumPurchase" ${!wordiiPremiumPlan.enabled?'disabled':''}>${wordiiPremiumPlan.enabled?'Purchase Premium':'Premium purchases disabled'}</button><div id="wordiiPremiumPanel" class="hidden"><img class="wordii-pay-qr" src="wordii-payment-qr.jpg" alt="Wordii payment QR"><p>Amount: ₹${wordiiPremiumPlan.price}</p><label>UTR / Transaction ID</label><input id="wordiiPremiumUtr" maxlength="45" placeholder="Payment reference"><label>Payment screenshot</label><input id="wordiiPremiumProof" type="file" accept="image/*"><button type="button" class="btn" id="wordiiPremiumSubmit">Submit Premium Request</button></div></div>${me?.admin===true?`<div class="card"><h3>Premium plan settings</h3><label class="setrow"><span>Enable Premium purchases (₹50)</span><input id="wordiiPremiumEnabled" type="checkbox" ${wordiiPremiumPlan.enabled?'checked':''}></label><button id="wordiiPremiumSave" class="btn">Save Premium availability</button></div>`:''}`;
  return premiumBlock+`<div class="card wordii-subscription"><div class="wordii-sub-icon">✔</div><h3>Wordii Verified</h3><p class="tiny">Get a verified badge next to your username after payment is checked by an admin.</p><div class="wordii-sub-price" id="wordiiSubPrice">₹${wordiiPlan.price}</div><p class="tiny">One-time badge • Manual verification • No automatic payment confirmation</p>${me?.verified ? '<p>✅ Your account is verified.</p>' : ''}<button type="button" id="wordiiPurchase" class="btn" ${!wordiiPlan.enabled?'disabled':''}>${wordiiPlan.enabled?'Purchase':'Purchases not enabled yet'}</button><div id="wordiiPurchasePanel" class="hidden"><p class="tiny">Scan this FamPay QR and pay the exact amount shown above. Check the recipient before paying.</p><img class="wordii-pay-qr" src="wordii-payment-qr.jpg" alt="Payment QR supplied by Wordii developer"><p><b>Amount: ₹<span id="wordiiPayAmount">${wordiiPlan.price}</span></b></p><label>UTR / Transaction ID</label><input id="wordiiUtr" maxlength="45" placeholder="Enter payment reference" autocomplete="off"><label>Payment screenshot (required)</label><input id="wordiiProof" type="file" accept="image/*"><p class="tiny">Your username: <b>${esc(me?.username)}</b>. Only admins can view your submitted proof. Do not upload passwords, OTPs or unrelated personal information.</p><button type="button" class="btn" id="wordiiSubmitProof">Submit for Verification</button></div><div id="wordiiMyRequests" class="tiny"></div></div>${me?.admin===true?`<div class="card"><h3>🛡️ Verified Badge Admin</h3><label>Badge price (₹)</label><input id="wordiiAdminPrice" type="number" min="1" max="10000" step="1" value="${wordiiPlan.price}"><label class="setrow"><span>Enable purchases</span><input type="checkbox" id="wordiiAdminEnabled" ${wordiiPlan.enabled?'checked':''}></label><button class="btn" id="wordiiSavePlan">Save price & availability</button><p class="tiny">Changing the price does not change existing requests. Confirm payment in FamPay before approval.</p><div id="wordiiAdminRequests">Loading requests…</div></div>`:''}`;
}
async function loadWordiiSubscription(){
  try {
    const snap=await getDoc(doc(db,'wordiiConfig','verifiedPlan'));
    wordiiPlan=snap.exists()?{price:snap.data().price,enabled:snap.data().enabled===true}:{price:30,enabled:false};
    const ps=await getDoc(doc(db,'wordiiConfig','premiumPlan'));wordiiPremiumPlan=ps.exists()?{price:50,enabled:ps.data().enabled===true}:{price:50,enabled:false};
    if(subKey!=='subs')return;
    // Refresh content only after the initial plan load.
    $('#settingsBody').innerHTML=wordiiFullSubscriptionHTML();
    // Payment requests loading enabled.
    const mine=await getDocs(query(collection(db,'verifiedRequests'),where('uid','==',uid),limit(20)));
    const mineBox=$('#wordiiMyRequests');
    if(mineBox)mineBox.innerHTML=mine.docs.map(d=>`<div class="wordii-request">${d.data().plan==='premium'?'💎 Premium':'✔ Verified'} · ₹${d.data().price} — <b>${esc(d.data().status)}</b></div>`).join('');
    if(me?.admin===true)await loadWordiiAdminRequests();
  }catch(e){toast(friendly(e));}
}
async function loadWordiiAdminRequests(){
  const box=$('#wordiiAdminRequests');if(!box||me?.admin!==true)return;
  try{
    const snap=await getDocs(query(collection(db,'verifiedRequests'),limit(100)));
    const rows=snap.docs.filter(d=>d.data().status==='pending');
    box.innerHTML=`<h4>Pending payments (${rows.length})</h4>`+(rows.length?rows.map(d=>{const v=d.data();return `<div class="wordii-request"><b>${esc(v.username)}</b> · ${v.plan==='premium'?'💎 Premium':'✔ Verified'} · ₹${v.price}<p class="tiny">UTR: ${esc(v.utr)}</p><img class="wordii-proof-preview" src="${esc(v.proof)}" alt="User payment screenshot"><div class="row-btns"><button class="btn sm" data-wordii-approve="${esc(d.id)}">Approve</button><button class="btn sm ghost" data-wordii-reject="${esc(d.id)}">Reject</button></div></div>`}).join(''):'<p class="tiny">No pending payments.</p>');
  }catch(e){box.textContent=friendly(e);}
}
async function wordiiImageData(file){
  if(!file||!file.type.startsWith('image/'))throw Error('Choose a payment screenshot.');
  if(file.size>8*1024*1024)throw Error('Screenshot must be under 8 MB.');
  const bitmap=await createImageBitmap(file);const scale=Math.min(1,850/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  const result=canvas.toDataURL('image/jpeg',.55);
  if(result.length>180000)throw Error('Screenshot is too large. Crop it and try again.');
  return result;
}
function wordiiFullSubscriptionHTML(){
  return `<div class="wd-sub-hero"><span class="wd-sub-crown">♛</span><h2>Wordii Membership</h2><p>Choose your badge. Every payment is reviewed manually.</p><div class="wd-sub-chips"><span>✦ Premium</span><span>✓ Verified</span><span>🔒 Private proof</span></div></div>` + wordiiOriginalSubscriptionHTML();
}
async function handleWordiiSubscriptionClick(e){ return wordiiOriginalSubscriptionClick(e); }
async function wordiiOriginalSubscriptionClick(e){
  if(e.target.closest('#wordiiPremiumPurchase')){$('#wordiiPremiumPanel')?.classList.remove('hidden');return true;}
  const pSave=e.target.closest('#wordiiPremiumSave');if(pSave){
    if(me?.admin!==true){toast('Admin only');return true;}
    await act(async()=>{await setDoc(doc(db,'wordiiConfig','premiumPlan'),{price:50,enabled:$('#wordiiPremiumEnabled').checked,updatedAt:serverTimestamp(),updatedBy:uid});toast('Premium settings saved');await loadWordiiSubscription();},pSave);return true;
  }
  const pSubmit=e.target.closest('#wordiiPremiumSubmit');if(pSubmit){
    await act(async()=>{
      const utr=$('#wordiiPremiumUtr').value.trim();if(!/^[A-Za-z0-9-]{8,45}$/.test(utr))throw Error('Enter valid UTR');
      const proof=await wordiiImageData($('#wordiiPremiumProof').files[0]);
      const snap=await getDoc(doc(db,'wordiiConfig','premiumPlan'));
      if(!snap.exists()||snap.data().enabled!==true||snap.data().price!==50)throw Error('Premium purchases are disabled or changed.');
      await addDoc(collection(db,'verifiedRequests'),{uid,username:me.username,utr,proof,price:50,plan:'premium',status:'pending',createdAt:serverTimestamp()});
      toast('Premium request sent for admin approval');await loadWordiiSubscription();
    },pSubmit);return true;
  }

  const purchase=e.target.closest('#wordiiPurchase');if(purchase){if(!wordiiPlan.enabled)return true;$('#wordiiPurchasePanel')?.classList.remove('hidden');purchase.classList.add('hidden');return true;}
  const save=e.target.closest('#wordiiSavePlan');if(save){
    if(me?.admin!==true){toast('Admin only');return true;}
    await act(async()=>{const price=Number($('#wordiiAdminPrice').value);if(!Number.isInteger(price)||price<1||price>10000)throw Error('Enter a whole-number price from ₹1 to ₹10000.');await setDoc(doc(db,'wordiiConfig','verifiedPlan'),{price,enabled:$('#wordiiAdminEnabled').checked,updatedAt:serverTimestamp(),updatedBy:uid});toast('Subscription settings saved');await loadWordiiSubscription();},save);return true;
  }
  const submit=e.target.closest('#wordiiSubmitProof');if(submit){
    await act(async()=>{if(!wordiiPlan.enabled)throw Error('Purchases are disabled.');const utr=$('#wordiiUtr').value.trim();if(!/^[a-zA-Z0-9\-]{8,45}$/.test(utr))throw Error('Enter a valid UTR / transaction ID (8–45 characters).');const proof=await wordiiImageData($('#wordiiProof').files[0]);const snap=await getDoc(doc(db,'wordiiConfig','verifiedPlan'));if(!snap.exists()||snap.data().enabled!==true)throw Error('Purchases are disabled.');if(snap.data().price!==wordiiPlan.price)throw Error('Price changed. Reopen subscriptions before paying.');await addDoc(collection(db,'verifiedRequests'),{uid,username:me.username,utr,proof,price:wordiiPlan.price,status:'pending',createdAt:serverTimestamp()});toast('Request submitted. Await admin verification.');await loadWordiiSubscription();},submit);return true;
  }
  const approve=e.target.closest('[data-wordii-approve]');const reject=e.target.closest('[data-wordii-reject]');if(approve||reject){
    if(me?.admin!==true){toast('Admin only');return true;}
    const id=(approve||reject).dataset.wordiiApprove||(approve||reject).dataset.wordiiReject;const yes=!!approve;
    if(!confirm(yes?'Have you independently confirmed this UTR and amount in FamPay? Approve badge?':'Reject this payment request?'))return true;
    await act(async()=>{const requestRef=doc(db,'verifiedRequests',id);const snap=await getDoc(requestRef);if(!snap.exists()||snap.data().status!=='pending')throw Error('Request already handled.');const batch=writeBatch(db);batch.update(requestRef,{status:yes?'approved':'rejected',reviewedBy:uid,reviewedAt:serverTimestamp()});if(yes)batch.update(doc(db,'users',snap.data().uid),snap.data().plan==='premium'?{verified:true,premium:true}:{verified:true});await batch.commit();toast(yes?'Badge approved':'Request rejected');await loadWordiiSubscription();},approve||reject);return true;
  }
  return false;
}

// v1.5 Step 5: Premium gallery wallpaper is device-local, not uploaded to Firebase.
function applyWordiiWallpaper() {
  const chat = document.querySelector("#chat");
  if (!chat) return;
  const photo = (uid && (canBTP() || me?.premium)) ? localStorage.getItem("wordii_wallpaper_" + uid) : null;
  if (photo && photo.startsWith("data:image/")) {
    chat.style.setProperty("--wd-gallery-wallpaper", `url("${photo}")`);
    chat.classList.add("wd-gallery-wallpaper");
  } else {
    chat.style.removeProperty("--wd-gallery-wallpaper");
    chat.classList.remove("wd-gallery-wallpaper");
  }
}
// Re-apply after account data has loaded, and when navigating back to the app.
document.addEventListener("visibilitychange", () => { if (!document.hidden) applyWordiiWallpaper(); });


// Followers list on own profile (capture to prevent older data-go router handling it).
document.getElementById('profile')?.addEventListener('click', e => {
  const b = e.target.closest('[data-go="followers"]');
  if (!b) return;
  e.stopImmediatePropagation();
  act(async () => wordiiShowFollowers(uid), b);
}, true);

// Wordii v1.6: keep a live call running while browsing chats or gallery.
(function(){
 const ui=document.getElementById('callUI');if(!ui)return;
 const bar=ui.querySelector('.call-bar');if(!bar)return;
 const btn=document.createElement('button');btn.id='wdCallMinimize';btn.className='call-btn';btn.type='button';btn.textContent='↙';btn.title='Browse while calling';btn.setAttribute('aria-label','Minimize call');bar.prepend(btn);
 btn.onclick=()=>{if(!call)return;ui.classList.toggle('wd-call-minimized');btn.textContent=ui.classList.contains('wd-call-minimized')?'↗':'↙';};
})();

// WORDII STATUS CREATOR V1.6.1: extra shortcuts to existing editing controls.
(function wordiiCreatorShortcuts(){
 const editor=document.getElementById('storyEdit');
 const head=editor?.querySelector('.story-edit-head');
 if(!head||document.getElementById('wordiiCreatorToolbar'))return;
 const bar=document.createElement('nav');bar.id='wordiiCreatorToolbar';bar.setAttribute('aria-label','Story editing tools');
 const tools=[['Aa','Text',()=>document.getElementById('seText')?.focus()],['♫','Music',()=>document.getElementById('seMusic')?.click()],['✨','Effects',()=>document.getElementById('seEffect')?.click()],['🎨','Colour',()=>document.getElementById('seColor')?.click()]];
 for(const [symbol,label,action] of tools){const b=document.createElement('button');b.type='button';b.innerHTML='<span></span><small></small>';b.querySelector('span').textContent=symbol;b.querySelector('small').textContent=label;b.setAttribute('aria-label',label);b.onclick=action;bar.append(b);}
 head.insertAdjacentElement('afterend',bar);
})();


// Wordii reference-style story toolbar: delegates to existing editor actions.
for (const [quick, existing] of Object.entries({
  wdQuickClose:'seClose', wdQuickMusic:'seMusic', wdQuickText:'seText',
  wdQuickSticker:'wdStickerBtn', wdQuickDraw:'wdDrawBtn',
  wdQuickEffects:'seEffect', wdQuickLayout:'wdLayoutBtn'
})) {
  document.getElementById(quick)?.addEventListener('click', () => {
    const target = document.getElementById(existing);
    if (!target) return;
    if (existing === 'seText') target.focus();
    else target.click();
  });
}


// Couple invitations only. Paid badge activation is intentionally NOT implemented.
function wordiiCouplePair(a,b){return [a,b].sort().join('_');}
function wordiiCouplePage(){
  return `<div class="card wd-couple-card wd-couple-v13"><h3>💞 Couple Badge</h3><p class="tiny">₹40 per person · Manual verification · Both partners must consent</p>
  <div class="card wd-couple-payment"><img class="wordii-pay-qr" src="couple-payment-qr.jpg" alt="Wordii Couple Badge payment QR" loading="lazy"><p class="tiny">Check the recipient and refund policy before paying. Do not share OTPs.</p><label>UTR / Transaction ID</label><input id="wdCoupleUtr" maxlength="45" placeholder="Enter genuine transaction ID" autocomplete="off"><label>Payment screenshot</label><input id="wdCoupleProof" type="file" accept="image/*"><button type="button" class="btn" id="wdCoupleSubmit">Save Payment Details</button><div id="wdCoupleMyPayments" class="tiny"></div></div>
  <div class="card"><h4>💌 Partner invitations</h4><p class="tiny">Both people must accept before verification can start.</p><input type="hidden" id="wdCoupleUsername"><button type="button" class="btn ghost" id="wdCoupleRefresh">Refresh invitations</button><div id="wdCoupleRequests" aria-live="polite"></div></div>
  <div class="wd-couple-modal hidden" id="wdCoupleModal" role="dialog" aria-modal="true" aria-labelledby="wdCoupleModalTitle"><div class="wd-couple-dialog"><div class="wd-couple-heart">💕</div><h3 id="wdCoupleModalTitle">Choose your partner</h3><p class="tiny">Enter their exact Wordii username. You can finish later.</p><label for="wdCoupleModalName">Partner username</label><input id="wdCoupleModalName" maxlength="40" placeholder="@username" autocomplete="off" autocapitalize="none" spellcheck="false"><p id="wdCoupleModalError" class="tiny" aria-live="polite"></p><div class="wd-couple-dialog-actions"><button type="button" class="btn ghost" id="wdCoupleLater">Later</button><button type="button" class="btn" id="wdCoupleConfirm">Confirm</button></div></div></div>
  ${me?.admin===true?`<div class="card"><h4>🛡️ Couple Payment Admin</h4><button type="button" class="btn ghost" id="wdCoupleAdminRefresh">Refresh payment requests</button><div id="wdCoupleAdminPayments"></div></div>`:""}</div>`;
}
async function wordiiCoupleRefresh(){
  const box=document.getElementById('wdCoupleRequests');if(!box||!uid)return;
  box.textContent='Loading…';
  try{
    const snap=await getDocs(query(collection(db,'coupleInvites'),where('members','array-contains',uid),limit(40)));
    if(!document.getElementById('wdCoupleRequests'))return;
    box.innerHTML=snap.empty?'<p class="tiny">No invitations yet.</p>':snap.docs.map(d=>{
      const x=d.data(),other=x.members.find(v=>v!==uid);
      const label=uid===x.from?x.toName:x.fromName;
      const actions=x.status==='pending'&&x.to===uid?`<button class="btn sm" data-wd-couple-act="accepted" data-pair="${esc(d.id)}">Accept</button> <button class="btn sm ghost" data-wd-couple-act="rejected" data-pair="${esc(d.id)}">Reject</button>`:'';
      const disconnect=x.status==='accepted'||x.status==='pending'?`<button class="btn sm ghost" data-wd-couple-act="disconnected" data-pair="${esc(d.id)}">Disconnect 💔</button>`:'';
      return `<div class="card"><b>${esc(label||other)}</b><p class="tiny">${esc(x.status)} · ${x.status==='accepted'?'Connection accepted (badge not active)':'No badge active'}</p>${actions}${disconnect}</div>`;
    }).join('');
  }catch(e){box.textContent=friendly(e);}
}

// WORDII COUPLE BADGE V12
function wordiiCoupleCountdown(t){
  if(!t)return 'Awaiting verification';
  const ms=t.toMillis?t.toMillis():new Date(t).getTime();
  if(!Number.isFinite(ms))return 'Awaiting verification';
  const left=Math.max(0,86400000-(Date.now()-ms));
  if(!left)return '24-hour review window ended · Awaiting admin';
  const h=Math.floor(left/3600000);
  const m=Math.floor(left%3600000/60000);
  const sec=Math.floor(left%60000/1000);
  return 'Wait for Verification · '+[h,m,sec]
    .map(n=>String(n).padStart(2,'0')).join(':');
}

async function wordiiCouplePayments(){
  const mine=document.getElementById('wdCoupleMyPayments');
  if(mine){
    try{
      const draft=await getDoc(doc(db,'couplePaymentDrafts',uid));
      const snap=await getDocs(query(
        collection(db,'couplePaymentRequests'),
        where('uid','==',uid),limit(20)
      ));
      let html='';
      if(draft.exists()){
        html+='<div class="card"><b>Payment details saved</b>'+
          '<p class="tiny">Partner username is still required. '+
          'The 24-hour timer has not started.</p>'+
          '<button type="button" class="btn" id="wdCoupleComplete">'+
          'Complete Partner Details</button></div>';
      }
      html+=snap.docs.map(d=>{
        const v=d.data();
        const pending=v.status==='pending';
        return '<div class="card"><b>₹40 · '+
          esc(v.partnerUsername)+'</b><p>'+
          esc(v.status)+'</p><p class="tiny" '+
          (pending?'data-wd-couple-timer="'+
          esc(String(v.createdAt?.toMillis?.()||0))+'"':'')+
          '>'+esc(pending?wordiiCoupleCountdown(v.createdAt):
          'Admin review: '+v.status)+'</p></div>';
      }).join('');
      mine.innerHTML=html||'No payment requests yet.';
    }catch(e){mine.textContent=friendly(e);}
  }

  const admin=document.getElementById('wdCoupleAdminPayments');
  if(admin&&me?.admin===true){
    try{
      const snap=await getDocs(query(
        collection(db,'couplePaymentRequests'),limit(100)
      ));
      const pending=snap.docs.filter(d=>d.data().status==='pending');
      admin.innerHTML=pending.length?pending.map(d=>{
        const v=d.data();
        return '<div class="card"><b>'+esc(v.username)+
          '</b> → '+esc(v.partnerUsername)+
          ' · ₹40<p class="tiny">UTR: '+esc(v.utr)+
          '</p><img class="wordii-proof-preview" src="'+
          esc(v.proof)+'" alt="Payment proof">'+
          '<div class="row-btns"><button type="button" class="btn sm" '+
          'data-wd-couple-payment="approved" data-id="'+esc(d.id)+
          '">Approve</button><button type="button" class="btn sm ghost" '+
          'data-wd-couple-payment="rejected" data-id="'+esc(d.id)+
          '">Reject</button></div></div>';
      }).join(''):'No pending Couple payments.';
    }catch(e){admin.textContent=friendly(e);}
  }
}

function wordiiCoupleModal(open=true){
  const modal=document.getElementById('wdCoupleModal');if(!modal)return;
  modal.classList.toggle('hidden',!open);
  if(open){document.getElementById('wdCoupleModalError').textContent='';document.getElementById('wdCoupleModalName')?.focus();}
}
async function wordiiCoupleCompletePartner(){
  const draft=await getDoc(doc(db,'couplePaymentDrafts',uid));
  if(!draft.exists())throw Error('No saved payment details.');
  wordiiCoupleModal(true);
}
async function wordiiCoupleConfirmPartner(){
  const field=document.getElementById('wdCoupleModalName');
  let name=String(field?.value||'').trim().toLowerCase();
  if(name&&!name.startsWith('@'))name='@'+name;
  if(!/^@[a-z0-9_]{3,15}(?:#[0-9]{3})?$/.test(name))throw Error('Enter a valid exact @username.');
  if(name===String(me.username).toLowerCase())throw Error('You cannot select yourself.');
  const found=await getDocs(query(collection(db,'users'),where('username','==',name),limit(2)));
  if(found.empty)throw Error('Partner username not found.');
  const partnerUid=found.docs[0].id,pairId=wordiiCouplePair(uid,partnerUid);
  const inviteList=await getDocs(query(collection(db,'coupleInvites'),where('members','array-contains',uid),limit(100)));
  const invite=inviteList.docs.find(d=>d.id===pairId);
  if(!invite){
    document.getElementById('wdCoupleUsername').value=name;
    await wordiiCoupleInvite();
    wordiiCoupleModal(false);
    toast('Invitation sent. Partner must accept before verification starts.');
    await wordiiCouplePayments();return;
  }
  if(invite.data().status==='pending'){
    wordiiCoupleModal(false);
    toast('Invitation pending. Ask your partner to accept.');
    return;
  }
  if(invite.data().status!=='accepted')throw Error('Connection ended. Contact support to start a new invitation.');
  const ref=doc(db,'couplePaymentDrafts',uid),draft=await getDoc(ref);
  if(!draft.exists())throw Error('No saved payment details.');
  const v=draft.data();
  await addDoc(collection(db,'couplePaymentRequests'),{
    uid,username:me.username,partnerUid,partnerUsername:name,pairId,
    utr:v.utr,proof:v.proof,price:40,status:'pending',createdAt:serverTimestamp()
  });
  try{await deleteDoc(ref);}catch(e){console.warn('Draft cleanup pending',e);}
  wordiiCoupleModal(false);
  toast('Verification request submitted. 24-hour review window started.');
  await wordiiCouplePayments();
}

async function wordiiCoupleSubmitPayment(){
  const utr=String(
    document.getElementById('wdCoupleUtr')?.value||''
  ).trim();

  if(!/^[A-Za-z0-9-]{8,45}$/.test(utr))
    throw Error('Enter a valid UTR (8–45 characters).');

  const proof=await wordiiImageData(
    document.getElementById('wdCoupleProof')?.files?.[0]
  );

  const ref=doc(db,'couplePaymentDrafts',uid);
  let existing;
  try{existing=await getDoc(ref);}catch(e){throw Error('Cannot read payment draft: '+(e.code||e.message));}

  if(existing.exists())
    throw Error('Complete your existing payment details first.');

  try{await setDoc(ref,{
    uid,username:me.username,utr,proof,
    price:40,status:'awaiting_partner',
    createdAt:serverTimestamp()
  });}catch(e){throw Error('Payment draft save denied: '+(e.code||e.message));}

  toast('Payment details saved. Enter partner username.');
  await wordiiCouplePayments();
  wordiiCoupleModal(true);
}

if(!window.wordiiCoupleV12Timer){
  window.wordiiCoupleV12Timer=setInterval(()=>{
    document.querySelectorAll('[data-wd-couple-timer]')
      .forEach(el=>{
        const ms=Number(el.dataset.wdCoupleTimer);
        if(ms)el.textContent=wordiiCoupleCountdown(
          {toMillis:()=>ms}
        );
      });
  },1000);
}
// END WORDII COUPLE BADGE V12
async function wordiiCoupleReviewPayment(id,status){
  if(me?.admin!==true)throw Error('Admin only');
  if(!confirm(status==='approved'?'Have you independently verified the actual ₹40 transaction?':'Reject request? If money was received, process refund separately.'))return;
  const ref=doc(db,'couplePaymentRequests',id);const snap=await getDoc(ref);
  if(!snap.exists()||snap.data().status!=='pending')throw Error('Request already reviewed');
  await updateDoc(ref,{status,reviewedBy:uid,reviewedAt:serverTimestamp()});
  toast('Payment '+status+'. Badge activation is separate.');await wordiiCouplePayments();
}
async function wordiiCoupleInvite(){
  const input=document.getElementById('wdCoupleUsername');let name=(input?.value||'').trim().toLowerCase();if(name&&!name.startsWith('@'))name='@'+name;
  if(!/^@[a-z0-9_]{3,15}(?:#[0-9]{3})?$/.test(name))throw Error('Enter an exact username, e.g. @example');
  const found=await getDocs(query(collection(db,'users'),where('username','==',name),limit(2)));
  if(found.empty)throw Error('Username not found');
  const target=found.docs[0];if(target.id===uid)throw Error('Cannot invite yourself');
  const pair=wordiiCouplePair(uid,target.id);
  await runTransaction(db,async tx=>{
    const ref=doc(db,'coupleInvites',pair),old=await tx.get(ref);
    if(old.exists())throw Error('Invitation already exists for this pair');
    tx.set(ref,{members:[uid,target.id].sort(),from:uid,to:target.id,fromName:me.username,toName:name,status:'pending',createdAt:serverTimestamp()});
  });
  toast('Invitation sent');await wordiiCoupleRefresh();
}
async function wordiiCoupleAction(pair,status){
  if(!['accepted','rejected','disconnected'].includes(status))return;
  if(status==='disconnected'&&!confirm('Disconnect? The connection will end for both people.'))return;
  await runTransaction(db,async tx=>{
    const ref=doc(db,'coupleInvites',pair),snap=await tx.get(ref);
    if(!snap.exists())throw Error('Invitation no longer exists');
    const d=snap.data();if(!d.members.includes(uid))throw Error('Not a participant');
    if(status==='accepted'&&(d.to!==uid||d.status!=='pending'))throw Error('Only invited partner can accept');
    if(status==='rejected'&&(d.to!==uid||d.status!=='pending'))throw Error('Only invited partner can reject');
    if(status==='disconnected'&&!['pending','accepted'].includes(d.status))throw Error('Already ended');
    const lockA=doc(db,'couplePartnerLocks',d.from),lockB=doc(db,'couplePartnerLocks',d.to);
    if(status==='accepted'){
      const la=await tx.get(lockA),lb=await tx.get(lockB);
      if(la.exists()||lb.exists())throw Error('One partner is already connected. Disconnect first.');
      tx.set(lockA,{pairId:pair,partnerUid:d.to});
      tx.set(lockB,{pairId:pair,partnerUid:d.from});
    }
    if(status==='disconnected'&&d.status==='accepted'){
      const la=await tx.get(lockA),lb=await tx.get(lockB);
      if(!la.exists()||!lb.exists()||la.data().pairId!==pair||lb.data().pairId!==pair)throw Error('Partner lock mismatch; contact admin.');
      tx.delete(lockA);tx.delete(lockB);
    }
    tx.update(ref,{status,updatedAt:serverTimestamp(),updatedBy:uid});
  });
  toast('Connection updated');await wordiiCoupleRefresh();
}
document.getElementById('settingsBody')?.addEventListener('click',e=>{
  if(subKey!=='couple')return;
  const btn=e.target.closest('#wdCoupleInvite,#wdCoupleRefresh,#wdCoupleSubmit,#wdCoupleComplete,#wdCoupleConfirm,#wdCoupleLater,#wdCoupleAdminRefresh,[data-wd-couple-payment],[data-wd-couple-act]');if(!btn)return;
  if(btn.id==='wdCoupleLater'){wordiiCoupleModal(false);toast('Saved. Complete partner details later.');return;}
  btn.disabled=true;
  const job=btn.id==='wdCoupleInvite'?wordiiCoupleInvite():btn.id==='wdCoupleRefresh'?Promise.all([wordiiCoupleRefresh(),wordiiCouplePayments()]):btn.id==='wdCoupleSubmit'?wordiiCoupleSubmitPayment():btn.id==='wdCoupleComplete'?wordiiCoupleCompletePartner():btn.id==='wdCoupleConfirm'?wordiiCoupleConfirmPartner():btn.id==='wdCoupleAdminRefresh'?wordiiCouplePayments():btn.dataset.wdCouplePayment?wordiiCoupleReviewPayment(btn.dataset.id,btn.dataset.wdCouplePayment):wordiiCoupleAction(btn.dataset.pair,btn.dataset.wdCoupleAct);
  Promise.resolve(job).catch(e=>{const msg=String(e.message||e).slice(0,160);const err=document.getElementById('wdCoupleModalError');if(err&&!document.getElementById('wdCoupleModal')?.classList.contains('hidden'))err.textContent=msg;toast(msg);}).finally(()=>{if(btn.isConnected)btn.disabled=false;});
});
