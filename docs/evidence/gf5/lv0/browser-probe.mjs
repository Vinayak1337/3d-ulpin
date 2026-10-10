// Browser-only probes. Records counts and timing, never source properties or document text.
export function installProbe() {
  const probe = window.__lv0 = {
    active: false, frames: [], tasks: [], parts: [], calls: [], commits: [], renderNames: {}, lastRender: null,
  };
  let previous = performance.now();
  function frame(now) {
    if (probe.active) probe.frames.push({ at: now, ms: now - previous });
    previous = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (probe.active) probe.tasks.push({ at: entry.startTime, ms: entry.duration });
    }
  }).observe({ type: 'longtask', buffered: false });
  const renderers = new Map();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers,
    inject(renderer) {
      const id = renderers.size + 1;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(id, root) {
      if (!probe.active) return;
      const names = {};
      function visit(fiber) {
        if (!fiber) return;
        const type = fiber.type;
        const name = typeof type === 'function' ? type.displayName || type.name : null;
        if (name && (fiber.flags & 1)) names[name] = (names[name] || 0) + 1;
        visit(fiber.child);
        visit(fiber.sibling);
      }
      visit(root.current);
      probe.commits.push({ at: performance.now(), names });
      for (const [name, count] of Object.entries(names)) {
        probe.renderNames[name] = (probe.renderNames[name] || 0) + count;
      }
    },
    onCommitFiberUnmount() {},
  };
  const original = EventSource.prototype.addEventListener;
  EventSource.prototype.addEventListener = function (type, listener, options) {
    if (!['chunk', 'metadata', 'complete', 'failed'].includes(type)) {
      return original.call(this, type, listener, options);
    }
    return original.call(this, type, function (event) {
      const at = performance.now();
      const data = JSON.parse(event.data);
      const part = {
        type, at, count: data.features?.length || 0,
        buildings: data.features?.filter((feature) => feature.kind === 'building').length || 0,
        sequence: data.sequence,
      };
      probe.parts.push(part);
      listener.call(this, event);
      part.listenerMs = performance.now() - at;
      if (type === 'chunk') requestAnimationFrame(() => requestAnimationFrame(() => {
        part.twoFramesMs = performance.now() - at;
      }));
      if (type === 'complete') probe.completed = true;
      if (type === 'failed') probe.failed = true;
    }, options);
  };
}

export async function instrumentModules(root) {
  const probe = window.__lv0;
  const { SceneEngine } = await import(`/@fs/${root}/packages/scene/src/engine.ts`);
  const { QueryClient } = await import('/node_modules/.vite/deps/@tanstack_react-query.js');
  function wrap(target, name, describe = () => ({})) {
    const original = target[name];
    target[name] = function (...args) {
      const at = performance.now();
      const details = describe.call(this, args);
      try {
        return original.apply(this, args);
      } finally {
        if (probe.active) probe.calls.push({ name, at, ms: performance.now() - at, ...details });
      }
    };
  }
  wrap(SceneEngine.prototype, 'setBuildings', function (args) {
    return { before: this.buildingBounds.size, after: args[0].length };
  });
  for (const name of ['setBase', 'fitGroundAndShadow', 'buildDressing', 'clearEntries']) {
    wrap(SceneEngine.prototype, name);
  }
  wrap(QueryClient.prototype, 'setQueryData', (args) => ({ key: args[0][0] }));
  const render = SceneEngine.prototype.requestRender;
  SceneEngine.prototype.requestRender = function () {
    if (!this.__lv0Render) {
      this.__lv0Render = true;
      const original = this.renderFrame;
      this.renderFrame = (now) => {
        const at = performance.now();
        original(now);
        if (probe.active) {
          probe.lastRender = performance.now();
          probe.calls.push({
            name: 'renderFrame', at, ms: probe.lastRender - at, buildings: this.buildingBounds.size,
          });
        }
      };
    }
    return render.call(this);
  };
}
