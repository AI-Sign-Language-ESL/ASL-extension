import type { CachedTranscript } from '../types';
import { logger } from './logger';

const CACHE_PREFIX = 'transcript_cache_';
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function getCachedTranscript(videoId: string): Promise<CachedTranscript | null> {
  try {
    const key = `${CACHE_PREFIX}${videoId}`;
    const result = await chrome.storage.local.get(key);
    const cached = result[key] as CachedTranscript | undefined;
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      await removeCachedTranscript(videoId);
      return null;
    }
    logger.info('Transcript cache hit for', videoId);
    return cached;
  } catch {
    return null;
  }
}

export async function setCachedTranscript(
  videoId: string,
  data: { segments: { start: number; duration: number; text: string }[]; transcript: string }
): Promise<void> {
  try {
    const cached: CachedTranscript = {
      videoId,
      segments: data.segments,
      transcript: data.transcript,
      timestamp: Date.now(),
    };
    await chrome.storage.local.set({ [`${CACHE_PREFIX}${videoId}`]: cached });
    logger.info('Transcript cached for', videoId);
  } catch (e) {
    logger.warn('Failed to cache transcript:', e);
  }
}

export async function removeCachedTranscript(videoId: string): Promise<void> {
  await chrome.storage.local.remove(`${CACHE_PREFIX}${videoId}`);
}

export async function clearExpiredCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const deletions: string[] = [];
  for (const [key, val] of Object.entries(all)) {
    if (key.startsWith(CACHE_PREFIX)) {
      const cached = val as CachedTranscript;
      if (now - cached.timestamp > CACHE_TTL) {
        deletions.push(key);
      }
    }
  }
  if (deletions.length > 0) {
    await chrome.storage.local.remove(deletions);
    logger.info(`Cleared ${deletions.length} expired transcript caches`);
  }
}
