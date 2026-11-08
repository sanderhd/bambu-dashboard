// Browser-side helpers.

/** JSON fetch that sends you to the login page when the session expired. Throws on API errors. */
export async function api<T = any>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error('Not logged in');
  }
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** Uploads one file as the raw request body, reporting progress (0–1). */
export function uploadFile(url: string, file: File, onProgress: (p: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let j: any = {};
      try { j = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401) { window.location.href = '/login'; return reject(new Error('Not logged in')); }
      if (xhr.status >= 200 && xhr.status < 300 && j.ok) resolve(j);
      else reject(new Error(j.error || `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed: connection lost'));
    xhr.send(file);
  });
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtGrams(g: number) {
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`;
}
