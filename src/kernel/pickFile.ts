/**
 * Asks the user for one file.
 *
 * `showOpenFilePicker()` would be tidier but only exists on Chromium, and this desktop supports
 * three browsers. A hidden `<input type="file">` is the portable version of the same gesture, and
 * it is the user's own file dialog either way — the page never sees a path, only what is chosen.
 *
 * The element is deliberately not appended to the document: Safari once required it, current
 * versions do not, and an element in the tree is one more thing that can be styled or clicked.
 */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;

    // A cancelled dialog fires `cancel` in current browsers and nothing at all in older ones, so
    // the promise also settles when focus comes back to the page.
    const settle = (file: File | null) => {
      globalThis.removeEventListener('focus', onFocus);
      resolve(file);
    };
    const onFocus = () => setTimeout(() => settle(input.files?.[0] ?? null), 300);

    input.addEventListener('change', () => settle(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => settle(null), { once: true });
    globalThis.addEventListener('focus', onFocus, { once: true });

    input.click();
  });
}
