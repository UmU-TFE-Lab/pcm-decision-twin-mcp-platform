export const MCP_GATEWAY_URL = (
  import.meta.env.VITE_MCP_GATEWAY_URL || "http://127.0.0.1:8787"
).replace(/\/$/, "");

async function fetchJson(path, options = {}) {
  const response = await fetch(`${MCP_GATEWAY_URL}${path}`, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.detail || `MCP Gateway request failed (${response.status}).`);
  }
  return response.json();
}

export async function checkMcpGateway(signal) {
  const health = await fetchJson("/health", { signal });
  const capabilities = await fetchJson("/api/v1/mcp/capabilities", { signal });
  return { ...health, ...capabilities };
}

export async function startAgentRun(payload, signal) {
  return fetchJson("/api/v1/agent/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

export async function cancelAgentRun(runId) {
  return fetchJson(`/api/v1/agent/runs/${runId}/cancel`, { method: "POST" });
}

export async function runAgentWorkflowViaGateway(payload, { onUpdate, signal } = {}) {
  const run = await startAgentRun(payload, signal);
  return new Promise((resolve, reject) => {
    const source = new EventSource(`${MCP_GATEWAY_URL}/api/v1/agent/runs/${run.id}/events`);
    let settled = false;

    const cleanup = () => {
      source.close();
      signal?.removeEventListener("abort", handleAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const handlePayload = (event) => {
      const state = JSON.parse(event.data);
      onUpdate?.(state);
      if (state.status === "completed") finish(resolve, state);
      else if (state.status === "failed") finish(reject, new Error(state.error || "MCP Gateway workflow failed."));
      else if (state.status === "cancelled") finish(reject, new DOMException("Workflow cancelled.", "AbortError"));
    };
    const handleAbort = () => {
      cancelAgentRun(run.id).catch(() => {});
      finish(reject, new DOMException("Workflow cancelled.", "AbortError"));
    };

    for (const eventName of ["snapshot", "update", "completed", "failed", "cancelled"]) {
      source.addEventListener(eventName, handlePayload);
    }
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        finish(reject, new Error("MCP Gateway event stream closed before completion."));
      }
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}
