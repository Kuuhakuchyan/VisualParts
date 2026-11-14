"""CPU-only UTCI distillation; a physics emulator, never spatial field calibration."""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from backend.aic.store import digest

ARTIFACT = Path(__file__).resolve().parents[1]/'models/spatial-utci-emulator.json'
VERSION = 'spatial-utci-distillation/1.0'
FEATURES = ['air_temperature_c', 'mrt_minus_air_c', 'wind_10m_mps', 'vapour_pressure_kpa']


def vapour_pressure(temperature, humidity):
    """Same saturation formula/units as the published UTCI reference implementation."""
    tk = np.asarray(temperature,dtype=float)+273.15
    coefficients = [-2836.5744,-6028.076559,19.54263612,-0.02737830188,0.000016261698,7.0229056e-10,-1.8680009e-13]
    saturation = 2.7150305*np.log(tk)
    for power, coefficient in enumerate(coefficients):
        saturation += coefficient*np.power(tk,power-2)
    return np.exp(saturation)*0.001*np.asarray(humidity,dtype=float)/100


def inputs(temperature, mrt, wind, humidity):
    t,r,v,h = np.broadcast_arrays(*[np.asarray(x,dtype=float) for x in [temperature,mrt,wind,humidity]])
    return np.column_stack([t.reshape(-1),(r-t).reshape(-1),v.reshape(-1),vapour_pressure(t,h).reshape(-1)])


def design(matrix, model):
    normalized=(matrix-np.asarray(model['center']))/np.asarray(model['scale'])
    powers=np.asarray(model['powers'],dtype=int)
    return np.prod(normalized[:,None,:]**powers[None,:,:],axis=2)


@lru_cache(maxsize=1)
def artifact():
    model=json.loads(ARTIFACT.read_text(encoding='utf-8'))
    if model.get('schema_version')!=VERSION or model.get('feature_names')!=FEATURES:
        raise ValueError('unsupported spatial emulator')
    if model.get('artifact_sha256')!=digest({k:v for k,v in model.items() if k!='artifact_sha256'}):
        raise ValueError('spatial emulator checksum mismatch')
    if model['evaluation']['test']['max_abs_error_c']>0.02:
        raise ValueError('spatial emulator evaluation gate failed')
    coefficients=np.asarray(model['coefficients'])
    if len(coefficients)!=len(model['powers']) or not np.isfinite(coefficients).all():
        raise ValueError('invalid spatial emulator weights')
    return model


def manifest():
    try:
        model=artifact()
        return {'available':True,'schema_version':VERSION,'method':'polynomial_physics_distillation',
                'artifact_sha256':model['artifact_sha256'],'training_origin':model['training_origin'],
                'sample_counts':model['sample_counts'],'evaluation':model['evaluation'],
                'field_calibrated':False,'purpose':'per_grid_heat_stress_prediction_checked_against_physics'}
    except (OSError,ValueError,KeyError,TypeError):
        return {'available':False,'reason':'artifact_unavailable_or_rejected','field_calibrated':False}


def checked_predict(temperature,mrt,wind,humidity,physics):
    reference=np.asarray(physics,dtype=float).reshape(-1)
    accepted=np.zeros(len(reference),dtype=bool)
    prediction=np.full(len(reference),np.nan)
    try:
        model=artifact()
        matrix=inputs(temperature,mrt,wind,humidity)
        domain=np.asarray(model['domain'])
        eligible=np.isfinite(reference)&np.isfinite(matrix).all(axis=1)&((matrix>=domain[:,0])&(matrix<=domain[:,1])).all(axis=1)
        if eligible.any():
            prediction[eligible]=design(matrix[eligible],model)@np.asarray(model['coefficients'])
            # Tight online agreement also protects small construction deltas.
            accepted=eligible&(np.abs(prediction-reference)<=0.00001)
            for threshold in [-40,-27,-13,0,9,26,32,38,46]:
                accepted &= (prediction<threshold)==(reference<threshold)
    except (OSError,ValueError,KeyError,TypeError):
        pass
    return np.where(accepted,prediction,reference),prediction,accepted
