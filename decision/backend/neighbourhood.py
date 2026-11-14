"""Metric morphology and per-grid causal evidence, without fabricated temperature kernels."""
from functools import lru_cache

from shapely import from_wkb
from shapely.geometry import box
from shapely.ops import unary_union

from backend.aic.store import digest

VERSION='grid-neighbourhood-evidence/1.0'


def morphology(cell,tree,objects):
    x,y=cell.centroid.coords[0]
    neighbours=tuple((objects[i]['metric'].wkb,objects[i]['height'])
                     for i in sorted(tree.query(box(x-300,y-300,x+300,y+300))))
    return _morphology(cell.centroid.wkb,neighbours)


@lru_cache(maxsize=4096)
def _morphology(point_wkb,neighbours):
    point=from_wkb(point_wkb);objects=[(from_wkb(g),h) for g,h in neighbours]
    result={}
    for radius in [50,150,300]:
        disk=point.buffer(radius,quad_segs=16)
        areas=[(g.intersection(disk).area,h) for g,h in objects if g.distance(point)<=radius]
        areas=[(a,h) for a,h in areas if a>0]
        area=sum(a for a,_ in areas)
        union=unary_union([g for g,_ in objects if g.intersects(disk)]).intersection(disk)
        result[str(radius)]={'radius_m':radius,'building_count':len(areas),
            'plan_area_fraction':round(union.area/disk.area,6),
            'area_weighted_height_m':round(sum(a*h for a,h in areas)/area,4) if area else 0}
    return result


def cell_effect(properties):
    p=properties
    def delta(key):
        a,b=p.get('baseline_'+key),p.get('proposed_'+key)
        return round(b-a,6) if a is not None and b is not None else None
    shade=delta('shade_fraction');sky=delta('svf');mrt=delta('mrt_c')
    mechanisms=[]
    if shade is not None and abs(shade)>1e-6:mechanisms.append('direct_solar_shading')
    if sky is not None and abs(sky)>1e-6:mechanisms.append('diffuse_sky_obstruction')
    if p.get('baseline_occupied')!=p.get('proposed_occupied'):mechanisms.append('outdoor_footprint_change')
    return {'delta_shade_fraction':shade,'delta_svf':sky,'delta_mrt_c':mrt,
            'mechanisms':mechanisms,'air_temperature_change_modelled':False,
            'local_wind_change_modelled':False}


def summarize(cells):
    usable=[f for f in cells if f['properties'].get('delta_utci_c') is not None]
    changed=[f for f in usable if abs(f['properties']['delta_utci_c'])>=.001]
    def entry(f):
        p=f['properties']
        return {'grid_id':p['grid_id'],'delta_utci_c':p['delta_utci_c'],
                'baseline_utci_c':p['baseline_utci_c'],'proposed_utci_c':p['proposed_utci_c'],
                'distance_to_edit_m':p['distance_to_edit_m'],'effect':p['neighbourhood_effect'],
                'baseline_morphology':p['baseline_neighbourhood'],'proposed_morphology':p['proposed_neighbourhood']}
    return {'schema_version':VERSION,'computed_cells':len(cells),'changed_cells':len(changed),
            'radii_m':[50,150,300],'affected_max_distance_m':max((f['properties']['distance_to_edit_m'] for f in changed if f['properties']['distance_to_edit_m'] is not None),default=None),
            'cooling_hotspots':[entry(f) for f in sorted(changed,key=lambda f:f['properties']['delta_utci_c']) if f['properties']['delta_utci_c']<0][:5],
            'warming_hotspots':[entry(f) for f in sorted(changed,key=lambda f:-f['properties']['delta_utci_c']) if f['properties']['delta_utci_c']>0][:5],
            'mechanism_counts':{key:sum(key in f['properties']['neighbourhood_effect']['mechanisms'] for f in cells)
                                for key in ['direct_solar_shading','diffuse_sky_obstruction','outdoor_footprint_change']},
            'numeric_sha256':digest([{'grid_id':f['properties']['grid_id'],'effect':f['properties']['neighbourhood_effect'],
                                      'delta_utci_c':f['properties']['delta_utci_c']} for f in cells])}
