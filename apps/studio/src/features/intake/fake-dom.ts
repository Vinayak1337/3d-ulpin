/**
 * Test support only. The Studio tests run in Node without a DOM, and the server renderer never checks keys, so this
 * is the least document that lets react-dom/client mount a page: React's own duplicate-key warning then fires as it
 * does in the browser, and handlers are pressed through the props React keeps on each node. Import it first.
 */
class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  constructor(public nodeType: number, public nodeName: string, public ownerDocument: FakeDocument | null) {}
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get lastChild(): FakeNode | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child: FakeNode) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    if (!before) return this.appendChild(child);
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    return child;
  }
  removeChild(child: FakeNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  get textContent(): string { return this.childNodes.map((child) => child.textContent).join(''); }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(new FakeText(String(value), this.ownerDocument));
  }
  addEventListener() {}
  removeEventListener() {}
}

class FakeText extends FakeNode {
  constructor(public data: string, owner: FakeDocument | null) { super(3, '#text', owner); }
  get nodeValue() { return this.data; }
  set nodeValue(value: string) { this.data = value; }
  override get textContent() { return this.data; }
  override set textContent(value: string) { this.data = value; }
}

class FakeElement extends FakeNode {
  attributes = new Map<string, string>();
  style: Record<string, unknown> = { setProperty() {}, removeProperty() {} };
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  constructor(public tagName: string, owner: FakeDocument | null) { super(1, tagName, owner); }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  /** A select's options, which React walks to mark the chosen one. */
  get options(): FakeElement[] { return elements(this).filter((node) => node.tagName === 'OPTION'); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() {}
}

class FakeDocument extends FakeNode {
  activeElement: FakeElement | null = null;
  body: FakeElement;
  documentElement: FakeElement;
  defaultView: unknown = null;
  constructor() {
    super(9, '#document', null);
    this.documentElement = this.appendChild(this.createElement('HTML')) as FakeElement;
    this.body = this.documentElement.appendChild(this.createElement('BODY')) as FakeElement;
  }
  createElement(tag: string) { return new FakeElement(tag.toUpperCase(), this); }
  createElementNS(_namespace: string, tag: string) { return this.createElement(tag); }
  createTextNode(text: string) { return new FakeText(text, this); }
  createComment(text: string) { return new FakeText(text, this); }
}

const document = new FakeDocument();
const window = { document, HTMLIFrameElement: class {}, addEventListener() {}, removeEventListener() {},
  location: { href: 'http://localhost/' } };
document.defaultView = window;
Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true });

export type { FakeElement };

/** A fresh mount point in the fake document. */
export function container() {
  return document.body.appendChild(document.createElement('div')) as FakeElement;
}

/** Every element under the root, in document order. */
export function elements(root: FakeNode): FakeElement[] {
  return root.childNodes.flatMap((child) => child instanceof FakeElement ? [child, ...elements(child)] : []);
}

/** The props React keeps on a node it rendered. */
export function propsOf(node: FakeElement): Record<string, (...args: unknown[]) => unknown> {
  const key = Object.keys(node).find((name) => name.startsWith('__reactProps$'));
  if (!key) throw new Error(`${node.tagName} was not rendered by React.`);
  return (node as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[key]!;
}

/** The button whose words are exactly `words`. */
export function button(root: FakeNode, words: string) {
  const found = elements(root).find((node) => node.tagName === 'BUTTON' && node.textContent.trim() === words);
  if (!found) throw new Error(`No button reads "${words}".`);
  return found;
}
