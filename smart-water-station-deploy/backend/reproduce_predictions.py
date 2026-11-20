import sys,json
from pathlib import Path
import pandas as pd,numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from service import Inference,SENSORS
engine=Inference();df=pd.read_csv(Path(__file__).resolve().parent.parent/'training/water_station_cleaned.csv')
root=Path(__file__).resolve().parent
report={}
for task in ['current_quality','early_warning']:
 saved=pd.read_csv(root/'evaluation'/f'{task}_test_predictions.csv')
 if task=='current_quality':
  merged=saved.merge(df,on=['scenario_id','timestamp'],validate='one_to_one');X=merged[SENSORS]
 else:
  groups={sid:g.sort_values('timestamp').reset_index(drop=True) for sid,g in df.groupby('scenario_id')};rows=[]
  for r in saved.itertuples():
   g=groups[r.scenario_id];i=g.index[g.timestamp==r.timestamp][0];w=g.iloc[i-11:i+1];assert len(w)==12 and (np.diff(w.timestamp)==5000).all();t=(w.timestamp.to_numpy()-w.timestamp.iloc[0])/1000;f={}
   for c in SENSORS:
    a=w[c].to_numpy(float);f.update({c+'_last':a[-1],c+'_mean':a.mean(),c+'_std':a.std(),c+'_min':a.min(),c+'_max':a.max(),c+'_slope':float(np.polyfit(t,a,1)[0]),c+'_delta':a[-1]-a[0]})
   rows.append(f)
  X=pd.DataFrame(rows)
 b=engine.models[task];prob=b['model'].predict_proba(X[b['features']])[:,list(b['model'].classes_).index(1)];pred=(prob>=b['threshold']).astype(int)
 assert np.array_equal(pred,saved.predicted.to_numpy())
 assert np.allclose(prob,saved.probability_uncalibrated.to_numpy(),rtol=0,atol=1e-12)
 report[task]={'test_records':len(saved),'predictions_identical':True,'max_score_difference':float(np.max(abs(prob-saved.probability_uncalibrated.to_numpy())))}
(root/'verification_results.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
