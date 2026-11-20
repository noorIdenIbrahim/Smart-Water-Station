"""Run the tested quality models and publish advisory results to Firebase."""
import argparse
import hashlib
import json
import math
import os
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import joblib
import numpy as np
import pandas as pd
import sklearn

ROOT = Path(__file__).resolve().parent
TZ = ZoneInfo('Asia/Hebron')
SENSORS = ['tds', 'ph', 'turbidity', 'dissolved_oxygen']
LIMITS = [(0, 1000), (0, 14), (0, 5), (0, 10)]


def numeric(v):
    if v is None or isinstance(v, bool) or isinstance(v, str) and not v.strip():
        raise ValueError('Missing numeric value')
    n = float(v)
    if not math.isfinite(n):
        raise ValueError('Non-finite number')
    return n


def measurement(row, now):
    ts = numeric(row.get('timestamp'))
    if not 946684800000 <= ts <= now + 5000:
        raise ValueError('Invalid Unix millisecond timestamp')
    values = [numeric(row.get(c)) for c in SENSORS]
    if any(not lo <= x <= hi for x, (lo, hi) in zip(values, LIMITS)):
        raise ValueError('Sensor reading outside simulated device range')
    return ts, values


# Keep the exact estimator, feature schema and validation-selected threshold.
class Inference:
    def __init__(self):
        self.models = {}
        for task in ['current_quality', 'early_warning']:
            path = ROOT / 'models' / (task + '_model.joblib')
            bundle = joblib.load(path)
            if bundle['sklearn_version'] != sklearn.__version__:
                raise RuntimeError('Install scikit-learn==' + bundle['sklearn_version'])
            bundle['version'] = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
            self.models[task] = bundle

    def predict(self, task, features, source_ts, now):
        b = self.models[task]
        frame = pd.DataFrame([features], columns=b['features'])
        positive_index = list(b['model'].classes_).index(1)
        score = float(b['model'].predict_proba(frame)[0, positive_index])
        return dict(status='ready', source='trained_model', model_version=b['version'],
                    generated_at=now, source_timestamp=source_ts, valid_until=source_ts + 60000,
                    positive=bool(score >= b['threshold']), score=score,
                    threshold=float(b['threshold']), score_calibrated=False)

    def quality(self, live, history, now):
        empty = dict(status='unavailable', generated_at=now, valid_until=now,
                     reason='Missing, invalid or stale live reading')
        try:
            ts, values = measurement(live, now)
            if now - ts > 60000:
                raise ValueError('Stale live reading')
        except (ValueError, TypeError, AttributeError):
            return dict(current_quality=empty, early_warning=empty.copy())
        current = self.predict('current_quality', dict(zip(SENSORS, values)), ts, now)
        current['verdict'] = 'unacceptable' if current['positive'] else 'acceptable'
        waiting = dict(status='gathering', generated_at=now, valid_until=now,
                       reason='Need 12 valid consecutive samples at exactly 5000 ms; no interpolation')
        rows = {}
        conflicts = set()
        for row in list((history or {}).values()) + [live]:
            try:
                stamp, vals = measurement(row, now)
                if stamp > ts:
                    continue
                if stamp in rows and rows[stamp] != vals:
                    conflicts.add(stamp)
                rows[stamp] = vals
            except (ValueError, TypeError, AttributeError):
                continue
        # Match training's sampling contract; never silently resample or invent values.
        stamps = [ts - i * 5000 for i in range(11, -1, -1)]
        if any(s not in rows or s in conflicts for s in stamps):
            return dict(current_quality=current, early_warning=waiting)
        if current['positive']:
            return dict(current_quality=current, early_warning=dict(waiting, status='current_violation',
                        reason='Water already outside current limits; future warning is not applicable'))
        t = (np.array(stamps) - stamps[0]) / 1000
        features = {}
        for i, c in enumerate(SENSORS):
            a = np.array([rows[s][i] for s in stamps])
            features.update({c+'_last': a[-1], c+'_mean': a.mean(), c+'_std': a.std(),
                             c+'_min': a.min(), c+'_max': a.max(),
                             c+'_slope': float(np.polyfit(t, a, 1)[0]), c+'_delta': a[-1]-a[0]})
        warning = self.predict('early_warning', features, ts, now)
        warning['horizon_seconds'] = 60
        return dict(current_quality=current, early_warning=warning)


