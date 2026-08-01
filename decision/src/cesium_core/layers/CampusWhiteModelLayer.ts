/**
 * CampusWhiteModelLayer
 *
 * Loads real public building footprints and renders them as a lightweight
 * ground white model. Current data is derived from OpenStreetMap building ways
 * for the Zhengzhou University main-campus view, with attribution preserved in
 * the UI.
 */

import * as Cesium from "cesium";
import type { Viewer } from "cesium";

export interface CampusWhiteModelOptions {
  alpha?: number;
  outlineAlpha?: number;
  maxBuildings?: number;
  showLabels?: boolean;
}

interface WhiteModelFeature {
  id?: string | number;
  properties?: {
    osm_id?: number;
    name?: string;
    building?: string;
    height_m?: number;
    levels?: number | null;
    area_m2?: number;
  };
  geometry?: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}

interface WhiteModelCollection {
  attribution?: string;
  features?: WhiteModelFeature[];
}

const DEFAULT_OPTIONS: Required<CampusWhiteModelOptions> = {
  alpha: 0.82,
  outlineAlpha: 0.55,
  maxBuildings: Number.POSITIVE_INFINITY,
  showLabels: false,
};

const MODEL_COLOR = Cesium.Color.fromCssColorString("#f0f4ef");
const OUTLINE_COLOR = Cesium.Color.fromCssColorString("#51656b");

export class CampusWhiteModelLayer {
  private readonly _viewer: Viewer;
  private readonly _entities: Cesium.Entity[] = [];
  private _isLoaded = false;
  private _attribution = "";
  private _bounds: Cesium.Rectangle | null = null;
  private _boundingSphere: Cesium.BoundingSphere | null = null;

  constructor(viewer: Viewer) {
    if (!viewer) {
      throw new Error("[CampusWhiteModelLayer] viewer 不能为空");
    }
    this._viewer = viewer;
  }

  public get isLoaded(): boolean {
    return this._isLoaded;
  }

  public get buildingCount(): number {
    return this._entities.length;
  }

  public get attribution(): string {
    return this._attribution;
  }

  public async load(
    url = "./data/zzu_osm_buildings.geojson",
    options: CampusWhiteModelOptions = {}
  ): Promise<number> {
    if (this._isLoaded) {
      this.destroy();
    }

    const merged = { ...DEFAULT_OPTIONS, ...options };
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) {
      throw new Error(`[CampusWhiteModelLayer] 白模数据加载失败: ${res.status}`);
    }

    const data = (await res.json()) as WhiteModelCollection;
    this._attribution = data.attribution ?? "OpenStreetMap contributors (ODbL 1.0)";
    const features = (data.features ?? []).slice(0, merged.maxBuildings);
    const material = new Cesium.ColorMaterialProperty(
      MODEL_COLOR.withAlpha(merged.alpha)
    );

    let rectangle: Cesium.Rectangle | null = null;
    const allPositions: Cesium.Cartesian3[] = [];
    for (const feature of features) {
      const entities = this._entitiesFromFeature(feature, material, merged);
      for (const entity of entities) {
        this._viewer.entities.add(entity);
        this._entities.push(entity);
        const hierarchy = (entity.polygon as any)?.hierarchy?.getValue?.(Cesium.JulianDate.now());
        if (hierarchy?.positions?.length) {
          allPositions.push(...hierarchy.positions);
          const current = Cesium.Rectangle.fromCartesianArray(hierarchy.positions);
          rectangle = rectangle ? Cesium.Rectangle.union(rectangle, current) : current;
        }
      }
    }

