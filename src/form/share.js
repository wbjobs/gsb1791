function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '='
  );
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeSnapshot(snapshot) {
  const json = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(json);
  return bytesToBase64Url(bytes);
}

export function decodeSnapshot(encoded) {
  const bytes = base64UrlToBytes(encoded);
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createShareUrl(snapshot, origin = location.origin, path = location.pathname) {
  return `${origin}${path}#draft=${encodeSnapshot(snapshot)}`;
}

export function readSharedSnapshot(hash = location.hash) {
  const match = hash.match(/(?:^#|&)draft=([^&]+)/);
  if (!match) return null;
  try {
    return decodeSnapshot(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}
