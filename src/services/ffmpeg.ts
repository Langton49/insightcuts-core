import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs";
import { execFileSync } from "child_process";
import { deflateSync } from "zlib";
// @ts-ignore — no bundled types
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

// ─── Solid-colour PNG helper (avoids lavfi virtual device requirement) ────────

function crc32(buf: Buffer): number {
  const table: number[] = []
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table.push(c)
  }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]!) & 0xFF]! ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/** Writes a solid-colour PNG at the given dimensions to `filePath`. Used instead of lavfi `color=` source. */
function writeSolidColorPng(r: number, g: number, b: number, w: number, h: number, filePath: string): void {
  const ihdrData = Buffer.allocUnsafe(13)
  ihdrData.writeUInt32BE(w, 0); ihdrData.writeUInt32BE(h, 4)
  ihdrData[8] = 8; ihdrData[9] = 2; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0
  // Build one scanline (filter=None byte + w*3 RGB bytes) then repeat for h rows
  const scanline = Buffer.allocUnsafe(1 + w * 3)
  scanline[0] = 0
  for (let i = 0; i < w; i++) { scanline[1 + i * 3] = r; scanline[2 + i * 3] = g; scanline[3 + i * 3] = b }
  const idatData = deflateSync(Buffer.concat(Array.from({ length: h }, () => scanline)))

  function chunk(type: string, data: Buffer): Buffer {
    const t = Buffer.from(type, 'ascii')
    const lenBuf = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length)
    const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([lenBuf, t, data, crcBuf])
  }

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdrData),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ])
  fs.writeFileSync(filePath, png)
}

/** Silent raw-PCM audio source available on Linux without lavfi. */
const SILENCE_SRC = '/dev/zero'
const SILENCE_OPTS = ['-f', 's16le', '-ar', '44100', '-ac', '2']

// ─── Binary paths ─────────────────────────────────────────────────────────────

/**
 * On Linux/Mac, prefer the system ffmpeg/ffprobe (installed via nixpacks on
 * Railway) because it includes the full lavfi virtual-device format needed for
 * title/outro/insight card generation. Falls back to the bundled static binary
 * so dev machines without system ffmpeg still work.
 */
function resolveSystemBinary(name: string): string | undefined {
  if (process.platform === "win32") return undefined;
  try {
    const p = execFileSync("which", [name], { encoding: "utf8" }).trim();
    return p || undefined;
  } catch {
    return undefined;
  }
}

// Prefer explicit env overrides → system binary → bundled static binary.
const FFMPEG_PATH  = process.env.FFMPEG_PATH  ?? resolveSystemBinary("ffmpeg")  ?? (ffmpegStatic as string);
const FFPROBE_PATH = process.env.FFPROBE_PATH ?? resolveSystemBinary("ffprobe") ?? ffprobeInstaller.path;

ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ─── Video info ───────────────────────────────────────────────────────────────

export function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, meta) => {
      if (err) return reject(err);
      resolve(meta.format.duration ?? 0);
    });
  });
}

// ─── Frame extraction ─────────────────────────────────────────────────────────

/**
 * Extracts a single JPEG frame from a video at the given timestamp.
 * Used to provide visual context to GPT-4o Vision for narration generation
 * without requiring a prior assembly step.
 */
