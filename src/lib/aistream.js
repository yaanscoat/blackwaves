// talks to /api/ai/chat and /api/ai/rewrite, which answer as a stream of small
// events: t = text, r = thinking, m = which model answered, e = error
export async function streamAi(path, body, { signal, onEvent }) {
  const response = await fetch(path, {
    method: "POST",
    signal,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    const error = new Error(data?.error || `the ai didn't answer (${response.status})`);
    error.status = response.status;
    throw error;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      if (chunk.startsWith("data: ")) {
        try {
          onEvent(JSON.parse(chunk.slice(6)));
        } catch {}
      }
    }
  }
}
