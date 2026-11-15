# Wordii Chat (free version, Spark plan)

Works on Firebase's FREE plan. No Cloud Functions, no card needed.

## What works
Anonymous accounts, unique usernames (@name#123), 6-digit friend codes (10 minutes), private real-time chat, symbol messages (decoded for 10 seconds, long-press to copy, paste to decode).

## NOT in this version (needs the paid Blaze plan)
Points, levels, daily streak, shop, referrals. The full version is saved in `full-version-needs-blaze/` for later.

## Honest notes
- Symbol messages are obfuscation, NOT encryption.
- Accounts live in the browser; clearing site data loses the account.
- Friend codes expire in 10 minutes, but on the free plan there is no limit on wrong guesses, so a determined person could try numbers.
- Your phone's date and time must be correct (codes use it).
- Signed-in users can see other users' usernames.
- Not tested against live Firebase yet; test with the steps below.

## Deploy (Termux)
```
cd ~/wordii-chat
firebase deploy --project wordii-chat
```
Then open https://wordii-chat.web.app

## Test with two phones
1. Phone A and Phone B: open the link and create accounts (different devices or browsers).
2. A: Connect tab shows a code. B: type it, tap Connect.
3. Both open the chat and send a message: readable for 10 seconds, then symbols. Tap to read again; long-press to copy symbols; paste into the box to decode.

## v3 additions
- Display name and profile logo (Profile tab). Friends see your name and logo; your @username stays the same.
- Photo sharing (📎 button). Photos are shrunk on the phone and stored inside Firestore, so no paid plan is needed. Photos show as "Photo, tap to view" and are visible for 10 seconds like text.
- NOT possible on the free plan: videos and other files. Firebase Storage needs the paid Blaze plan, and Firestore documents are limited to 1 MB.
- Only the latest 40 messages load when you open a chat (saves free-plan quota).
- Photos are stored as text in the database, so heavy photo use can use up the free daily quota sooner.

## v5: view-once for received messages
- Your own sent messages show as symbols; they are readable for 10 s right after you send them (tap to read again).
- Received messages become readable the first time you see them, for 10 s, then turn into stars (★★★). The sender sees "Seen".
- Note: long-press still copies the symbol text, and pasting it decodes it. That is how the symbol system works, so "view once" is not a strong protection (and screenshots always work).

## v6: points, levels, daily streak (free plan)
- +4 points once per day (streak grows if you also claimed yesterday), +1 point per active minute. Level = 1 + floor(points / 10).
- Enforced by Firestore rules using the server clock: you cannot edit points directly, claim a day twice, or earn faster than 1 point per ~55 s.
- Limits: "active" means the app is open and focused; a script could still earn 1 point per minute. The streak day is the UTC day (resets 5:30 AM India time). Your phone's clock must be roughly correct.
- Shop and referrals are still not included (they need the paid plan, or a bigger rules design).

## v7: logo, Status, social icons
- App logo (round, from your artwork) used for the header, splash and install icons.
- Status tab: text (8 colours) or photo statuses, visible to your friends for 24 hours. Expired ones are removed by the owner's app. A friend you connect later only sees your NEW statuses.
- YouTube / Instagram icons appear in the top bar and on the Profile tab. Edit `public/links.js` to set them.
- The home-screen / APK icon is baked into the APK: regenerate the APK in PWABuilder (same package ID and signing key, higher version code) to get the new icon. "Add to Home screen" installs pick it up automatically.

## v8: passwords, account recovery, admin, verified badge
- Turn on **Email/Password** in Firebase console: Authentication, Sign-in method, Email/Password, Enable (leave "Email link" off). Without it, passwords will not save.
- Every account can have a password. On a new phone: Log in with your username (like @name#123) and the password. Old anonymous accounts get a "Protect your account" card in Profile.
- No email is used. Forgotten passwords cannot be recovered. Log out of an account without a password and it is gone for good.
- Admin: reserved username @wordii (no number) with a blue verified badge. Created from the "Admin" link on the first screen, using the admin key that is inside `firestore.rules` (keep that file private). Only someone with that key can take an untagged, verified username. The admin picks their own password.

## v9: username search, chat requests, inbox, notifications
- Chats tab: search a username (full like @name#123, or the first letters). Tap Request. The other person must Accept (🔔 inbox) before any chat exists. They can also Decline. The 6-digit code still works as before.
- 🔔 inbox (top bar): requests, sent requests, new messages, recent notifications. Red dots show unread chats.
- Phone notifications work while the app is open or recently in the background (turn them on in the inbox). When the app is fully closed, a real push needs a server (Cloud Functions + FCM = paid Blaze plan), which this free version does not have.
- Request notes are plain text (max 100 letters). There is no block button yet.

## v10
- Sign up with Gmail, verify by email link, and "Forgot password?" resets by email. Log in with Gmail or (old accounts) @username.
- Admin: reserved username of your choice (several admin keys are in firestore.rules), gold star badge + blue tick, and Settings, Admin tools to give or remove blue ticks.
- Profile: bio, banner, followers (only you see who you follow), tap a name in a chat to open their profile. Public accounts can be messaged directly; private accounts need a request.
- Settings: account, privacy (public/private), theme (phone / dark / light), chat background, notifications on/off, invite, language and subscription notes.
- Status: who saw it, likes, close-friends-only statuses.
- Not possible on the free web app: blocking screenshots, push notifications when the app is fully closed, paid subscriptions.

## v11
- You tab looks like WhatsApp's You screen: big logo with a green +, bio bubble, then a list (Points, Edit profile, Account, Privacy, Chats, Notifications, Language, Subscriptions, Invite, Admin tools). Each row opens its own page.
- Online status: green dot and "Active now" while a friend has the app open; otherwise "Last seen ...". Turn it off in Privacy. It uses one small database write per minute while the app is open.
- Light mode: outline buttons are readable now.

## v12
- Typing indicator, voice messages (tap the mic, tap again to send; up to 60 s, stored in the database), group chats (New group button), per-chat hide on/off (the eye button in a chat), status mentions + "Add to my status", status view/like counts, incoming call screen, voice and video calls, admin dashboard.
- Calls use WebRTC with free Google STUN servers. Some mobile networks block this; if calls do not connect, add a TURN server in `public/links.js`. Calls only ring while the other person has the app open.
- Group chat: group messages are readable for 10 s each time you open the chat (no "view once" stamp in groups). Groups cannot add or remove members after creation yet.
- Admin dashboard shows user counts, who is online/active, newest users and top points. It cannot tell cheating from honest use; it only shows activity.
