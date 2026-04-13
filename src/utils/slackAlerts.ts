import { logJson } from "./structuredLogger.ts";

const DEFAULT_TIMEOUT_MS = 4_000;

function isEnabled() {
  return process.env.SLACK_ALERTS_ENABLED === "true";
}

function getWebhookUrl() {
  return process.env.SLACK_ALERT_WEBHOOK_URL?.trim() ?? "";
}

function getTimeoutMs() {
  const parsed = Number(process.env.SLACK_ALERT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

function truncate(value: string, max = 500) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...[truncated]`;
}

type SlackCriticalAlertInput = {
  title: string;
  requestId: string;
  endpoint: string;
  route: string;
  method: string;
  statusCode: number;
  feature: string;
  durationMs: number;
  dbLatencyMs: number;
  externalLatencyMs: number;
  errorCategory?: string;
  errorType?: string;
  errorMessage?: string;
  errorStack?: string;
  payloadPreview?: unknown;
};

export async function sendSlackCriticalAlert(input: SlackCriticalAlertInput) {
  if (!isEnabled()) return;
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    logJson("warn", {
      event: "slack_alert_skipped_missing_webhook",
      requestId: input.requestId,
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: truncate(input.title, 140),
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Endpoint:*\n${truncate(input.endpoint, 180)}` },
          { type: "mrkdwn", text: `*Status:*\n${input.statusCode}` },
          { type: "mrkdwn", text: `*Method:*\n${input.method}` },
          { type: "mrkdwn", text: `*Feature:*\n${input.feature}` },
          { type: "mrkdwn", text: `*Request ID:*\n${input.requestId}` },
          { type: "mrkdwn", text: `*Duration:*\n${input.durationMs.toFixed(2)}ms` },
          { type: "mrkdwn", text: `*DB latency:*\n${input.dbLatencyMs.toFixed(2)}ms` },
          { type: "mrkdwn", text: `*External latency:*\n${input.externalLatencyMs.toFixed(2)}ms` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `*Route:* ${truncate(input.route, 220)}`,
            `*Error category:* ${input.errorCategory ?? "unknown"}`,
            `*Error type:* ${input.errorType ?? "unknown"}`,
            `*Error message:* ${truncate(input.errorMessage ?? "unknown", 500)}`,
          ].join("\n"),
        },
      },
    ] as Array<Record<string, unknown>>;

    if (input.errorStack) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Stack (truncated):*\n\`\`\`${truncate(input.errorStack, 900)}\`\`\``,
        },
      });
    }

    if (input.payloadPreview) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Sanitized payload:*\n\`\`\`${truncate(JSON.stringify(input.payloadPreview), 900)}\`\`\``,
        },
      });
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${input.title} (${input.statusCode})`,
        blocks,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logJson("error", {
        event: "slack_alert_failed",
        requestId: input.requestId,
        statusCode: response.status,
        message: truncate(body, 300),
      });
      return;
    }

    logJson("info", {
      event: "slack_alert_sent",
      requestId: input.requestId,
      endpoint: input.endpoint,
    });
  } catch (error) {
    logJson("error", {
      event: "slack_alert_failed",
      requestId: input.requestId,
      message: error instanceof Error ? error.message : "Unknown Slack alert error",
    });
  } finally {
    clearTimeout(timeout);
  }
}
