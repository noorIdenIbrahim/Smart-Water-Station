"""Compare models using one cleaned CSV. Simulation research, not a potability certificate."""
from pathlib import Path
import hashlib
import json
import time
import importlib.metadata
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split, StratifiedGroupKFold, GridSearchCV
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.metrics import (accuracy_score, balanced_accuracy_score, precision_score, recall_score,
    f1_score, fbeta_score, average_precision_score, roc_auc_score, confusion_matrix, classification_report)
from threadpoolctl import threadpool_limits

SENSORS=['tds','ph','turbidity','dissolved_oxygen']
SEED=42
WINDOW=12  # Twelve readings spanning 55 seconds; selected before model comparison.
INTERVAL_MS=5000
HORIZON_SECONDS=60

# Check the cleaned-file contract without silently cleaning, filling, or relabeling it.
def load_clean_csv(csv_path):
    df=pd.read_csv(csv_path)
    required=SENSORS+['scenario_id','timestamp','water_healthy','crossing_next_60s']
    missing=set(required)-set(df.columns)
    if missing:raise ValueError('Missing columns: '+', '.join(sorted(missing)))
    for c in SENSORS+['timestamp','crossing_next_60s']:
        df[c]=pd.to_numeric(df[c],errors='raise')
    if not np.isfinite(df[SENSORS+['timestamp']].to_numpy()).all():raise ValueError('Missing/nonfinite measurement: run cleaning first')
    for f,hi in zip(SENSORS,[1000,14,5,10]):
        if not df[f].between(0,hi).all():raise ValueError('Invalid measurement range: '+f)
    if df.scenario_id.isna().any() or df.duplicated(['scenario_id','timestamp']).any():raise ValueError('Invalid or conflicting recording/time')
    if (df.timestamp.mod(1)!=0).any():raise ValueError('Expected integer Unix milliseconds')
    if 'timestamp_unit' in df and not df.timestamp_unit.eq('unix_ms').all():raise ValueError('Expected unix_ms')
    df.timestamp=df.timestamp.astype('int64')
    if not df.water_healthy.isin([True,False,0,1,'True','False','true','false']).all():raise ValueError('Invalid current label')
    df.water_healthy=df.water_healthy.astype(str).str.lower().map({'true':True,'false':False,'1':True,'0':False})
    if not df.crossing_next_60s.dropna().isin([0,1]).all():raise ValueError('Invalid future label')
    rules=((df.tds<=300)&df.ph.between(6.5,8.5)&(df.turbidity<=1.5)&(df.dissolved_oxygen>=5))
    if not rules.eq(df.water_healthy).all():raise ValueError('Current labels conflict with declared ESP32 operating rules')
    return df.drop(columns='split',errors='ignore').sort_values(['scenario_id','timestamp']).reset_index(drop=True)

# Split independent recordings, not individual rows; scenario_type is used only for balanced assignment.
def split_recordings(df):
    groups=df[['scenario_id']].drop_duplicates().sort_values('scenario_id')
    if len(groups)<15:raise ValueError('At least 15 independent recordings required for this train/validation/test workflow')
    if 'scenario_type' in df:
        if df.groupby('scenario_id').scenario_type.nunique().max()!=1:raise ValueError('Inconsistent recording metadata')
        groups=groups.merge(df[['scenario_id','scenario_type']].drop_duplicates(),on='scenario_id')
        strat=groups.scenario_type if groups.scenario_type.value_counts().min()>=5 else None
    else:strat=None
    tr,held=train_test_split(groups,test_size=.4,random_state=SEED,stratify=strat)
    strat2=held.scenario_type if strat is not None else None
    val,te=train_test_split(held,test_size=.5,random_state=SEED,stratify=strat2)
    mapping={sid:part for part,g in [('train',tr),('validation',val),('test',te)] for sid in g.scenario_id}
    assert set(tr.scenario_id).isdisjoint(te.scenario_id) and set(val.scenario_id).isdisjoint(tr.scenario_id)
    return mapping

# Derive predictors from past/current measurements and elapsed time only; absolute dates are excluded.
def past_window_features(w):
    if len(w)!=WINDOW or not np.diff(w.timestamp.to_numpy()).__eq__(INTERVAL_MS).all():raise ValueError('Incomplete past window')
    t=(w.timestamp.to_numpy()-w.timestamp.iloc[0])/1000.
    result={}
    for c in SENSORS:
        a=w[c].to_numpy(dtype=float)
        result.update({c+'_last':a[-1],c+'_mean':a.mean(),c+'_std':a.std(),c+'_min':a.min(),c+'_max':a.max(),c+'_slope':float(np.polyfit(t,a,1)[0]),c+'_delta':a[-1]-a[0]})
    return result

