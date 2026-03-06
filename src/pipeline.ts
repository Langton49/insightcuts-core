import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { ensureIndex, uploadVideo, searchGestures, getVideoTranscript } from "./services/twelve-labs.js";
import {
  extractClipWithOverlay,
  generateTitleCard,
  generateOutroCard,
  concatenateClips,
  getVideoDuration,
  replaceAudio,
  mixBackgroundMusic,
  addPodcastIntroOutro,
} from "./services/ffmpeg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the podcast intro/outro music track. */
const PODCAST_INTRO_OUTRO_PATH = path.join(
  __dirname,
  "audios/podcast_intro_outro/hitslab-bossa-nova-bossa-nova-cafe-music-457829.mp3",
);
import { extractText } from "./services/document-extractor.js";
import { generateClipNarration, generatePodcastScript, transcribeClipAudio } from "./services/openai.js";
import { generateAudio } from "./services/elevenlabs.js";
import type {
  PipelineConfig,
  DetectionResult,
  AssemblyResult,
  ExtractedClip,
  GestureMatch,
} from "./types.js";

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULTS = {
  indexName: "insightcuts",
  clipBefore: 20,
  clipAfter: 20,
  maxClips: 10,
  outputDir: "./output",
  title: "InsightCuts Brief",
  subtitle: "Automatically detected moments",
  generateNarration: false,
  generatePodcast: false,
} as const;

// ─── Phase 1: Detection ───────────────────────────────────────────────────────

/**
 * Runs the Twelve Labs half of the pipeline:
 *   1. Ensure index exists
 *   2. Upload + index the video → get HLS stream URL
 *   3. Search for gesture moments → get scored, timestamped matches
 *
 * Returns immediately after search so the caller can show the results for
 * review before committing to FFmpeg work.
 */
export async function runDetection(cfg: PipelineConfig): Promise<DetectionResult> {
  const config = { ...DEFAULTS, ...stripUndefined(cfg) } as typeof DEFAULTS & PipelineConfig;

  console.log("\n=== InsightCuts — Detection ===");
  console.log(`Video : ${config.videoPath}`);
  console.log(`Query : "${config.gestureQuery}"`);
  console.log("==============================\n");

  const sourceDuration = await getVideoDuration(config.videoPath);

  let indexId: string;
  let videoId: string;
  let hlsUrl: string | null;

  if (cfg.existingVideoId && cfg.existingIndexId) {
    // Already indexed — skip Twelve Labs upload and go straight to search
    indexId = cfg.existingIndexId;
    videoId = cfg.existingVideoId;
    hlsUrl = cfg.existingHlsUrl ?? null;
    console.log(`Step 1/2 — Using existing TL index: ${indexId}`);
    console.log(`Step 2/2 — Using existing indexed video: ${videoId} — skipping upload`);
  } else {
    console.log("Step 1/3 — Twelve Labs: ensure index");
    indexId = await ensureIndex(config.indexName);

    console.log("\nStep 2/3 — Twelve Labs: upload & index video");
    ({ videoId, hlsUrl } = await uploadVideo(indexId, config.videoPath));

    console.log("\nStep 3/3 — Twelve Labs: search for gesture moments");
  }

  const matches = await searchGestures(indexId, config.gestureQuery, {
    videoId,
    maxResults: config.maxClips,
    confidenceFilter: config.confidenceFilter,
  });

  if (matches.length === 0) {
    console.warn("[Detection] No matches found.");
  }

  return { indexId, videoId, hlsUrl, matches, sourceDuration };
}

// ─── Phase 2: Assembly ────────────────────────────────────────────────────────

export interface AssemblyOptions {
  /** Indices into DetectionResult.matches to include (default: all) */
  selectedIndices?: number[];
  /** Per-clip start/end overrides (keyed by original match index) from the timeline editor */
  clipBoundaries?: Record<number, { start: number; end: number }>;
}

/**
 * Runs the FFmpeg half of the pipeline on the matches selected during review:
 *   1. Extract each clip from the local source video
 *   2. Burn in lower-third overlay
 *   3. Generate AI narration for each clip (if enabled)
 *   4. Generate intro + outro cards and concatenate brief
 *   5. Generate podcast audio from documents + clip data (if documents provided)
 */
