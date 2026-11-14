import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";

// Survey geometry is not available: preserve the OSM footprint and disclosed height.
export function createBuildingLayer(data, { dark = false, onError = () => {} } = {}) {
  const b = data.bbox || [113.531, 34.814, 113.531, 34.814];
  const origin = MercatorCoordinate.fromLngLat([(b[0]+b[2])/2, (b[1]+b[3])/2], 0);
  const meter = origin.meterInMercatorCoordinateUnits();
  const layer = {
    id: "campus-model-detail", type: "custom", renderingMode: "3d", visible: true,
    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      this.sun = new THREE.DirectionalLight(0xffffff, 2.8);
      this.sun.position.set(-200, -150, 300);
      this.scene.add(this.sun);
      this.materials = [
        new THREE.MeshStandardMaterial({ color: 0xf2f4f3, roughness: 0.85, metalness: 0.02 }),
        new THREE.MeshStandardMaterial({ color: 0xc5ced1, roughness: 0.9, metalness: 0.02 }),
      ];
      this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x94a6ae, transparent: true, opacity: 0.3 });
      this.group = new THREE.Group();
      this.scene.add(this.group);
      this.meshes = new Map();
      this.featureGroups = new Map();
      this.newMaterial = new THREE.MeshStandardMaterial({ color: 0xe7ab75, roughness: 0.8, metalness: 0.02 });
      this.setFeatures(data);
      this.transform = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(meter, -meter, meter));
      this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      this.renderer.autoClear = false;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.85;
    },
    setFeatures(next) {
      if (!this.featureGroups) return;
      const ids = new Set(next.features.map(f => f.id));
      for (const [id, item] of this.featureGroups) if (!ids.has(id)) {
        this.group.remove(item.group); item.group.traverse(node => node.geometry?.dispose());
        this.featureGroups.delete(id); this.meshes.delete(id);
      }
      for (const feature of next.features) {
        const signature = JSON.stringify([feature.geometry, feature.properties.render_height_m, feature.properties.height_m]);
        if (this.featureGroups.get(feature.id)?.signature === signature) continue;
        const old = this.featureGroups.get(feature.id);
        if (old) { this.group.remove(old.group); old.group.traverse(node => node.geometry?.dispose()); }
        const featureGroup = new THREE.Group();
        this.group.add(featureGroup); this.meshes.set(feature.id, []);
        this.featureGroups.set(feature.id, { group: featureGroup, signature });
        const polygons = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : [];
        const h = Number(feature.properties.render_height_m ?? feature.properties.height_m);
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
          const material = feature.properties.state === "new" ? this.newMaterial : this.materials;
          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData.baseMaterial = material;
          mesh.userData.featureId = feature.id;
          this.meshes.get(feature.id).push(mesh);
          featureGroup.add(mesh);
          featureGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), this.edgeMaterial));
        }
      }
      this.map?.triggerRepaint();
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
      if (this.selected) { for (const mesh of this.selected) mesh.material = mesh.userData.baseMaterial; this.selected = null; }
      const meshes = this.meshes?.get(id);
      this.highlightMaterial?.dispose();
      if (meshes) {
        this.highlightMaterial = new THREE.MeshStandardMaterial({ color: 0xe2a459, roughness: 0.7 });
        for (const mesh of meshes) mesh.material = this.highlightMaterial;
        this.selected = meshes;
      }
      this.map?.triggerRepaint();
    },
    pick(point) {
      if (!this.visible || this.failed || !this.camera) return null;
      const canvas=this.map.getCanvas(), x=point.x/canvas.clientWidth*2-1, y=1-point.y/canvas.clientHeight*2;
      const inverse=this.camera.projectionMatrix.clone().invert();
      const near=new THREE.Vector3(x,y,-1).applyMatrix4(inverse);
      const far=new THREE.Vector3(x,y,1).applyMatrix4(inverse);
      const ray=new THREE.Raycaster(near,far.sub(near).normalize());
      this.group.updateMatrixWorld(true);
      return ray.intersectObjects([...this.meshes.values()].flat(),false)[0]?.object.userData.featureId ?? null;
    },
    onRemove() {
      this.group?.traverse((node) => node.geometry?.dispose());
      this.materials?.forEach((material) => material.dispose());
      this.edgeMaterial?.dispose(); this.highlightMaterial?.dispose();
      this.newMaterial?.dispose();
      this.renderer?.dispose();
    },
  };
  return layer;
}
