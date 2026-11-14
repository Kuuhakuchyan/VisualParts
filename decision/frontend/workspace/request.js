export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function errorMessage(body, status) {
  if (typeof body?.detail === "string") return body.detail;
  if (typeof body?.message === "string") return body.message;
  if (Array.isArray(body?.detail)) {
    const fields = body.detail.filter(item => typeof item?.msg === "string").slice(0, 3);
    if (fields.length) return fields.map(item => {
      const path = Array.isArray(item.loc) ? item.loc.filter(key => key !== "body").join(".") : "";
      return path ? `${path}: ${item.msg}` : item.msg;
    }).join("；");
  }
  return `请求未完成（${status}），请检查输入或稍后重试。`;
}

export async function request(url, options = {}) {
  const { json, timeoutMs = 20000, signal, headers, ...init } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("请求超时必须为正数。");
  const requestHeaders = new Headers(headers);
  if (Object.hasOwn(options, "json")) {
    if (init.body !== undefined) throw new TypeError("请求不能同时提供 json 和 body。");
    init.body = JSON.stringify(json);
    init.method ??= "POST";
    if (!requestHeaders.has("Content-Type")) requestHeaders.set("Content-Type", "application/json");
  }
  const timeout = new AbortController();
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const timer = setTimeout(() => timeout.abort(new DOMException("请求超时，请稍后重试。", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", ...init, headers: requestHeaders, signal: combined });
    if (response.ok && response.status === 204) return null;
    let body;
    try { body = await response.json(); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    if (!response.ok) throw new ApiError(errorMessage(body, response.status), response.status);
    if (body === undefined || body === null) throw new Error("服务返回格式异常，请稍后重试。");
    return body;
  } catch (error) {
    // Preserve timeout versus cancellation even when the response body is still streaming.
    if (combined.aborted) throw combined.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
