"""Reproducible physics distillation, with disjoint weather blocks and no field claim."""
import itertools
import json
from pathlib import Path

import numpy as np
from pythermalcomfort.models import utci

from backend.aic.store import digest
from backend.spatial_surrogate import FEATURES, VERSION, design, inputs


def main():
    rng=np.random.default_rng(20261026)
    model={'schema_version':VERSION,'feature_names':FEATURES,
           'center':[10,20,8.75,2.5],'scale':[40,50,8.25,2.5],
           'domain':[[-30,50],[-30,70],[0.5,17],[0,5]],
           'powers':[list(p) for p in itertools.product(range(7),repeat=4) if sum(p)<=6],
           'training_origin':'synthetic_pythermalcomfort_4.6.2_UTCI_teacher_not_field_measurements',
           'teacher':'https://pythermalcomfort.readthedocs.io/en/latest/documentation/models.html',
           'split':'temperature-radiant-weather blocks held out before fitting; test never used for fitting',
           'seed':20261026,'field_calibrated':False}
    rows=[]
    for _ in range(6):
        count=12000
        t=rng.uniform(-30,50,count);rh=rng.uniform(0,100,count);v=rng.uniform(.5,17,count);delta=rng.uniform(-30,70,count)
        x=inputs(t,t+delta,v,rh)
        y=np.asarray(utci(tdb=t,tr=t+delta,v=v,rh=rh,round_output=False).utci)
        good=np.isfinite(y)
        rows.append((x[good],y[good]))
    x=np.concatenate([r[0] for r in rows]);y=np.concatenate([r[1] for r in rows])
    # Hold out entire temperature/radiant blocks, not random copies of a scene.
    block=(np.floor((x[:,0]+30)/5).astype(int)*11+np.floor((x[:,1]+30)/10).astype(int))%7
    masks={'train':block<5,'validation':block==5,'test':block==6}
    train=design(x[masks['train']],model)
    coefficients,_,rank,_=np.linalg.lstsq(train,y[masks['train']],rcond=1e-12)
    model['coefficients']=coefficients.tolist();model['rank']=int(rank)
    model['sample_counts']={name:int(mask.sum()) for name,mask in masks.items()}
    model['training_data_sha256']=digest({'features':x.tolist(),'labels':y.tolist()})
    model['evaluation']={}
    for name,mask in masks.items():
        predicted=design(x[mask],model)@coefficients
        errors=np.abs(predicted-y[mask]);baseline=np.abs(x[mask,0]-y[mask])
        model['evaluation'][name]={'mae_c':float(errors.mean()),'p95_abs_error_c':float(np.quantile(errors,.95)),
            'max_abs_error_c':float(errors.max()),'air_temperature_baseline_mae_c':float(baseline.mean()),
            'meaning':'emulation_error_against_UTCI_teacher_not_real_microclimate_prediction_error'}
    if model['evaluation']['test']['max_abs_error_c']>.02 or rank!=len(coefficients):
        raise RuntimeError('held-out physics emulation gate failed')
    model['artifact_sha256']=digest(model)
    target=Path('models/spatial-utci-emulator.json')
    target.write_text(json.dumps(model,indent=2,allow_nan=False),encoding='utf-8')
    evidence=Path('output/playwright/spatial-emulator-training.json')
    evidence.write_text(json.dumps({k:v for k,v in model.items() if k not in {'coefficients','powers'}},indent=2),encoding='utf-8')
    print(json.dumps({'artifact':str(target),'samples':model['sample_counts'],'evaluation':model['evaluation'],'sha256':model['artifact_sha256']}))


if __name__=='__main__':
    main()
