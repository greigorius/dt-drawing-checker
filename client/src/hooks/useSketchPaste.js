import { useEffect } from 'react';

/**
 * Listens for paste events and fires onPaste(dataUrl, naturalWidth, naturalHeight)
 * whenever an image is found on the clipboard.
 *
 * @param {(dataUrl: string, w: number, h: number) => void} onPaste
 * @param {boolean} enabled  — set false to disable the listener
 */
export function useSketchPaste(onPaste, enabled = true) {
  useEffect(() => {
    if (!enabled || !onPaste) return;

    const handler = (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItem = items.find(it => it.type.startsWith('image/'));
      if (!imageItem) return;
      e.preventDefault();

      const blob = imageItem.getAsFile();
      if (!blob) return;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const img = new Image();
        img.onload = () => onPaste(dataUrl, img.naturalWidth, img.naturalHeight);
        img.src = dataUrl;
      };
      reader.readAsDataURL(blob);
    };

    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [onPaste, enabled]);
}