    this._bounds = rectangle;
    this._boundingSphere = allPositions.length
      ? Cesium.BoundingSphere.fromPoints(allPositions)
      : null;
    this._isLoaded = this._entities.length > 0;
    this._requestRender();
    console.info(`[CampusWhiteModelLayer] 已加载真实建筑轮廓白模：${this._entities.length} 栋`);
    return this._entities.length;
  }

  public focus(duration = 0.6): void {
    if (!this._boundingSphere && !this._bounds) return;

    try {
      if (!this._boundingSphere) throw new Error("missing bounding sphere");
      this._viewer.camera.flyToBoundingSphere(this._boundingSphere, {
        duration,
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(342),
          Cesium.Math.toRadians(-48),
          1650
        ),
        complete: () => this._viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY),
      });
    } catch {
      if (this._bounds) {
        this._viewer.camera.setView({ destination: this._bounds });
      }
    }
  }

  public setVisible(visible: boolean): void {
    this._entities.forEach((entity) => {
      entity.show = visible;
    });
    this._requestRender();
  }

  public destroy(): void {
    while (this._entities.length > 0) {
      const entity = this._entities.pop();
      if (entity) this._viewer.entities.remove(entity);
    }
    this._isLoaded = false;
    this._bounds = null;
    this._boundingSphere = null;
    this._requestRender();
  }

  private _entitiesFromFeature(
    feature: WhiteModelFeature,
    material: Cesium.ColorMaterialProperty,
    options: Required<CampusWhiteModelOptions>
  ): Cesium.Entity[] {
    const geometry = feature.geometry;
    if (!geometry) return [];

    const polygons =
      geometry.type === "Polygon"
        ? [geometry.coordinates as number[][][]]
        : (geometry.coordinates as number[][][][]);

    return polygons
      .map((polygon, index) => this._entityFromPolygon(feature, polygon, index, material, options))
      .filter((entity): entity is Cesium.Entity => Boolean(entity));
  }

  private _entityFromPolygon(
    feature: WhiteModelFeature,
    polygon: number[][][],
    index: number,
    material: Cesium.ColorMaterialProperty,
    options: Required<CampusWhiteModelOptions>
  ): Cesium.Entity | null {
    const outerRing = polygon[0];
    if (!outerRing || outerRing.length < 4) return null;

    const positions = outerRing
      .map((coord) => Cesium.Cartesian3.fromDegrees(coord[0], coord[1], 0))
      .filter(Boolean);
    if (positions.length < 4) return null;

    const props = feature.properties ?? {};
    const height = this._safeHeight(props.height_m);
    const id = `${feature.id ?? `osm-${props.osm_id ?? "building"}`}-${index}`;
    const name = props.name || `OSM building ${props.osm_id ?? index}`;

    const polygonOptions: any = {
      hierarchy: new Cesium.PolygonHierarchy(positions),
      height,
      extrudedHeight: 0,
      perPositionHeight: false,
      material,
      outline: true,
      outlineColor: OUTLINE_COLOR.withAlpha(options.outlineAlpha),
      shadows: Cesium.ShadowMode.DISABLED,
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18000),
    };

    const entityOptions: Cesium.Entity.ConstructorOptions = {
      id,
      name,
      properties: new Cesium.PropertyBag({
        osmId: props.osm_id,
        building: props.building,
        heightMeters: height,
        levels: props.levels,
        areaM2: props.area_m2,
        source: "OpenStreetMap",
      }),
      polygon: polygonOptions,
    };

    if (options.showLabels && props.name) {
      entityOptions.position = this._centroidPosition(outerRing, height);
      entityOptions.label = {
        text: props.name,
        font: "12px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.5),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -16),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1800),
        disableDepthTestDistance: 1200,
      };
    }

    return new Cesium.Entity(entityOptions);
  }

  private _safeHeight(raw?: number): number {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return 12;
    return Math.max(3, Math.min(raw, 160));
  }

  private _centroidPosition(coords: number[][], height: number): Cesium.Cartesian3 {
    const total = coords.reduce(
      (acc, coord) => ({ lon: acc.lon + coord[0], lat: acc.lat + coord[1] }),
      { lon: 0, lat: 0 }
    );
    return Cesium.Cartesian3.fromDegrees(
      total.lon / coords.length,
      total.lat / coords.length,
      height + 4
    );
  }

  private _requestRender(): void {
    try {
      this._viewer.scene.requestRender();
    } catch {
      // Scene may already be destroyed during route unload.
    }
  }
}
