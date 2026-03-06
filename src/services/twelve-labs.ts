import { TwelveLabs } from "twelvelabs-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { GestureMatch } from "../types.js";

// ─── Video index cache (prevents re-uploading to TL) ─────────────────────────

interface VideoCacheEntry {
  indexId: string;
  videoId: string;
  hlsUrl: string | null;
}

const VIDEO_CACHE_PATH = path.resolve(process.env.UPLOADS_DIR ?? "./uploads", ".video-cache.json");
const videoCache = new Map<string, VideoCacheEntry>(); // `${indexId}:${sha256hex}` → entry

function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk as Buffer));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

(function loadVideoCache() {
  try {
    const obj = JSON.parse(fs.readFileSync(VIDEO_CACHE_PATH, "utf8")) as Record<string, VideoCacheEntry>;
    for (const [k, v] of Object.entries(obj)) videoCache.set(k, v);
    console.log(`[TL cache] Loaded ${videoCache.size} cached video(s)`);
  } catch { /* no cache yet */ }
})();

function saveVideoCache() {
  fs.mkdirSync(path.dirname(VIDEO_CACHE_PATH), { recursive: true });
  fs.writeFileSync(VIDEO_CACHE_PATH, JSON.stringify(Object.fromEntries(videoCache), null, 2));
}

export async function clearVideoCache(indexId: string, videoPath: string): Promise<void> {
  const fileHash = await computeFileHash(videoPath);
  const key = `${indexId}:${fileHash}`;
  if (videoCache.delete(key)) {
    saveVideoCache();
    console.log(`[TL cache] Cleared cache for ${path.basename(videoPath)}`);
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient(): TwelveLabs {
  const apiKey = process.env.TWELVE_LABS_API;
  if (!apiKey) throw new Error("TWELVE_LABS_API env var is not set");
  return new TwelveLabs({ apiKey });
}

// ─── Index management ─────────────────────────────────────────────────────────

export async function ensureIndex(indexName: string): Promise<string> {
  const client = getClient();
  const page = await client.indexes.list({ indexName });
  for await (const idx of page) {
    if (idx.indexName === indexName && idx.id) {
      console.log(`[TL] Reusing index "${indexName}" → ${idx.id}`);
      return idx.id;
    }
  }
  console.log(`[TL] Creating index "${indexName}"...`);
  const created = await client.indexes.create({
    indexName,
    // marengo3.0: visual search | pegasus1.1: text generation (transcripts, descriptions)
    models: [
      { modelName: "marengo3.0", modelOptions: ["visual", "audio"] },
      { modelName: "pegasus1.1", modelOptions: ["visual", "audio"] },
    ],
    addons: ["thumbnail"],
  });
  if (!created.id) throw new Error("TL index creation returned no id");
  console.log(`[TL] Index created → ${created.id}`);
  return created.id;
}

// ─── Video upload ─────────────────────────────────────────────────────────────

export interface UploadResult {
  videoId: string;
  /** HLS stream URL for the entire indexed video. Null if TL did not generate one. */
  hlsUrl: string | null;
}

/**
 * Uploads a local video file to the given index and waits until indexing is
 * complete. Returns the videoId and the HLS stream URL (for browser preview).
 */
export async function uploadVideo(
  indexId: string,
  videoPath: string
): Promise<UploadResult> {
  const fileHash = await computeFileHash(videoPath);
  const cacheKey = `${indexId}:${fileHash}`;
  const cached = videoCache.get(cacheKey);
  if (cached) {
    console.log(`[TL cache] Reusing indexed video ${cached.videoId} (hash match) — skipping upload`);
    return { videoId: cached.videoId, hlsUrl: cached.hlsUrl };
  }

  const client = getClient();

  console.log(`[TL] Uploading "${videoPath}" → index ${indexId}...`);
  const task = await client.tasks.create({
    indexId,
    videoFile: fs.createReadStream(videoPath),
    enableVideoStream: true,
  });
  if (!task.id) throw new Error("TL task creation returned no id");
  console.log(`[TL] Task created: ${task.id} — waiting for indexing...`);

  const done = await client.tasks.waitForDone(task.id, {
    sleepInterval: 8,
    callback: (t) => {
      process.stdout.write(`\r[TL] Status: ${t.status}          `);
    },
  });
  process.stdout.write("\n");

  const videoId = done.videoId;
  if (!videoId) {
    throw new Error(
      `TL task ${task.id} finished but returned no videoId (status: ${done.status})`
    );
  }

  let hlsUrl: string | null = null;
  try {
    const video = await client.indexes.videos.retrieve(indexId, videoId);
    hlsUrl = video.hls?.videoUrl ?? null;
  } catch {
    // non-fatal — HLS may not be ready yet
  }

  console.log(`[TL] Indexed video ID: ${videoId}`);
  if (hlsUrl) console.log(`[TL] HLS stream:       ${hlsUrl}`);

  videoCache.set(cacheKey, { indexId, videoId, hlsUrl });
  saveVideoCache();

  return { videoId, hlsUrl };
}

// ─── Gesture search ───────────────────────────────────────────────────────────

export interface TLSearchOptions {
  videoId?: string;
  maxResults?: number;
  confidenceFilter?: string[];
}

/**
 * Searches an index for moments matching `query`.
 * Returns matches with per-match thumbnailUrl where available.
 */
export async function searchGestures(
  indexId: string,
  query: string,
  opts: TLSearchOptions = {}
): Promise<GestureMatch[]> {
  const client = getClient();
  const { videoId, maxResults = 10, confidenceFilter } = opts;

  console.log(`[TL] Searching index ${indexId} for: "${query}"`);

  const page = await client.search.query({
    indexId,
    queryText: query,
    searchOptions: ["visual"],
    pageLimit: 50,
    ...(videoId ? { filter: JSON.stringify({ id: [videoId] }) } : {}),
  });

  const matches: GestureMatch[] = [];

  for await (const item of page) {
    if (item.start == null || item.end == null) continue;
    if (
      confidenceFilter &&
      item.confidence != null &&
      !confidenceFilter.includes(item.confidence)
    )
      continue;

    // marengo3.0 returns rank (lower = more relevant); older models return score
    const score =
      item.score != null
        ? item.score
        : item.rank != null
        ? 1 / item.rank
        : 0;

    matches.push({
      videoId: item.videoId ?? videoId ?? "",
      score,
      confidence: item.confidence ?? "unknown",
      start: item.start,
      end: item.end,
      gestureTimestamp: (item.start + item.end) / 2,
      thumbnailUrl: item.thumbnailUrl ?? undefined,
    });

    if (matches.length >= maxResults) break;
  }

  console.log(
    `[TL] Found ${matches.length} match(es) — scores: ${
      matches.map((m) => m.score.toFixed(2)).join(", ") || "none"
    }`
  );
  return matches;
}

// ─── Visual description ───────────────────────────────────────────────────────

/**
 * Asks Twelve Labs to describe what is visually happening in a video at a specific
 * time range. Used to ground narration in actual clip content.
 * Returns empty string on failure (non-fatal).
 */
export async function describeClipAtTimestamp(
  videoId: string,
  startSec: number,
  endSec: number,
  gestureQuery: string
): Promise<string> {
  const apiKey = process.env.TWELVE_LABS_API;
  if (!apiKey) return "";

  const startFmt = formatSeconds(startSec);
  const endFmt = formatSeconds(endSec);

  try {
    const response = await fetch("https://api.twelvelabs.io/v1.3/generate", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        video_id: videoId,
        prompt: `Describe in 2-3 sentences exactly what is visually happening in this video between ${startFmt} and ${endFmt}. The moment we are looking for is: "${gestureQuery}". Be specific about actions, movements, objects, and people visible on screen.`,
      }),
    });

    if (!response.ok) {
      console.warn(`[TL] Visual description failed (${response.status}) for video ${videoId}`);
      return "";
    }

    const data = (await response.json()) as { data?: string; text?: string };
    const text = (data.data ?? data.text ?? "").trim();
    console.log(`[TL] Visual description retrieved for ${videoId} at ${startFmt}-${endFmt}`);
    return text;
  } catch (err) {
    console.warn(`[TL] Visual description error for ${videoId}:`, (err as Error).message);
    return "";
  }
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Transcript generation ────────────────────────────────────────────────────

