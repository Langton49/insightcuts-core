// ─── Twelve Labs results ──────────────────────────────────────────────────────

export interface GestureMatch {
  videoId: string;
  score: number;
  confidence: string; // 'high' | 'medium' | 'low' | string
  start: number;      // seconds — start of the matched segment in the indexed video
  end: number;        // seconds — end of the matched segment
  gestureTimestamp: number; // midpoint of the matched segment
  /** Per-match thumbnail from TL's search result */
  thumbnailUrl?: string;
}

// ─── Insights ─────────────────────────────────────────────────────────────────

/** A key research finding extracted from an uploaded document by GPT-4o. */
export interface ExtractedInsight {
  id: string;
  text: string;
  /** Original document filename this insight was pulled from */
  source: string;
}

// ─── Pipeline config ──────────────────────────────────────────────────────────

export interface PipelineConfig {
  /** Absolute path to the source video file */
  videoPath: string;
  /** Original filename as uploaded by the user (for display — not the UUID on disk) */
  sourceFileName?: string;
  /** Natural-language description of the gesture/moment to find */
  gestureQuery: string;
  /** Twelve Labs index name — created if it doesn't exist (default: "insightcuts") */
  indexName?: string;
  /** Seconds of video to include before the gesture timestamp (default: 30) */
  clipBefore?: number;
  /** Seconds of video to include after the gesture timestamp (default: 10) */
  clipAfter?: number;
  /** Max number of gesture moments to extract (default: 5) */
  maxClips?: number;
  /** Directory where clips and the final brief will be written (default: ./output) */
  outputDir?: string;
  /** Title card title text */
  title?: string;
  /** Title card subtitle text */
  subtitle?: string;
  /**
   * Only keep matches with these confidence levels.
   * e.g. ['high', 'medium'] — omit to keep all.
   */
  confidenceFilter?: string[];
  /** Absolute paths to uploaded PDF/DOCX/TXT research documents */
  documentPaths?: string[];
  /** Generate AI narration audio for each clip and replace clip audio (default: true) */
  generateNarration?: boolean;
  /** Generate a standalone podcast.mp3 from documents + clip data (default: true when documentPaths present) */
  generatePodcast?: boolean;
  /**
   * User-linked insights: maps original match index → array of insight texts.
   * Multiple findings can be linked to a single clip. The narration will
   * describe what's on screen and weave in all linked findings.
   */
  clipInsights?: Record<number, string[]>;
  /** ElevenLabs voice ID for narration and podcast TTS (overrides default voice) */
  narrationVoice?: string;
  /** Layout style applied to all clips unless overridden per-clip */
  globalLayout?: string;
  /** Per-clip layout overrides: maps original match index → LayoutStyle */
  clipLayouts?: Record<number, string>;
  /**
   * Pre-generated narration scripts from the Narration Panel.
   * Maps original match index → script text.
   * When present for a clip, assembly uses the script directly and skips
   * GPT-4o Vision re-generation — only ElevenLabs TTS is called.
   */
  clipNarrationScripts?: Record<number, string>;
  /**
   * Absolute path to the background music file selected in MusicPanel.
   * When provided, it is mixed into the assembled brief at low volume (-18 dB).
   * Resolved from backgroundTrackId by the server before passing to the pipeline.
   */
  backgroundMusicPath?: string;
  /**
   * If set, skip the Twelve Labs upload step and use this existing TL video ID for search.
   * The video must already be indexed. Paired with existingIndexId.
   */
  existingVideoId?: string;
  /** Twelve Labs index ID for the already-indexed video. Required when existingVideoId is set. */
  existingIndexId?: string;
  /** HLS stream URL for the already-indexed video (optional, for browser preview). */
  existingHlsUrl?: string | null;
}

// ─── Detection result (after TL, before FFmpeg) ───────────────────────────────

export interface DetectionResult {
  indexId: string;
  videoId: string;
  /** HLS stream URL for the indexed video — use with hls.js to preview matches */
  hlsUrl: string | null;
  matches: GestureMatch[];
  /** Duration of the source video in seconds — set during detection */
  sourceDuration: number;
}

// ─── Assembly result (after FFmpeg) ──────────────────────────────────────────

export interface ExtractedClip {
  index: number;
  match: GestureMatch;
  /** Absolute path to the raw extracted clip */
  rawPath: string;
  /** Absolute path to the clip with lower-third overlay */
  overlaidPath: string;
  /** Actual start second used when cutting from the source video */
  clipStart: number;
  /** Actual duration of the cut in seconds */
  clipDuration: number;
  /** Absolute path to the per-clip narration MP3 (if narration was generated) */
  narrationPath?: string;
}

export interface AssemblyResult {
  clips: ExtractedClip[];
  /** Absolute path to the assembled brief video */
  briefPath: string;
  briefDuration: number;
  /** Absolute path to the generated podcast audio (if documents were provided) */
  podcastPath?: string;
}

/** @deprecated Use DetectionResult + AssemblyResult separately */
export interface PipelineResult {
  indexId: string;
  videoId: string;
  hlsUrl: string | null;
  matches: GestureMatch[];
  clips: ExtractedClip[];
  briefPath: string;
  briefDuration: number;
}
