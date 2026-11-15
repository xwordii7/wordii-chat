# Band app mein notification (Render free) - setup

Sab free hai. Aapko 3 jagah kaam karna hai: Firebase, Render, UptimeRobot.

## 1. Firebase se "service account" file lo
1. Firebase console > Project settings (gear) > **Service accounts** > **Generate new private key** > file download hogi (.json).
2. **Is file ko kabhi GitHub par mat daalna.** Ye aapke project ki chaabi hai.

## 2. GitHub par server ki files
Sabse aasan: ek naya repo banao (jaise `wordii-push`) aur `wordii-push-server.zip` ke andar ki 3 files upload karo:
`index.js`, `package.json`, `.gitignore` (folder nahi, seedhe repo ke andar).
(Agar poora project hi upload kar rakha hai, to Render mein **Root Directory** = `push-server` rakhna.)

## 3. Render par server banao
1. render.com > Sign up (GitHub se).
2. **New +** > **Web Service** > apna repo chuno.
3. Runtime: **Node**. Build Command: `npm install`. Start Command: `npm start`. Instance type: **Free**.
4. **Environment** (Environment Variables) mein ye 2 daalo:
   - `VAPID_PUBLIC_KEY` = (chat mein diya hua public key)
   - `VAPID_PRIVATE_KEY` = (chat mein diya hua private key)
5. **Secret Files** > Add Secret File: naam `serviceAccount.json`, content = step 1 wali .json file ka poora text (copy-paste).
6. **Create Web Service**. Kuch minute mein "Live" dikhega. Uska link kholo: "Wordii push server is running" likha aana chahiye.

## 4. Server ko jagaye rakho (zaroori)
Render ka free server 15 minute kuch na ho to so jata hai. Isliye:
1. uptimerobot.com par free account banao.
2. **Add New Monitor**: type HTTP(s), URL = `https://AAPKA-NAAM.onrender.com/health`, interval 5 minutes.

## 5. App mein ON karo
Naya app zip deploy karo (firebase deploy), phir app mein **You > Notifications > Alerts when the app is closed > Turn on** aur permission Allow karo.

## Test
Phone A mein app poori band karo (recent apps se swipe). Phone B se message bhejo. A par notification aana chahiye.

## Dhyan do
- Notification mein message ka text nahi hota, sirf "New message".
- Server so gaya ho to pehla notification der se aa sakta hai.
- Android ki battery saver kabhi notification rok deti hai (app ko "Unrestricted" battery do).
- Status mention ka push abhi nahi hai (sirf app ke andar).
