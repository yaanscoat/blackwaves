export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new ApiError(0, "can't reach the blackwaves server, check your connection");
  }
  let data = null;
  try {
    data = await response.json();
  } catch {}
  if (!response.ok) throw new ApiError(response.status, data?.error || `request failed (${response.status})`, data);
  return data;
}

// answers that are the same for everyone get remembered on this device for a
// few minutes, so flicking between pages doesn't keep asking the server again
const SHAREABLE = /^\/api\/(movies\/(?!hls)|manga\/|music\/(home|search|charts|album|artist)|ai\/models|cloud\/)/;
const MEMO_TTL = 5 * 60 * 1000;
const memo = new Map();

export function get(path, options) {
  if (!SHAREABLE.test(path)) return api(path, options);
  const hit = memo.get(path);
  if (hit && Date.now() - hit.at < MEMO_TTL) return hit.promise;
  const promise = api(path).catch((error) => {
    memo.delete(path);
    throw error;
  });
  memo.set(path, { at: Date.now(), promise });
  if (memo.size > 300) memo.delete(memo.keys().next().value);
  return promise;
}
export const post = (path, body, options) => api(path, { ...options, method: "POST", body: body ?? {} });
export const patch = (path, body) => api(path, { method: "PATCH", body });
export const put = (path, body) => api(path, { method: "PUT", body });
export const del = (path) => api(path, { method: "DELETE" });
