import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";

// Survey geometry is not available: preserve the OSM footprint and disclosed height.
export function createBuildingLayer(data, { dark = false, onError = () => {} } = {}) {
  const origin = MercatorCoordinate.fromLngLat([113.531, 34.814], 0);
  const meter = origin.meterInMercatorCoordinateUnits();
  const layer = {
    id: "campus-model-detail", type: "custom", renderingMode: "3d", visible: true,
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      this.sun = new THREE.DirectionalLight(0xffedcf, 2.8);
      this.sun.position.set(-200, -150, 300);
      this.scene.add(this.sun);
      this.materials = [
        new THREE.MeshStandardMaterial({ color: dark ? 0xc8ded7 : 0xe4eee5, roughness: 0.85, metalness: 0.08 }),
        new THREE.MeshStandardMaterial({ color: dark ? 0x5b8a86 : 0x97b3a4, roughness: 0.9, metalness: 0.04 }),
      ];
      this.edgeMaterial = new THREE.LineBasicMaterial({ color: dark ? 0x9ed5c2 : 0x566e63, transparent: true, opacity: 0.4 });
      this.group = new THREE.Group();
      this.scene.add(this.group);
      this.meshes = new Map();
      for (const [index, feature] of data.features.entries()) {
        const polygons = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : [];
        const h = Number(feature.properties.height_m);
        const height = Number.isFinite(h) && h > 0 ? h : 18;
        for (const polygon of polygons) {
          const paths = polygon.map((ring) => ring.map(([lng, lat]) => {
            const p = MercatorCoordinate.fromLngLat([lng, lat]);
            return new THREE.Vector2((p.x - origin.x) / meter, -(p.y - origin.y) / meter);
          }));
          if (paths[0]?.length < 4) continue;
          const shape = new THREE.Shape(paths[0]);
          shape.holes = paths.slice(1).map((ring) => new THREE.Path(ring));
          const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
          const mesh = new THREE.Mesh(geometry, this.materials);
          mesh.userData.featureId = feature.id;
          if (!this.meshes.has(index)) this.meshes.set(index, []);
          this.meshes.get(index).push(mesh);
          this.group.add(mesh);
          this.group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), this.edgeMaterial));
        }
      }
      this.transform = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(meter, -meter, meter));
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.85;
    },
    render(gl, args) {
      if (!this.visible || this.failed) return;
      try {
        this.camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix).multiply(this.transform);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        this.renderer.resetState();
      } catch (error) { this.failed = true; onError(error); }
    },
    setLighting(value) {
      if (!this.sun) return;
      const angle = Number(value) * Math.PI / 180;
      this.sun.position.set(250 * Math.cos(angle), 250 * Math.sin(angle), 300);
      this.map.triggerRepaint();
    },
    select(id) {
      if (this.selected) { for (const mesh of this.selected) mesh.material = this.materials; this.selected = null; }
      const meshes = this.meshes?.get(id);
      this.highlightMaterial?.dispose();
      if (meshes) {
        this.highlightMaterial = new THREE.MeshStandardMaterial({ color: 0xf6c873, roughness: 0.7 });
        for (const mesh of meshes) mesh.material = this.highlightMaterial;
        this.selected = meshes;
      }
      this.map?.triggerRepaint();
    },
    onRemove() {
      this.group?.traverse((node) => node.geometry?.dispose());
      this.materials?.forEach((material) => material.dispose());
      this.edgeMaterial?.dispose(); this.highlightMaterial?.dispose();
      this.renderer?.dispose();
    },
  };
  return layer;
}