# Demand is a transparent planning estimate, separate from trained quality inference.
def plan(schedule, partners, orders, settings, live, quality, now):
    base = dict(status='unavailable', generated_at=now, valid_until=now,
                source='planning_estimate', trained_ml_model=False)
    try:
        if not isinstance(schedule, dict) or schedule.get('schema_version') != 1:
            raise ValueError('Initialize and review the dated delivery schedule on the website')
        target = (datetime.fromtimestamp(now/1000, TZ).date()+timedelta(days=1)).isoformat()
        bookings = 0
        for b in (schedule.get('entries') or {}).values():
            if b.get('status') == 'cancelled':
                continue
            datetime.strptime(b['delivery_date'], '%Y-%m-%d')
            if b['delivery_date'] != target:
                continue
            partner = (partners or {}).get(b['partner_id'], {})
            if partner.get('status') != 'paid':
                raise ValueError('Tomorrow has a booking for an unpaid/missing contract')
            qty, done = numeric(b['quantity_m3']), numeric(b.get('delivered_m3', 0))
            if not 0 <= done <= qty:
                raise ValueError('Invalid booked/delivered quantities')
            bookings += qty-done
        samples = []
        for o in (orders or {}).values():
            if o.get('status') != 'completed' or o.get('partner_id') or o.get('sponsor', '').strip() != 'فردي' or o.get('estimated') is not False:
                continue
            stamp = numeric(o.get('completed_at') or o.get('created_at'))
            if stamp < 946684800000 or stamp > now:
                continue
            liters = numeric(o.get('filled_liters'))
            if liters > 0:
                samples.append(liters/1000)
        if not samples:
            raise ValueError('No actual individual sales available for calculating average order volume')
        cap = numeric(settings.get('tank_capacity_m3'))
        reserve_pct = numeric(settings.get('reserve_percent'))
        if settings.get('level_volume_relation') != 'linear' or cap <= 0 or not 0 <= reserve_pct <= 100:
            raise ValueError('Invalid tank configuration')
        stamp, _ = measurement(live, now)
        level = numeric(live.get('main_tank_level'))
        if now-stamp > 60000 or not 0 <= level <= 100 or live.get('main_level_valid') is False:
            raise ValueError('Missing or stale tank level')
        if not isinstance(live.get('water_healthy'), bool) or quality.get('status') != 'ready':
            raise ValueError('Quality status unavailable')
        healthy = live['water_healthy'] and not quality['positive']
        stock = cap*level/100 if healthy else 0
        individual = 5*sum(samples)/len(samples)
        reserve = cap*reserve_pct/100
        return dict(base, status='ready' if healthy else 'quality_blocked', target_date=target,
                    valid_until=stamp+60000, confirmed_m3=bookings, predicted_extra_m3=individual,
                    total_m3=bookings+individual, usable_stock_m3=stock, reserve_m3=reserve,
                    required_production_m3=max(0, bookings+individual+reserve-stock),
                    expected_individuals=5, historical_orders_used=len(samples),
                    average_individual_m3=sum(samples)/len(samples),
                    production_requires_quality_clearance=not healthy)
    except (ValueError, TypeError, KeyError, AttributeError) as e:
        return dict(base, reason=str(e))


def evaluate(engine, data, now):
    q = engine.quality(data.get('live_telemetry'), data.get('history_logs'), now)
    q['tomorrow_plan'] = plan(data.get('delivery_schedule'), data.get('partner_orders'),
                              data.get('vehicle_orders'), data.get('station_settings') or {},
                              data.get('live_telemetry'), q['current_quality'], now)
    q['service_status'] = dict(status='running', generated_at=now, valid_until=now+60000)
    return q


# Offline mode makes no network requests and never writes simulated results to Firebase.
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', type=Path)
    parser.add_argument('--output', type=Path, default=Path('offline_results.json'))
    parser.add_argument('--now-ms', type=int)
    args = parser.parse_args()
    engine = Inference()
    if args.offline:
        result = evaluate(engine, json.loads(args.offline.read_text(encoding='utf-8')),
                          args.now_ms or int(time.time()*1000))
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print('Offline evaluation saved:', args.output)
        return
    import firebase_admin
    from firebase_admin import credentials, db
    firebase_admin.initialize_app(credentials.ApplicationDefault(), {
        'databaseURL': os.environ.get('FIREBASE_DATABASE_URL',
          'https://ai-iot-smartwatersystem-default-rtdb.firebaseio.com')})
    paths = ['live_telemetry', 'history_logs', 'delivery_schedule', 'partner_orders', 'vehicle_orders', 'station_settings']
    while True:
        try:
            data = {p: (db.reference(p).order_by_key().limit_to_last(120).get()
                         if p == 'history_logs' else db.reference(p).get()) for p in paths}
            now = int(time.time()*1000)
            db.reference('ai_results').update(evaluate(engine, data, now))
            print('Published analysis at', datetime.now(TZ).isoformat(), flush=True)
        except Exception as e:
            # Old results expire in the UI even when publication itself is unavailable.
            print('Analysis cycle failed:', type(e).__name__, flush=True)
        time.sleep(5)


if __name__ == '__main__':
    main()
