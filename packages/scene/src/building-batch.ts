import { Box3, BufferAttribute, BufferGeometry, LineSegments, Mesh, Sphere, type Material, type Object3D } from 'three';

/** Resting footprint buildings of one look drawn together; past this many, a new batch starts. */
export const BATCH_SIZE = 2000;

// Vertices a batch first makes room for, so the first buildings of an area do not regrow its buffers one by one.
const FIRST_VERTICES = 8192;

interface Member {
  mesh: Mesh;
  edge: LineSegments;
  /** First vertex of the member's body and of its edges in the batch's buffers. */
  start: number;
  edgeStart: number;
  /** Drawn by the batch; otherwise collapsed in place while the member's own mesh and edges draw. */
  shown: boolean;
}

/**
 * Footprint buildings drawn as one mesh and one set of edges, so thousands of buildings cost a few draw calls instead
 * of three each (body, edges and shadow). Every member keeps its own mesh and edges, which picks and the halo use;
 * the batch holds a copy of their vertices. A member whose own objects draw unlike the batch (selected, hovered,
 * see-through near an explored building) is collapsed here and draws as its own objects on top.
 */
export class BuildingBatch {
  readonly mesh: Mesh;
  readonly lines: LineSegments;
  private readonly members = new Map<string, Member>();
  private vertices = 0;
  private edgeVertices = 0;
  private readonly box = new Box3();

  constructor(material: Material, edge: Material) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.receiveShadow = true;
    this.mesh.raycast = () => {};
    this.lines = new LineSegments(new BufferGeometry(), edge);
    this.lines.raycast = () => {};
  }

  get size(): number {
    return this.members.size;
  }

  /** Appends a building's body and edges after the last member, writing only the new vertices. */
  add(id: string, mesh: Mesh, edge: LineSegments): void {
    const member: Member = { mesh, edge, start: this.vertices, edgeStart: this.edgeVertices, shown: true };
    this.vertices += vertexCount(mesh.geometry);
    this.edgeVertices += vertexCount(edge.geometry);
    this.reserve(mesh.geometry, edge.geometry);
    this.members.set(id, member);
    this.write(member);
    this.box.union(mesh.geometry.boundingBox!);
    this.fit();
  }

  /** Drops members and closes the gaps, rewriting the remaining members once. */
  remove(ids: Iterable<string>): void {
    for (const id of ids) this.members.delete(id);
    this.vertices = 0;
    this.edgeVertices = 0;
    this.box.makeEmpty();
    for (const member of this.members.values()) {
      member.start = this.vertices;
      member.edgeStart = this.edgeVertices;
      this.vertices += vertexCount(member.mesh.geometry);
      this.edgeVertices += vertexCount(member.edge.geometry);
      this.write(member);
      this.box.union(member.mesh.geometry.boundingBox!);
    }
    for (const geometry of [this.mesh.geometry, this.lines.geometry]) {
      for (const attribute of Object.values(geometry.attributes) as BufferAttribute[]) attribute.clearUpdateRanges();
    }
    this.fit();
  }

  /**
   * Takes the look most members' own objects have, draws every member that has it and collapses the rest. Returns
   * the own objects of members drawn here and of members that must draw on their own.
   */
  match(): { batched: Object3D[]; own: Object3D[] } {
    const members = [...this.members.values()];
    const alike = members.filter((member) => this.drawsLike(member)).length;
    if (alike * 2 < members.length) this.drawLike(commonest(members));
    const batched: Object3D[] = [];
    const own: Object3D[] = [];
    for (const member of members) {
      const shown = this.drawsLike(member);
      this.show(member, shown);
      (shown ? batched : own).push(member.mesh, member.edge);
    }
    return { batched, own };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.lines.geometry.dispose();
  }

  private drawsLike({ mesh, edge }: Member): boolean {
    return mesh.material === this.mesh.material && mesh.visible === this.mesh.visible
      && mesh.castShadow === this.mesh.castShadow && edge.material === this.lines.material;
  }

  private drawLike({ mesh, edge }: Member) {
    this.mesh.material = mesh.material;
    this.mesh.visible = mesh.visible;
    this.mesh.castShadow = mesh.castShadow;
    this.lines.material = edge.material;
    this.lines.visible = edge.visible;
  }

  private show(member: Member, shown: boolean) {
    if (member.shown === shown) return;
    member.shown = shown;
    copyPositions(this.mesh.geometry, member.mesh.geometry, member.start, !shown);
    copyPositions(this.lines.geometry, member.edge.geometry, member.edgeStart, !shown);
  }

  private write(member: Member) {
    copyVertices(this.mesh.geometry, member.mesh.geometry, member.start);
    copyVertices(this.lines.geometry, member.edge.geometry, member.edgeStart);
    if (!member.shown) {
      copyPositions(this.mesh.geometry, member.mesh.geometry, member.start, true);
      copyPositions(this.lines.geometry, member.edge.geometry, member.edgeStart, true);
    }
  }

  /** Room for every member's vertices; a full buffer is replaced by one at least twice its size. */
  private reserve(body: BufferGeometry, edges: BufferGeometry) {
    if (vertexCount(this.mesh.geometry) < this.vertices) {
      this.mesh.geometry = regrown(this.mesh.geometry, body, this.vertices);
    }
    if (vertexCount(this.lines.geometry) < this.edgeVertices) {
      this.lines.geometry = regrown(this.lines.geometry, edges, this.edgeVertices);
    }
  }

  /** Draws only the members' vertices, and culls by their joint bounds rather than the unused tail. */
  private fit() {
    this.mesh.geometry.setDrawRange(0, this.vertices);
    this.lines.geometry.setDrawRange(0, this.edgeVertices);
    for (const geometry of [this.mesh.geometry, this.lines.geometry]) {
      geometry.boundingBox = this.box.clone();
      geometry.boundingSphere = this.box.getBoundingSphere(new Sphere());
    }
  }
}

