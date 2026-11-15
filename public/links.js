// YouTube and Instagram shown in the top corner and on the Profile tab.
// Use a full link or a handle like "@name". Leave "" to hide an icon.
export const links = {
  youtube: "https://youtube.com/@xwordii",
  instagram: "https://www.instagram.com/xwordii",
};

// Optional relay servers for calls (TURN). Calls work on many networks with the free STUN servers alone,
// but some mobile networks block them. If calls fail, get free TURN details from a service such as metered.ca
// and add them here, like: { urls: "turn:YOUR_HOST:80", username: "USER", credential: "PASSWORD" }
export const turnServers = [];

// Public key for phone push notifications (safe to share). The matching private key lives only on the Render server.
export const vapidPublicKey = "BHMsC34A75pxagV1kME88ExbsZDNFq5zJu41QPL0RWNOopyfp9ToE4R3nSsfjs7zUQBiZjZzD37wTAbA77HcJKw";
