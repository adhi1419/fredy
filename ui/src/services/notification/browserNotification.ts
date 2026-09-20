/*
 * Copyright (c) 2026 by Christian Kellner.
 * Licensed under Apache-2.0 with Commons Clause and Attribution/Naming Clause
 */

import heart from '../../assets/heart.png';

type Translate = (key: string, variables?: Record<string, string | number>) => string;

/**
 * Triggers a test browser notification, requesting permission if needed.
 *
 * @param t - The translation function
 * @param onSuccess - Callback when notification succeeds
 * @param onError - Callback when there is a validation or permission error
 */
export function triggerTestNotification(
  t: Translate,
  onSuccess: (message: string) => void,
  onError: (message: string) => void,
): void {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      const notification = new Notification('Test Call from Fredy', {
        body: 'Everything works perfectly! Real-time listings will appear here.',
        icon: heart,
      });
      notification.onclick = () => {
        window.focus();
      };
      onSuccess(t('notification.trySuccess'));
    } else if (Notification.permission === 'denied') {
      onError(t('notification.browserPermissionDenied'));
    } else {
      const handlePermissionResult = (permission: NotificationPermission) => {
        if (permission === 'granted') {
          const notification = new Notification('Test Call from Fredy', {
            body: 'Everything works perfectly! Real-time listings will appear here.',
            icon: heart,
          });
          notification.onclick = () => {
            window.focus();
          };
          onSuccess(t('notification.trySuccess'));
        } else if (permission === 'denied') {
          onError(t('notification.browserPermissionDenied'));
        }
      };

      try {
        const promise = Notification.requestPermission(handlePermissionResult);
        if (promise && typeof promise.then === 'function') {
          promise.then(handlePermissionResult).catch((err: unknown) => {
            onError(t('notification.tryError', { error: String(err) }));
          });
        }
      } catch {
        // Fallback for callback interface
      }
    }
  } else {
    onError(t('notification.browserNotSupported'));
  }
}
