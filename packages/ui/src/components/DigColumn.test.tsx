import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { DigColumn } from './DigColumn';

type Node = ReactElement<{ children?: unknown }>;
const children = (node: Node) => [node.props.children].flat().filter(isValidElement) as Node[];

describe('DigColumn', () => {
  it('states that a screening result is not a dig clearance', () => {
    const [, body] = children(DigColumn({ range: '0-2 m', bands: [] }) as Node);
    expect(children(body!)[0]!.props.children).toBe('Screening only, not a dig clearance.');
  });
});