# Validate future targets against complete observed horizons and skip windows containing time gaps.
def build_task_tables(df,mapping):
    current=df[['scenario_id','timestamp']+SENSORS].copy()
    current['target']=(~df.water_healthy).astype(int)
    forecast=[];audit={'eligible_future_targets':0,'complete_past_windows':0,'positive_windows':0}
    for sid,g in df.groupby('scenario_id',sort=False):
        g=g.sort_values('timestamp').reset_index(drop=True)
        times=g.timestamp.to_numpy()
        for i in range(len(g)):
            target=g.at[i,'crossing_next_60s']
            if pd.isna(target):continue
            future=g.iloc[i+1:i+13]
            if len(future)!=12 or not np.all(np.diff(times[i:i+13])==INTERVAL_MS):raise ValueError('Future label crosses a gap or incomplete horizon')
            if int((~future.water_healthy).any())!=int(target):raise ValueError('Incorrect future label: rerun cleaning')
            if not g.at[i,'water_healthy']:continue
            audit['eligible_future_targets']+=1
            if i<WINDOW-1:continue
            w=g.iloc[i-WINDOW+1:i+1]
            if not np.all(np.diff(w.timestamp.to_numpy())==INTERVAL_MS):continue
            forecast.append({**past_window_features(w),'scenario_id':sid,'timestamp':g.at[i,'timestamp'],'target':int(target)})
    warning=pd.DataFrame(forecast)
    if warning.empty:raise ValueError('No complete early-warning windows remain')
    audit['complete_past_windows']=len(warning);audit['positive_windows']=int(warning.target.sum())
    for table in [current,warning]:
        table['partition']=table.scenario_id.map(mapping)
        for part in ['train','validation','test']:
            subset=table[table.partition.eq(part)]
            if subset.empty or subset.target.nunique()!=2:raise ValueError('A partition has missing classes; collect more independent scenarios')
    return {'current_quality':current,'early_warning':warning},audit

# Compare five algorithm families with preprocessing fitted inside grouped training folds.
def model_candidates():
    return {
      'LogisticRegression':(Pipeline([('scale',StandardScaler()),('model',LogisticRegression(max_iter=3000,class_weight='balanced',random_state=SEED))]),{'model__C':[.1,1,10]}),
      'SVM_RBF':(Pipeline([('scale',StandardScaler()),('model',SVC(kernel='rbf',probability=True,class_weight='balanced',random_state=SEED))]),{'model__C':[1,10],'model__gamma':['scale']}),
      'RandomForest':(RandomForestClassifier(n_estimators=150,class_weight='balanced',random_state=SEED,n_jobs=1),{'max_depth':[None,10],'min_samples_leaf':[1,4]}),
      'ExtraTrees':(ExtraTreesClassifier(n_estimators=150,class_weight='balanced',random_state=SEED,n_jobs=1),{'max_depth':[None,10],'min_samples_leaf':[1,4]}),
      'HistGradientBoosting':(HistGradientBoostingClassifier(max_iter=150,random_state=SEED),{'learning_rate':[.05,.1],'max_leaf_nodes':[15,31]})
    }

def probability(model,X):
    col=list(model.classes_).index(1)
    return model.predict_proba(X)[:,col]

def metrics(y,p,score=None):
    tn,fp,fn,tp=confusion_matrix(y,p,labels=[0,1]).ravel()
    result={'accuracy':float(accuracy_score(y,p)),'balanced_accuracy':float(balanced_accuracy_score(y,p)),
      'precision':float(precision_score(y,p,zero_division=0)),'recall':float(recall_score(y,p,zero_division=0)),
      'f1':float(f1_score(y,p,zero_division=0)),'f2':float(fbeta_score(y,p,beta=2,zero_division=0)),
      'false_positive_rate':float(fp/(fp+tn)) if fp+tn else None,
      'tn':int(tn),'fp':int(fp),'fn':int(fn),'tp':int(tp)}
    if score is not None:
        result['average_precision']=float(average_precision_score(y,score))
        result['roc_auc']=float(roc_auc_score(y,score))
    return result

