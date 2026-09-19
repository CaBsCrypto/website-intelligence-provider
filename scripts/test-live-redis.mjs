// Real Redis only; synthetic reports and signed test envelopes; no facilitator/network payment.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { RedisLiveStore } from '../work/build/src/x402/live-store.js';
import { createAppServer } from '../work/build/src/server.js';
import { createPaymentReplayStore } from '../work/build/src/x402/settlement-attempt-guard.js';
import { recoveryProofForToken } from '../work/build/src/x402/recovery.js';
import { encodeX402Header, decodeX402Header } from '../work/build/src/x402/encoding.js';
import { analyzeHtml } from '../work/build/src/live-audit.js';
import { Account, TransactionBuilder, Operation, Networks, Keypair } from '@stellar/stellar-sdk';
const prefix=process.env.LIVE_QA_PREFIX ?? 'qa:website-live:'+randomBytes(12).toString('hex');
const store=new RedisLiveStore(process.env.LIVE_QA_REDIS_URL,process.env.LIVE_QA_REDIS_TOKEN,prefix);
if (process.argv[2]==='read-child') {
  const state=await store.get(process.argv[3]);
  assert.equal(state.phase,'delivered');assert.equal(state.result.mode,'live');assert.ok(state.resultHash);
  console.log(JSON.stringify({newProcess:true,phase:state.phase,resultHash:state.resultHash}));
} else {
  assert.equal(process.argv[2],'--run-isolated-test');
  const payer=Keypair.random(), id=randomBytes(16).toString('hex'), token=randomBytes(32).toString('base64url');
  const config={enabled:true,settlementEnabled:true,liveEnabled:true,executionMode:'durable-multi-instance',configurationErrors:[],publicBaseUrl:'https://provider.test',endpointPath:'/v1/x402/audits',network:'stellar:testnet',asset:'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',payTo:payer.publicKey(),amount:'10000',maxTimeoutSeconds:60};
  let audits=0,settles=0;
  const deps={config,liveStore:store,paymentReplayStore:createPaymentReplayStore(),settlementAttemptGuard:{tryConsume:()=>true},
    liveAudit:async input=>{audits++;return analyzeHtml({html:'<html lang="es"><title>Redis QA</title><h1>QA</h1>',finalUrl:input.url,fetchedAt:new Date().toISOString(),status:200,redirects:0},input.url);},
    facilitator:{supported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet',extra:{areFeesSponsored:true}}],extensions:[],signers:{}}),verify:async()=>({isValid:true,payer:payer.publicKey()}),settle:async()=>{settles++;return{success:true,network:'stellar:testnet',transaction:'a'.repeat(64),amount:'10000',ledger:1};}},
    settlementEvidenceVerifier:{reconcile:async(_request,result)=>({...result,success:true,amount:'10000',ledger:1})},
  };
  const server=createAppServer(deps).listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const input={mode:'live',url:'https://example.com/',language:'es'}, headers={'content-type':'application/json','x-bazaar-request-id':id,'x-bazaar-recovery-proof':recoveryProofForToken(token)};
  const post=(path,body,extra={})=>fetch(base+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
  try {
    const initial=await post(config.endpointPath,input);assert.equal(initial.status,402,await initial.clone().text());
    const required=decodeX402Header(initial.headers.get('payment-required'));
    const tx=new TransactionBuilder(new Account(payer.publicKey(),'1'),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.manageData({name:'QA-NO-PAYMENT',value:'test'})).setTimeout(60).build();tx.sign(payer);
    const payment=encodeX402Header({x402Version:2,resource:required.resource,accepted:required.accepts[0],extensions:required.extensions,payload:{transaction:tx.toXDR()}});
    const responses=await Promise.all(Array.from({length:8},()=>post(config.endpointPath,input,{'payment-signature':payment})));
    assert.ok(responses.some(r=>r.status===200));assert.equal(audits,1);assert.equal(settles,1);
    const state=await store.get(id);assert.equal(state.phase,'delivered');
    const recovery={version:'website-intelligence.delivery-recovery/v1',requestId:id,recoveryId:state.recoveryId,recoveryToken:token};
    assert.equal((await post('/v1/x402/audits/recover',{...recovery,recoveryToken:randomBytes(32).toString('base64url')})).status,403);
    assert.deepEqual((await (await post('/v1/x402/audits/recover',recovery)).json()).result,state.result);
    const child=spawn(process.execPath,[process.argv[1],'read-child',id],{env:{...process.env,LIVE_QA_PREFIX:prefix},stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>errors+=c);
    const [code]=await once(child,'exit');assert.equal(code,0,errors);assert.equal(JSON.parse(output).resultHash,state.resultHash);
    console.log(JSON.stringify({ok:true,redis:'real',prefix,keysRetained:1,audits,simulatedSettlementCalls:settles,concurrentRequests:8,newProcessRecovery:true,wrongTokenDenied:true,realPayment:false}));
  } finally {await new Promise(r=>server.close(r));}
}
