// Geometry-only canvas stand-in. It neither renders nor opens a browser.
export function installCanvasStub() {
  const previous = globalThis.document;
  globalThis.document = {
    createElement() {
      const context = new Proxy({}, {
        get(_target, key) {
          if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
          if (key === 'measureText') return () => ({ width: 32 });
          if (key === 'getImageData') return (_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) });
          return () => {};
        },
        set() { return true; },
      });
      return { width: 512, height: 512, getContext: () => context };
    },
  };
  return () => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; };
}

export function geometryBudget(group) {
  let draws = 0, triangles = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    draws += Array.isArray(object.material) ? object.geometry.groups.length : 1;
    triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  return { draws, triangles };
}