# Freeze the warning threshold on validation data, prioritizing recall through F2 (beta=2).
def choose_threshold(y,score,task):
    if task=='current_quality':return .5
    candidates=[]
    for t in np.arange(.1,.901,.05):
        m=metrics(y,(score>=t).astype(int));candidates.append((m['f2'],m['precision'],m['balanced_accuracy'],float(t)))
    return max(candidates)[3]

# Provide transparent references: exact operating rules, no-warning, and linear trend extrapolation.
def baseline_predict(task,X):
    if task=='current_quality':
        return ((X.tds>300)|~X.ph.between(6.5,8.5)|(X.turbidity>1.5)|(X.dissolved_oxygen<5)).astype(int).to_numpy()
    f={c:X[c+'_last']+60*X[c+'_slope'] for c in SENSORS}
    return ((f['tds']>300)|(f['ph']<6.5)|(f['ph']>8.5)|(f['turbidity']>1.5)|(f['dissolved_oxygen']<5)).astype(int).to_numpy()

# Plot only the selected model and declared references; the test set never chooses a winner.
def save_plots(y,p,score,comparison,task,out):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from sklearn.metrics import ConfusionMatrixDisplay,PrecisionRecallDisplay
    ConfusionMatrixDisplay.from_predictions(y,p,labels=[0,1],display_labels=['0: within/no event','1: violation/event'],colorbar=False)
    plt.title(task+' — held-out test');plt.tight_layout();plt.savefig(out/(task+'_confusion.png'),dpi=160);plt.close()
    PrecisionRecallDisplay.from_predictions(y,score);plt.title(task+' — held-out test PR');plt.tight_layout();plt.savefig(out/(task+'_precision_recall.png'),dpi=160);plt.close()
    names=comparison.algorithm.tolist();col='val_f2' if task=='early_warning' else 'val_balanced_accuracy'
    plt.figure(figsize=(8,4));plt.barh(names,comparison[col]);plt.xlim(0,1);plt.xlabel(col);plt.title('Validation comparison: '+task);plt.tight_layout();plt.savefig(out/(task+'_comparison.png'),dpi=160);plt.close()

