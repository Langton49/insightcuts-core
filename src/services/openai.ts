import OpenAI from "openai";
import fs from "fs";
import path from "path";
import type { ExtractedInsight } from "../types.js";

function getClient(): OpenAI {
  const apiKey = process.env.CHATGPT_API;
  if (!apiKey) throw new Error("CHATGPT_API env var is not set");
  return new OpenAI({ apiKey });
}

// ─── Clip narration (Vision-based) ────────────────────────────────────────────

export interface ClipNarrationContext {
  gestureQuery: string;
  clipIndex: number;
  totalClips: number;
  gestureTimestamp: number;
  clipDuration: number;
  confidence: string;
  /** Full research document text — used only when no linkedInsight is provided */
  documentText: string;
  /**
   * Research findings the user has linked to this clip (0 to many).
   * When present, narration describes the moment and ties in the findings.
   * When absent, narration is grounded in the gesture query and context.
   */
  linkedInsights?: string[];
}

/**
 * Generates narration for a single video clip using gpt-5.2 Vision.
 * Sends actual frames extracted from the clip so the narration is grounded in
 * what is literally on screen, not a generic search query description.
 * Also receives the full document text and identifies which findings are relevant
 * to this specific clip.
 */
export async function generateClipNarration(ctx: ClipNarrationContext): Promise<string> {
  const client = getClient();

  const targetWords = Math.max(10, Math.round(ctx.clipDuration * 2.2));
  const minutes = Math.floor(ctx.gestureTimestamp / 60);
  const seconds = Math.floor(ctx.gestureTimestamp % 60);
  const tsFormatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const hasLinkedInsights = (ctx.linkedInsights?.length ?? 0) > 0;

  // When specific insights are linked by the researcher, use those exclusively.
  // When none are linked, fall back to the full document text for general context.
  const contextSection = hasLinkedInsights
    ? `\n\nThe researcher has linked the following finding${ctx.linkedInsights!.length > 1 ? "s" : ""} to this clip:\n${ctx.linkedInsights!.map((t, i) => `${i + 1}. "${t}"`).join("\n")}`
    : ctx.documentText.trim()
    ? `\n\nResearch context (pick the most relevant finding for what you see on screen):\n${ctx.documentText}`
    : "";

  const insightInstruction = hasLinkedInsights
    ? `- In 1-2 sentences describe what you can see on screen, then in 1-2 more sentences connect this moment to the linked finding${ctx.linkedInsights!.length > 1 ? "s" : ""} above`
    : ctx.documentText.trim()
    ? `- Describe what you can see on screen (1-2 sentences), then if relevant connect it to the most applicable finding from the research context`
    : `- Describe what you can see on screen in 1-2 sentences`;

  const textPrompt = `You are writing voiceover narration that will be read aloud by a text-to-speech voice. Write narration for clip ${ctx.clipIndex + 1} of ${ctx.totalClips}.

This is a ${ctx.clipDuration.toFixed(1)}-second clip at timestamp ${tsFormatted}, detected while searching for: "${ctx.gestureQuery}".${contextSection}

Requirements:
- Target approximately ${targetWords} words
- ${insightInstruction}
- Write as natural spoken language — short sentences, conversational rhythm
- Use commas and short pauses naturally, like a person actually talking
- Avoid long complex sentences — break them into 2-3 short ones instead
- Use bracketed emotion cues (e.g. [thoughtful], [surprised], [concerned], [curious], [impressed]) where they naturally fit the tone — place them at the start of a sentence or before a key word; emotions must match what is actually being described
- Plain text only — no markdown, no bullet points, no quotation marks
- Do not begin with "In this clip", "Here we see", or "This clip shows"`;

  const response = await client.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: textPrompt }],
    temperature: 0.7,
    max_completion_tokens: 350,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}

// ─── Insight extraction ───────────────────────────────────────────────────────

/**
 * Extracts 15 key research findings from document text using gpt-5.2,
 * ranked from most insightful to least.
 * Returns an array of ExtractedInsight objects the user can link to clips.
 */
