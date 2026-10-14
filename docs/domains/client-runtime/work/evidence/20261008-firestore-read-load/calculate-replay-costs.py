import json, hashlib, argparse
from decimal import Decimal as D
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--before', required=True)
parser.add_argument('--after', required=True)
parser.add_argument('--output-dir', default='/tmp/calculate_firestore_measured_costs')
args=parser.parse_args()
OUT=Path(args.output_dir); OUT.mkdir(parents=True,exist_ok=True)
paths={'before':args.before,'after':args.after}
raw={k:json.load(open(p)) for k,p in paths.items()}
read_price=D('0.03')/100000
write_price=D('0.09')/100000
observations=[]
rows=[]
heads=[]
for b,a in zip(raw['before']['results'],raw['after']['results']):
 assert b['scale']==a['scale']
 assert b['status']==a['status']=='passed'
 assert b['finalDataDigest']==a['finalDataDigest']
 assert b['persistedApprovedPlanDigest']==a['persistedApprovedPlanDigest']
 scale=b['scale']; label={1:'small',10:'medium',100:'large'}[scale]
 vals={}
 for mode,r in [('before',b),('after',a)]:
  phases={p['operation']:p['counts'] for p in r['phases']}
  c=phases['cold-planner-launch']; k=phases['approved-save-K-and-complete']
  assert c['rpcErrors']==k['rpcErrors']==[]
  assert c['transactionDocumentResponses']==0
  assert k['transactionDocumentRequests']==k['transactionDocumentResponses']==32
  assert k['documentResponses']['schedule_event_migrations']==6
  assert k['missingTransactionDocuments']==0
  assert k['writeRequests']=={'weekly_planning_approval_operations':6,'weekly_planning_approval_items':10}
  assert k['verifyDocumentPreconditions']==16
  assert k['commitRequests']==6
  vals[mode]={'coldQueryTargets':sum(c['queryTargets'].values()),'coldListenDocumentResponses':sum(c['documentResponses'].values()),'replayQueryTargets':sum(k['queryTargets'].values()),'replayListenDocumentResponses':sum(k['documentResponses'].values()),'replayTransactionDocumentResponses':k['transactionDocumentResponses'],'sessionQueryTargets':sum(c['queryTargets'].values())+sum(k['queryTargets'].values()),'responseReadEquivalentPerSession':sum(c['documentResponses'].values())+sum(k['documentResponses'].values())+k['transactionDocumentResponses'],'commitVerifyOnlyOperationsPerSession':k['verifyDocumentPreconditions'],'readEquivalentPerSession':sum(c['documentResponses'].values())+sum(k['documentResponses'].values())+k['transactionDocumentResponses']+k['verifyDocumentPreconditions'],'actualWritesPerSession':16,'actualWritesStatus':'16 mutations observed; 16 dedicated verify-only operations excluded from writes and included in modeled reads','commitRequests':k['commitRequests']}
 assert vals['before']['coldListenDocumentResponses']==vals['after']['coldListenDocumentResponses']==55*scale+14
 assert vals['before']['responseReadEquivalentPerSession']==330*scale+117
 assert vals['before']['readEquivalentPerSession']==330*scale+133
 assert vals['after']['responseReadEquivalentPerSession']==55*scale+52
 assert vals['after']['readEquivalentPerSession']==55*scale+68
 observations.append({'dataset':label,'scale':scale,'ownerPlans':b['seedPlanCount'],'ownerMonthEvents':b['seedMonthEventCount'],**vals})
 heads.append({'dataset':label,'before':min(50000//vals['before']['readEquivalentPerSession'],20000//16),'after':min(50000//vals['after']['readEquivalentPerSession'],20000//16),'sharedAdditionalReads':0,'sharedAdditionalWrites':0})
 for dau in [100,1000,10000]:
  entry={'dataset':label,'DAU':dau,'sessionsPerDAUPerDay':1,'days':30,'writesPerDay':dau*16,'writesPerMonth':30*dau*16,'monthlyWriteUSD':str(30*max(0,dau*16-20000)*write_price)}
  for mode in ['before','after']:
   r=vals[mode]['readEquivalentPerSession']; reads=dau*r; rcost=30*max(0,reads-50000)*read_price; wcost=D(entry['monthlyWriteUSD']); entry[mode]={'readsPerDay':reads,'readsPerMonth':reads*30,'monthlyReadUSD':str(rcost),'monthlyReadWriteUSD':str(rcost+wcost),'dailyReadUSD':str(rcost/30)}
  entry['readEquivalentReductionPercent']=str((1-D(vals['after']['readEquivalentPerSession'])/D(vals['before']['readEquivalentPerSession']))*100)
  rows.append(entry)
result={'schemaVersion':2,'status':'validated against successful replay evidence on both revisions; not billing measurement','pricingCheckedDate':'2026-10-08','currency':'USD','edition':'Standard (assumed; deployment not inspected)','region':'us-central1 Iowa (assumed; deployment not inspected)','pricingModel':'default pay-as-you-go, no CUD','pricingSources':['https://cloud.google.com/firestore/pricing','https://firebase.google.com/docs/firestore/quotas','https://docs.cloud.google.com/firestore/native/docs/billing-questions#usage-dashboard-discrepancies','https://firebase.google.com/docs/firestore/pricing#free-quota-applies-only-to-one-database-per-project'],'readEquivalentDefinition':'Observed Listen and transaction document responses plus dedicated verify-only Commit operations; pricing sensitivity, not measured production billing.','verifyOnlyEvidence':'Instrumented outgoing Commit/Write verify-operation counter and unchanged final replay reports; raw RPC payloads were not persisted.','freeQuotaEligibility':'One eligible database per project assumed; actual deployment eligibility is unverified.','excludedWorkloads':['auth/profile','catalog/metadata','trace append/retry','admin history/export','shared backend/cron','Rules-dependent reads','index-entry reads','contention retries','SDK reconnects','storage/network/other services'],'readPricePer100000USD':'0.03','writePricePer100000USD':'0.09','freeReadsPerDay':50000,'freeWritesPerDay':20000,'monthlyDays':30,'scenario':'Cold planner launch plus five already-saved approval-plan replays and operation completion, once per DAU per day. Excludes explicit refresh and independent verification reads. Fixed-data sensitivity, no daily history growth. Not first-save success.','actualBillingMeasured':False,'missingDocumentReadsInIncludedScenario':0,'emptyQueriesInIncludedScenario':0,'sourceFiles':{k:{'path':p,'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest()} for k,p in paths.items()},'observations':observations,'scaleCosts':rows,'freeDocumentOperationHeadcountWithNoOtherLoad':heads}
(OUT/'cost-model.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'output':str(OUT/'cost-model.json'),'observations':observations,'freeHeads':heads},ensure_ascii=False,indent=2))
