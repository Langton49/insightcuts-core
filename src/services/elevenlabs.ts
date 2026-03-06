import fs from "fs";
import path from "path";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

const DEFAULT_VOICE_ID = "DLsHlh26Ugcm6ELvS0qi";

function getVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
}

function getApiKey(): string {
  const key = process.env.ELEVEN_LABS_API;
  if (!key) throw new Error("ELEVEN_LABS_API env var is not set");
  return key;
}

// ElevenLabs TTS API hard-limits request text to 5000 characters.
const TTS_MAX_CHARS = 4800; // safe margin

/**
 * Splits text into chunks at sentence boundaries, each ≤ TTS_MAX_CHARS characters.
 */
function splitIntoChunks(text: string): string[] {
  if (text.length <= TTS_MAX_CHARS) return [text];

  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > TTS_MAX_CHARS) {
    let splitAt = TTS_MAX_CHARS;
    // Prefer splitting at the end of a sentence within the window
    const sentenceEnd = Math.max(
      remaining.lastIndexOf(". ", splitAt),
      remaining.lastIndexOf("! ", splitAt),
      remaining.lastIndexOf("? ", splitAt),
    );
    if (sentenceEnd > TTS_MAX_CHARS * 0.5) {
      splitAt = sentenceEnd + 1; // include the punctuation
    } else {
      // Fall back to the last word boundary
      const spaceIdx = remaining.lastIndexOf(" ", splitAt);
      if (spaceIdx > 0) splitAt = spaceIdx;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function ttsChunk(text: string, voiceId: string, apiKey: string): Promise<Buffer> {
  const response = await fetch(`${ELEVENLABS_API}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_v3",
      voice_settings: {
        stability: 0.28,       // lower = more expressive variation between sentences
        similarity_boost: 0.72, // slight reduction allows more natural prosody
        style: 0.60,           // higher style exaggeration for emotive delivery
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(`ElevenLabs API error ${response.status}: ${body}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Generates speech audio from text and writes it to outputPath as MP3.
 * Automatically splits text longer than 4800 characters into chunks and
 * concatenates the resulting MP3 streams into a single file.
 * @param voiceId Optional ElevenLabs voice ID — overrides the env/default voice.
 */
export async function generateAudio(text: string, outputPath: string, voiceId?: string): Promise<void> {
  if (!text.trim()) throw new Error("Cannot generate audio from empty text");

  const apiKey = getApiKey();
  voiceId = voiceId ?? getVoiceId();

  const chunks = splitIntoChunks(text);
  const buffers = await Promise.all(chunks.map(chunk => ttsChunk(chunk, voiceId!, apiKey)));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // MP3 is a streaming format — frames are self-contained, so buffers can be
  // safely concatenated directly into a single valid MP3 file.
  fs.writeFileSync(outputPath, Buffer.concat(buffers));
}
