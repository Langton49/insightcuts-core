import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID, createHash } from "crypto";
import { fileURLToPath } from "url";

const __serverDir = path.dirname(fileURLToPath(import.meta.url));

// ─── Background track catalogue (matches client MusicPanel TRACKS) ────────────

const BACKGROUND_TRACKS_DIR = path.resolve(__serverDir, "../client/src/audios/background");

const BACKGROUND_TRACK_FILES: Record<string, string> = {
  bg1: "audiocoffee-innovative-technology-242948.mp3",
  bg2: "denis-pavlov-music-bossa-nova-jazz-piano-summer-cafe-podcast-music-398166.mp3",
  bg3: "evgeniach-innovative-306122.mp3",
  bg4: "hitslab-bossa-nova-bossa-nova-cafe-music-457829.mp3",
  bg5: "ivan_luzan-innovative-146729.mp3",
  bg6: "megisss-innovative-world-2-464248.mp3",
  bg7: "music_for_videos-jazz-bossa-nova-163669.mp3",
  bg8: "paulyudin-innovative-corporate-technology-317820.mp3",
  bg9: "pumpupthemind-tech-innovative-403426.mp3",
};

function resolveBackgroundTrackPath(trackId: string): string | undefined {
  const fileName = BACKGROUND_TRACK_FILES[trackId];
  if (!fileName) return undefined;
  const fullPath = path.join(BACKGROUND_TRACKS_DIR, fileName);
  return fs.existsSync(fullPath) ? fullPath : undefined;
}

const PODCAST_INTRO_OUTRO_PATH = path.join(
  __serverDir,
  "audios/podcast_intro_outro/hitslab-bossa-nova-bossa-nova-cafe-music-457829.mp3",
);

import { runDetection, runAssembly } from "./pipeline.js";
import { searchGestures, getAllIndexedVideos } from "./services/twelve-labs.js";
import { extractText } from "./services/document-extractor.js";
import { extractInsights, generateClipNarration, generatePodcastScript, refineScript, refineInsight, generateEmailSummary } from "./services/openai.js";
import { sendEmail, buildEmailHtml } from "./services/email.js";
import { generateAudio } from "./services/elevenlabs.js";
import { addPodcastIntroOutro } from "./services/ffmpeg.js";
import { getSlackToken, getSlackWorkspace, saveSlackAuth, clearSlackAuth, listChannels, uploadFileAndPost, generateShareMessage } from "./services/slack.js";
import type { PipelineConfig, DetectionResult, AssemblyResult, ExtractedInsight } from "./types.js";

// ─── Setup ────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT ?? 3001);
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR ?? "./uploads");
const OUTPUT_DIR  = path.resolve(process.env.OUTPUT_DIR  ?? "./output");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR,  { recursive: true });

// Serve uploaded files directly — Express static handles Range/206 automatically.
app.use('/api/uploads', express.static(UPLOADS_DIR));

// ─── File dedup index (SHA-256 → upload entry) ────────────────────────────────

interface FileEntry {
  fileId: string;
  filePath: string;
  originalName: string;
  size: number;
}

const FILE_INDEX_PATH = path.join(UPLOADS_DIR, ".file-index.json");
const fileIndex = new Map<string, FileEntry>();

(function loadFileIndex() {
  try {
    const obj = JSON.parse(fs.readFileSync(FILE_INDEX_PATH, "utf8")) as Record<string, FileEntry>;
    for (const [hash, entry] of Object.entries(obj)) fileIndex.set(hash, entry);
    console.log(`[dedup] Loaded ${fileIndex.size} file(s) from index`);
  } catch { /* no index yet */ }
})();

function saveFileIndex() {
  fs.writeFileSync(FILE_INDEX_PATH, JSON.stringify(Object.fromEntries(fileIndex), null, 2));
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// ─── Multer ───────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (_req, file, cb) => {
    cb(null, `${randomUUID()}${path.extname(file.originalname)}`);
  },
});
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 2048) * 1024 * 1024;
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES } });

// ─── Job store ────────────────────────────────────────────────────────────────

type JobStatus = "detecting" | "review" | "assembling" | "complete" | "error";

