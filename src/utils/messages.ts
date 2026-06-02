import type { ExtensionMessage } from '../types';

export function sendMessage<T = unknown>(msg: ExtensionMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

export function sendMessageToTab<T = unknown>(
  tabId: number,
  msg: ExtensionMessage
): Promise<T> {
  return chrome.tabs.sendMessage(tabId, msg) as Promise<T>;
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
