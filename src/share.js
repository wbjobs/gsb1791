/**
 * Share codec: snapshot <-> portable URL-safe token.
 * Format: `v1.<base64url(json)>.<fnv1a checksum>` — tamper-evident, no deps.
 */

const b64urlEncode = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const b64urlDecode = (str) => {
  const b64 = str.replaceAll('-', '+').replaceAll('_', '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

// Node < 18.17 fallback safety (btoa/atob exist in Node 16+, kept for clarity).
const encodeJson = (obj) => b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
const decodeJson = (str) => JSON.parse(new TextDecoder().decode(b64urlDecode(str)));

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function encodeShareToken(snapshot) {
  const payload = encodeJson({ v: 1, snapshot });
  return `v1.${payload}.${fnv1a(payload)}`;
}

export function decodeShareToken(token) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('malformed share token');
  const [, payload, checksum] = parts;
  if (fnv1a(payload) !== checksum) throw new Error('share token checksum mismatch');
  const decoded = decodeJson(payload);
  if (decoded.v !== 1 || !decoded.snapshot) throw new Error('unsupported share payload');
  return decoded.snapshot;
}
