"""Chronological 15-minute forecast experiment; never a spatial retrofit model."""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import xlrd
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.preprocessing import StandardScaler


def features(window):
    now = window[-1]
    time = pd.Timestamp(now["time"])
    hour = time.hour+time.minute/60
    return [now["temperature_c"], now["humidity_pct"], now["pressure_hpa"], now["wind_mps"],
            *[now[key]-window[-offset-1][key] for key in ("temperature_c", "humidity_pct") for offset in (1, 3, 6)],
            math.sin(hour*math.pi/12), math.cos(hour*math.pi/12)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    paths = sorted(args.data.rglob("*.xls"))
    rows, sources, rejected = [], [], 0
    for path in paths:
        book = xlrd.open_workbook(str(path))
        for sheet in book.sheets():
            if sheet.ncols != 22 or sheet.cell_value(0, 0) != "观测时间":
                raise ValueError("Unexpected workbook schema: "+path.name)
            for index in range(1, sheet.nrows):
                values = sheet.row_values(index)
                try:
                    stamp = pd.Timestamp(values[0], tz="Asia/Shanghai")
                    temp, rh, pressure, wind = [float(values[k]) for k in (6, 11, 4, 15)]
                    if not (-40 <= temp <= 60 and 0 <= rh <= 100 and 800 <= pressure <= 1100 and 0 <= wind <= 60):
                        raise ValueError("outside range")
                    rows.append(dict(time=stamp.isoformat(), temperature_c=temp, humidity_pct=rh,
                                     pressure_hpa=pressure, wind_mps=wind))
                except (ValueError, TypeError):
                    rejected += 1
        sources.append({"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    frame = pd.DataFrame(rows)
    conflicts = frame.groupby("time").nunique().max(axis=1)
    conflict_times = set(conflicts[conflicts > 1].index)
    unique = frame.drop_duplicates().sort_values("time")
    duplicate_count = len(frame)-len(unique)
    unique = unique[~unique.time.isin(conflict_times)]
    records = unique.to_dict("records")
    x, y, present, times = [], [], [], []
    for i in range(6, len(records)-3):
        seq = records[i-6:i+4]
        stamps = pd.to_datetime([r["time"] for r in seq])
        if any((b-a).total_seconds() != 300 for a, b in zip(stamps, stamps[1:])):
            continue
        now, future = seq[6], seq[9]
        x.append(features(seq[:7])); present.append([now["temperature_c"], now["humidity_pct"]])
        y.append([future[k]-now[k] for k in ("temperature_c", "humidity_pct")]);times.append(stamps[6])
    x, y, present = np.asarray(x), np.asarray(y), np.asarray(present)
    if len(x) < 2000:
        raise ValueError("Too few contiguous labelled windows")
    boundary1, boundary2 = times[int(len(times)*0.7)], times[int(len(times)*0.85)]
    embargo = pd.Timedelta(minutes=45)
    masks = [np.array([t < boundary1-embargo for t in times]),
             np.array([boundary1 <= t < boundary2-embargo for t in times]),
             np.array([t >= boundary2 for t in times])]
    train, valid, test = masks
    scaler = StandardScaler().fit(x[train])
    candidates = []
    for alpha in (0.1, 1, 10, 100, 1000):
        model = Ridge(alpha=alpha).fit(scaler.transform(x[train]), y[train])
        prediction = model.predict(scaler.transform(x[valid]))
        score = np.mean(np.abs(prediction-y[valid])/np.maximum(np.mean(np.abs(y[valid]), axis=0), 0.01))
        candidates.append((score, alpha, model))
    _, alpha, model = min(candidates, key=lambda c: c[0])
    predictions = model.predict(scaler.transform(x[test]))
    metrics = {}
    enabled = []
    for i, key in enumerate(("temperature_c", "humidity_pct")):
        target = present[test, i]+y[test, i]
        forecast = present[test, i]+predictions[:, i]
        baseline = present[test, i]
        mae = float(mean_absolute_error(target, forecast))
        rmse = float(math.sqrt(mean_squared_error(target, forecast)))
        bmae = float(mean_absolute_error(target, baseline))
        brmse = float(math.sqrt(mean_squared_error(target, baseline)))
        eligible = mae < bmae and rmse < brmse
        enabled.append(eligible)
        metrics[key] = dict(mae=mae, rmse=rmse, persistence_mae=bmae, persistence_rmse=brmse,
                            passes_holdout_gate=eligible)
    model_json = dict(schema_version="weather-temporal-ridge/1.0", horizon_minutes=15,
                      feature_names=["temperature_c", "humidity_pct", "pressure_hpa", "wind_mps", "dt5", "dt15", "dt30", "drh5", "drh15", "drh30", "hour_sin", "hour_cos"],
                      coefficients=model.coef_.tolist(), intercept=model.intercept_.tolist(),
                      feature_mean=scaler.mean_.tolist(), feature_scale=scaler.scale_.tolist(),
                      enabled_targets=enabled, alpha=alpha,
                      evaluation=metrics, sample_counts=dict(train=int(train.sum()), validation=int(valid.sum()), test=int(test.sum())),
                      split=dict(train_end=max(t for t, m in zip(times, train) if m).isoformat(),
                                 validation_start=boundary1.isoformat(), validation_end=max(t for t, m in zip(times, valid) if m).isoformat(),
                                 test_start=boundary2.isoformat(), test_end=times[-1].isoformat(), embargo_minutes=45),
                      data_summary=dict(files=len(paths), rows=len(rows), exact_duplicates=duplicate_count,
                                        conflicting_timestamps=len(conflict_times), rejected_rows=rejected,
                                        retained_rows=len(records), first=records[0]["time"], last=records[-1]["time"]),
                      source_sha256=hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
                      provenance_status="user_supplied_station_exports_station_id_location_calibration_unverified",
                      spatial_retreatment_eligible=False, medical_eligible=False, deepseek_weights_modified=False,
                      limitations=["Chronological holdout, not independent station validation.",
                                   "No location, LCZ or intervention labels: cannot fit building-induced spatial temperature change.",
                                   "Rejected targets fall back to persistence, not invented improvements.",
                                   "Requires seven consecutive five-minute station observations; not applicable to hourly gridded weather."])
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/"weather-temporal-ridge.json").write_text(json.dumps(model_json, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.output/"source-manifest.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding="utf-8")
    chart_data = dict(actual=(present[test]+y[test])[:576].tolist(), forecast=(present[test]+predictions)[:576].tolist(), metrics=metrics)
    chart_html = '''<!doctype html><meta charset="utf-8"><style>body{margin:0;font:16px Arial;background:#f2f6f5;color:#213d3b}.chart{width:1200px;height:640px;padding:35px;box-sizing:border-box}h1{font-size:28px;margin:0 0 12px}p{font-size:14px;color:#5b7470}canvas{width:1130px;height:480px}</style><section class="chart" id="timeseries"><h1>Station observations / 15-minute temporal forecast</h1><p>Chronological held-out period · User-supplied station export · Not spatial retrofit validation</p><canvas id="lines" width="1130" height="480"></canvas></section><section class="chart" id="validation"><h1>Measured forecasting error / chronological holdout</h1><p>15-minute horizon · 2,629 held-out windows · Lower is better</p><canvas id="bars" width="1130" height="480"></canvas></section><script>const data=CHART_DATA;
const colors=['#19736a','#d17b48'];
const c=document.querySelector('#lines').getContext('2d');
for(let k=0;k<2;k++){const top=k*235+25,low=Math.floor(Math.min(...data.actual.map(r=>r[k])))-1,high=Math.ceil(Math.max(...data.actual.map(r=>r[k])))+1;c.fillStyle='#213d3b';c.font='16px Arial';c.fillText(k?'Humidity / %RH':'Temperature / C',65,top);for(let t=0;t<=4;t++){let y=top+25+t*40;c.strokeStyle='#d7e2df';c.beginPath();c.moveTo(65,y);c.lineTo(1100,y);c.stroke();c.fillStyle='#5b7470';c.fillText((high-(high-low)*t/4).toFixed(1),10,y+5);}['actual','forecast'].forEach((name,i)=>{c.strokeStyle=colors[i];c.lineWidth=i?1:2;c.beginPath();data[name].forEach((r,j)=>{let x=65+j/(data[name].length-1)*1035,y=top+25+(high-r[k])/(high-low)*160;j?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();});c.fillStyle=colors[0];c.fillText('Station export',770,top);c.fillStyle=colors[1];c.fillText('Forecast',965,top);}
const b=document.querySelector('#bars').getContext('2d');Object.entries(data.metrics).forEach(([key,m],k)=>{let left=k*560+65,max=Math.max(m.mae,m.persistence_mae)*1.35;b.font='18px Arial';b.fillStyle='#213d3b';b.fillText(k?'Humidity MAE / percentage points':'Temperature MAE / C',left,30);[m.persistence_mae,m.mae].forEach((v,i)=>{let x=left+i*220,y=385-v/max*280;b.fillStyle=i?colors[0]:'#8b9ba2';b.fillRect(x,y,140,385-y);b.fillStyle='#213d3b';b.fillText(v.toFixed(3),x,y-15);b.fillText(i?'Trained ridge':'Persistence',x,420);});});</script>'''
    (args.output/"chart-page.html").write_text(chart_html.replace("CHART_DATA", json.dumps(chart_data)), encoding="utf-8")
    print(json.dumps({k: model_json[k] for k in ("data_summary", "sample_counts", "split", "evaluation", "enabled_targets")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