export async function extractInsights(
  documentText: string,
  sourceLabel: string
): Promise<ExtractedInsight[]> {
  const client = getClient();

  const prompt = `You are analyzing a UX research document. Extract exactly 15 distinct, actionable research findings from the text below.

Each finding should be:
- A single concrete observation, behaviour, or data point (1-2 sentences)
- Specific enough to connect to a particular moment in a video recording
- Written in plain English without jargon

Rank the findings from most insightful to least insightful. Put the most surprising, impactful, or non-obvious findings first. Put more generic or expected observations last.

Document source: "${sourceLabel}"

Document text:
${documentText}

Return a JSON object with an "insights" array of exactly 15 elements, ordered from most to least insightful. Each element must have:
- "id": a short slug (e.g. "finding-1" through "finding-15")
- "text": the finding in 1-2 sentences
- "source": the document filename "${sourceLabel}"

Return ONLY valid JSON, no other text.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_completion_tokens: 2500,
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { insights?: unknown[] };
    const arr = Array.isArray(parsed.insights) ? parsed.insights : [];

    return arr.map((item, i) => {
      const obj = item as Record<string, unknown>;
      return {
        id: typeof obj.id === "string" ? obj.id : `insight-${i}`,
        text: typeof obj.text === "string" ? obj.text : String(item),
        source: typeof obj.source === "string" ? obj.source : sourceLabel,
      };
    });
  } catch (err) {
    console.warn(`[OpenAI] extractInsights failed for "${sourceLabel}":`, (err as Error).message);
    return [];
  }
}

// ─── Clip transcript via Whisper ──────────────────────────────────────────────

/**
 * Transcribes the audio track of a clip file (MP4 or MP3) using OpenAI Whisper.
 * Returns empty string on failure so podcast generation degrades gracefully.
 */
export async function transcribeClipAudio(filePath: string): Promise<string> {
  const client = getClient();
  try {
    const transcription = await client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
    });
    return transcription.text.trim();
  } catch (err) {
    console.warn(`  [Whisper] Transcription failed for ${path.basename(filePath)}:`, (err as Error).message);
    return "";
  }
}

// ─── Podcast script ───────────────────────────────────────────────────────────

export interface PodcastScriptContext {
  projectTitle: string;
  gestureQuery: string;
  clips: Array<{
    index: number;
    timestamp: number;
    confidence: string;
    transcript: string;
  }>;
  documentText: string;
}

/**
 * Generates a full long-form podcast script from research documents,
 * clip metadata, and video transcripts.
 */
export async function generatePodcastScript(ctx: PodcastScriptContext): Promise<string> {
  const client = getClient();

  const clipSummaries = ctx.clips
    .map((c) => {
      const m = Math.floor(c.timestamp / 60);
      const s = Math.floor(c.timestamp % 60);
      const ts = `${m}:${s.toString().padStart(2, "0")}`;
      const transcriptLine = c.transcript.trim()
        ? `\n   Transcript: "${c.transcript.slice(0, 400)}"`
        : "";
      return `  - Clip ${c.index + 1} at ${ts} · confidence: ${c.confidence}${transcriptLine}`;
    })
    .join("\n");

  const prompt = `You are writing a podcast script that will be read aloud by a text-to-speech voice. Write a complete, natural-sounding podcast episode based on the following research material.

Project: "${ctx.projectTitle}"
Research focus: "${ctx.gestureQuery}"

Detected video moments:
${clipSummaries}

Research documents content:
${ctx.documentText}

Cover these sections in flowing spoken audio (no headers, no bullet points, just natural continuous speech):
1. Opening (30-45 seconds) — welcome the listener and introduce the research topic
2. Document findings (2-3 minutes) — walk through the key findings from the research documents in a clear, accessible way
3. Video evidence (1-2 minutes) — describe what was found in the video clips and what it reveals
4. Synthesis (1-2 minutes) — connect the document findings with the video evidence and explain what it means
5. Close (20-30 seconds) — wrap up with the key takeaway

Writing style requirements — this will be read aloud by TTS, so:
- Write short sentences. Break long thoughts into 2-3 sentences.
- Use natural spoken rhythm — the way a person actually talks, not formal writing
- Use commas to create natural breathing pauses
- Vary sentence length — mix short punchy sentences with slightly longer ones
- Sprinkle bracketed emotion cues throughout (e.g. [thoughtful], [surprised], [sigh], [excited], [curious], [concerned], [impressed], [warm], [serious]) to make the delivery feel natural — place them at the start of a sentence or just before a key phrase; the emotion must genuinely match the sentiment of what is being said
- No markdown, no bullet points, no headers, no speaker labels
- Approximately 1200-1800 words total`;

  const response = await client.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.75,
    max_completion_tokens: 2500,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}