# Tune on grouped training CV, select on validation, evaluate the selected model once on held-out recordings.
def compare_task(table,task,out):
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    cols=[c for c in table if c not in ['scenario_id','timestamp','target','partition']]
    parts={p:table[table.partition.eq(p)] for p in ['train','validation','test']}
    train,val,test=[parts[p] for p in ['train','validation','test']]
    cv=list(StratifiedGroupKFold(n_splits=3,shuffle=True,random_state=SEED).split(train[cols],train.target,train.scenario_id))
    for a,b in cv:
        if train.iloc[a].target.nunique()!=2 or train.iloc[b].target.nunique()!=2:raise ValueError('Grouped CV lacks a class')
        assert set(train.iloc[a].scenario_id).isdisjoint(train.iloc[b].scenario_id)
    rows=[];fitted={};cv_scoring='average_precision' if task=='early_warning' else 'balanced_accuracy'
    for name,(model,grid) in model_candidates().items():
        begin=time.perf_counter();print(task+': fitting '+name,flush=True)
        search=GridSearchCV(model,grid,cv=cv,scoring=cv_scoring,n_jobs=1,error_score='raise',refit=True)
        with threadpool_limits(limits=2):search.fit(train[cols],train.target)
        best=search.best_estimator_;score=probability(best,val[cols]);threshold=choose_threshold(val.target,score,task)
        mv=metrics(val.target,(score>=threshold).astype(int),score)
        rows.append({'algorithm':name,'cv_score':float(search.best_score_),'cv_scoring':cv_scoring,'threshold':threshold,
          'parameters':json.dumps(search.best_params_,sort_keys=True),'seconds':time.perf_counter()-begin,**{'val_'+k:v for k,v in mv.items()}})
        fitted[name]=best
        pd.DataFrame(search.cv_results_).to_csv(out/(task+'_'+name+'_cv.csv'),index=False)
    comparison=pd.DataFrame(rows)
    order=['val_f2','val_precision','val_balanced_accuracy'] if task=='early_warning' else ['val_balanced_accuracy','val_f1']
    comparison=comparison.sort_values(order,ascending=False).reset_index(drop=True)
    winner=comparison.iloc[0];model=fitted[winner.algorithm];threshold=float(winner.threshold)
    score=probability(model,test[cols]);pred=(score>=threshold).astype(int)
    result={'selected_algorithm':winner.algorithm,'threshold':threshold,'best_parameters':json.loads(winner.parameters),
      'selection_metric':'validation F2, then precision and balanced accuracy' if task=='early_warning' else 'validation balanced accuracy, then F1',
      'cv_scoring':cv_scoring,'sample_counts':{p:len(g) for p,g in parts.items()},
      'independent_recordings':{p:int(g.scenario_id.nunique()) for p,g in parts.items()},
      'positive_counts':{p:int(g.target.sum()) for p,g in parts.items()},
      'test':metrics(test.target,pred,score),'baseline_test':metrics(test.target,baseline_predict(task,test[cols])),
      'no_event_baseline_test':metrics(test.target,np.zeros(len(test),dtype=int)),
      'classification_report':classification_report(test.target,pred,labels=[0,1],output_dict=True,zero_division=0),
      'positive_class':'outside_ESP32_operating_limits' if task=='current_quality' else 'violation_in_next_60_seconds_while_currently_within_limits'}
    # Persist schema and threshold with the estimator; live inference needs identical window features.
    bundle={'model':model,'features':cols,'threshold':threshold,'task':task,'positive_class':result['positive_class'],
      'window_readings':1 if task=='current_quality' else WINDOW,'interval_ms':INTERVAL_MS,'forecast_seconds':0 if task=='current_quality' else 60,
      'feature_version':'quality_v2_past_only','sklearn_version':importlib.metadata.version('scikit-learn'),
      'deployment_approved':False,'note':'Trained on provided data; inspect provenance and independent validation before use.'}
    path=out/(task+'_model.joblib');joblib.dump(bundle,path)
    loaded=joblib.load(path);assert np.array_equal((probability(loaded['model'],test[cols])>=loaded['threshold']).astype(int),pred)
    comparison.to_csv(out/(task+'_comparison.csv'),index=False)
    predictions=test[['scenario_id','timestamp','target']].copy();predictions['predicted']=pred;predictions['probability_uncalibrated']=score;predictions['baseline']=baseline_predict(task,test[cols])
    predictions.to_csv(out/(task+'_test_predictions.csv'),index=False)
    (out/(task+'_results.json')).write_text(json.dumps(result,indent=2))
    save_plots(test.target,pred,score,comparison,task,out)
    print('Selected:',task,winner.algorithm,'test:',result['test'],flush=True)
    return result

# Run the full single-input experiment and retain enough metadata for reproducibility.
def run_training(csv_path,output_dir='training_outputs'):
    out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
    df=load_clean_csv(csv_path);mapping=split_recordings(df);tables,audit=build_task_tables(df,mapping)
    pd.DataFrame({'scenario_id':list(mapping),'partition':list(mapping.values())}).to_csv(out/'recording_partitions_audit.csv',index=False)
    result={task:compare_task(table,task,out) for task,table in tables.items()}
    summary={'input_file':Path(csv_path).name,'input_sha256':hashlib.sha256(Path(csv_path).read_bytes()).hexdigest(),
      'rows':len(df),'recordings':int(df.scenario_id.nunique()),'seed':SEED,'window_readings':WINDOW,'window_span_seconds':(WINDOW-1)*5,
      'forecast_horizon_seconds':60,'window_audit':audit,'data_origin_counts':df.data_origin.value_counts().to_dict() if 'data_origin' in df else {'unspecified':len(df)},
      'results':result,'limitations':['Synthetic-data performance is not real water potability evidence.','Current labels reproduce the same rules used to generate them.','Windows overlap within recordings; sample count is not independent event count.','Test recordings come from a previously used synthetic generator; this is not a fresh external benchmark.','F2 selection may increase false alerts; test rates must be reviewed.','Probabilities are uncalibrated.','No model was retrained on validation or test after selection.','No Firebase access or automatic pump control.']}
    (out/'training_summary.json').write_text(json.dumps(summary,indent=2))
    versions='\n'.join(f'{m}=={importlib.metadata.version(m)}' for m in ['numpy','pandas','scikit-learn','joblib','matplotlib','threadpoolctl'])
    (out/'requirements_runtime.txt').write_text(versions+'\n')
    print('Completed. Results saved to',out,flush=True)
    return summary

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('csv');p.add_argument('--output',default='training_outputs');a=p.parse_args()
    run_training(a.csv,a.output)