export function extractFrameAtTime(
  videoPath: string,
  timestamp: number,
  outputPath: string,
): Promise<void> {
  ensureDir(path.dirname(outputPath));
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(Math.max(0, timestamp))
      .frames(1)
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

// ─── Clip extraction ──────────────────────────────────────────────────────────

/**
 * Cuts a segment from a source video.
 * Resets PTS on both streams so the concat demuxer handles it cleanly.
 */
export function extractClip(
  videoPath: string,
  startTime: number,
  duration: number,
  outputPath: string
): Promise<void> {
  ensureDir(path.dirname(outputPath));
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(Math.max(0, startTime))
      .duration(duration)
      .videoCodec("libx264")
      .audioCodec("aac")
      .videoFilters(["fps=fps=30", "setpts=PTS-STARTPTS"])
      .audioFilters("asetpts=PTS-STARTPTS")
      .outputOptions(["-preset fast", "-crf 23"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

/**
 * Adds a lower-third bar to a clip.
 * `mainText`  — shown in large text (e.g. "Gesture detected at 2:15")
 * `labelText` — shown top-right in small text (e.g. "video.mp4 — 2:15")
 */
export function addLowerThird(
  inputPath: string,
  outputPath: string,
  mainText: string,
  labelText: string
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  const safe = (s: string, maxLen: number) =>
    s
      .replace(/'/g, "")
      .replace(/:/g, "\\:")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .slice(0, maxLen);

  const safeMain = safe(mainText, 120);
  const safeLabel = safe(labelText, 60);

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters([
        `drawbox=x=0:y=ih-ih*0.22:w=iw:h=ih*0.22:color=0x000E24D8:t=fill`,
        `drawtext=text='${safeMain}':fontsize=24:fontcolor=white:x=40:y=h-h*0.17`,
        `drawtext=text='${safeLabel}':fontsize=14:fontcolor=0xC8D3E0CC:x=w-tw-20:y=20`,
        "fps=fps=30",
        "setpts=PTS-STARTPTS",
      ])
      .audioFilters("asetpts=PTS-STARTPTS")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-preset fast", "-crf 23"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

// ─── Title / outro cards ──────────────────────────────────────────────────────

export async function generateTitleCard(
  outputPath: string,
  title: string,
  subtitle: string,
  durationSeconds = 3
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  const safeTitle = title.replace(/'/g, "\\'").replace(/:/g, "\\:").slice(0, 80);
  const safeSub = subtitle.replace(/'/g, "\\'").replace(/:/g, "\\:").slice(0, 120);

  const tmpPng = `${outputPath}.bg.png`
  writeSolidColorPng(0x00, 0x0E, 0x24, 1280, 720, tmpPng)
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(tmpPng)
        .inputOptions(['-loop', '1', '-framerate', '30'])
        .input(SILENCE_SRC)
        .inputOptions(SILENCE_OPTS)
        .videoFilters([
          "drawbox=x=80:y=280:w=1120:h=4:color=0x003478:t=fill",
          `drawtext=text='${safeTitle}':fontsize=54:fontcolor=white:x=(w-tw)/2:y=200`,
          `drawtext=text='${safeSub}':fontsize=28:fontcolor=0xC8D3E0:x=(w-tw)/2:y=320`,
          "drawtext=text='InsightCuts':fontsize=18:fontcolor=0x4DA3FF:x=(w-tw)/2:y=560",
        ])
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions(["-preset fast", "-t", String(durationSeconds)])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run()
    })
  } finally {
    fs.rmSync(tmpPng, { force: true })
  }
}

export async function generateOutroCard(
  outputPath: string,
  momentCount: number,
  totalDurationSeconds: number,
  durationSeconds = 2
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  const m = Math.floor(totalDurationSeconds / 60);
  const s = Math.floor(totalDurationSeconds % 60);
  const durationStr = `${m}m ${s}s`;

  const tmpPng = `${outputPath}.bg.png`
  writeSolidColorPng(0x00, 0x0E, 0x24, 1280, 720, tmpPng)
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(tmpPng)
        .inputOptions(['-loop', '1', '-framerate', '30'])
        .input(SILENCE_SRC)
        .inputOptions(SILENCE_OPTS)
        .videoFilters([
          "drawbox=x=80:y=300:w=1120:h=2:color=0x003478:t=fill",
          `drawtext=text='${momentCount} Insight Moments · ${durationStr}':fontsize=36:fontcolor=white:x=(w-tw)/2:y=230`,
          "drawtext=text='Prepared with InsightCuts':fontsize=22:fontcolor=0xC8D3E0:x=(w-tw)/2:y=320",
        ])
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions(["-preset fast", "-t", String(durationSeconds)])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run()
    })
  } finally {
    fs.rmSync(tmpPng, { force: true })
  }
}

// ─── Frame extraction ─────────────────────────────────────────────────────────

/**
 * Extracts `count` JPEG frames at evenly spaced intervals from a video clip.
 * Returns the absolute paths of the saved frame images.
 */
export async function extractKeyFrames(
  videoPath: string,
  outputDir: string,
  count: number,
  prefix: string
): Promise<string[]> {
  ensureDir(outputDir);
  const duration = await getVideoDuration(videoPath);

  const framePaths: string[] = [];
  const promises: Promise<void>[] = [];

  for (let i = 0; i < count; i++) {
    // Sample at 20%, 50%, 80% of the clip
    const t = duration * (0.2 + (i / Math.max(count - 1, 1)) * 0.6);
    const framePath = path.join(outputDir, `${prefix}_frame${i}.jpg`);
    framePaths.push(framePath);

    promises.push(
      new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .seekInput(Math.max(0, t))
          .outputOptions(["-vframes 1", "-q:v 4"])
          .output(framePath)
          .on("end", () => resolve())
          .on("error", reject)
          .run();
      })
    );
  }

  await Promise.all(promises);
  return framePaths;
}
// ─── Layout-aware overlay ─────────────────────────────────────────────────────

/**
 * Estimates rendered pixel width of a string at a given font size.
 * Ratios are intentionally high so boxes are never undersized.
 *
 *   bold   → 0.72× fontsize per character
 *   mono   → 0.62× fontsize per character
 *   italic → 0.64× fontsize per character
 *   normal → 0.68× fontsize per character
 */
function estimateTextWidth(
  text: string,
  fontsize: number,
  style: "normal" | "bold" | "mono" | "italic" = "normal",
): number {
  const ratio =
    style === "bold"   ? 0.72 :
    style === "mono"   ? 0.62 :
    style === "italic" ? 0.64 :
    0.68;
  return Math.ceil(text.length * fontsize * ratio);
}

/**
 * Wraps text so each line fits within `maxPixels` at the given font size.
 * Works in pixel-space so wrapping matches actual rendered output.
 * Never splits a word unless it alone exceeds maxPixels.
 */
function wrapText(
  text: string,
  maxPixels: number,
  fontsize: number,
  style: "normal" | "bold" | "mono" | "italic" = "normal",
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateTextWidth(candidate, fontsize, style) <= maxPixels) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (estimateTextWidth(word, fontsize, style) > maxPixels) {
        let chunk = "";
        for (const char of word) {
          const next = chunk + char;
          if (estimateTextWidth(next, fontsize, style) <= maxPixels) {
            chunk = next;
          } else {
            if (chunk) lines.push(chunk);
            chunk = char;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Reads the actual pixel dimensions of a video file using ffprobe.
 */
export function getVideoDimensions(inputPath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) return reject(err);
      const stream = metadata.streams.find(s => s.codec_type === "video");
      if (!stream || !stream.width || !stream.height) {
        return reject(new Error("Could not determine video dimensions"));
      }
      resolve({ width: stream.width, height: stream.height });
    });
  });
}

