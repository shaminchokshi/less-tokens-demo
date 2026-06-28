/* account.js — auth + subscription + pricing calls against the FastAPI backend.
   Reuses the same API base as the rest of the site (see shared.js). */

import { API } from "./shared.js";

const TOKEN_KEY = "lt_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function call(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const t = getToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

// Live price from the pricing table → { product_code, amount }
export const getPricing = () => call("/pricing");

export const signup = (payload) =>
  call("/auth/signup", { method: "POST", body: payload });

export const login = async (email, password) => {
  const data = await call("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  setToken(data.token);
  return data.user;
};

export const verifyEmail = (token) =>
  call(`/auth/verify?token=${encodeURIComponent(token)}`);

export const me = () => call("/me", { auth: true });

export const subscribe = () =>
  call("/extension/subscribe", { method: "POST", auth: true });

export const cancel = () =>
  call("/extension/cancel", { method: "POST", auth: true });

export const logout = () => clearToken();