interface Job {
  id: string;
  status: JobStatus;
  startedAt: string;
  config: PipelineConfig;
  detection?: DetectionResult;
  assembly?: AssemblyResult;
  error?: string;
  /** Path to podcast.mp3 rendered standalone (outside of assembly) */
  standalonePodcastPath?: string;
}

const jobs = new Map<string, Job>();

// ─── Job persistence ──────────────────────────────────────────────────────────

const JOBS_DIR = path.join(OUTPUT_DIR, "_jobs");
fs.mkdirSync(JOBS_DIR, { recursive: true });

function saveJob(job: Job): void {
  try {
    fs.writeFileSync(path.join(JOBS_DIR, `${job.id}.json`), JSON.stringify(job, null, 2));
  } catch (err) {
    console.warn(`[jobs] Failed to persist job ${job.id}:`, (err as Error).message);
  }
}

(function loadJobs() {
  try {
    const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, file), "utf8")) as Job;
        // Any job that was mid-flight when the server died is unrecoverable — mark as error
        if (job.status === "detecting" || job.status === "assembling") {
          job.status = "error";
          job.error = "Server restarted while processing";
          fs.writeFileSync(path.join(JOBS_DIR, file), JSON.stringify(job, null, 2));
        }
        jobs.set(job.id, job);
      } catch { /* skip corrupted entries */ }
    }
    if (jobs.size) console.log(`[jobs] Restored ${jobs.size} job(s) from disk`);
  } catch { /* no jobs yet */ }
})();

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/upload
 * Accepts a multipart video file, returns { fileId, filePath, originalName, size }.
 */
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded — use field name 'file'" });
    return;
  }

  const hash = sha256(req.file.path);
  const existing = fileIndex.get(hash);

  if (existing && fs.existsSync(existing.filePath)) {
    fs.unlinkSync(req.file.path);
    console.log(`[dedup] Duplicate upload (${hash.slice(0, 8)}…) → reusing ${existing.fileId}`);
    res.json({ ...existing, duplicate: true });
    return;
  }

  const docMimes = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ]);
  const fileType = docMimes.has(req.file.mimetype) ? "document" : "video";

  const entry: FileEntry = {
    fileId: path.basename(req.file.filename, path.extname(req.file.filename)),
    filePath: req.file.path,
    originalName: req.file.originalname,
    size: req.file.size,
  };
  fileIndex.set(hash, entry);
  saveFileIndex();

  res.json({ ...entry, fileType });
});

/**
 * GET /api/indexed-videos
 * Returns videos that have been previously uploaded AND indexed in Twelve Labs,
 * and whose local file still exists on disk. These can be re-used without re-uploading.
 */
app.get("/api/indexed-videos", (_req, res) => {
  const cached = getAllIndexedVideos();
  const result: Array<{
    fileId: string;
    filePath: string;
    originalName: string;
    size: number;
    videoId: string;
    hlsUrl: string | null;
    indexId: string;
    thumbnailUrl: string;
  }> = [];

  for (const { fileHash, indexId, videoId, hlsUrl } of cached) {
    const entry = fileIndex.get(fileHash);
    if (!entry) continue;
    if (!fs.existsSync(entry.filePath)) continue;
    result.push({
      fileId: entry.fileId,
      filePath: entry.filePath,
      originalName: entry.originalName,
      size: entry.size,
      videoId,
      hlsUrl,
      indexId,
      thumbnailUrl: `/api/uploads/${path.basename(entry.filePath)}`,
    });
  }

  res.json({ videos: result });
});

/**
 * POST /api/run
 * Starts the detection phase (TL index + upload + search).
 * Job moves to "review" when done; client can then call /api/jobs/:id/assemble.
 *
 * Body: { filePath, gestureQuery, indexName?, clipBefore?, clipAfter?,
 *         maxClips?, title?, subtitle?, confidenceFilter?,
 *         documentPaths?: string[], generateNarration?: boolean, generatePodcast?: boolean }
 */
