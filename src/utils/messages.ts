import type { ExtensionMessage } from '../types';

export async function sendMessage<T = unknown>(msg: ExtensionMessage): Promise<T> {
  try {
    if (!chrome.runtime?.id) {
      console.warn('[TAFAHOM] Extension context lost in messages.ts');
      return Promise.reject(new Error('Extension context invalidated'));
    }
    return await chrome.runtime.sendMessage(msg);
  } catch (e) {
    console.error('[TAFAHOM] sendMessage failed:', e);
    return Promise.reject(e);
  }
}

export async function sendMessageToTab<T = unknown>(
  tabId: number,
  msg: ExtensionMessage
): Promise<T> {
  try {
    if (!chrome.runtime?.id) {
      console.warn('[TAFAHOM] Extension context lost in messages.ts');
      return Promise.reject(new Error('Extension context invalidated'));
    }
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    console.error('[TAFAHOM] sendMessageToTab failed:', e);
    return Promise.reject(e);
  }
}

export function sendMessageToCurrentTab<T = unknown>(
  msg: ExtensionMessage
): Promise<T> {
  return chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (!tab?.id) throw new Error('No active tab');
      return sendMessageToTab<T>(tab.id, msg);
    });
}