/** The member whose look the most members share. */
function commonest(members: Member[]): Member {
  const counts = new Map<string, { member: Member; count: number }>();
  let best: { member: Member; count: number } | undefined;
  for (const member of members) {
    const { mesh, edge } = member;
    const materials = `${(mesh.material as Material).uuid}:${(edge.material as Material).uuid}`;
    const key = `${materials}:${mesh.visible}:${mesh.castShadow}`;
    const tally = counts.get(key) ?? { member, count: 0 };
    tally.count += 1;
    counts.set(key, tally);
    if (!best || tally.count > best.count) best = tally;
  }
  return best!.member;
}

function vertexCount(geometry: BufferGeometry): number {
  return geometry.getAttribute('position')?.count ?? 0;
}

/** A geometry with the template's attributes, room for at least `needed` vertices and the old vertices copied in. */
function regrown(old: BufferGeometry, template: BufferGeometry, needed: number): BufferGeometry {
  const size = Math.max(needed, vertexCount(old) * 2, FIRST_VERTICES);
  const geometry = new BufferGeometry();
  for (const [name, source] of Object.entries(template.attributes) as [string, BufferAttribute][]) {
    const array = new Float32Array(size * source.itemSize);
    const previous = old.getAttribute(name);
    if (previous) array.set(previous.array as Float32Array);
    geometry.setAttribute(name, new BufferAttribute(array, source.itemSize));
  }
  old.dispose();
  return geometry;
}

/** Copies every attribute of a member (prism bodies and edges are not indexed) to `start` in the batch. */
function copyVertices(target: BufferGeometry, source: BufferGeometry, start: number) {
  for (const [name, to] of Object.entries(target.attributes) as [string, BufferAttribute][]) {
    const from = source.getAttribute(name);
    if (!from) continue;
    (to.array as Float32Array).set(from.array as Float32Array, start * to.itemSize);
    to.addUpdateRange(start * to.itemSize, from.count * to.itemSize);
    to.needsUpdate = true;
  }
}

/** Writes a member's positions back, or collapses them onto its first vertex: no area or length, nothing drawn. */
function copyPositions(target: BufferGeometry, source: BufferGeometry, start: number, collapse: boolean) {
  const to = target.getAttribute('position') as BufferAttribute;
  const from = source.getAttribute('position') as BufferAttribute;
  if (!from?.count) return;
  const array = to.array as Float32Array;
  const values = from.array as Float32Array;
  if (collapse) {
    for (let i = start * 3; i < (start + from.count) * 3; i += 3) array.set(values.subarray(0, 3), i);
  } else {
    array.set(values, start * 3);
  }
  to.addUpdateRange(start * 3, from.count * 3);
  to.needsUpdate = true;
}
