import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MapControls as NativeMapControls } from 'three/addons/controls/MapControls.js';
import { TOUCH } from 'three';

/** Own one control connection per camera/canvas, never per React status update. */
export const NavigationControls = forwardRef<NativeMapControls, {
  mode: '2d' | '3d';
  onStart: () => void;
}>(({ mode, onStart }, ref) => {
  const { camera, gl, get, set, invalidate } = useThree();
  const controls = useMemo(() => new NativeMapControls(camera), [camera]);
  const startRef = useRef(onStart);
  startRef.current = onStart;
  useImperativeHandle(ref, () => controls, [controls]);

  useEffect(() => {
    const canvas = gl.domElement;
    const oldControls = get().controls;
    const previousTabIndex = canvas.getAttribute('tabindex');
    const pointers = new Map<number, string>();
    controls.connect(canvas);
    controls.enableDamping = true;
    controls.dampingFactor = .12;
    controls.minZoom = .25;
    controls.maxZoom = 20;
    controls.maxDistance = 1800;
    controls.zoomToCursor = true;
    controls.screenSpacePanning = false;
    controls.listenToKeyEvents(canvas);
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', 'District map. Drag to pan, right-drag to orbit, scroll or pinch to zoom. Arrow keys pan when focused.');
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    const onDown = (event: PointerEvent) => {
      pointers.set(event.pointerId, event.pointerType);
      canvas.focus({ preventScroll: true });
    };
    const onUp = (event: PointerEvent) => pointers.delete(event.pointerId);
    const cancel = () => {
      // A tab/window switch must not leave a held gesture or stale pointer behind.
      for (const [pointerId, pointerType] of pointers) {
        canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId, pointerType, bubbles: true }));
      }
      pointers.clear();
      canvas.style.cursor = 'grab';
    };
    const visibility = () => { if (document.hidden) cancel(); };
    const start = () => { canvas.style.cursor = 'grabbing'; startRef.current(); };
    const end = () => { canvas.style.cursor = 'grab'; };
    const change = () => invalidate();
    controls.addEventListener('start', start);
    controls.addEventListener('end', end);
    controls.addEventListener('change', change);
    canvas.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    canvas.addEventListener('pointercancel', onUp, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    set({ controls: controls as never });
    return () => {
      cancel();
      controls.removeEventListener('start', start);
      controls.removeEventListener('end', end);
      controls.removeEventListener('change', change);
      canvas.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      canvas.removeEventListener('pointercancel', onUp, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
      controls.dispose();
      set({ controls: oldControls });
      if (previousTabIndex === null) canvas.removeAttribute('tabindex');
      else canvas.setAttribute('tabindex', previousTabIndex);
    };
  }, [controls, gl, get, set, invalidate]);

  useEffect(() => {
    controls.enableRotate = mode === '3d';
    controls.minPolarAngle = mode === '2d' ? 0 : .08;
    controls.maxPolarAngle = mode === '2d' ? .00001 : Math.PI * .45;
    controls.touches.ONE = TOUCH.PAN;
    controls.touches.TWO = mode === '2d' ? TOUCH.DOLLY_PAN : TOUCH.DOLLY_ROTATE;
  }, [controls, mode]);

  useFrame((_, delta) => { if (controls.enabled) controls.update(delta); }, -1);
  return null;
});
NavigationControls.displayName = 'NavigationControls';