app.post("/api/run", (req, res) => {
  const { filePath, gestureQuery, existingVideoId, existingIndexId, existingHlsUrl } = req.body;

  if (!filePath || !gestureQuery) {
    res.status(400).json({ error: "filePath and gestureQuery are required" });
    return;
  }
  if (!fs.existsSync(filePath)) {
    res.status(400).json({ error: `File not found: ${filePath}` });
    return;
  }

  // Validate any provided document paths
  const documentPaths: string[] | undefined = req.body.documentPaths;
  if (documentPaths) {
    for (const docPath of documentPaths) {
      if (!fs.existsSync(docPath)) {
        res.status(400).json({ error: `Document not found: ${docPath}` });
        return;
      }
    }
  }

  const jobId = randomUUID();
  const config: PipelineConfig = {
    videoPath:          filePath,
    sourceFileName:     req.file?.originalname,
    gestureQuery,
    indexName:          req.body.indexName,
    clipBefore:         req.body.clipBefore,
    clipAfter:          req.body.clipAfter,
    maxClips:           req.body.maxClips,
    outputDir:          path.join(OUTPUT_DIR, jobId),
    title:              req.body.title,
    subtitle:           req.body.subtitle,
    confidenceFilter:   req.body.confidenceFilter,
    documentPaths,
    generateNarration:  req.body.generateNarration,
    generatePodcast:    req.body.generatePodcast,
    existingVideoId,
    existingIndexId,
    existingHlsUrl,
  };

  const job: Job = { id: jobId, status: "detecting", startedAt: new Date().toISOString(), config };
  jobs.set(jobId, job);

  console.log(`[server] Job ${jobId} — detecting: "${gestureQuery}"`);

  runDetection(config)
    .then((detection) => {
      job.detection = detection;
      job.status = "review";
      saveJob(job);
      console.log(`[server] Job ${jobId} — ready for review (${detection.matches.length} matches)`);
    })
    .catch((err: Error) => {
      job.status = "error";
      job.error = err.message;
      saveJob(job);
      console.error(`[server] Job ${jobId} — detection failed:`, err.message);
    });

  res.status(202).json({ jobId });
});

/**
 * POST /api/extract-insights
 * Extracts key research findings from uploaded documents using GPT-4o.
 * Call this in parallel with detection so insights are ready by review time.
 * Body: { documentPaths: string[] }
 */
app.post("/api/extract-insights", async (req, res) => {
  const { documentPaths } = req.body as { documentPaths?: string[] };
  if (!documentPaths?.length) {
    res.status(400).json({ error: "documentPaths is required" });
    return;
  }

  const allInsights: ExtractedInsight[] = [];

  for (const docPath of documentPaths) {
    if (!fs.existsSync(docPath)) {
      console.warn(`[insights] File not found: ${docPath}`);
      continue;
    }
    try {
      const text = await extractText(docPath);
      const sourceLabel = path.basename(docPath);
      console.log(`[insights] Extracting from "${sourceLabel}" (${text.length} chars)...`);
      const insights = await extractInsights(text, sourceLabel);
      console.log(`[insights] Got ${insights.length} insight(s) from "${sourceLabel}"`);
      allInsights.push(...insights);
    } catch (err) {
      console.warn(`[insights] Failed for ${path.basename(docPath)}:`, (err as Error).message);
    }
  }

  res.json({ insights: allInsights });
});

/**
 * POST /api/jobs/:id/assemble
 * Triggers FFmpeg assembly for a job in "review" status.
 * Body: { selectedIndices?: number[], clipBoundaries?, clipInsights? }
 */
