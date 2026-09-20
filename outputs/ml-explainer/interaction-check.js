
    (() => {
      const root = document.getElementById('ulpin-ml-evidence');
      const data = JSON.parse(root.querySelector('#ulpin-evidence-data').textContent);
      const source = root.querySelector('#ulpin-evidence-source');
      const overlay = root.querySelector('#ulpin-evidence-overlay');
      const svg = root.querySelector('.evidence-view');
      const picture = root.querySelector('#ulpin-evidence-image');
      const regions = root.querySelector('#ulpin-evidence-regions');
      function draw() {
        const sample = data[source.value];
        svg.setAttribute('viewBox', `0 0 ${sample.width} ${sample.height}`);
        picture.setAttribute('href', sample.image);
        picture.setAttribute('width', sample.width);
        picture.setAttribute('height', sample.height);
        regions.replaceChildren();
        sample.components.forEach(component => {
          const polygons = component.geometry.type === 'Polygon' ? [component.geometry.coordinates] : component.geometry.coordinates;
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', polygons.flatMap(p => p.map(r => r.map((point,i) => `${i ? 'L' : 'M'}${point[0]},${point[1]}`).join(' ')+' Z')).join(' '));
          regions.appendChild(path);
        });
        regions.style.display = overlay.checked ? '' : 'none';
        root.querySelector('#ulpin-evidence-detail').textContent = `${sample.label} · ${sample.components.length} suggested regions`;
      }
      function restore(state) {
        const saved = state?.modelContent;
        if (saved && data[saved.source]) source.value = saved.source;
        if (typeof saved?.overlay === 'boolean') overlay.checked = saved.overlay;
        draw();
      }
      function change() {
        draw();
        window.openai?.setWidgetState?.({modelContent:{source:source.value,overlay:overlay.checked},privateContent:null}).catch(() => {});
      }
      source.addEventListener('change', change);
      overlay.addEventListener('change', change);
      window.addEventListener('openai:set_globals', e => restore(e.detail?.globals?.widgetState));
      restore(window.openai?.widgetState);
    })();
  