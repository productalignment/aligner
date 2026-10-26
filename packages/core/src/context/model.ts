// Assembles the product model from parsed documents.
import type { Node, ParsedDoc } from './parse.ts';
import { emptyModel, type ItemType, type Model } from './types.ts';

type Obj = Record<string, unknown>;

function* walk(node: Node, owner: Node | null): Generator<[Node, Node | null]> {
  for (const c of node.children) {
    yield [c, owner];
    yield* walk(c, c.kind === 'item' ? c : owner);
  }
}

export function assemble(docs: Iterable<ParsedDoc>): Model {
  const m = emptyModel();
  const byId = new Map<string, Obj>();
  const ordered = [...docs].sort((a, b) => a.path.localeCompare(b.path));

  for (const doc of ordered) {
    for (const [node, owner] of walk(doc.root, null)) {
      if (node.kind === 'vision') { m.vision = { ...(node.fields as Model['vision']) }; continue; }
      if (node.kind !== 'item') continue;
      // Connections and links are known by what they join, not by an ID of their own.
      const joins = node.type === 'connection' || node.type === 'link';
      const obj: Obj = joins ? { ...node.fields } : { id: node.id, ...node.fields };
      const parent = owner ? byId.get(owner.id!) : undefined;
      place(m, node.type!, obj, parent);
      if (!joins) byId.set(node.id!, obj);
    }
  }
  return m;
}

function place(m: Model, type: ItemType, obj: Obj, parent: Obj | undefined) {
  const push = (key: string) => {
    if (!parent) return;
    ((parent[key] ??= []) as Obj[]).push(obj);
  };
  switch (type) {
    case 'out_of_scope': m.out_of_scope.push(obj as never); break;
    case 'constraint': m.constraints.push(obj as never); break;
    case 'persona': Object.assign(obj, { jobs: [] }); m.personas.push(obj as never); break;
    case 'job': push('jobs'); break;
    case 'flow': Object.assign(obj, { steps: [], connections: [] }); m.flows.push(obj as never); break;
    case 'step': push('steps'); break;
    case 'connection': push('connections'); break;
    case 'screen': Object.assign(obj, { links: [] }); m.screens.push(obj as never); break;
    case 'link': push('links'); break;
  }
}
