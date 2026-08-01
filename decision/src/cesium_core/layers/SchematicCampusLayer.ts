/**
 * SchematicCampusLayer
 *
 * Provides a lightweight Zhengzhou University ground-touching white model when
 * no production 3D Tileset is configured. The geometry is intentionally
 * schematic, so it should be replaced by licensed 3D Tiles once available.
 */

import * as Cesium from "cesium";
import type { Viewer } from "cesium";

export type SchematicBuildingType =
  | "teaching"
  | "lab"
  | "library"
  | "dormitory"
  | "service"
  | "office";

export interface SchematicBuildingSpec {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  widthMeters: number;
  depthMeters: number;
  heightMeters: number;
  headingDeg?: number;
  type: SchematicBuildingType;
}

export interface SchematicCampusLayerOptions {
  alpha?: number;
  showLabels?: boolean;
  maxBuildings?: number;
}

const WHITE_MODEL_COLOR = Cesium.Color.fromCssColorString("#eef5f4");
const OUTLINE_COLOR = Cesium.Color.fromCssColorString("#71838a").withAlpha(0.72);

const DEFAULT_OPTIONS: Required<SchematicCampusLayerOptions> = {
  alpha: 0.86,
  showLabels: false,
  maxBuildings: Number.POSITIVE_INFINITY,
};

