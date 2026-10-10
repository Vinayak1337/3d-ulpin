// Browser-only mounting of actual callers. Missing reads are handled by the capture's request guard.
export async function prepareCapture(root) {
  const runtime = (await import('/@react-refresh')).default;
  runtime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
  await import(`/@fs/${root}/packages/ui/src/styles/index.css`);
}

async function mountReview(node, React, createRoot, name, register) {
  // Read Vite's resolved URLs: mixing optimized URL versions gives a different query context.
  const source = await (await fetch('/src/app/App.tsx')).text();
  const queryUrl = source.match(/from\s*["']([^"']*@tanstack_react-query[^"']*)["']/)[1];
  const routerUrl = source.match(/from\s*["']([^"']*react-router[^"']*)["']/)[1];
  // Vite rewrites variable imports with an extra ?import; that would duplicate the context module.
  const nativeImport = new Function('url', 'return import(url)');
  const { QueryClient, QueryClientProvider } = await nativeImport(queryUrl);
  const { MemoryRouter, Routes, Route } = await nativeImport(routerUrl);
  const relative = name === 'register' ? 'features/register/RegisterPage' : 'features/review/WorkspacePage';
  const module = await import(`/src/${relative}.tsx`);
  const Component = name === 'register' ? module.RegisterPage : module.WorkspacePage;
  const route = React.createElement(Route, { path: '/:buildingId', element: React.createElement(Component) });
  const router = React.createElement(MemoryRouter, { initialEntries: [`/${register.property.id}?stage=check`] },
    React.createElement(Routes, null, route));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  createRoot(node).render(React.createElement(QueryClientProvider, { client }, router));
}

async function mountScene(node, React, createRoot, { root, name, nyc, roof }) {
  node.style.height = '900px';
  let Component;
  let props;
  if (name === 'roofprint-map') {
    const module = await import(`/@fs/${root}/apps/studio/src/features/review/candidates/RoofprintMap.tsx`);
    Component = module.RoofprintMap;
    props = { cards: [{ id: roof.buildingId, polygons: roof.footprint.value }],
      selectedId: roof.buildingId, onSelect: () => {} };
  } else {
    Component = (await import(`/@fs/${root}/apps/studio/src/portal/PublicScene.tsx`)).PublicScene;
    props = { map: { features: nyc.features.filter((feature) => feature.kind !== 'utility') },
      building: null, levelId: null, spaceId: null, label: nyc.area.name };
  }
  createRoot(node).render(React.createElement(Component, props));
}

export async function mountCaller(data) {
  const React = (await import('/node_modules/.vite/deps/react.js')).default;
  const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js')).default;
  const node = document.createElement('div');
  document.body.replaceChildren(node);
  if (data.name === 'register' || data.name === 'review-workspace') {
    await mountReview(node, React, createRoot, data.name, data.register);
  } else await mountScene(node, React, createRoot, data);
}
