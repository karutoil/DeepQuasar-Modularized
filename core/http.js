import { fetch } from "undici";

/**
 * HTTP client with retries, timeouts, and logging.
 * Provides get/post/patch/delete with JSON convenience and exponential backoff.
 */
export function createHttp(config, logger) {
  const DEFAULT_TIMEOUT_MS = Number(config.get("HTTP_TIMEOUT_MS") || 10000);
  const DEFAULT_RETRIES = Number(config.get("HTTP_RETRIES") || 2);
  const DEFAULT_BACKOFF_MS = Number(config.get("HTTP_BACKOFF_MS") || 300);

  function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async function request(method, url, { headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
    let attempt = 0;
    let lastError;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      while (attempt <= retries) {
        try {
          const res = await fetch(url, {
            method,
            headers,
            body,
            signal: controller.signal,
          });

          const contentType = (res.headers.get("content-type") || "").toLowerCase();
          let data = null;
          if (contentType.includes("application/json")) {
            data = await res.json().catch(() => null);
          } else {
            data = await res.text().catch(() => null);
          }

          if (!res.ok) {
            const info = { status: res.status, statusText: res.statusText, url };
            logger.warn(`HTTP ${method} ${url} -> ${res.status}`, { info, data });
            if (attempt < retries && isRetryable(res.status)) {
              attempt++;
              await delay(backoff(attempt));
              continue;
            }
            return { ok: false, status: res.status, data, headers: res.headers };
          }

          return { ok: true, status: res.status, data, headers: res.headers };
        } catch (err) {
          lastError = err;
          if (attempt < retries) {
            attempt++;
            await delay(backoff(attempt));
            continue;
          }
          logger.error(`HTTP ${method} ${url} error: ${err?.message}`, { stack: err?.stack });
          return { ok: false, status: 0, data: null, error: err };
        }
      }
    } finally {
      clearTimeout(id);
    }

    return { ok: false, status: 0, data: null, error: lastError };
  }

  function isRetryable(status) {
    // Retry network errors and 5xx
    return status >= 500 && status <= 599;
  }

  function backoff(attempt) {
    const base = DEFAULT_BACKOFF_MS;
    const jitter = Math.floor(Math.random() * base);
    return base * Math.pow(2, attempt - 1) + jitter;
  }

  function jsonHeaders(extra = {}) {
    return {
      "content-type": "application/json",
      "user-agent": config.get("HTTP_USER_AGENT") || "modular-discord-bot/0.1",
      ...extra,
    };
  }

  // JSON convenience
  function get(url, opts = {}) {
    return request("GET", url, {
      ...opts,
      headers: { ...jsonHeaders(), ...(opts.headers || {}) },
    });
  }

  function post(url, data, opts = {}) {
    return request("POST", url, {
      ...opts,
      headers: { ...jsonHeaders(), ...(opts.headers || {}) },
      body: data != null ? JSON.stringify(data) : undefined,
    });
  }

  function patch(url, data, opts = {}) {
    return request("PATCH", url, {
      ...opts,
      headers: { ...jsonHeaders(), ...(opts.headers || {}) },
      body: data != null ? JSON.stringify(data) : undefined,
    });
  }

  function del(url, opts = {}) {
    return request("DELETE", url, {
      ...opts,
      headers: { ...jsonHeaders(), ...(opts.headers || {}) },
    });
  }

  return {
    request,
    get,
    post,
    patch,
    delete: del,
  };
}