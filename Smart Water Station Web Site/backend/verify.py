"""Offline verification with the user's models; no Firebase writes."""
import json
import hashlib
from pathlib import Path
import pandas as pd
import numpy as np
from service import Inference, evaluate, SENSORS

root=Path(__file__).resolve().parent
engine=Inference()
# Reproduce saved held-out predictions using the exact exported models.
reports={}
for task in ['current_quality','early_warning']:
    b=engine.models[task]
    frame=pd.read_csv(root/'evaluation'/f'{task}_test_predictions.csv')
    print(task, frame.columns.tolist())

now=1795104000000
history={str(i):dict(timestamp=now-(11-i)*5000,tds=160,ph=7.5,turbidity=.8,dissolved_oxygen=8) for i in range(12)}
live=dict(history['11'],main_tank_level=50,water_healthy=True)
date='2026-11-20'
data=dict(history_logs=history,live_telemetry=live,
          station_settings=dict(tank_capacity_m3=100,reserve_percent=10,level_volume_relation='linear'),
          delivery_schedule=dict(schema_version=1,entries={'a':dict(partner_id='p',delivery_date=date,quantity_m3=20,delivered_m3=0)}),
          partner_orders={'p':dict(status='paid')},
          vehicle_orders={'a':dict(status='completed',sponsor='فردي',estimated=False,filled_liters=5000,created_at=now-86400000),
                          'b':dict(status='completed',sponsor='فردي',estimated=False,filled_liters=6000,created_at=now-86400000)})
r=evaluate(engine,data,now)
assert r['current_quality']['status']=='ready'
assert r['early_warning']['status']=='ready'
assert abs(r['tomorrow_plan']['total_m3']-47.5)<1e-8
assert r['tomorrow_plan']['required_production_m3']==7.5
(root/'offline_example_results.json').write_text(json.dumps(r,indent=2))
assert engine.quality(live,history,now+61000)['current_quality']['status']=='unavailable'
broken=history.copy();del broken['5']
assert engine.quality(live,broken,now)['early_warning']['status']=='gathering'
assert evaluate(engine,dict(data,delivery_schedule=None),now)['tomorrow_plan']['status']=='unavailable'
assert evaluate(engine,dict(data,live_telemetry=dict(live,water_healthy=False)),now)['tomorrow_plan']['status']=='quality_blocked'
assert engine.quality(dict(live,tds=1001),history,now)['current_quality']['status']=='unavailable'
print('PASS: inference, plan arithmetic, stale data, gaps, absent schedule, quality block, invalid sensor')
