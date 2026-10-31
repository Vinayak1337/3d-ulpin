import { expect } from 'vitest';

/** Check rendered, non-flight controls, including every checkbox and select. */
export function expectDisabledReasons(html: string) {
  let disabled = 0;
  for (const [control] of html.matchAll(/<(?:button|select|input)\b[^>]*>/g)) {
    if (control.startsWith('<input') && !control.includes('type="checkbox"')) continue;
    const description = control.match(/aria-describedby="([^"]+)"/)?.[1];
    if (!control.includes('disabled=""')) {
      expect(description, control).toBeUndefined();
      continue;
    }
    disabled++;
    expect(description, control).toBeTruthy();
    expect(description?.split(' ')).toHaveLength(1);
    const reason = html.match(new RegExp(`<p id="${description}"([^>]*)>([\\s\\S]*?)</p>`));
    expect(reason, control).toBeTruthy();
    expect(reason?.[1]).toContain('color:var(--ui-ink-soft)');
    expect(reason?.[1]).not.toMatch(/hidden|display:none/);
    expect(reason?.[2]?.trim().length).toBeGreaterThan(0);
  }
  return disabled;
}
