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
- Use bracketed expression cues to direct the TTS voice — these are read directly by ElevenLabs and shape delivery, so they must be accurate
- Emotional states (place at the start of a sentence): [warm], [thoughtful], [curious], [surprised], [concerned], [impressed], [excited], [serious], [hopeful], [gentle], [sad]
- Physical actions (place inline, on their own before a phrase): [sighs], [laughs softly], [giggles], [whispers], [clears throat], [pauses]
- Aim for 2-4 cues total for a clip of this length — mix emotional and action types; never stack two cues back to back
- Cues must genuinely match the moment — do not use [excited] for something sombre or [giggles] in a serious moment
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
- Where available, include specific numbers, percentages, counts, or measurements (e.g. "7 out of 10 participants", "42% of users", "took an average of 3 attempts") — these make findings more credible and actionable

Rank the findings from most insightful to least insightful using this priority order:
1. Findings with specific numbers or quantitative evidence (most credible)
2. Findings that reveal surprising, unexpected, or counterintuitive behaviour
3. Findings with clear actionable implications
4. General qualitative observations (least priority)

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

// ─── Insight refinement ───────────────────────────────────────────────────────

/**
 * Rewrites a single research insight finding based on a user instruction
 * (e.g. "summarise further", "make more specific", "rewrite for executives").
 * Returns the revised finding as a single plain-text string.
 */
export async function refineInsight(insightText: string, instruction: string): Promise<string> {
  const client = getClient();

  const prompt = `You are editing a UX research finding based on a user instruction.

Current finding:
"${insightText}"

User instruction: "${instruction}"

Rewrite the finding applying the instruction. Keep it as a single concrete observation in 1-2 sentences. Write in plain English without jargon. Return only the revised finding text with no extra commentary.`;

  const response = await client.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.5,
    max_completion_tokens: 300,
  });

  return response.choices[0]?.message?.content?.trim() ?? insightText;
}

// ─── Script refinement ────────────────────────────────────────────────────────

/**
 * Rewrites an existing narration or podcast script based on a user instruction
 * (e.g. "make it shorter", "add more enthusiasm", "make it formal").
 */
export async function refineScript(currentScript: string, instruction: string): Promise<string> {
  const client = getClient();

  const prompt = `You are editing a voiceover script based on a user instruction.

Current script:
"${currentScript}"

User instruction: "${instruction}"

Rewrite the script applying the instruction. Keep the same approximate length unless told otherwise. Maintain the natural spoken-language style with short sentences and conversational rhythm.

Bracketed expression cues shape TTS delivery — preserve and refine them as you edit:
- Emotional states (start of a sentence): [warm], [thoughtful], [curious], [surprised], [concerned], [impressed], [excited], [serious], [hopeful], [gentle], [sad]
- Physical actions (inline, before a phrase): [sighs], [laughs softly], [giggles], [whispers], [clears throat], [pauses]
- Never stack two cues back to back; cues must match the tone of what follows.

Return only the revised script text with no extra commentary.`;

  const response = await client.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_completion_tokens: 500,
  });

  return response.choices[0]?.message?.content?.trim() ?? currentScript;
}

// ─── Email summary ────────────────────────────────────────────────────────────

export interface EmailSummary {
  subject: string;
  summary: string;
}

/**
 * Generates a short email subject and 2-3 sentence summary for sharing
 * an InsightCuts project via email.
 */
export async function generateEmailSummary(
  projectTitle: string,
  gestureQuery: string,
  clipCount: number,
  insights: string[]
): Promise<EmailSummary> {
  const client = getClient();

  const insightLines = insights.length > 0
    ? `\n\nKey insights:\n${insights.slice(0, 5).map((t, i) => `${i + 1}. ${t}`).join("\n")}`
    : "";

  const prompt = `You are writing a brief email notification about a UX research project summary.

Project: "${projectTitle}"
Research focus: "${gestureQuery}"
Video clips found: ${clipCount}${insightLines}

Write:
1. A concise email subject line (max 10 words, no quotes)
2. A 2-3 sentence summary suitable for an email body — what was found, why it matters

Return a JSON object with:
- "subject": the email subject line
- "summary": the 2-3 sentence body summary

Return ONLY valid JSON.`;

  const response = await client.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.5,
    max_completion_tokens: 200,
  });

  try {
    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}") as { subject?: string; summary?: string };
    return {
      subject: parsed.subject ?? `InsightCuts: ${projectTitle}`,
      summary: parsed.summary ?? "",
    };
  } catch {
    return { subject: `InsightCuts: ${projectTitle}`, summary: "" };
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
- Use bracketed expression cues throughout to shape TTS delivery — ElevenLabs reads these directly, so they must fit the moment exactly
- Emotional states (start of a sentence): [warm], [thoughtful], [curious], [surprised], [concerned], [impressed], [excited], [serious], [hopeful], [gentle], [sad]
- Physical actions (inline, before a phrase or on their own): [sighs], [laughs softly], [giggles], [whispers], [clears throat], [pauses]
- Aim for roughly one cue every 3-5 sentences — vary between emotional and action types; never stack two cues back to back
- The cue must genuinely match the tone of what follows — wrong-tone cues break the illusion of natural speech
- No markdown, no bullet points, no headers, no speaker labels
- Approximately 1200-1800 words total`;

  const response = await client.chat.completions.create({
    model: "gpt-5.2",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.75,
    max_completion_tokens: 4000,
  });

  return response.choices[0]?.message?.content?.trim() ?? "";
}
