const METHODS = ['get', 'post', 'patch', 'put', 'delete', 'head', 'options'];

/**
 * The `operations` list of docs/api/source-pins.json: every `METHOD /path` in the published schema, sorted.
 * Catalogue generation and the contract refresh both write this one rule.
 */
export function pinnedOperations(document: { paths: Record<string, object> }): string[] {
  return Object.entries(document.paths)
    .flatMap(([path, item]) => Object.keys(item)
      .filter(method => METHODS.includes(method))
      .map(method => `${method.toUpperCase()} ${path}`))
    .sort();
}