/**
 * Requests a spoken-word transcript of an indexed video from Twelve Labs
 * using the Pegasus generate endpoint.
 *
 * Returns null on failure so the caller can fall back to Whisper.
 * Requires the index to have been created with pegasus1.1.
 */
export async function getVideoTranscript(videoId: string): Promise<string | null> {
  const apiKey = process.env.TWELVE_LABS_API;
  if (!apiKey) return null;

  try {
    const response = await fetch("https://api.twelvelabs.io/v1.3/generate", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        video_id: videoId,
        prompt: "Transcribe all spoken words in this video exactly as heard.",
      }),
    });

    if (!response.ok) {
      console.warn(`[TL] Transcript request failed (${response.status}) for video ${videoId} — will fall back to Whisper`);
      return null;
    }

    const data = (await response.json()) as { data?: string; text?: string };
    const text = (data.data ?? data.text ?? "").trim();
    console.log(`[TL] Transcript retrieved for ${videoId} (${text.length} chars)`);
    return text || null;
  } catch (err) {
    console.warn(`[TL] Transcript error for ${videoId}:`, (err as Error).message);
    return null;
  }
}

// ─── Cache access ─────────────────────────────────────────────────────────────

/**
 * Returns all locally-cached TL video entries (videos previously uploaded and indexed).
 * Each entry includes the file's SHA-256 hash so the server can join against the file index.
 */
export function getAllIndexedVideos(): Array<{
  fileHash: string;
  indexId: string;
  videoId: string;
  hlsUrl: string | null;
}> {
  return Array.from(videoCache.entries()).map(([key, entry]) => {
    const colonIdx = key.indexOf(":");
    const fileHash = key.slice(colonIdx + 1);
    return { fileHash, indexId: entry.indexId, videoId: entry.videoId, hlsUrl: entry.hlsUrl };
  });
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export async function deleteVideo(indexId: string, videoId: string): Promise<void> {
  const client = getClient();
  await client.indexes.videos.delete(indexId, videoId);
  console.log(`[TL] Deleted video ${videoId} from index ${indexId}`);
}
