/**
 * 微境智护 — 追踪实体图层管理器
 * 在 Cesium 地图上管理无人机/小车实体的显示、位置更新与轨迹绘制
 */

import * as Cesium from "cesium";

export class TrackingLayer {
  constructor(viewer) {
    this._viewer = viewer;
    /** @type {Map<string, {entity: Cesium.Entity, trajectory: object[]}>} */
    this._entities = new Map();
    this._trajectoryLength = 30;
    this._labelEntities = new Map();
  }

  init() {
    // nothing to init — entities are added dynamically via updatePositions()
  }

  /**
   * 根据实体类型获取颜色
   * @param {string} type - "drone" | "car"
   * @returns {Cesium.Color}
   */
  _colorFor(type) {
    switch (type) {
      case "drone": return Cesium.Color.fromCssColorString("#00ff88");
      case "car":   return Cesium.Color.fromCssColorString("#ffcc00");
      default:      return Cesium.Color.CYAN;
    }
  }

  /**
   * 创建实体图标（Canvas → data URL）
   * @param {string} type
   * @param {string} color
   * @returns {string} data URL
   */
  _createIconDataUrl(type, color) {
    const size = 40;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    ctx.clearRect(0, 0, size, size);

    if (type === "drone") {
      // 十字准星 + 外圈
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(size / 2, 6);
      ctx.lineTo(size / 2, size - 6);
      ctx.moveTo(6, size / 2);
      ctx.lineTo(size - 6, size / 2);
      ctx.stroke();
    } else {
      // 箭头（表示车辆方向）
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(size / 2, 4);
      ctx.lineTo(size - 6, size / 2 + 6);
      ctx.lineTo(size / 2, size - 4);
      ctx.lineTo(size / 2 + 4, size / 2 + 6);
      ctx.closePath();
      ctx.fill();
    }

    return canvas.toDataURL();
  }

  /**
   * 更新所有追踪实体（新增 / 移动 / 删除）
   * @param {Array} entities - 后端返回的实体数组
   */
  updatePositions(entities) {
    const incomingIds = new Set(entities.map(e => e.id));

    // 删除已消失的实体
    for (const [id] of this._entities) {
      if (!incomingIds.has(id)) {
        this._removeEntity(id);
      }
    }

    for (const data of entities) {
      if (this._entities.has(data.id)) {
        this._updateEntity(data);
      } else {
        this._addEntity(data);
      }
    }
  }

  _addEntity(data) {
    const color = this._colorFor(data.type);
    const colorCss = type => type === "drone" ? "#00ff88" : "#ffcc00";

    const entity = this._viewer.entities.add({
      id: `tracking_${data.id}`,
      position: Cesium.Cartesian3.fromDegrees(data.lon, data.lat, data.altitude ?? 0),
      billboard: {
        image: this._createIconDataUrl(data.type, colorCss(data.type)),
        width: 36,
        height: 36,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
        heightReference: data.type === "drone"
          ? Cesium.HeightReference.RELATIVE_TO_GROUND
          : Cesium.HeightReference.CLAMP_TO_GROUND,
      },
      label: {
        text: data.name,
        font: "11px sans-serif",
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -24),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        horizontalOrigin: Cesium.HorizontalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });

    this._entities.set(data.id, {
      entity,
      trajectory: data.trajectory ?? [],
    });

    // 初始化轨迹线
    if (data.trajectory && data.trajectory.length > 1) {
      this._updateTrajectoryLine(data.id, data.trajectory, data.type);
    }
  }

  _updateEntity(data) {
    const record = this._entities.get(data.id);
    if (!record) return;

    record.entity.position = Cesium.Cartesian3.fromDegrees(
      data.lon,
      data.lat,
      data.altitude ?? 0
    );

    // 更新轨迹
    if (data.trajectory && data.trajectory.length > 1) {
      record.trajectory = data.trajectory;
      this._updateTrajectoryLine(data.id, data.trajectory, data.type);
    }
  }

  _removeEntity(id) {
    const record = this._entities.get(id);
    if (!record) return;

    this._viewer.entities.removeById(`tracking_${id}`);
    this._viewer.entities.removeById(`trajectory_${id}`);
    this._entities.delete(id);
  }

  _updateTrajectoryLine(entityId, trajectory, type) {
    const lineId = `trajectory_${entityId}`;
    const existing = this._viewer.entities.getById(lineId);
    if (existing) this._viewer.entities.remove(existing);

    const positions = trajectory.map(p =>
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0)
    );

    const color = this._colorFor(type);

    this._viewer.entities.add({
      id: lineId,
      polyline: {
        positions,
        width: 2,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.2,
          color: color.withAlpha(0.6),
        }),
        clampToGround: true,
      },
    });
  }

  destroy() {
    for (const [id] of this._entities) {
      this._removeEntity(id);
    }
    this._entities.clear();
  }
}