/**
 * Returns a set of font sizes and layout metrics scaled to the video height.
 *
 * All values are derived from VH so the overlay looks proportionally
 * identical regardless of whether the video is 360p, 720p, 1080p, portrait, etc.
 *
 * Reference baseline: VH = 720.
 */
function scaledMetrics(VH: number) {
  const s = VH / 720; // scale factor relative to 720p baseline

  const px = (n: number) => Math.max(1, Math.round(n * s));

  return {
    // Font sizes
    fsMain:    px(28),  // main headline
    fsLabel:   px(12),  // label / eyebrow
    fsInsight: px(14),  // insight / subtext
    fsPanel:   px(21),  // split-screen panel headline (slightly smaller — narrow column)

    // Line heights (≈ fontsize × 1.3)
    lhMain:    px(36),
    lhLabel:   px(17),
    lhInsight: px(20),
    lhPanel:   px(28),

    // Padding inside boxes
    padXMain:  px(32),
    padYMain:  px(16),
    padXLabel: px(20),
    padYLabel: px(12),

    // Bar thicknesses
    barH:      px(158),   // 22% of 720
    accentW:   Math.max(3, px(5)),
    accentH:   Math.max(2, px(3)),

    // Gaps between stacked elements
    gap:       px(10),
  };
}

/**
 * Builds a centred, padded background box + horizontally-centred text lines
 * as an array of FFmpeg filter strings.
 *
 * All coordinates are concrete pixel values derived from the actual video
 * dimensions — no FFmpeg expression strings that assume a fixed canvas size.
 */
function centeredTextBox(opts: {
  lines: string[];
  fontsize: number;
  fontcolor: string;
  lineHeight: number;
  font?: "bold" | "mono" | "italic" | "normal";
  boxColor: string;
  borderColor?: string;
  padX?: number;
  padY?: number;
  regionX: number;
  regionY: number;
  regionW: number;
  regionH: number;
}): string[] {
  const {
    lines, fontsize, fontcolor, lineHeight,
    font = "normal", boxColor, borderColor,
    padX = 24, padY = 16,
    regionX, regionY, regionW, regionH,
  } = opts;

  const style: "normal" | "bold" | "mono" | "italic" =
    font === "bold"   ? "bold"   :
    font === "mono"   ? "mono"   :
    font === "italic" ? "italic" :
    "normal";

  const widestPx   = lines.reduce((m, l) => Math.max(m, estimateTextWidth(l, fontsize, style)), 0);
  const textBlockH = lines.length * lineHeight - Math.max(0, lineHeight - fontsize);
  const boxW = Math.min(widestPx + padX * 2, regionW - 4);
  const boxH = textBlockH + padY * 2;

  const boxX = regionX + Math.floor((regionW - boxW) / 2);
  const boxY = regionY + Math.floor((regionH - boxH) / 2);

  const fontArg =
    font === "bold"   ? ":font=bold"      :
    font === "mono"   ? ":font=monospace" :
    font === "italic" ? ":font=italic"    :
    "";

  const filters: string[] = [];
  filters.push(`drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${boxH}:color=${boxColor}:t=fill`);
  if (borderColor) {
    filters.push(`drawbox=x=${boxX}:y=${boxY}:w=${boxW}:h=${Math.max(2, Math.round(fontsize * 0.1))}:color=${borderColor}:t=fill`);
  }

  const contentW = boxW - padX * 2;
  lines.forEach((line, i) => {
    const lineW = estimateTextWidth(line, fontsize, style);
    const textX = boxX + padX + Math.floor((contentW - lineW) / 2);
    const textY = boxY + padY + i * lineHeight;
    filters.push(
      `drawtext=text='${line}':fontsize=${fontsize}:fontcolor=${fontcolor}:x=${textX}:y=${textY}${fontArg}`,
    );
  });

  return filters;
}

/**
 * Left-anchored drawtext lines for panel layouts (split-screen).
 */
function drawtextLines(
  lines: string[],
  opts: {
    fontsize: number;
    fontcolor: string;
    x: number;
    baseY: number;
    lineHeight: number;
    font?: string;
  },
): string[] {
  return lines.map((line, i) => {
    const y = opts.baseY + i * opts.lineHeight;
    const fontPart = opts.font ? `:font=${opts.font}` : "";
    return `drawtext=text='${line}':fontsize=${opts.fontsize}:fontcolor=${opts.fontcolor}:x=${opts.x}:y=${y}${fontPart}`;
  });
}