export async function runAssembly(
  cfg: PipelineConfig,
  detection: DetectionResult,
  opts: AssemblyOptions = {}
): Promise<AssemblyResult> {
  const config = { ...DEFAULTS, ...stripUndefined(cfg) } as typeof DEFAULTS & PipelineConfig;
  const outputDir = path.resolve(config.outputDir);
  const clipsDir = path.join(outputDir, "clips");
  fs.mkdirSync(clipsDir, { recursive: true });

  const { selectedIndices, clipBoundaries } = opts;

  const doNarration = cfg.generateNarration === true;
  const hasDocuments = (config.documentPaths ?? []).length > 0;
  const doPodcast = cfg.generatePodcast === true && hasDocuments;

  // Preserve original indices so clipBoundaries keys remain valid after filtering
  const indexedMatches: Array<{ match: GestureMatch; origIndex: number }> = detection.matches
    .map((m, i) => ({ match: m, origIndex: i }))
    .filter(({ origIndex }) => !selectedIndices || selectedIndices.includes(origIndex));

  // Extra clips from secondary searches (Find Clips) have indices beyond detection.matches.
  // Their timing is fully defined by clipBoundaries — synthesize a GestureMatch for them.
  if (selectedIndices && clipBoundaries) {
    const extraIndices = selectedIndices
      .filter(i => i >= detection.matches.length)
      .sort((a, b) => a - b);
    for (const extraIdx of extraIndices) {
      const boundary = clipBoundaries[extraIdx];
      if (boundary) {
        const mid = (boundary.start + boundary.end) / 2;
        indexedMatches.push({
          match: {
            videoId: detection.videoId,
            score: 0,
            confidence: "medium",
            start: boundary.start,
            end: boundary.end,
            gestureTimestamp: mid,
          },
          origIndex: extraIdx,
        });
      }
    }
    // Keep chronological order
    indexedMatches.sort((a, b) => a.match.gestureTimestamp - b.match.gestureTimestamp);
  }

  if (indexedMatches.length === 0) {
    throw new Error("No matches selected for assembly");
  }

  const totalSteps = doPodcast ? 4 : 3;
  console.log("\n=== InsightCuts — Assembly ===");
  console.log(`Clips     : ${indexedMatches.length}`);
  console.log(`Clip      : -${config.clipBefore}s … +${config.clipAfter}s around gesture`);
  console.log(`Output    : ${outputDir}`);
  console.log(`Narration : ${doNarration ? "enabled" : "disabled"}`);
  console.log(`Podcast   : ${doPodcast ? "enabled" : hasDocuments ? "enabled" : "disabled (no documents)"}`);
  console.log("=============================\n");

  const videoDuration = await getVideoDuration(config.videoPath);

  // ─── Step 1: Extract + overlay clips ────────────────────────────────────────
  console.log(`Step 1/${totalSteps} — FFmpeg: extract and overlay clips`);
  // Pre-compute clip boundaries for all matches
  const clipWindows = indexedMatches.map(({ match, origIndex }) => {
    const boundary = clipBoundaries?.[origIndex];
    if (boundary) {
      return {
        start: Math.max(0, boundary.start),
        end:   Math.min(videoDuration, boundary.end),
      };
    }
    return {
      start: Math.max(0, match.gestureTimestamp - config.clipBefore),
      end:   Math.min(videoDuration, match.gestureTimestamp + config.clipAfter),
    };
  });

  // Resolve overlapping windows: split each collision evenly at the midpoint
  for (let i = 0; i < clipWindows.length - 1; i++) {
    const curr = clipWindows[i];
    const next = clipWindows[i + 1];
    if (curr.end > next.start) {
      const mid = (curr.end + next.start) / 2;
      curr.end   = mid;
      next.start = mid;
    }
  }

  // Drop clips shorter than 5s after collision resolution
  const MIN_CLIP_SECONDS = 5;
  const resolvedMatches = indexedMatches
    .map((im, idx) => ({ ...im, window: clipWindows[idx] }))
    .filter(({ window }) => window.end - window.start >= MIN_CLIP_SECONDS);

  const droppedCount = indexedMatches.length - resolvedMatches.length;
  if (droppedCount > 0) {
    console.log(`  [Collision] Dropped ${droppedCount} clip(s) shorter than ${MIN_CLIP_SECONDS}s after overlap resolution`);
  }
  if (resolvedMatches.length === 0) {
    throw new Error("No clips remain after collision resolution — all were shorter than 5s");
  }

  const clips: ExtractedClip[] = [];

  for (let i = 0; i < resolvedMatches.length; i++) {
    const { match, origIndex, window } = resolvedMatches[i];
    const clipStart    = window.start;
    const clipDuration = Math.max(0.1, window.end - window.start);

    const overlaidPath = path.join(clipsDir, `overlaid_${i}.mp4`);

    const ts          = formatTimestamp(match.gestureTimestamp);
    const layout      = config.clipLayouts?.[origIndex] ?? config.globalLayout ?? "bottom-top";
    const insightText = config.clipInsights?.[origIndex]?.[0];

    console.log(`  [${i + 1}/${resolvedMatches.length}] ${ts} (${clipDuration.toFixed(1)}s) [${layout}]`);
    await extractClipWithOverlay(config.videoPath, clipStart, clipDuration, overlaidPath, layout, "", "", insightText);

    clips.push({ index: origIndex, match, rawPath: overlaidPath, overlaidPath, clipStart, clipDuration });
  }

  // ─── Step 2: AI narration ────────────────────────────────────────────────────
  // Load full document text once — GPT-4o Vision picks the relevant parts per clip
  let documentText = "";
  if (doNarration && hasDocuments) {
    documentText = await loadDocumentText(config.documentPaths!, 8_000);
  }

  if (doNarration) {
    console.log(`\nStep 2/${totalSteps} — AI: generate narration for ${clips.length} clip(s)`);

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const narrationPath = path.join(clipsDir, `narration_${i}.mp3`);
      const narratedPath = path.join(clipsDir, `narrated_${i}.mp4`);

      const prebuiltScript = config.clipNarrationScripts?.[clip.index];
      let script: string;

      if (prebuiltScript) {
        console.log(`  [${i + 1}/${clips.length}] Using pre-generated narration script.`);
        script = prebuiltScript;
      } else {
        const linkedInsights = config.clipInsights?.[clip.index];
        console.log(
          `  [${i + 1}/${clips.length}] Generating narration script${linkedInsights?.length ? ` — ${linkedInsights.length} linked insight(s)` : ""}...`
        );
        script = await generateClipNarration({
          gestureQuery: config.gestureQuery,
          clipIndex: i,
          totalClips: clips.length,
          gestureTimestamp: clip.match.gestureTimestamp,
          clipDuration: clip.clipDuration,
          confidence: clip.match.confidence,
          documentText,
          linkedInsights,
        });
      }

      console.log(`  [${i + 1}/${clips.length}] Generating audio (${script.split(/\s+/).length} words)...`);
      await generateAudio(script, narrationPath, config.narrationVoice);

      // ── Extend clip if narration overruns it ───────────────────────────────
      const narrationDuration = await getVideoDuration(narrationPath).catch(() => clip.clipDuration);
      let overlaidForMix = clip.overlaidPath;
      let finalClipDuration = clip.clipDuration;

      if (narrationDuration > clip.clipDuration + 0.3) {
        // Clamp to the video's actual end
        const extDuration = Math.min(videoDuration - clip.clipStart, narrationDuration + 0.1);
        console.log(
          `  [${i + 1}/${clips.length}] Narration (${narrationDuration.toFixed(1)}s) > clip (${clip.clipDuration.toFixed(1)}s) — extending to ${extDuration.toFixed(1)}s...`
        );
        const extOverlaidPath = path.join(clipsDir, `overlaid_ext_${i}.mp4`);
        const extLayout = config.clipLayouts?.[clip.index] ?? config.globalLayout ?? "bottom-top";
        const extInsightText = config.clipInsights?.[clip.index]?.[0];
        await extractClipWithOverlay(config.videoPath, clip.clipStart, extDuration, extOverlaidPath, extLayout, "", "", extInsightText);
        overlaidForMix = extOverlaidPath;
        finalClipDuration = extDuration;
      }

      console.log(`  [${i + 1}/${clips.length}] Mixing narration into clip...`);
      await replaceAudio(overlaidForMix, narrationPath, narratedPath);

      clips[i] = { ...clip, narrationPath, overlaidPath: narratedPath, clipDuration: finalClipDuration };
    }
  }

  // ─── Step 3: Cards + concat ──────────────────────────────────────────────────
  const cardStep = doNarration ? 3 : 2;
  console.log(`\nStep ${cardStep}/${totalSteps} — FFmpeg: generate cards + concatenate`);
  const introPath = path.join(outputDir, "intro.mp4");
  const outroPath = path.join(outputDir, "outro.mp4");
  const briefPath = path.join(outputDir, "brief.mp4");
  const listPath  = path.join(outputDir, "concat_list.txt");

  const totalClipDuration = clips.reduce((sum, c) => sum + c.clipDuration, 0);
  await generateTitleCard(introPath, config.title, config.subtitle, 3);
  await generateOutroCard(outroPath, clips.length, totalClipDuration, 2);

  await concatenateClips([introPath, ...clips.map((c) => c.overlaidPath), outroPath], briefPath, listPath);

  let briefDuration = totalClipDuration + 5;
  try { briefDuration = await getVideoDuration(briefPath); } catch { /* use estimate */ }

  // ─── Background music ─────────────────────────────────────────────────────
  if (config.backgroundMusicPath && fs.existsSync(config.backgroundMusicPath)) {
    console.log(`  Mixing background music into brief...`);
    const mixedPath = path.join(outputDir, "brief_music.mp4");
    try {
      await mixBackgroundMusic(briefPath, config.backgroundMusicPath, mixedPath);
      fs.renameSync(mixedPath, briefPath);
      console.log(`  Background music mixed successfully.`);
    } catch (err) {
      console.warn(`  [Warn] Background music mixing failed — keeping silent brief:`, (err as Error).message);
      if (fs.existsSync(mixedPath)) fs.unlinkSync(mixedPath);
    }
  }

  // ─── Step 4: Podcast ─────────────────────────────────────────────────────────
  let podcastPath: string | undefined;

  if (doPodcast) {
    console.log(`\nStep 4/${totalSteps} — AI: generate podcast`);

    console.log("  Loading document text...");
    const documentText = await loadDocumentText(config.documentPaths!, 12_000);

    // Prefer TL Pegasus transcript (full video); fall back to Whisper per clip
    console.log("  Fetching video transcript (Twelve Labs Pegasus)...");
    const tlTranscript = await getVideoTranscript(detection.videoId);
    let clipTranscripts: string[];
    if (tlTranscript !== null) {
      // Distribute the full video transcript as context for every clip entry
      clipTranscripts = clips.map(() => tlTranscript);
    } else {
      console.log("  Falling back to Whisper per clip...");
      clipTranscripts = await Promise.all(clips.map((c) => transcribeClipAudio(c.rawPath)));
    }

    const podcastClips = clips.map((c, i) => ({
      index: c.index,
      timestamp: c.match.gestureTimestamp,
      confidence: c.match.confidence,
      transcript: clipTranscripts[i] ?? "",
    }));

    console.log("  Generating podcast script...");
    const podcastScript = await generatePodcastScript({
      projectTitle: config.title ?? "InsightCuts Brief",
      gestureQuery: config.gestureQuery,
      clips: podcastClips,
      documentText,
    });

    podcastPath = path.join(outputDir, "podcast.mp3");
    console.log(`  Generating podcast audio (${podcastScript.split(/\s+/).length} words)...`);
    await generateAudio(podcastScript, podcastPath, config.narrationVoice);

    // Wrap podcast with 5s music intro and outro
    if (fs.existsSync(PODCAST_INTRO_OUTRO_PATH)) {
      const podcastWithMusicPath = path.join(outputDir, "podcast_music.mp3");
      try {
        await addPodcastIntroOutro(podcastPath, PODCAST_INTRO_OUTRO_PATH, podcastWithMusicPath);
        fs.renameSync(podcastWithMusicPath, podcastPath);
        console.log(`  Podcast intro/outro added.`);
      } catch (err) {
        console.warn(`  [Warn] Podcast intro/outro failed — keeping plain podcast:`, (err as Error).message);
        if (fs.existsSync(podcastWithMusicPath)) fs.unlinkSync(podcastWithMusicPath);
      }
    }

    console.log(`  Podcast → ${podcastPath}`);
  }

  console.log(`\n=== Done! Brief → ${briefPath} (${briefDuration.toFixed(1)}s) ===`);
  if (podcastPath) console.log(`       Podcast → ${podcastPath}\n`);

  return { clips, briefPath, briefDuration, ...(podcastPath ? { podcastPath } : {}) };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extracts and concatenates text from all document paths, up to maxChars total.
 */
async function loadDocumentText(documentPaths: string[], maxChars: number): Promise<string> {
  const texts: string[] = [];
  for (const docPath of documentPaths) {
    try {
      const text = await extractText(docPath);
      texts.push(text);
    } catch (err) {
      console.warn(`  [Warn] Could not extract text from ${path.basename(docPath)}:`, (err as Error).message);
    }
  }
  return texts.join("\n\n---\n\n").slice(0, maxChars);
}

/** Removes undefined-valued keys so spreading doesn't clobber defaults. */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
