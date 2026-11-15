// Wordii symbol codec. This is OBFUSCATION, NOT ENCRYPTION: anyone with this code can decode.
export const ALPHABET = "◐◑◒◓◔◕◖◗◢◣◤◥◰◱◲◳"; // 16 symbols = one hex digit each
export const OPEN = "⟦";
export const CLOSE = "⟧";
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });
const mask = (i) => (i * 37 + 11) & 255; // position-based scramble so repeats don't look alike

export function encodeMessage(text) {
  const bytes = enc.encode(text); // UTF-8: handles English, Hindi, numbers, punctuation, emoji
  let out = "";
  bytes.forEach((b, i) => {
    const x = b ^ mask(i);
    out += ALPHABET[x >> 4] + ALPHABET[x & 15];
  });
  return OPEN + out + CLOSE;
}

export function isSymbolMessage(s) {
  s = String(s).trim();
  if (s.length < 4 || s[0] !== OPEN || s[s.length - 1] !== CLOSE) return false;
  const body = s.slice(1, -1);
  if (body.length % 2) return false;
  for (const ch of body) if (!ALPHABET.includes(ch)) return false;
  return true;
}

export function decodeMessage(s) {
  if (!isSymbolMessage(s)) return null;
  const body = String(s).trim().slice(1, -1);
  const bytes = new Uint8Array(body.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const x = (ALPHABET.indexOf(body[2 * i]) << 4) | ALPHABET.indexOf(body[2 * i + 1]);
    bytes[i] = x ^ mask(i);
  }
  try { return dec.decode(bytes); } catch { return null; }
}
