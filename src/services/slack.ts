import fs from "fs";
import path from "path";
import OpenAI from "openai";

// ─── Token storage ────────────────────────────────────────────────────────────

const SLACK_TOKEN_PATH = path.resolve("./uploads/.slack-token.json");

interface SlackAuth {
  access_token: string;
  team: { id: string; name: string };
}

export function getSlackToken(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(SLACK_TOKEN_PATH, "utf8")) as SlackAuth;
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export function getSlackWorkspace(): { id: string; name: string } | null {
  try {
    const data = JSON.parse(fs.readFileSync(SLACK_TOKEN_PATH, "utf8")) as SlackAuth;
    return data.team ?? null;
  } catch {
    return null;
  }
}

export function saveSlackAuth(data: SlackAuth): void {
  fs.mkdirSync(path.dirname(SLACK_TOKEN_PATH), { recursive: true });
  fs.writeFileSync(SLACK_TOKEN_PATH, JSON.stringify(data, null, 2));
}

export function clearSlackAuth(): void {
  try { fs.unlinkSync(SLACK_TOKEN_PATH); } catch { /* already gone */ }
}

// ─── Channels ─────────────────────────────────────────────────────────────────

export async function listChannels(token: string): Promise<{ id: string; name: string }[]> {
  const resp = await fetch(
    "https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=200&exclude_archived=true",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await resp.json() as { ok: boolean; channels?: { id: string; name: string; is_archived?: boolean }[]; error?: string };
  if (!data.ok) throw new Error(`Slack conversations.list failed: ${data.error}`);
  return (data.channels ?? []).map(c => ({ id: c.id, name: c.name }));
}

// ─── File upload + post ───────────────────────────────────────────────────────

/**
 * Uploads a file to a Slack channel using the v2 upload API and posts an
 * initial comment alongside it.
 * Returns the Slack file ID.
 */
export async function uploadFileAndPost(
  token: string,
  channelId: string,
  filePath: string,
  message: string,
  filename: string,
): Promise<string> {
  const fileSize = fs.statSync(filePath).size;

  // Step 1 — get a presigned upload URL
  const urlResp = await fetch("https://slack.com/api/files.getUploadURLExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ filename, length: String(fileSize) }),
  });
  const urlData = await urlResp.json() as { ok: boolean; upload_url?: string; file_id?: string; error?: string };
  if (!urlData.ok || !urlData.upload_url || !urlData.file_id) {
    throw new Error(`Slack getUploadURLExternal failed: ${urlData.error ?? "unknown"}`);
  }

  // Step 2 — PUT the raw file bytes to the presigned URL
  const fileBuffer = fs.readFileSync(filePath);
  const putResp = await fetch(urlData.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: fileBuffer,
  });
  if (!putResp.ok) {
    throw new Error(`Slack file PUT failed: ${putResp.status} ${putResp.statusText}`);
  }

  // Step 3 — complete the upload and post to the channel
  const completeResp = await fetch("https://slack.com/api/files.completeUploadExternal", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      files: [{ id: urlData.file_id, title: filename }],
      channel_id: channelId,
      initial_comment: message,
    }),
  });
  const completeData = await completeResp.json() as { ok: boolean; files?: { id: string }[]; error?: string };
  if (!completeData.ok) {
    throw new Error(`Slack completeUploadExternal failed: ${completeData.error ?? "unknown"}`);
  }

  return completeData.files?.[0]?.id ?? urlData.file_id;
}

// ─── AI-generated share message ───────────────────────────────────────────────

export async function generateShareMessage(
  title: string,
  query: string,
  clipCount: number,
  type: "brief" | "podcast",
): Promise<string> {
  const apiKey = process.env.CHATGPT_API;
  if (!apiKey) return type === "brief" ? `New research brief: ${title}` : `New research podcast: ${title}`;

  const client = new OpenAI({ apiKey });

  const prompt = type === "brief"
    ? `Write a short Slack message (2-3 sentences, professional and engaging) announcing a UX research video brief titled "${title}". The research focused on: "${query}". It contains ${clipCount} video clip${clipCount !== 1 ? "s" : ""}. No hashtags or emoji.`
    : `Write a short Slack message (2-3 sentences, professional and engaging) announcing a UX research podcast episode titled "${title}". The podcast covers: "${query}". No hashtags or emoji.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 150,
      temperature: 0.7,
    });
    return response.choices[0]?.message?.content?.trim() ?? title;
  } catch {
    return type === "brief" ? `New research brief: ${title}` : `New research podcast: ${title}`;
  }
}