/** Sanitises a string for use inside an FFmpeg filter expression. */
const safeFilter = (s: string, maxLen: number): string =>
  s
    .replace(/\\/g, "")       // strip backslashes (avoid accidental escape sequences)
    .replace(/'/g, "")        // strip single quotes (they close the text='...' value)
    .replace(/%/g, "%%")      // escape % — FFmpeg drawtext expands %{VARNAME} macros
    .replace(/:/g, "\\:")     // escape colons (filter graph option separator)
    .replace(/\[/g, "\\[")    // escape brackets (filter graph stream labels)
    .replace(/\]/g, "\\]")
    .slice(0, maxLen);

/**
 * Builds the complete FFmpeg video-filter chain for a given layout.
 * All arguments must already be sanitised with safeFilter before calling.
 */
function buildOverlayFilters(
  VW: number,
  VH: number,
  layout: string,
  safeMain: string,
  safeLabel: string,
  safeInsight: string,
): string[] {
  const m = scaledMetrics(VH);
  let videoFilters: string[];

  switch (layout) {

    // ── Split-screen ──────────────────────────────────────────────────────────
    case "split-screen": {
      const outW      = Math.max(VW, Math.round(VH * (4 / 3)));
      const outH      = VH;
      const videoW    = Math.round(outW * 0.67);
      const panelX    = videoW + m.accentW;
      const panelW    = outW - videoW;
      const textX     = panelX + m.padXLabel;
      const textMaxPx = panelW - m.padXLabel * 2;

      const mainLines    = wrapText(safeMain,    textMaxPx, m.fsPanel,   "bold");
      const labelLines   = wrapText(safeLabel,   textMaxPx, m.fsLabel,   "mono");
      const insightLines = safeInsight ? wrapText(safeInsight, textMaxPx, m.fsInsight, "italic").slice(0, 7) : [];

      const labelBaseY   = Math.round(outH * 0.28);
      const mainBaseY    = labelBaseY + labelLines.length * m.lhLabel + m.gap;
      const ruleY        = mainBaseY  + mainLines.length  * m.lhPanel  + Math.round(m.gap * 0.4);
      const insightBaseY = ruleY + m.gap;

      videoFilters = [
        `scale=${videoW}:${outH}:force_original_aspect_ratio=decrease`,
        `pad=${outW}:${outH}:0:(oh-ih)/2:0x0a0e1a`,
        `drawbox=x=${videoW}:y=0:w=${panelW}:h=${outH}:color=0x000E24FF:t=fill`,
        `drawbox=x=${videoW}:y=0:w=${m.accentW}:h=${outH}:color=0x3A7BD5FF:t=fill`,
        `drawbox=x=${panelX}:y=0:w=${panelW - m.accentW}:h=${m.accentH}:color=0x3A7BD5FF:t=fill`,
        ...drawtextLines(labelLines, { fontsize: m.fsLabel,   fontcolor: "0x7A9CC0", x: textX, baseY: labelBaseY, lineHeight: m.lhLabel, font: "monospace" }),
        ...drawtextLines(mainLines,  { fontsize: m.fsPanel,   fontcolor: "0xEFF4FA", x: textX, baseY: mainBaseY,  lineHeight: m.lhPanel, font: "bold" }),
        `drawbox=x=${textX}:y=${ruleY}:w=${Math.round(textMaxPx * 0.5)}:h=${m.accentH}:color=0x3A7BD5AA:t=fill`,
        ...(insightLines.length ? [
          `drawbox=x=${textX}:y=${insightBaseY + Math.round(m.lhInsight * 0.1)}:w=${m.gap}:h=${m.gap}:color=0x3A7BD5FF:t=fill`,
          ...drawtextLines(insightLines, { fontsize: m.fsInsight, fontcolor: "0xC8D8EE", x: textX + m.gap + 4, baseY: insightBaseY, lineHeight: m.lhInsight, font: "italic" }),
        ] : []),
        `drawbox=x=${panelX}:y=${outH - Math.round(outH * 0.025)}:w=${panelW - m.accentW}:h=${Math.round(outH * 0.02)}:color=0x3A7BD508:t=fill`,
        "fps=fps=30",
        "setpts=PTS-STARTPTS",
      ];
      break;
    }

    // ── Bottom-top ────────────────────────────────────────────────────────────
    case "bottom-top": {
      const textMaxPx  = VW - m.accentW - m.padXMain * 2;
      const mainLines  = wrapText(safeMain,  textMaxPx, m.fsMain,  "bold");
      const labelLines = wrapText(safeLabel, textMaxPx, m.fsLabel, "mono");

      const mainBoxH  = mainLines.length  * m.lhMain  + m.padYMain  * 2;
      const labelBoxH = labelLines.length * m.lhLabel + m.padYLabel * 2;
      const totalH    = mainBoxH + m.gap + labelBoxH;
      const barH      = Math.max(m.barH, totalH + m.gap * 2);
      const blockTopY = Math.floor((barH - totalH) / 2);

      const insightLines = safeInsight ? wrapText(safeInsight, textMaxPx, m.fsInsight, "italic").slice(0, 5) : [];
      const insightFilters: string[] = [];
      if (insightLines.length) {
        const insightBoxH = insightLines.length * m.lhInsight + m.padYLabel * 2;
        insightFilters.push(...centeredTextBox({
          lines: insightLines, fontsize: m.fsInsight, fontcolor: "0xC8D8EE",
          lineHeight: m.lhInsight, font: "italic",
          boxColor: "0x000E24DD", borderColor: "0x3A7BD5AA",
          padX: m.padXLabel, padY: m.padYLabel,
          regionX: 0, regionY: VH - insightBoxH - m.gap, regionW: VW, regionH: insightBoxH,
        }));
      }

      videoFilters = [
        `drawbox=x=0:y=0:w=${VW}:h=${barH}:color=0x000E24F0:t=fill`,
        `drawbox=x=0:y=${barH - m.accentH}:w=${VW}:h=${m.accentH}:color=0x3A7BD5CC:t=fill`,
        `drawbox=x=0:y=0:w=${m.accentW}:h=${barH}:color=0x3A7BD5FF:t=fill`,
        ...centeredTextBox({ lines: mainLines,  fontsize: m.fsMain,  fontcolor: "0xEFF4FA", lineHeight: m.lhMain,  font: "bold", boxColor: "0x00000000", padX: m.padXMain,  padY: m.padYMain,  regionX: 0, regionY: blockTopY,                          regionW: VW, regionH: mainBoxH  }),
        ...centeredTextBox({ lines: labelLines, fontsize: m.fsLabel, fontcolor: "0x7A9CC0", lineHeight: m.lhLabel, font: "mono", boxColor: "0x00000000", padX: m.padXLabel, padY: m.padYLabel, regionX: 0, regionY: blockTopY + mainBoxH + m.gap,          regionW: VW, regionH: labelBoxH }),
        ...insightFilters,
        "fps=fps=30",
        "setpts=PTS-STARTPTS",
      ];
      break;
    }

    // ── Overlay ───────────────────────────────────────────────────────────────
    case "overlay": {
      const textMaxPx    = VW - m.padXMain * 2 - m.gap * 2;
      const mainLines    = wrapText(safeMain,    textMaxPx, m.fsMain,    "bold");
      const labelLines   = wrapText(safeLabel,   textMaxPx, m.fsLabel,   "mono");
      const insightLines = safeInsight ? wrapText(safeInsight, textMaxPx, m.fsInsight, "italic").slice(0, 4) : [];

      const labelBoxH   = labelLines.length  * m.lhLabel   + m.padYLabel * 2;
      const mainBoxH    = mainLines.length   * m.lhMain    + m.padYMain  * 2;
      const insightBoxH = insightLines.length ? insightLines.length * m.lhInsight + m.padYLabel * 2 : 0;
      const totalH      = labelBoxH + m.gap + mainBoxH + (insightBoxH ? m.gap + insightBoxH : 0);

      const blockTopY   = Math.min(VH - totalH - Math.round(VH * 0.04), Math.round(VH * 0.55));
      const mainBoxY    = blockTopY + labelBoxH + m.gap;
      const insightBoxY = mainBoxY  + mainBoxH  + m.gap;

      videoFilters = [
        `drawbox=x=0:y=0:w=${VW}:h=${VH}:color=0x00000044:t=fill`,
        ...centeredTextBox({ lines: labelLines,   fontsize: m.fsLabel,   fontcolor: "0x7A9CC0", lineHeight: m.lhLabel,   font: "mono",   boxColor: "0x000E24DD", borderColor: "0x3A7BD5AA", padX: m.padXLabel, padY: m.padYLabel, regionX: 0, regionY: blockTopY,   regionW: VW, regionH: labelBoxH   }),
        ...centeredTextBox({ lines: mainLines,    fontsize: m.fsMain,    fontcolor: "0xEFF4FA", lineHeight: m.lhMain,    font: "bold",   boxColor: "0x000E24EE", borderColor: "0x3A7BD5FF", padX: m.padXMain,  padY: m.padYMain,  regionX: 0, regionY: mainBoxY,    regionW: VW, regionH: mainBoxH    }),
        ...(insightLines.length ? centeredTextBox({ lines: insightLines, fontsize: m.fsInsight, fontcolor: "0xC8D8EE", lineHeight: m.lhInsight, font: "italic", boxColor: "0x000E24CC", borderColor: "0x3A7BD5AA", padX: m.padXLabel, padY: m.padYLabel, regionX: 0, regionY: insightBoxY, regionW: VW, regionH: insightBoxH }) : []),
        "fps=fps=30",
        "setpts=PTS-STARTPTS",
      ];
      break;
    }

    // ── Picture-in-picture ────────────────────────────────────────────────────
    case "picture-in-picture": {
      const outW    = Math.max(VW, Math.round(VH * (16 / 9)));
      const outH    = VH;
      const pipW    = Math.round(outW * 0.25);
      const pipH    = Math.round(pipW * (9 / 16));
      const pipX    = outW - pipW - m.gap;
      const pipY    = m.gap;
      const PANEL_X = m.accentW;
      const PANEL_W = outW - pipW - m.gap * 3;
      const textMaxPx = PANEL_W - m.padXMain * 2;

      const mainLines    = wrapText(safeMain,    textMaxPx, m.fsMain,    "bold");
      const labelLines   = wrapText(safeLabel,   textMaxPx, m.fsLabel,   "mono");
      const insightLines = safeInsight ? wrapText(safeInsight, textMaxPx, m.fsInsight, "italic").slice(0, 7) : [];

      const labelBoxH   = labelLines.length  * m.lhLabel   + m.padYLabel * 2;
      const mainBoxH    = mainLines.length   * m.lhMain    + m.padYMain  * 2;
      const insightBoxH = insightLines.length ? insightLines.length * m.lhInsight + m.padYLabel * 2 : 0;
      const totalH      = labelBoxH + m.gap + mainBoxH + (insightBoxH ? m.gap + insightBoxH : 0);

      const blockTopY   = Math.floor((outH - totalH) / 2);
      const mainTopY    = blockTopY + labelBoxH + m.gap;
      const insightTopY = mainTopY  + mainBoxH  + m.gap;

      videoFilters = [
        `scale=${pipW}:${pipH}`,
        `pad=${outW}:${outH}:${pipX}:${pipY}:0x0a0e1a`,
        `drawbox=x=0:y=0:w=${PANEL_W + PANEL_X}:h=${outH}:color=0x000E24FF:t=fill`,
        `drawbox=x=0:y=0:w=${m.accentW}:h=${outH}:color=0x3A7BD5FF:t=fill`,
        ...centeredTextBox({ lines: labelLines, fontsize: m.fsLabel,   fontcolor: "0x7A9CC0", lineHeight: m.lhLabel,   font: "mono",   boxColor: "0x0A1830DD", borderColor: "0x3A7BD566", padX: m.padXLabel, padY: m.padYLabel, regionX: PANEL_X, regionY: blockTopY,   regionW: PANEL_W, regionH: labelBoxH   }),
        ...centeredTextBox({ lines: mainLines,  fontsize: m.fsMain,    fontcolor: "0xEFF4FA", lineHeight: m.lhMain,    font: "bold",   boxColor: "0x0A1830EE", borderColor: "0x3A7BD5FF", padX: m.padXMain,  padY: m.padYMain,  regionX: PANEL_X, regionY: mainTopY,    regionW: PANEL_W, regionH: mainBoxH    }),
        ...(insightBoxH ? centeredTextBox({ lines: insightLines, fontsize: m.fsInsight, fontcolor: "0xC8D8EE", lineHeight: m.lhInsight, font: "italic", boxColor: "0x0A1830CC", borderColor: "0x3A7BD544", padX: m.padXLabel, padY: m.padYLabel, regionX: PANEL_X, regionY: insightTopY, regionW: PANEL_W, regionH: insightBoxH }) : []),
        `drawbox=x=${pipX - m.accentH}:y=${pipY - m.accentH}:w=${pipW + m.accentH * 2}:h=${pipH + m.accentH * 2}:color=0x3A7BD5AA:t=2`,
        "fps=fps=30",
        "setpts=PTS-STARTPTS",
      ];
      break;
    }

    // ── Sequential ────────────────────────────────────────────────────────────
    case "sequential": {
      videoFilters = ["fps=fps=30", "setpts=PTS-STARTPTS"];
      break;
    }

    // ── Default: lower-third ──────────────────────────────────────────────────
    default: {
      const textMaxPx  = VW - m.accentW - m.padXMain * 2;
      const mainLines  = wrapText(safeMain,  textMaxPx, m.fsMain,  "bold");
      const labelLines = wrapText(safeLabel, textMaxPx, m.fsLabel, "mono");

      const mainBoxH  = mainLines.length  * m.lhMain  + m.padYMain  * 2;
      const labelBoxH = labelLines.length * m.lhLabel + m.padYLabel * 2;
      const totalH    = mainBoxH + m.gap + labelBoxH;
      const barH      = Math.max(m.barH, totalH + m.gap * 2);
      const barY      = VH - barH;
      const blockTopY = barY + Math.floor((barH - totalH) / 2);

      const insightLines = safeInsight ? wrapText(safeInsight, textMaxPx, m.fsInsight, "italic").slice(0, 3) : [];
      const insightFilters: string[] = [];
      if (insightLines.length) {
        const insightBoxH = insightLines.length * m.lhInsight + m.padYLabel * 2;
        insightFilters.push(...centeredTextBox({
          lines: insightLines, fontsize: m.fsInsight, fontcolor: "0xC8D8EE",
          lineHeight: m.lhInsight, font: "italic",
          boxColor: "0x000E24CC", borderColor: "0x3A7BD5AA",
          padX: m.padXLabel, padY: m.padYLabel,
          regionX: 0, regionY: Math.max(0, barY - insightBoxH - m.gap), regionW: VW, regionH: insightBoxH,
        }));
      }

      videoFilters = [
        `drawbox=x=0:y=${barY}:w=${VW}:h=${barH}:color=0x000E24F0:t=fill`,
        `drawbox=x=0:y=${barY}:w=${VW}:h=${m.accentH}:color=0x3A7BD5CC:t=fill`,
        `drawbox=x=0:y=${barY}:w=${m.accentW}:h=${barH}:color=0x3A7BD5FF:t=fill`,
        ...centeredTextBox({ lines: mainLines,  fontsize: m.fsMain,  fontcolor: "0xEFF4FA", lineHeight: m.lhMain,  font: "bold", boxColor: "0x00000000", padX: m.padXMain,  padY: m.padYMain,  regionX: 0, regionY: blockTopY,                 regionW: VW, regionH: mainBoxH  }),
        ...centeredTextBox({ lines: labelLines, fontsize: m.fsLabel, fontcolor: "0x7A9CC0", lineHeight: m.lhLabel, font: "mono", boxColor: "0x00000000", padX: m.padXLabel, padY: m.padYLabel, regionX: 0, regionY: blockTopY + mainBoxH + m.gap, regionW: VW, regionH: labelBoxH }),
        ...insightFilters,
        "fps=fps=30",
        "setpts=PTS-STARTPTS",
      ];
      break;
    }
  }

  return videoFilters;
}

/**
 * Generates a standalone insight card video used as the leading segment
 * in a sequential layout. Dimensions must match the clip to allow concat.
 *
 * @param narrationPath  Optional path to an MP3 narration file. When provided
 *                       the narration plays as audio during the card instead of
 *                       silence — narration is padded or trimmed to durationSeconds.
 */
export async function generateInsightCard(
  outputPath: string,
  insightText: string,
  labelText: string,
  durationSeconds: number,
  VW: number,
  VH: number,
  narrationPath?: string,
): Promise<void> {
  ensureDir(path.dirname(outputPath));
  const m = scaledMetrics(VH);
  const textMaxPx = VW - 160;

  const insightLines = wrapText(safeFilter(insightText, 800), textMaxPx, m.fsMain, "bold").slice(0, 10);
  const labelLines   = wrapText(safeFilter(labelText, 120),   textMaxPx, m.fsLabel, "mono").slice(0, 2);

  const insightBoxH = insightLines.length * m.lhMain  + m.padYMain  * 2;
  const labelBoxH   = labelLines.length   * m.lhLabel + m.padYLabel * 2;
  const totalH      = insightBoxH + m.gap * 2 + labelBoxH;
  const blockTopY   = Math.floor((VH - totalH) / 2);
  const labelTopY   = blockTopY + insightBoxH + m.gap * 2;

  const filters: string[] = [
    `drawbox=x=0:y=0:w=${VW}:h=${VH}:color=0x000E24FF:t=fill`,
    `drawbox=x=${Math.round(VW * 0.06)}:y=${blockTopY - m.gap}:w=${Math.round(VW * 0.88)}:h=${m.accentH}:color=0x3A7BD5CC:t=fill`,
    ...centeredTextBox({
      lines: insightLines, fontsize: m.fsMain, fontcolor: "0xEFF4FA",
      lineHeight: m.lhMain, font: "bold", boxColor: "0x00000000",
      padX: m.padXMain, padY: m.padYMain,
      regionX: 0, regionY: blockTopY, regionW: VW, regionH: insightBoxH,
    }),
    `drawbox=x=${Math.round(VW * 0.06)}:y=${labelTopY - m.gap}:w=${Math.round(VW * 0.44)}:h=${m.accentH}:color=0x3A7BD544:t=fill`,
    ...centeredTextBox({
      lines: labelLines, fontsize: m.fsLabel, fontcolor: "0x7A9CC0",
      lineHeight: m.lhLabel, font: "mono", boxColor: "0x00000000",
      padX: m.padXLabel, padY: m.padYLabel,
      regionX: 0, regionY: labelTopY, regionW: VW, regionH: labelBoxH,
    }),
    `drawtext=text='InsightCuts':fontsize=${m.fsLabel}:fontcolor=0x4DA3FF:x=${VW - Math.round(VW * 0.1)}:y=${VH - Math.round(VH * 0.05)}`,
  ];

  const tmpPng = `${outputPath}.bg.png`
  writeSolidColorPng(0x00, 0x0E, 0x24, VW, VH, tmpPng)
  try {
    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg()
        .input(tmpPng)
        .inputOptions(['-loop', '1', '-framerate', '30'])

      if (narrationPath) {
        // Narration audio: pad with silence if shorter than card, trim if longer
        cmd
          .input(narrationPath)
          .complexFilter([`[1:a]apad,atrim=duration=${durationSeconds}[aout]`])
          .outputOptions(["-map 0:v", "-map [aout]"])
      } else {
        cmd
          .input(SILENCE_SRC)
          .inputOptions(SILENCE_OPTS)
      }

      cmd
        .videoFilters(filters)
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions(["-preset fast", "-t", String(durationSeconds)])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", reject)
        .run()
    })
  } finally {
    fs.rmSync(tmpPng, { force: true })
  }
}