app.post("/api/jobs/:id/assemble", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" }); return;
  }
  if (job.status !== "review") {
    res.status(409).json({ error: `Job is "${job.status}", must be "review" to assemble` }); return;
  }
  if (!job.detection) {
    res.status(409).json({ error: "Detection result missing" }); return;
  }

  const {
    selectedIndices,
    clipBoundaries,
    clipInsights,
    generateNarration,
    generatePodcast,
    narrationVoice,
    globalLayout,
    clipLayouts,
    narrationScripts,
    backgroundTrackId,
  } = req.body as {
    selectedIndices?: number[];
    clipBoundaries?: Record<string, { start: number; end: number }>;
    /** Maps original match index (as string key) → array of insight texts */
    clipInsights?: Record<string, string[]>;
    generateNarration?: boolean;
    generatePodcast?: boolean;
    narrationVoice?: string;
    globalLayout?: string;
    clipLayouts?: Record<string, string>;
    /** Pre-generated narration scripts from the Narration Panel: index (string) → script */
    narrationScripts?: Record<string, string>;
    /** Track ID from MusicPanel — resolved to an absolute file path for FFmpeg */
    backgroundTrackId?: string;
  };

  // JSON keys are always strings; convert to numbers for pipeline lookup
  const normalizedBoundaries = clipBoundaries
    ? Object.fromEntries(Object.entries(clipBoundaries).map(([k, v]) => [Number(k), v]))
    : undefined;

  const normalizedInsights = clipInsights
    ? Object.fromEntries(Object.entries(clipInsights).map(([k, v]) => [Number(k), v]))
    : undefined;

  if (normalizedInsights) {
    job.config = { ...job.config, clipInsights: normalizedInsights };
  }

  // Allow the assemble call to override narration/podcast flags from the original run config
  if (generateNarration !== undefined) job.config = { ...job.config, generateNarration };
  if (generatePodcast    !== undefined) job.config = { ...job.config, generatePodcast };
  if (narrationVoice    !== undefined) job.config = { ...job.config, narrationVoice };
  if (globalLayout      !== undefined) job.config = { ...job.config, globalLayout };

  if (clipLayouts !== undefined) {
    const normalizedLayouts = Object.fromEntries(
      Object.entries(clipLayouts).map(([k, v]) => [Number(k), v])
    );
    job.config = { ...job.config, clipLayouts: normalizedLayouts };
  }

  if (narrationScripts !== undefined) {
    const normalizedNarrationScripts = Object.fromEntries(
      Object.entries(narrationScripts).map(([k, v]) => [Number(k), v])
    );
    job.config = { ...job.config, clipNarrationScripts: normalizedNarrationScripts };
  }

  if (backgroundTrackId !== undefined) {
    const musicPath = resolveBackgroundTrackPath(backgroundTrackId);
    if (musicPath) {
      job.config = { ...job.config, backgroundMusicPath: musicPath };
      console.log(`[server] Background track "${backgroundTrackId}" → ${path.basename(musicPath)}`);
    } else {
      console.warn(`[server] Unknown or missing background track: "${backgroundTrackId}"`);
    }
  }

  job.status = "assembling";
  saveJob(job);

  console.log(
    `[server] Job ${req.params.id} — assembling ${
      selectedIndices ? `${selectedIndices.length} selected` : "all"
    } clip(s)`
  );

  runAssembly(job.config, job.detection, { selectedIndices, clipBoundaries: normalizedBoundaries })
    .then((assembly) => {
      job.assembly = assembly;
      job.status = "complete";
      saveJob(job);
      console.log(`[server] Job ${req.params.id} — complete: ${assembly.briefPath}`);
    })
    .catch((err: Error) => {
      job.status = "error";
      job.error = err.message;
      saveJob(job);
      console.error(`[server] Job ${req.params.id} — assembly failed:`, err.message);
    });

  res.status(202).json({ jobId: job.id });
});

/**
 * GET /api/jobs/:id
 * Returns the full job state including detection (HLS URL + matches) and assembly result.
 * Also computes `sourceDuration` and `editorClips[]` for the frontend timeline editor.
 */
app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const detection = job.detection;
  const clipBefore = job.config.clipBefore ?? 10;
  const clipAfter  = job.config.clipAfter  ?? 10;

  const editorClips = detection
    ? detection.matches.map((m, i) => {
        const start    = Math.max(0, m.gestureTimestamp - clipBefore);
        const end      = Math.min(detection.sourceDuration, m.gestureTimestamp + clipAfter);
        return {
          index:        i,
          sceneLabel:   `Scene ${i + 1}`,
          start,
          duration:     Math.max(0.1, end - start),
          confidence:   m.confidence,
          thumbnailUrl: m.thumbnailUrl,
          selected:     true,
        };
      })
    : null;

  const sourceVideoUrl = `/api/uploads/${path.basename(job.config.videoPath)}`;
  res.json({ ...job, sourceDuration: detection?.sourceDuration ?? null, editorClips, sourceVideoUrl });
});

