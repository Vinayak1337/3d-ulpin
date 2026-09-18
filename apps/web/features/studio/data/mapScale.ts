/** Choose a readable distance and its exact corresponding CSS-pixel width. */
export function mapScale(pixelsPerMetre: number, maximumWidth = 120) {
  if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) return { metres: 0, pixels: 0, label: '—' };
  const desired = maximumWidth / pixelsPerMetre;
  const exponent = Math.floor(Math.log10(desired));
  const base = 10 ** exponent;
  const metres = [5, 2, 1].map(n => n * base).find(n => n <= desired) ?? base / 2;
  return { metres, pixels: metres * pixelsPerMetre, label: metres >= 1000 ? `${metres / 1000} km` : `${Number(metres.toPrecision(8))} m` };
}