/**
 * Extracts a clip from `videoPath` and applies the layout overlay in a single
 * FFmpeg pass, eliminating the quality loss of a double re-encode.
 */
export async function extractClipWithOverlay(
  videoPath: string,
  startTime: number,
  duration: number,
  outputPath: string,
  layout: string,
  mainText: string,
  labelText: string,
  insightText?: string,
  /** For sequential layout: if provided, the bare extracted clip (no card) is saved here
   *  so the pipeline can later rebuild the audio mix (narration over card + original audio
   *  during clip) without a second source-video seek. */
  rawClipOutputPath?: string,
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  if (layout === "sequential") {
    const tmpDir = path.dirname(outputPath);
    const base = `_seq_${Date.now()}`;
    const cardPath = path.join(tmpDir, `${base}_card.mp4`);
    const clipPath = rawClipOutputPath ?? path.join(tmpDir, `${base}_clip.mp4`);
    const { width: VW, height: VH } = await getVideoDimensions(videoPath);
    const cardText = insightText?.trim() || mainText;
    const cardDuration = Math.min(8, Math.max(3, 3 + cardText.length * 0.04));
    try {
      await generateInsightCard(cardPath, cardText, labelText, cardDuration, VW, VH);
      await extractClip(videoPath, startTime, duration, clipPath);
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(cardPath)
          .input(clipPath)
          .complexFilter("[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]")
          .outputOptions(["-map [v]", "-map [a]", "-c:v libx264", "-c:a aac", "-preset fast", "-crf 23"])
          .output(outputPath)
          .on("end", () => resolve())
          .on("error", reject)
          .run();
      });
    } finally {
      // Always clean up the temp card; only clean up clip if we own it (no rawClipOutputPath)
      try { fs.unlinkSync(cardPath); } catch { /* ignore */ }
      if (!rawClipOutputPath) {
        try { fs.unlinkSync(clipPath); } catch { /* ignore */ }
      }
    }
    return;
  }

  const { width: VW, height: VH } = await getVideoDimensions(videoPath);
  const videoFilters = buildOverlayFilters(
    VW, VH, layout,
    safeFilter(mainText, 200),
    safeFilter(labelText, 80),
    insightText ? safeFilter(insightText, 600) : "",
  );
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(Math.max(0, startTime))
      .duration(duration)
      .videoFilters(videoFilters)
      .audioFilters("asetpts=PTS-STARTPTS")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-preset fast", "-crf 23"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

