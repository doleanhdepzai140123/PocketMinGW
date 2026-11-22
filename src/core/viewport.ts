import { useEffect } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';

/** Native Keyboard owns WebView resizing; never subtract the keyboard twice. */
export function useAppViewport() {
  useEffect(() => {
    const root = document.documentElement, native = Capacitor.isNativePlatform();
    const handles: PluginListenerHandle[] = [];
    let disposed = false;
    const measure = () => {
      const height = native ? window.innerHeight : window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty('--viewport-height', `${Math.round(height)}px`);
    };
    const setKeyboard = (open: boolean) => {
      root.dataset.keyboard = open ? 'open' : 'closed';
      measure();
      requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('resize', measure);
    if (!native) window.visualViewport?.addEventListener('resize', measure);
    if (native) {
      for (const subscription of [
        Keyboard.addListener('keyboardWillShow', () => setKeyboard(true)),
        Keyboard.addListener('keyboardDidShow', () => setKeyboard(true)),
        Keyboard.addListener('keyboardWillHide', () => setKeyboard(false)),
        Keyboard.addListener('keyboardDidHide', () => setKeyboard(false)),
      ]) {
        void subscription.then(handle => {
          if (disposed) void handle.remove(); else handles.push(handle);
        });
      }
      if (Capacitor.getPlatform() === 'ios') {
        void Keyboard.setAccessoryBarVisible({ isVisible: false });
        void Keyboard.setScroll({ isDisabled: true });
      }
    }
    return () => {
      disposed = true;
      handles.forEach(handle => void handle.remove());
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      delete root.dataset.keyboard;
    };
  }, []);
}

export async function hideKeyboard() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (Capacitor.isNativePlatform()) await Keyboard.hide();
}
