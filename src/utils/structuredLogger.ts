type JsonLogLevel = "info" | "warn" | "error";

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ message: "Failed to stringify log payload" });
  }
}

export function logJson(level: JsonLogLevel, payload: Record<string, unknown>) {
  const base = {
    level,
    timestamp: new Date().toISOString(),
    service: "DevEnvBackend",
    ...payload,
  };
  const line = safeStringify(base);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

