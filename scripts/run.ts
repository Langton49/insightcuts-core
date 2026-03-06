/**
 * InsightCuts Core — CLI runner (detect + assemble all matches non-interactively)
 *
 * Usage:
 *   npx tsx scripts/run.ts --video /path/to/video.mp4 --query "person pointing at screen"
 *
 * Flags:
 *   --video      <path>     Required. Path to the source video file.
 *   --query      <text>     Required. Natural-language gesture description.
 *   --index      <name>     TL index name (default: "insightcuts")
 *   --before     <seconds>  Clip seconds before gesture (default: 30)
 *   --after      <seconds>  Clip seconds after gesture  (default: 10)
 *   --max        <n>        Max clips to extract (default: 5)
 *   --output     <dir>      Output directory (default: ./output)
 *   --title      <text>     Title card title
 *   --subtitle   <text>     Title card subtitle
 *   --confidence <levels>   Comma-separated: high,medium,low (default: all)
 *   --keep                  Keep the video indexed in TL after pipeline finishes
 */

import "dotenv/config";
import path from "path";
import fs from "fs";
import { runDetection, runAssembly } from "../src/pipeline.js";
import type { PipelineConfig } from "../src/types.js";

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.video || !args.query) {
  console.error(
    "Usage: npx tsx scripts/run.ts --video <path> --query <text> [options]\n\n" +
      "  --video      Path to the source video file (required)\n" +
      "  --query      Gesture description to search for (required)\n" +
      "  --index      TL index name (default: insightcuts)\n" +
      "  --before     Seconds before gesture (default: 30)\n" +
      "  --after      Seconds after gesture (default: 10)\n" +
      "  --max        Max clips (default: 5)\n" +
      "  --output     Output directory (default: ./output)\n" +
      "  --title      Title card text\n" +
      "  --subtitle   Subtitle card text\n" +
      "  --confidence Comma-separated confidence levels (high,medium,low)\n" +
      "  --keep       Keep video indexed in Twelve Labs after pipeline\n"
  );
  process.exit(1);
}

const videoPath = path.resolve(args.video as string);
if (!fs.existsSync(videoPath)) {
  console.error(`Error: video file not found: ${videoPath}`);
  process.exit(1);
}

const config: PipelineConfig = {
  videoPath,
  gestureQuery:    args.query as string,
  indexName:       (args.index    as string) ?? "insightcuts",
  clipBefore:      args.before    ? Number(args.before)    : 30,
  clipAfter:       args.after     ? Number(args.after)     : 10,
  maxClips:        args.max       ? Number(args.max)       : 5,
  outputDir:       path.resolve((args.output as string) ?? "./output"),
  title:           (args.title    as string) ?? "InsightCuts Brief",
  subtitle:        (args.subtitle as string) ?? `Query: "${args.query}"`,
  confidenceFilter: args.confidence
    ? (args.confidence as string).split(",").map((s) => s.trim())
    : undefined,
  keepIndexed: !!args.keep,
};

// ─── Run ──────────────────────────────────────────────────────────────────────

console.log("[run] Config:", JSON.stringify(config, null, 2), "\n");

async function main() {
  const detection = await runDetection(config);

  if (!detection.matches.length) {
    console.log("[run] No matches found — nothing to assemble.");
    return;
  }

  console.log(`\n[run] Detection complete — ${detection.matches.length} match(es):`);
  detection.matches.forEach((m, i) => {
    const ts = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
    console.log(
      `  [${i + 1}] ${ts(m.gestureTimestamp)}  score=${m.score.toFixed(2)}  confidence=${m.confidence}  (${ts(m.start)}–${ts(m.end)})`
    );
  });
  if (detection.hlsUrl) console.log(`\n[run] HLS preview: ${detection.hlsUrl}`);

  const assembly = await runAssembly(config, detection);

  console.log("\n[run] Assembly complete!");
  console.log(`  Brief    : ${assembly.briefPath}`);
  console.log(`  Duration : ${assembly.briefDuration.toFixed(1)}s`);
  console.log(`  Clips    : ${assembly.clips.length}`);

  const summaryPath = path.join(path.dirname(assembly.briefPath), "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify({ detection, assembly }, null, 2), "utf-8");
  console.log(`  Summary  : ${summaryPath}`);
}

main().catch((err: Error) => {
  console.error("\n[run] Failed:", err.message);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