const ZZU_SCHEMATIC_BUILDINGS: SchematicBuildingSpec[] = [
  { id: "zzu-core-01", name: "核心教学组团 A", longitude: 113.5307, latitude: 34.8151, widthMeters: 128, depthMeters: 48, heightMeters: 32, headingDeg: -6, type: "teaching" },
  { id: "zzu-core-02", name: "核心教学组团 B", longitude: 113.5322, latitude: 34.8150, widthMeters: 118, depthMeters: 48, heightMeters: 32, headingDeg: -6, type: "teaching" },
  { id: "zzu-core-03", name: "核心教学组团 C", longitude: 113.5313, latitude: 34.8162, widthMeters: 136, depthMeters: 50, heightMeters: 36, headingDeg: -5, type: "teaching" },
  { id: "zzu-core-04", name: "公共教学楼", longitude: 113.5295, latitude: 34.8140, widthMeters: 96, depthMeters: 42, heightMeters: 28, headingDeg: -8, type: "teaching" },
  { id: "zzu-lib-01", name: "图书馆示意体", longitude: 113.5312, latitude: 34.8176, widthMeters: 118, depthMeters: 78, heightMeters: 34, headingDeg: 0, type: "library" },
  { id: "zzu-office-01", name: "行政办公组团", longitude: 113.5330, latitude: 34.8175, widthMeters: 104, depthMeters: 46, heightMeters: 30, headingDeg: -4, type: "office" },
  { id: "zzu-lab-01", name: "实验楼 A", longitude: 113.5279, latitude: 34.8169, widthMeters: 86, depthMeters: 52, heightMeters: 42, headingDeg: 4, type: "lab" },
  { id: "zzu-lab-02", name: "实验楼 B", longitude: 113.5289, latitude: 34.8177, widthMeters: 78, depthMeters: 46, heightMeters: 40, headingDeg: 4, type: "lab" },
  { id: "zzu-lab-03", name: "实验楼 C", longitude: 113.5267, latitude: 34.8148, widthMeters: 84, depthMeters: 48, heightMeters: 38, headingDeg: 3, type: "lab" },
  { id: "zzu-lab-04", name: "实验平台楼", longitude: 113.5346, latitude: 34.8148, widthMeters: 92, depthMeters: 54, heightMeters: 44, headingDeg: -7, type: "lab" },
  { id: "zzu-teach-05", name: "南区教学楼 A", longitude: 113.5304, latitude: 34.8127, widthMeters: 96, depthMeters: 42, heightMeters: 26, headingDeg: -5, type: "teaching" },
  { id: "zzu-teach-06", name: "南区教学楼 B", longitude: 113.5320, latitude: 34.8128, widthMeters: 92, depthMeters: 42, heightMeters: 26, headingDeg: -5, type: "teaching" },
  { id: "zzu-service-01", name: "公共服务中心", longitude: 113.5339, latitude: 34.8128, widthMeters: 84, depthMeters: 50, heightMeters: 24, headingDeg: -8, type: "service" },
  { id: "zzu-service-02", name: "体育服务建筑", longitude: 113.5269, latitude: 34.8124, widthMeters: 110, depthMeters: 44, heightMeters: 22, headingDeg: 0, type: "service" },
  { id: "zzu-north-01", name: "北区教学楼 A", longitude: 113.5298, latitude: 34.8192, widthMeters: 104, depthMeters: 44, heightMeters: 30, headingDeg: -6, type: "teaching" },
  { id: "zzu-north-02", name: "北区教学楼 B", longitude: 113.5314, latitude: 34.8191, widthMeters: 104, depthMeters: 44, heightMeters: 30, headingDeg: -6, type: "teaching" },
  { id: "zzu-north-03", name: "北区实验楼", longitude: 113.5330, latitude: 34.8190, widthMeters: 92, depthMeters: 50, heightMeters: 36, headingDeg: -6, type: "lab" },
  { id: "zzu-dorm-01", name: "生活区宿舍 A", longitude: 113.5258, latitude: 34.8186, widthMeters: 72, depthMeters: 42, heightMeters: 48, headingDeg: 2, type: "dormitory" },
  { id: "zzu-dorm-02", name: "生活区宿舍 B", longitude: 113.5266, latitude: 34.8194, widthMeters: 72, depthMeters: 42, heightMeters: 48, headingDeg: 2, type: "dormitory" },
  { id: "zzu-dorm-03", name: "生活区宿舍 C", longitude: 113.5274, latitude: 34.8202, widthMeters: 72, depthMeters: 42, heightMeters: 48, headingDeg: 2, type: "dormitory" },
  { id: "zzu-dorm-04", name: "东区宿舍 A", longitude: 113.5364, latitude: 34.8176, widthMeters: 76, depthMeters: 42, heightMeters: 50, headingDeg: -8, type: "dormitory" },
  { id: "zzu-dorm-05", name: "东区宿舍 B", longitude: 113.5374, latitude: 34.8167, widthMeters: 76, depthMeters: 42, heightMeters: 50, headingDeg: -8, type: "dormitory" },
  { id: "zzu-dorm-06", name: "东区宿舍 C", longitude: 113.5383, latitude: 34.8158, widthMeters: 76, depthMeters: 42, heightMeters: 50, headingDeg: -8, type: "dormitory" },
  { id: "zzu-east-01", name: "东区教学楼", longitude: 113.5360, latitude: 34.8142, widthMeters: 96, depthMeters: 46, heightMeters: 30, headingDeg: -8, type: "teaching" },
  { id: "zzu-east-02", name: "东区实验楼", longitude: 113.5374, latitude: 34.8131, widthMeters: 92, depthMeters: 52, heightMeters: 38, headingDeg: -8, type: "lab" },
  { id: "zzu-west-01", name: "西区综合楼", longitude: 113.5255, latitude: 34.8158, widthMeters: 88, depthMeters: 52, heightMeters: 30, headingDeg: 5, type: "office" },
  { id: "zzu-west-02", name: "西区教学楼", longitude: 113.5248, latitude: 34.8142, widthMeters: 92, depthMeters: 42, heightMeters: 28, headingDeg: 4, type: "teaching" },
  { id: "zzu-south-01", name: "南门服务楼", longitude: 113.5310, latitude: 34.8097, widthMeters: 80, depthMeters: 36, heightMeters: 22, headingDeg: -3, type: "service" },
  { id: "zzu-south-02", name: "南区办公楼", longitude: 113.5330, latitude: 34.8107, widthMeters: 84, depthMeters: 42, heightMeters: 28, headingDeg: -4, type: "office" },
  { id: "zzu-south-03", name: "南区实验楼", longitude: 113.5287, latitude: 34.8108, widthMeters: 86, depthMeters: 50, heightMeters: 34, headingDeg: 2, type: "lab" },
  { id: "zzu-ring-01", name: "环路节点建筑 A", longitude: 113.5354, latitude: 34.8190, widthMeters: 66, depthMeters: 38, heightMeters: 26, headingDeg: -10, type: "service" },
  { id: "zzu-ring-02", name: "环路节点建筑 B", longitude: 113.5388, latitude: 34.8182, widthMeters: 64, depthMeters: 36, heightMeters: 24, headingDeg: -12, type: "service" },
  { id: "zzu-ring-03", name: "环路节点建筑 C", longitude: 113.5392, latitude: 34.8128, widthMeters: 68, depthMeters: 38, heightMeters: 24, headingDeg: -10, type: "service" },
  { id: "zzu-ring-04", name: "环路节点建筑 D", longitude: 113.5250, latitude: 34.8117, widthMeters: 70, depthMeters: 38, heightMeters: 24, headingDeg: 6, type: "service" },
  { id: "zzu-infill-01", name: "教学连廊 A", longitude: 113.5309, latitude: 34.8137, widthMeters: 62, depthMeters: 26, heightMeters: 18, headingDeg: -4, type: "teaching" },
  { id: "zzu-infill-02", name: "教学连廊 B", longitude: 113.5326, latitude: 34.8138, widthMeters: 62, depthMeters: 26, heightMeters: 18, headingDeg: -4, type: "teaching" },
  { id: "zzu-infill-03", name: "科研配套楼 A", longitude: 113.5293, latitude: 34.8168, widthMeters: 56, depthMeters: 34, heightMeters: 24, headingDeg: -5, type: "lab" },
  { id: "zzu-infill-04", name: "科研配套楼 B", longitude: 113.5336, latitude: 34.8167, widthMeters: 56, depthMeters: 34, heightMeters: 24, headingDeg: -5, type: "lab" },
];

