"""验证LCZ分类结果的脚本"""
import json

with open("output/lcz_classified/lcz_result_20260511_024935.geojson", encoding="utf-8") as f:
    data = json.load(f)

print("Type:", data["type"])
print("FeatureCount:", len(data["features"]))
print("CRS:", data["crs"]["properties"]["name"])
print()
print("First feature sample:")
f1 = data["features"][0]
print("  GridID:", f1["properties"]["grid_id"])
print("  LCZ:", f1["properties"]["lcz_type"], "-", f1["properties"]["lcz_name"])
print("  SVF:", f1["properties"]["svf"], "| Albedo:", f1["properties"]["albedo"])
print("  Height:", f1["properties"]["building_height"], "m | NDVI:", f1["properties"]["ndvi"])
print("  LST:", f1["properties"]["lst_smw"], "C | UHI:", f1["properties"]["uhi_intensity"])
print()
print("Second feature sample:")
f2 = data["features"][50]
print("  GridID:", f2["properties"]["grid_id"])
print("  LCZ:", f2["properties"]["lcz_type"], "-", f2["properties"]["lcz_name"])
print()

# 统计LCZ分布
from collections import Counter
lczs = Counter(f["properties"]["lcz_type"] for f in data["features"])
print("LCZ Distribution:")
for lcz, cnt in sorted(lczs.items(), key=lambda x: -x[1]):
    pct = cnt / len(data["features"]) * 100
    print(f"  LCZ {lcz}: {cnt} grids ({pct:.1f}%)")

print()
print("Cesium-ready properties confirmed:")
print("  - lcz_color field:", f1["properties"]["lcz_color"])
print("  - uhi_class field:", f1["properties"]["uhi_class"])
print("  - lst_rural_ref field:", f1["properties"]["lst_rural_ref"])
