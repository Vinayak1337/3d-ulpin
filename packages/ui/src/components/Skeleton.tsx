/** Loading placeholder in the final layout's shape. */
export function Skeleton({ height = 14, width = '100%', radius = 6 }: { height?: number; width?: string | number; radius?: number }) {
  return <span className="ul-skeleton" style={{ display: 'block', height, width, borderRadius: radius }} aria-hidden="true" />;
}