/**
 * GET /api/output/:jobId/source
 * Redirects to /api/uploads/:filename — express.static handles Range/206 correctly.
 */
app.get("/api/output/:jobId/source", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    console.error(`[source] Job ${req.params.jobId} not found. Known jobs: ${[...jobs.keys()].slice(0, 5).join(', ')}`);
    res.status(404).json({ error: "Job not found" }); return;
  }
  const videoPath = job.config.videoPath;
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error(`[source] videoPath not found: ${videoPath}`);
    res.status(404).json({ error: "Source file not on disk" }); return;
  }
  const filename = path.basename(videoPath);
  console.log(`[source] Redirecting to /api/uploads/${filename}`);
  res.redirect(302, `/api/uploads/${encodeURIComponent(filename)}`);
});

/**
 * GET /api/output/:jobId/brief.mp4
 * Streams the assembled brief video.
 */
app.get("/api/output/:jobId/brief.mp4", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "complete" || !job.assembly?.briefPath) {
    res.status(409).json({ error: `Job is "${job.status}"` }); return;
  }
  if (!fs.existsSync(job.assembly.briefPath)) {
    res.status(404).json({ error: "Brief file not on disk" }); return;
  }
  res.sendFile(job.assembly.briefPath);
});

/**
 * GET /api/output/:jobId/podcast.mp3
 * Streams the generated podcast audio.
 */
app.get("/api/output/:jobId/podcast.mp3", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  // Accept both: podcast generated during assembly OR via standalone /podcast/render
  const podcastPath = job.assembly?.podcastPath ?? job.standalonePodcastPath;
  if (!podcastPath) {
    res.status(404).json({ error: "No podcast has been generated for this job" }); return;
  }
  if (!fs.existsSync(podcastPath)) {
    res.status(404).json({ error: "Podcast file not on disk" }); return;
  }
  res.setHeader("Content-Type", "audio/mpeg");
  res.sendFile(podcastPath);
});

/**
 * GET /api/output/:jobId/clips/:index
 * Streams an individual extracted clip by index.
 */
app.get("/api/output/:jobId/clips/:index", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== "complete" || !job.assembly) {
    res.status(409).json({ error: "Job not complete or no assembly" }); return;
  }
  const idx = parseInt(req.params.index, 10);
  const clip = job.assembly.clips?.[idx];
  if (!clip || !clip.overlaidPath) { res.status(404).json({ error: "Clip not found" }); return; }
  if (!fs.existsSync(clip.overlaidPath)) { res.status(404).json({ error: "Clip file not on disk" }); return; }
  res.sendFile(clip.overlaidPath);
});

/**
 * POST /api/jobs/:id/search
 * Searches the already-indexed Twelve Labs video with a new natural-language query.
 * Job must be in "review" or later status (index and video must exist).
 * Body: { query: string }
 */
