export interface User {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  role: string;
  is_verified: boolean;
  plan?: string;
  subscription_status?: string;
  tokens_used?: number;
  weekly_tokens_limit?: number;
  bonus_tokens?: number;
}

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
  index: number;
}

export interface TranscriptSegmentWithTimestamp {
  timestamp: string;
  text: string;
}

export type ExtractionSource = 'transcript_panel' | 'live_captions' | 'unavailable';

export type DetectedLanguage = 'arabic' | 'latin' | 'unknown';

export interface ExtractionResult {
  success: true;
  videoId: string;
  videoTitle: string;
  segments: TranscriptSegmentWithTimestamp[];
  transcript: string;
  source: ExtractionSource;
  language: DetectedLanguage;
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  transcript: string;
  source?: string;
}

export interface TranslationResult {
  success: boolean;
  translation_id?: number;
  transcript: string;
  gloss: string[];
  animations: string[];
  tokens_used: number;
  remaining_tokens: number;
  source?: string;
}

export interface CachedTranscript {
  videoId: string;
  segments: { start: number; duration: number; text: string }[];
  transcript: string;
  timestamp: number;
}

export interface VideoInfo {
  videoId: string | null;
  videoTitle: string | null;
  videoUrl: string | null;
}

export interface SessionData {
  token: string | null;
  refresh: string | null;
  user: User | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
  loading: boolean;
}

export type TranscriptState = 'idle' | 'extracting' | 'available' | 'unavailable' | 'error';

export type TranslationState = 'idle' | 'translating' | 'complete' | 'error';

export type MessageType =
  | 'VIDEO_INFO'
  | 'GET_VIDEO_INFO'
  | 'PING'
  | 'AUTH_STATE_CHANGED'
  | 'TRANSCRIPT_READY'
  | 'TRANSCRIPT_ERROR'
  | 'TRANSLATION_RESULT'
  | 'START_TRANSLATION'
  | 'EXTRACT_TRANSCRIPT'
  | 'OPEN_SIDE_PANEL'
  | 'AUTH_EXPIRED'
  | 'REFRESH_TOKEN'
  | 'EXTRACT_TRANSCRIPT_DOM'
  | 'EXTRACT_TRANSCRIPT_DOM_RESULT';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload?: T;
  error?: string;
}

export interface TranscriptReadyPayload {
  videoId: string;
  videoTitle: string;
  transcript: string;
  segments: TranscriptSegmentWithTimestamp[];
  source: ExtractionSource;
  language: DetectedLanguage;
}

export interface TranslationResultPayload {
  jobId: number;
  result: TranslationResult;
}

export interface StartTranslationPayload {
  videoId: string;
  videoTitle: string;
  transcript: string;
  segments?: TranscriptSegmentWithTimestamp[];
}

export interface PopupState {
  auth: AuthState;
  videoInfo: VideoInfo;
  transcriptState: TranscriptState;
  translationState: TranslationState;
  error: string | null;
}
