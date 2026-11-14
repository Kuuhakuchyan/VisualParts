"""Budgeted informative tours on a noded road/air graph; not global optima."""
import math

import networkx as nx
from shapely.geometry import LineString, Point
from shapely.ops import unary_union

VERSION = "informative-return-tour/1.1"


def parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == "LineString":
        return [geometry]
    return [line for g in getattr(geometry, "geoms", []) for line in parts(g)]


def graph_from_lines(geometry, spacing=25):
    graph = nx.Graph()
    for line in parts(unary_union(parts(geometry))):
        # Keep original vertices: replacing curved streets by chords cuts corners.
        coords = list(line.coords)
        for a, b in zip(coords, coords[1:]):
            length = math.dist(a, b)
            count = max(1, math.ceil(length / spacing))
            nodes = [tuple(round(a[k]+(b[k]-a[k])*i/count, 5) for k in (0, 1)) for i in range(count+1)]
            for start, end in zip(nodes, nodes[1:]):
                if start != end:
                    graph.add_edge(start, end, length=math.dist(start, end))
    return graph


def aerial_graph(region, obstacles, spacing=60):
    free = region.buffer(-5).difference(obstacles)
    if free.is_empty:
        return nx.Graph()
    w, s, e, n = free.bounds
    edges = []
    for iy in range(math.ceil((n-s)/spacing)+1):
        for ix in range(math.ceil((e-w)/spacing)+1):
            a = (w+ix*spacing, s+iy*spacing)
            if not free.covers(Point(a)):
                continue
            for dx, dy in [(1, 0), (0, 1), (1, 1), (-1, 1)]:
                b = (a[0]+dx*spacing, a[1]+dy*spacing)
                edge = LineString([a, b])
                if free.covers(edge):
                    edges.append(edge)
    return graph_from_lines(unary_union(edges), spacing=spacing)


def informative_tour(graph, cell_at, priorities, budget_wh, power_w, speed_mps,
                     reserve_fraction, start_point=None, setup_wh=0, turn_wh=0,
                     cell_classes=None, diversity_weight=2.0):
    if not graph.number_of_edges():
        return None, {"status": "no_connected_network", "planner_version": VERSION}
    components = sorted(nx.connected_components(graph), key=lambda c: (-len(c), min(c)))
    if start_point is None:
        component = components[0]
        center = (sum(x for x, _ in component)/len(component), sum(y for _, y in component)/len(component))
        depot = min(component, key=lambda p: (math.dist(p, center), p))
        start_method = "largest_component_central_staging_point"
    else:
        depot = min(graph, key=lambda p: (math.dist(p, start_point), p))
        if math.dist(depot, start_point) > 100:
            return None, {"status": "depot_too_far_from_network", "planner_version": VERSION}
        component = nx.node_connected_component(graph, depot)
        start_method = "requested_depot_snapped_within_100m"
    sub = graph.subgraph(component)
    length_to_home, paths_home = nx.single_source_dijkstra(sub, depot, weight="length")
    cell_ids = {p: cell_at(Point(p)) for p in sub}
    # One candidate per cell limits work without favouring dense road vertices.
    candidates = {}
    for p in sorted(sub):
        key = cell_ids[p]
        if key is not None:
            candidates.setdefault(key, p)
    visited = {cell_ids[depot]} - {None}
    cell_classes = cell_classes or {}
    classes_for = lambda cells: {cell_classes[c] for c in cells if cell_classes.get(c) is not None}
    visited_classes = classes_for(visited)
    path = [depot]
    distance = 0.0
    wh_per_m = power_w / speed_mps / 3600
    available = budget_wh*(1-reserve_fraction)
    turns = 0
    for _ in range(min(180, len(candidates))):
        distances, paths = nx.single_source_dijkstra(sub, path[-1], weight="length")
        options = []
        for key, target in candidates.items():
            if key in visited or target not in distances:
                continue
            extension = paths[target]
            home = paths_home[target]
            # Count every graph bend conservatively, including the return path.
            predicted_turns = turns + max(0, len(extension)-2) + max(0, len(home)-2) + 1
            total = distance+distances[target]+length_to_home[target]
            energy = setup_wh+total*wh_per_m+predicted_turns*turn_wh
            if energy > available:
                continue
            gained = {cell_ids[p] for p in extension}-{None}-visited
            reward = sum(priorities.get(cell, 1) for cell in gained)
            reward += diversity_weight * len(classes_for(gained)-visited_classes)
            cost = max(distances[target]*wh_per_m+max(0, len(extension)-2)*turn_wh, 0.001)
            if reward > 0:
                options.append((reward/cost, -distances[target], target, extension, gained))
        if not options:
            break
        _, negative_distance, target, extension, gained = max(options)
        path.extend(extension[1:]); distance -= negative_distance
        turns += max(0, len(extension)-2)+1
        visited.update(gained)
        visited_classes.update(classes_for(gained))
    home = list(reversed(paths_home[path[-1]]))
    distance += length_to_home[path[-1]]
    turns += max(0, len(home)-2)
    path.extend(home[1:])
    energy = setup_wh+distance*wh_per_m+turns*turn_wh
    if distance < 10 or len(path) < 3 or energy > available+1e-8:
        return None, {"status": "insufficient_budget_or_coverage", "planner_version": VERSION}
    route = LineString(path)
    available_cells = set(cell_ids.values())-{None}
    covered = {cell_ids[p] for p in path}-{None}
    stats = {"status": "ready", "planner_version": VERSION,
             "objective": "greedy_grid_and_LCZ_diversity_per_Wh_with_return_reserve" if cell_classes else "greedy_marginal_grid_information_per_Wh_with_return_reserve",
             "globally_optimal": False, "closed_tour": True, "start_method": start_method,
             "network_components": len(components), "reachable_nodes": len(component),
             "excluded_components": len(components)-1, "covered_grid_count": len(covered),
             "reachable_grid_count": len(available_cells), "information_score": round(sum(priorities.get(c, 1) for c in covered), 3),
             "estimated_energy_wh": round(energy, 4), "battery_budget_wh": budget_wh,
             "reserve_fraction": reserve_fraction, "usable_budget_wh": round(available, 4),
             "assumptions": {"power_w": power_w, "speed_mps": speed_mps, "setup_wh": setup_wh,
                             "turn_wh": turn_wh, "energy_model": "constant_power_plus_setup_and_graph_turns", "calibrated": False},
             "duration_s": distance/speed_mps, "depot_metric": list(depot),
             "covered_lcz_classes": sorted(classes_for(covered)),
             "reachable_lcz_classes": sorted(classes_for(available_cells)),
             "uncovered_lcz_classes": sorted(classes_for(available_cells)-classes_for(covered)),
             "lcz_diversity_weight": diversity_weight if cell_classes else 0}
    stats["information_score"] = round(sum(priorities.get(c, 1) for c in covered) + diversity_weight*len(classes_for(covered)), 3)
    stats["depot_crs"] = "EPSG:32649"
    stats["depot_snap_distance_m"] = round(math.dist(depot,start_point),3) if start_point is not None else None
    return route, stats