/**
 * Adds an overlay to an already-extracted clip file.
 * Prefer `extractClipWithOverlay` when extracting new clips to avoid a double re-encode.
 */
export async function addLayoutOverlay(
  inputPath: string,
  outputPath: string,
  layout: string,
  mainText: string,
  labelText: string,
  insightText?: string,
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  if (layout === "sequential") {
    const tmpDir = path.dirname(outputPath);
    const cardPath = path.join(tmpDir, `_seq_${Date.now()}_card.mp4`);
    const { width: VW, height: VH } = await getVideoDimensions(inputPath);
    const cardText = insightText?.trim() || mainText;
    const cardDuration = Math.min(8, Math.max(3, 3 + cardText.length * 0.04));
    try {
      await generateInsightCard(cardPath, cardText, labelText, cardDuration, VW, VH);
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(cardPath)
          .input(inputPath)
          .complexFilter("[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]")
          .outputOptions(["-map [v]", "-map [a]", "-c:v libx264", "-c:a aac", "-preset fast", "-crf 23"])
          .output(outputPath)
          .on("end", () => resolve())
          .on("error", reject)
          .run();
      });
    } finally {
      try { fs.unlinkSync(cardPath); } catch { /* ignore */ }
    }
    return;
  }

  const { width: VW, height: VH } = await getVideoDimensions(inputPath);
  const videoFilters = buildOverlayFilters(
    VW, VH, layout,
    safeFilter(mainText, 200),
    safeFilter(labelText, 80),
    insightText ? safeFilter(insightText, 600) : "",
  );
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilters(videoFilters)
      .audioFilters("asetpts=PTS-STARTPTS")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-preset fast", "-crf 23"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

