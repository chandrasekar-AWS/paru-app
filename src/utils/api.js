const KEY = 'adzone_admin_token';
// sessionStorage: closing the tab/browser also ends the admin session.
export const getToken = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
export const setToken = (t) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

/** When the current session ends (ms timestamp), read from the token. 0 if none. */
export const tokenExpiry = () => {
  try {
    const p = getToken().split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p)).exp || 0;
  } catch { return 0; }
};

export const goToLogin = (expired = false) => {
  setToken('');
  window.location.assign(`/admin/login${expired ? '?expired=1' : ''}`);
};

/** JSON helper. Adds the admin token automatically. */
export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (res.status === 401 && token && path !== '/api/login') { goToLogin(true); }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Uploads a photo and returns "/api/media/<id>".
 * The ORIGINAL file is sent untouched (same pixels, same colour profile) whenever it
 * is a JPG/PNG/WEBP/GIF under 4 MB (the hosting limit). Only bigger or unsupported
 * files are re-encoded — at the highest quality that fits, keeping their size.
 */
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const UPLOAD_LIMIT = 4 * 1024 * 1024;

async function fitUnderLimit(file) {
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
  for (let round = 0; round < 8; round++) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const q of [0.95, 0.9, 0.85]) {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= UPLOAD_LIMIT) return blob;
    }
    scale *= 0.85; // still too big → reduce the size a little and try again
  }
  throw new Error('This image is too large to upload. Please use a smaller file.');
}

export async function uploadImage(file) {
  const original = UPLOAD_TYPES.includes(file.type) && file.size <= UPLOAD_LIMIT;
  const body = original ? file : await fitUnderLimit(file);
  const res = await fetch('/api/media', {
    method: 'POST',
    headers: { 'content-type': original ? file.type : 'image/jpeg', authorization: `Bearer ${getToken()}` },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}

export const deleteMedia = (url) =>
  url?.startsWith('/api/media/') ? api(url, { method: 'DELETE' }).catch(() => {}) : Promise.resolve();
