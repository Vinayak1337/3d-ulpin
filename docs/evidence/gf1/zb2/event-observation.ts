import type { Page } from '@playwright/test';

/** Records each case-event frame the page's own reader receives; does not replace the stream or add frames. */
export function observeEventFrames(page: Page) {
  return page.addInitScript(() => {
    const actual = window.fetch;
    const frames: { at: number; text: string }[] = [];
    (window as any).__eventFrames = frames;
    window.fetch = async (...args) => {
      const response = await actual(...args);
      if (response.url.includes('/events') && response.body) {
        const get = response.body.getReader.bind(response.body);
        response.body.getReader = (() => {
          const reader = get();
          const read = reader.read.bind(reader);
          const decoder = new TextDecoder();
          reader.read = async () => {
            const value = await read();
            if (value.value) frames.push({ at: Date.now(), text: decoder.decode(value.value, { stream: true }) });
            return value;
          };
          return reader;
        }) as typeof response.body.getReader;
      }
      return response;
    };
  });
}