// ─── Audio replacement ────────────────────────────────────────────────────────

/**
 * Replaces a video clip's audio track with the provided audio file.
 * The audio is trimmed to match the video duration (never extends the clip).
 */
export function replaceAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
): Promise<void> {
  ensureDir(path.dirname(outputPath));
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      // apad extends narration with silence so the clip plays its full duration
      // when narration is shorter than the video. -shortest then stops at video end.
      .complexFilter("[1:a]apad[a]")
      .outputOptions([
        "-map 0:v:0",
        "-map [a]",
        "-shortest",
        "-c:v libx264",
        "-c:a aac",
        "-preset fast",
        "-crf 23",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}
// ─── Background music mixing ──────────────────────────────────────────────────

/**
 * Mixes a background music track into a video at a low volume.
 * The music is mixed under the existing audio (narration / original video audio).
 * If the music is shorter than the video, it fades out gracefully via amix's
 * dropout_transition rather than looping — most tracks are long enough.
 *
 * @param volume Linear gain for the music track (default 0.15 ≈ -16 dB).
 */
export function mixBackgroundMusic(
  videoPath: string,
  musicPath: string,
  outputPath: string,
  volume = 0.15,
): Promise<void> {
  ensureDir(path.dirname(outputPath));
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(musicPath)
      .complexFilter([
        `[1:a]volume=${volume}[bg]`,
        "[0:a][bg]amix=inputs=2:duration=first:dropout_transition=3[aout]",
      ])
      .outputOptions([
        "-map 0:v:0",
        "-map [aout]",
        "-c:v copy",
        "-c:a aac",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}

// ─── Podcast intro / outro ────────────────────────────────────────────────────

/**
 * Wraps a podcast MP3 with a 5-second music intro and 5-second outro.
 * Both segments are taken from the beginning of `musicPath` with fade-in/out.
 * The original `podcastPath` is not modified — result is written to `outputPath`.
 */
export async function addPodcastIntroOutro(
  podcastPath: string,
  musicPath: string,
  outputPath: string,
  introDuration = 5,
  outroDuration = 5,
): Promise<void> {
  ensureDir(path.dirname(outputPath));
  const tmpDir = path.dirname(outputPath);
  const introPath = path.join(tmpDir, "_intro_tmp.mp3");
  const outroPath = path.join(tmpDir, "_outro_tmp.mp3");

  const makeClip = (dest: string, duration: number): Promise<void> =>
    new Promise((resolve, reject) => {
      ffmpeg(musicPath)
        .outputOptions(["-t", String(duration)])
        .audioFilters([
          "afade=t=in:d=0.5",
          `afade=t=out:st=${duration - 1}:d=1`,
        ])
        .audioCodec("libmp3lame")
        .output(dest)
        .on("end", () => resolve())
        .on("error", reject)
        .run();
    });

  await makeClip(introPath, introDuration);
  await makeClip(outroPath, outroDuration);

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(introPath)
      .input(podcastPath)
      .input(outroPath)
      .complexFilter("[0:a][1:a][2:a]concat=n=3:v=0:a=1[aout]")
      .outputOptions(["-map [aout]"])
      .audioCodec("libmp3lame")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });

  fs.unlinkSync(introPath);
  fs.unlinkSync(outroPath);
}

// ─── Concatenation ────────────────────────────────────────────────────────────

export function concatenateClips(
  clipPaths: string[],
  outputPath: string,
  listFilePath: string
): Promise<void> {
  ensureDir(path.dirname(outputPath));

  // Write the concat manifest with forward-slash absolute paths
  const listContent = clipPaths
    .map((p) => `file '${path.resolve(p).replace(/\\/g, "/")}'`)
    .join("\n");
  fs.writeFileSync(path.resolve(listFilePath), listContent, "utf-8");

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.resolve(listFilePath))
      .inputOptions(["-f concat", "-safe 0"])
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-preset fast", "-crf 23", "-r 30"])
      .output(path.resolve(outputPath))
      .on("end", () => resolve())
      .on("error", reject)
      .run();
  });
}