export class SchematicCampusLayer {
  private readonly _viewer: Viewer;
  private readonly _entities: Cesium.Entity[] = [];
  private _isLoaded = false;

  constructor(viewer: Viewer) {
    if (!viewer) {
      throw new Error("[SchematicCampusLayer] viewer 不能为空");
    }
    this._viewer = viewer;
  }

  public get isLoaded(): boolean {
    return this._isLoaded;
  }

  public get buildingCount(): number {
    return this._entities.length;
  }

  public load(options: SchematicCampusLayerOptions = {}): number {
    if (this._isLoaded) {
      this.destroy();
    }

    const merged = { ...DEFAULT_OPTIONS, ...options };
    const specs = ZZU_SCHEMATIC_BUILDINGS.slice(0, merged.maxBuildings);
    const material = new Cesium.ColorMaterialProperty(
      WHITE_MODEL_COLOR.withAlpha(merged.alpha)
    );

    specs.forEach((spec) => {
      const entity = this._createBuildingEntity(spec, material, merged.showLabels);
      this._viewer.entities.add(entity);
      this._entities.push(entity);
    });

    this._isLoaded = true;
    this._requestRender();
    console.info(`[SchematicCampusLayer] 已加载郑州大学示意贴地白模：${this._entities.length} 栋`);
    return this._entities.length;
  }

  public setVisible(visible: boolean): void {
    this._entities.forEach((entity) => {
      entity.show = visible;
    });
    this._requestRender();
  }

  public focus(duration = 0): void {
    const target = Cesium.Cartesian3.fromDegrees(113.5317, 34.8152, 0);
    const sphere = new Cesium.BoundingSphere(target, 980);
    const offset = new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(342),
      Cesium.Math.toRadians(-48),
      1720
    );

    try {
      this._viewer.camera.flyToBoundingSphere(sphere, {
        duration,
        offset,
        complete: () => this._viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY),
      });
    } catch {
      this._viewer.camera.lookAt(target, offset);
      this._viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    }
  }

  public destroy(): void {
    while (this._entities.length > 0) {
      const entity = this._entities.pop();
      if (entity) {
        this._viewer.entities.remove(entity);
      }
    }
    this._isLoaded = false;
    this._requestRender();
  }

  private _createBuildingEntity(
    spec: SchematicBuildingSpec,
    material: Cesium.ColorMaterialProperty,
    showLabel: boolean
  ): Cesium.Entity {
    const groundHeight = this._getGroundHeight(spec.longitude, spec.latitude);
    const centerHeight = groundHeight + spec.heightMeters / 2;
    const position = Cesium.Cartesian3.fromDegrees(
      spec.longitude,
      spec.latitude,
      centerHeight
    );
    const heading = Cesium.Math.toRadians(spec.headingDeg ?? 0);
    const orientation = Cesium.Transforms.headingPitchRollQuaternion(
      position,
      new Cesium.HeadingPitchRoll(heading, 0, 0)
    );

    const entityOptions: Cesium.Entity.ConstructorOptions = {
      id: spec.id,
      name: spec.name,
      position,
      orientation,
      properties: new Cesium.PropertyBag({
        source: "schematic-campus-white-model",
        type: spec.type,
        heightMeters: spec.heightMeters,
      }),
      box: {
        dimensions: new Cesium.Cartesian3(
          spec.widthMeters,
          spec.depthMeters,
          spec.heightMeters
        ),
        material,
        outline: true,
        outlineColor: OUTLINE_COLOR,
        shadows: Cesium.ShadowMode.DISABLED,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 16000),
      },
    };

    if (showLabel) {
      entityOptions.label = {
        text: spec.name,
        font: "12px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.55),
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2400),
        disableDepthTestDistance: 1200,
      };
    }

    return new Cesium.Entity(entityOptions);
  }

  private _getGroundHeight(longitude: number, latitude: number): number {
    try {
      const cartographic = Cesium.Cartographic.fromDegrees(longitude, latitude);
      return this._viewer.scene.globe.getHeight(cartographic) ?? 0;
    } catch {
      return 0;
    }
  }

  private _requestRender(): void {
    try {
      this._viewer.scene.requestRender();
    } catch {
      // Scene may already be destroyed during route unload.
    }
  }
}