app.post("/api/jobs/:id/search", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.detection) {
    res.status(404).json({ error: "Job not found or detection not complete" }); return;
  }
  const { query } = req.body as { query?: string };
  if (!query?.trim()) {
    res.status(400).json({ error: "query is required" }); return;
  }
  try {
    const { indexId, videoId } = job.detection;
    const clipBefore = job.config.clipBefore ?? 10;
    const clipAfter  = job.config.clipAfter  ?? 10;
    const matches = await searchGestures(indexId, query, { videoId, maxResults: 30 });
    const results = matches.map(m => ({
      tempId:       randomUUID(),
      start:        Math.max(0, m.gestureTimestamp - clipBefore),
      duration:     clipBefore + clipAfter,
      confidence:   m.confidence,
      thumbnailUrl: m.thumbnailUrl,
    }));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/jobs/:id/narration/script
 * Generates narration scripts for all clips — no prior assembly required.
 */
app.post("/api/jobs/:id/narration/script", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.detection) {
    res.status(404).json({ error: "Job not found or detection not complete" }); return;
  }
  try {
    const clipBefore = job.config.clipBefore ?? 10;
    const clipAfter  = job.config.clipAfter  ?? 10;
    const selectedIndices: number[] | undefined = req.body?.selectedIndices;
    const bodyInsights: Record<string, string[]> | undefined = req.body?.clipInsights;
    const bodyBoundaries: Record<string, { start: number; end: number }> | undefined = req.body?.clipBoundaries;
    const insightsMap = bodyInsights ?? job.config.clipInsights;

    // Normalize boundary keys to numbers
    const boundariesMap: Record<number, { start: number; end: number }> | undefined = bodyBoundaries
      ? Object.fromEntries(Object.entries(bodyBoundaries).map(([k, v]) => [Number(k), v]))
      : undefined;

    // Partition selected indices: known detection matches vs extra clips from Find Clips
    const knownIndices = selectedIndices && selectedIndices.length > 0
      ? selectedIndices.filter(i => i < job.detection!.matches.length)
      : job.detection.matches.map((_, i) => i);

    const extraIndices = selectedIndices
      ? selectedIndices.filter(i => i >= job.detection!.matches.length && boundariesMap?.[i] !== undefined)
      : [];

    // Build a unified ordered list: { index, gestureTimestamp, clipDuration, confidence }
    type ClipEntry = { index: number; gestureTimestamp: number; clipDuration: number; confidence: string };
    const entries: ClipEntry[] = [
      ...knownIndices.map(i => {
        const match = job.detection!.matches[i];
        return { index: i, gestureTimestamp: match.gestureTimestamp, clipDuration: clipBefore + clipAfter, confidence: match.confidence };
      }),
      ...extraIndices.map(i => {
        const b = boundariesMap![i];
        return { index: i, gestureTimestamp: (b.start + b.end) / 2, clipDuration: b.end - b.start, confidence: "medium" };
      }),
    ].sort((a, b) => a.gestureTimestamp - b.gestureTimestamp);

    const totalClips = entries.length;
    const scripts = [];

    for (let pos = 0; pos < entries.length; pos++) {
      const { index: i, gestureTimestamp, clipDuration, confidence } = entries[pos];
      const linkedInsights = insightsMap?.[i] ?? [];
      const script = await generateClipNarration({
        gestureQuery:     job.config.gestureQuery,
        clipIndex:        pos,
        totalClips,
        gestureTimestamp,
        clipDuration,
        confidence,
        documentText:     "",
        linkedInsights:   linkedInsights.length > 0 ? linkedInsights : undefined,
      });

      scripts.push({ clipIndex: i, sceneLabel: `Scene ${i + 1}`, script });
    }

    res.json({ scripts });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/jobs/:id/narration/refine
 * Rewrites a single narration script based on a user instruction.
 * Body: { script: string, instruction: string }
 * Returns: { script: string }
 */
app.post("/api/jobs/:id/narration/refine", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.detection) {
    res.status(404).json({ error: "Job not found or detection not complete" }); return;
  }
  const { script, instruction } = req.body as { script?: string; instruction?: string };
  if (!script?.trim() || !instruction?.trim()) {
    res.status(400).json({ error: "script and instruction are required" }); return;
  }
  try {
    const refined = await refineScript(script, instruction);
    res.json({ script: refined });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/jobs/:id/podcast/render
 * Renders a podcast script to audio via ElevenLabs and saves it to the job output dir.
 * This is a standalone action — no full assembly required.
 * Body: { script: string, voice?: string }
 * Returns: { podcastUrl: string }
 */
app.post("/api/jobs/:id/podcast/render", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.detection) {
    res.status(404).json({ error: "Job not found or detection not complete" }); return;
  }
  const { script, voice } = req.body as { script?: string; voice?: string };
  if (!script?.trim()) {
    res.status(400).json({ error: "script is required" }); return;
  }
  try {
    const outputDir = path.join(OUTPUT_DIR, job.id);
    fs.mkdirSync(outputDir, { recursive: true });
    const podcastPath = path.join(outputDir, "podcast.mp3");
    await generateAudio(script, podcastPath, voice);

    if (fs.existsSync(PODCAST_INTRO_OUTRO_PATH)) {
      const withMusicPath = path.join(outputDir, "podcast_music.mp3");
      try {
        await addPodcastIntroOutro(podcastPath, PODCAST_INTRO_OUTRO_PATH, withMusicPath);
        fs.renameSync(withMusicPath, podcastPath);
      } catch (err) {
        console.warn(`[server] Podcast intro/outro failed:`, (err as Error).message);
        if (fs.existsSync(withMusicPath)) fs.unlinkSync(withMusicPath);
      }
    }

    job.standalonePodcastPath = podcastPath;
    saveJob(job);
    res.json({ podcastUrl: `/api/output/${job.id}/podcast.mp3` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/jobs/:id/podcast/script
 * Generates a podcast narrative from the job's research documents.
 * Body: (none required — uses documents from the original job config)
 */
app.post("/api/jobs/:id/podcast/script", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job?.detection) {
    res.status(404).json({ error: "Job not found or detection not complete" }); return;
  }
  const { documentPaths: bodyDocPaths } = req.body as { documentPaths?: string[] };
  const docPaths = bodyDocPaths ?? job.config.documentPaths ?? [];
  try {
    const docTexts = await Promise.all(
      docPaths.filter(p => fs.existsSync(p)).map(p => extractText(p))
    );
    const clipData = job.detection.matches.map((m, i) => ({
      index:      i,
      timestamp:  m.gestureTimestamp,
      confidence: m.confidence,
      transcript: "",
    }));
    const script = await generatePodcastScript({
      projectTitle: job.config.title ?? "InsightCuts Brief",
      gestureQuery: job.config.gestureQuery,
      clips:        clipData,
      documentText: docTexts.join("\n\n"),
    });
    res.json({ script });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/insights/refine
 * Rewrites a single research insight using a user instruction
 * (e.g. "summarise further", "make more specific", "rewrite for executives").
 * Body: { insightText: string, instruction: string }
 * Returns: { text: string }
 */
app.post("/api/insights/refine", async (req, res) => {
  const { insightText, instruction } = req.body as { insightText?: string; instruction?: string };
  if (!insightText?.trim() || !instruction?.trim()) {
    res.status(400).json({ error: "insightText and instruction are required" }); return;
  }
  try {
    const text = await refineInsight(insightText, instruction);
    res.json({ text });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Slack OAuth + sharing ────────────────────────────────────────────────────

app.get("/api/slack/status", (_req, res) => {
  const token = getSlackToken();
  if (!token) { res.json({ connected: false }); return; }
  res.json({ connected: true, workspace: getSlackWorkspace() });
});

app.get("/api/slack/connect", (req, res) => {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) { res.status(500).json({ error: "SLACK_CLIENT_ID not configured" }); return; }
  const redirectUri = process.env.SLACK_REDIRECT_URI ?? `${req.protocol}://${req.get("host")}/api/slack/callback`;
  const scopes = "files:write,chat:write,channels:read,groups:read";
  res.redirect(`https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}`);
});

app.get("/api/slack/callback", async (req, res) => {
  const { code, error } = req.query as { code?: string; error?: string };
  if (error || !code) { res.redirect("/?slack=error"); return; }
  const clientId     = process.env.SLACK_CLIENT_ID ?? "";
  const clientSecret = process.env.SLACK_CLIENT_SECRET ?? "";
  const redirectUri  = process.env.SLACK_REDIRECT_URI ?? `${req.protocol}://${req.get("host")}/api/slack/callback`;
  try {
    const resp = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
    });
    const data = await resp.json() as { ok: boolean; access_token?: string; team?: { id: string; name: string }; error?: string };
    if (!data.ok || !data.access_token || !data.team) {
      console.error("[Slack] OAuth failed:", data.error);
      res.redirect("/?slack=error"); return;
    }
    saveSlackAuth({ access_token: data.access_token, team: data.team });
    res.redirect("/?slack=connected");
  } catch (err) {
    console.error("[Slack] OAuth callback error:", err);
    res.redirect("/?slack=error");
  }
});

app.get("/api/slack/channels", async (_req, res) => {
  const token = getSlackToken();
  if (!token) { res.status(401).json({ error: "Slack not connected" }); return; }
  try {
    res.json({ channels: await listChannels(token) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete("/api/slack/disconnect", (_req, res) => {
  clearSlackAuth();
  res.json({ ok: true });
});

app.post("/api/jobs/:id/share/brief", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const briefPath = job.assembly?.briefPath;
  if (!briefPath || !fs.existsSync(briefPath)) { res.status(400).json({ error: "Brief not ready" }); return; }
  const token = getSlackToken();
  if (!token) { res.status(401).json({ error: "Slack not connected" }); return; }
  const { channelId } = req.body as { channelId?: string };
  if (!channelId) { res.status(400).json({ error: "channelId required" }); return; }
  try {
    const clipCount = job.assembly?.clips?.length ?? 0;
    const message = await generateShareMessage(job.config.title ?? "InsightCuts Brief", job.config.gestureQuery, clipCount, "brief");
    const fileId = await uploadFileAndPost(token, channelId, briefPath, message, `${(job.config.title ?? "brief").replace(/\s+/g, "-")}.mp4`);
    res.json({ ok: true, fileId });
  } catch (err) {
    console.error("[Slack] Share brief failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/api/jobs/:id/share/podcast", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const podcastPath = job.assembly?.podcastPath ?? (job as unknown as Record<string, string>).standalonePodcastPath;
  if (!podcastPath || !fs.existsSync(podcastPath)) { res.status(400).json({ error: "Podcast not ready" }); return; }
  const token = getSlackToken();
  if (!token) { res.status(401).json({ error: "Slack not connected" }); return; }
  const { channelId } = req.body as { channelId?: string };
  if (!channelId) { res.status(400).json({ error: "channelId required" }); return; }
  try {
    const message = await generateShareMessage(job.config.title ?? "InsightCuts Podcast", job.config.gestureQuery, 0, "podcast");
    const fileId = await uploadFileAndPost(token, channelId, podcastPath, message, `${(job.config.title ?? "podcast").replace(/\s+/g, "-")}.mp3`);
    res.json({ ok: true, fileId });
  } catch (err) {
    console.error("[Slack] Share podcast failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/jobs/:id/share/email
 * Sends an AI-generated email summary of the project to a recipient.
 * Body: { to: string }
 */
app.post("/api/jobs/:id/share/email", async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  const { to } = req.body as { to?: string };
  if (!to?.trim()) { res.status(400).json({ error: "to (email address) is required" }); return; }
  try {
    const clipCount = job.assembly?.clips?.length ?? job.detection?.matches?.length ?? 0;
    const insights = Object.values(job.config.clipInsights ?? {}).flat();
    const { subject, summary } = await generateEmailSummary(
      job.config.title ?? "InsightCuts Project",
      job.config.gestureQuery,
      clipCount,
      insights
    );
    const html = buildEmailHtml({
      projectTitle: job.config.title ?? "InsightCuts Project",
      summary,
      gestureQuery: job.config.gestureQuery,
      clipCount,
      insights,
    });
    await sendEmail({ to, subject, html });
    res.json({ ok: true });
  } catch (err) {
    console.error("[email] Share failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Static client serving ────────────────────────────────────────────────────
// In production: serve the built Vite client and handle SPA routing.
// In development: the Vite dev server at :5173 proxies /api here; no static serving needed.

const clientDist = path.resolve("./client/dist");

if (process.env.NODE_ENV === "production" && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
} else if (process.env.NODE_ENV !== "production") {
  // Dev hint: any non-API browser request should go to the Vite dev server
  app.get("/", (_req, res) => res.redirect("http://localhost:5173"));
}

// ─── Start ────────────────────────────────────────────────────────────────────

// In development, bind to 127.0.0.1 so the Vite proxy connects reliably on Windows.
// In production, bind to 0.0.0.0 to accept external connections.
const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
app.listen(PORT, host, () => {
  console.log(`\nInsightCuts Core running on http://${host}:${PORT}\n`);
  if (process.env.NODE_ENV !== "production") {
    console.log(`  API only — open the app at http://localhost:5173\n`);
  }
});
