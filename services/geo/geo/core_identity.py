"""Identity metadata semantics shared with TypeScript via generated policy/corpus."""
from __future__ import annotations
from .core_contract import bundled_schema, fail, parse_core, ref_key


def unique(values, code):
    if len(set(values)) != len(values):
        fail(code, "Duplicate references/assertions are not permitted")


def acyclic(edges, group):
    outgoing, indegree = {}, {}
    for source, target in edges:
        outgoing.setdefault(source, []).append(target)
        indegree.setdefault(source, 0)
        indegree[target] = indegree.get(target, 0) + 1
    ready = [key for key, count in indegree.items() if count == 0]
    cursor = 0
    while cursor < len(ready):
        for target in outgoing.get(ready[cursor], []):
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
        cursor += 1
    if cursor != len(indegree):
        fail("RELATION_CYCLE", "Cycle in " + group + " relationships")


def validate_core_identity_graph(value):
    graph = parse_core("identity-graph", value)
    policy = bundled_schema("identity-graph")[0]["x-ulpin-relation-policy"]
    entities = {}
    for entity in graph["entities"]:
        key = ref_key(entity["ref"])
        if key in entities:
            fail("DUPLICATE_ENTITY", "A canonical reference appears more than once")
        entities[key] = entity
        unique([(ref_key(m["collection"]), m["role"]) for m in entity["memberships"]], "DUPLICATE_MEMBERSHIP")
        unique([(i["scheme"], i["issuer"], i["value"]) for i in entity["identifiers"]], "DUPLICATE_IDENTIFIER")
        if any(i["scheme"] == "official_ulpin" for i in entity["identifiers"]) and entity["kind"] != "parcel":
            fail("IDENTIFIER_SCOPE", "A parcel identifier cannot become a building identifier")
    replacement_edges, changes, allocation_changes = [], {}, {}
    for entity in graph["entities"]:
        lifecycle = entity["lifecycle"]
        if lifecycle["state"] != "retired":
            continue
        source = ref_key(entity["ref"])
        targets = [ref_key(r) for r in lifecycle["replacedBy"]]
        unique(targets, "DUPLICATE_SUCCESSOR")
        if (lifecycle["mode"] == "split" and len(targets) < 2) or (lifecycle["mode"] == "merge" and len(targets) != 1):
            fail("SUCCESSOR_COUNT", "Retirement successors must match the operation")
        for target_key in targets:
            target = entities.get(target_key)
            if target is None:
                fail("MISSING_SUCCESSOR", "A retired identity's successor is missing")
            if target_key == source or target["kind"] != entity["kind"] or target["ref"]["namespace"] != entity["ref"]["namespace"]:
                fail("INVALID_SUCCESSOR", "Identity successor kind or namespace differs")
            if target_key in allocation_changes and allocation_changes[target_key] != lifecycle["changeId"]:
                fail("SUCCESSOR_ALLOCATION", "A successor cannot be allocated by unrelated changes")
            allocation_changes[target_key] = lifecycle["changeId"]
            replacement_edges.append((source, target_key))
        changes.setdefault(lifecycle["changeId"], []).append(entity)
    acyclic(replacement_edges, "replacement")
    for group in changes.values():
        first = group[0]["lifecycle"]
        if any(e["lifecycle"]["mode"] != first["mode"] for e in group):
            fail("RETIREMENT_GROUP", "One change cannot mix split and merge")
        if first["mode"] == "split" and len(group) != 1:
            fail("RETIREMENT_GROUP", "A split identifies one original")
        if first["mode"] == "merge" and (len(group) < 2 or any(ref_key(e["lifecycle"]["replacedBy"][0]) != ref_key(first["replacedBy"][0]) for e in group)):
            fail("RETIREMENT_GROUP", "A merge identifies at least two originals and one successor")
    unique([r["id"] for r in graph["relations"]], "DUPLICATE_RELATION_ID")
    keys, groups, lineage_keys = [], {}, set()
    for relation in graph["relations"]:
        source_key, target_key = ref_key(relation["from"]), ref_key(relation["to"])
        source, target = entities.get(source_key), entities.get(target_key)
        if source is None or target is None:
            fail("MISSING_ENDPOINT", "A relationship endpoint is missing")
        if source_key == target_key:
            fail("SELF_RELATION", "A relationship cannot target itself")
        rule = policy[relation["kind"]]
        if [source["kind"], target["kind"]] not in rule["pairs"]:
            fail("RELATION_KIND", "Relationship endpoint kinds are incompatible")
        if relation["kind"] == "recorded_by" and (target["ref"]["namespace"] != "registry" or source["ref"]["namespace"] == "registry"):
            fail("RECORD_NAMESPACE", "Recording must explicitly target a distinct registry identity")
        if relation["kind"] in ("split_from", "merged_from"):
            if source["ref"]["namespace"] != target["ref"]["namespace"]:
                fail("LINEAGE_NAMESPACE", "Lineage cannot change namespace")
            lifecycle = target["lifecycle"]
            mode = "split" if relation["kind"] == "split_from" else "merge"
            if lifecycle["state"] != "retired" or lifecycle["changeId"] != relation.get("changeId") or lifecycle["mode"] != mode or source_key not in [ref_key(r) for r in lifecycle["replacedBy"]]:
                fail("LINEAGE_CHANGE", "Lineage must agree with the recorded retirement")
            lineage_keys.add((relation["kind"], source_key, target_key, relation["changeId"]))
        elif "changeId" in relation:
            fail("LINEAGE_CHANGE", "Only lineage can carry an identity change ID")
        pair = sorted((source_key, target_key)) if rule["symmetric"] else (source_key, target_key)
        keys.append((relation["kind"], *pair))
        if rule["cycleGroup"]:
            groups.setdefault(rule["cycleGroup"], []).append((source_key, target_key))
    unique(keys, "DUPLICATE_RELATION")
    for group, edges in groups.items():
        acyclic(edges, group)
    for entity in graph["entities"]:
        lifecycle = entity["lifecycle"]
        if lifecycle["state"] == "retired":
            kind = "split_from" if lifecycle["mode"] == "split" else "merged_from"
            for successor in lifecycle["replacedBy"]:
                if (kind, ref_key(successor), ref_key(entity["ref"]), lifecycle["changeId"]) not in lineage_keys:
                    fail("LINEAGE_MISSING", "Every successor requires explicit lineage")
    return graph
