import type { Page } from '@playwright/test';

/** Reads only byte counts and completion; does not replace the product stream or manufacture event frames. */
export function observeEventReads(page: Page) {
  return page.addInitScript(() => {
    const actual = window.fetch;
    (window as any).__eventReads = [];
    window.fetch = async (...args) => {
      const response = await actual(...args);
      if (response.url.includes('/events') && response.body) {
        const get = response.body.getReader.bind(response.body);
        response.body.getReader = (() => {
          const reader = get();
          const read = reader.read.bind(reader);
          reader.read = async () => {
            try {
              const value = await read();
              (window as any).__eventReads.push({ at: Date.now(), done: value.done, bytes: value.value?.length ?? 0 });
              return value;
            } catch (error: any) {
              (window as any).__eventReads.push({ at: Date.now(), error: error.message });
              throw error;
            }
          };
          return reader;
        }) as typeof response.body.getReader;
      }
      return response;
    };
  });
}
