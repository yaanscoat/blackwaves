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

export const get = (path, options) => api(path, options);
export const post = (path, body, options) => api(path, { ...options, method: "POST", body: body ?? {} });
export const patch = (path, body) => api(path, { method: "PATCH", body });
export const put = (path, body) => api(path, { method: "PUT", body });
export const del = (path) => api(path, { method: "DELETE" });
