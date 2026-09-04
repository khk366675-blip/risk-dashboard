'use client';
import { useEffect } from 'react';
import { discardThesisMessage } from './thesis-workspace';

export function useThesisNavigationGuard(
  dirty: boolean,
  confirmDiscard: (message: string) => Promise<boolean>,
) {
  useEffect(() => {
    if (!dirty) return;
    let approvedUnload = false;
    const unload = (event: BeforeUnloadEvent) => {
      if (!approvedUnload) event.preventDefault();
    };
    const link = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target =
        event.target instanceof Element
          ? event.target.closest('a[href]')
          : null;
      if (
        !(target instanceof HTMLAnchorElement) ||
        target.target === '_blank' ||
        target.hasAttribute('download') ||
        target.href === location.href
      )
        return;
      const href = target.href;
      event.preventDefault();
      event.stopPropagation();
      void confirmDiscard(discardThesisMessage).then((approved) => {
        if (!approved) return;
        approvedUnload = true;
        window.location.assign(href);
      });
    };
    // Chromium's Navigation API can cancel same-document Back/Forward, unlike popstate.
    const navigation = (window as unknown as { navigation?: EventTarget })
      .navigation;
    const traverse = (event: Event) => {
      if (
        (event as Event & { navigationType?: string }).navigationType ===
          'traverse' &&
        event.cancelable &&
        !window.confirm(discardThesisMessage)
      )
        event.preventDefault();
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', link, true);
    navigation?.addEventListener('navigate', traverse);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', link, true);
      navigation?.removeEventListener('navigate', traverse);
    };
  }, [dirty, confirmDiscard]);
}
