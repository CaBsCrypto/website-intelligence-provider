import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Account, TransactionBuilder, Networks, Operation, Keypair } from '@stellar/stellar-sdk';
import { createAppServer } from '../src/server.js';
import { memoryLiveStore, type LiveStore } from '../src/x402/live-store.js';
import { analyzeHtml } from '../src/live-audit.js';
import { encodeX402Header, decodeX402Header } from '../src/x402/encoding.js';
import { recoveryProofForToken } from '../src/x402/recovery.js';
import { getServiceCardForConfig } from '../src/service-card.js';
import type { X402ProviderConfig, X402Dependencies, PaymentRequired } from '../src/x402/types.js';
const payer = Keypair.random();
const config: X402ProviderConfig = { enabled: true, settlementEnabled: true, liveEnabled: true, executionMode: 'durable-multi-instance', configurationErrors: [], publicBaseUrl: 'https://provider.test', endpointPath: '/v1/x402/audits', network: 'stellar:testnet', asset: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA', payTo: payer.publicKey(), amount: '10000', maxTimeoutSeconds: 60 };
const body = { mode: 'live', url: 'https://example.com/', language: 'es' };
function transaction() { const tx = new TransactionBuilder(new Account(payer.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(Operation.manageData({name:'unit-test',value:'not-a-real-payment'})).setTimeout(60).build(); tx.sign(payer); return tx.toXDR(); }
async function harness(run: (api: any) => Promise<void>, change?: (deps: X402Dependencies, counters: any) => void) {
  const counters = { audit: 0, settle: 0, confirmed: false };
  const store = memoryLiveStore();
  const deps: X402Dependencies = { config, liveStore: store, paymentReplayStore: {} as any, settlementAttemptGuard: {tryConsume:()=>true},
    liveAudit: async input => { counters.audit++; await new Promise(r=>setTimeout(r,15)); return analyzeHtml({html:'<html lang="es"><title>Prueba</title><h1>Hola</h1></html>',finalUrl:input.url,status:200,redirects:0,fetchedAt:new Date().toISOString()}, input.url); },
    facilitator: { supported: async () => ({ kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet',extra:{areFeesSponsored:true}}],signers:{},extensions:[] }), verify:async()=>({isValid:true,payer:payer.publicKey()}), settle:async()=>{ counters.settle++; counters.confirmed=true; return {success:true,network:'stellar:testnet',transaction:'a'.repeat(64),amount:'10000',ledger:12,payer:payer.publicKey()}; } },
    settlementEvidenceVerifier: { reconcile:async(_request,settlement)=>{ if (!counters.confirmed) throw Error('NOT_CONFIRMED'); return {...settlement,success:true,network:'stellar:testnet',amount:'10000',ledger:12,payer:payer.publicKey()}; } },
  };
  change?.(deps,counters);
  const server = createAppServer(deps).listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address(); assert(address&&typeof address==='object');
  const origin=`http://127.0.0.1:${address.port}`, id=randomBytes(16).toString('hex'), token=randomBytes(32).toString('base64url'), proof=recoveryProofForToken(token);
  const post=(path:string,data:any,extra={})=>fetch(origin+path,{method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(data)});
  const request=(payment?:string,input=body)=>post(config.endpointPath,input,{'x-bazaar-request-id':id,'x-bazaar-recovery-proof':proof,...(payment?{'payment-signature':payment}:{})});
  const prepare=async()=>{ const response=await request(); assert.equal(response.status,402,await response.clone().text()); const required=decodeX402Header<PaymentRequired>(response.headers.get('payment-required')!); return encodeX402Header({x402Version:2,resource:required.resource,accepted:required.accepts[0],extensions:required.extensions,payload:{transaction:transaction()}}); };
  const recover=async(extra={})=>{const state=await store.get(id); return post('/v1/x402/audits/recover',{version:'website-intelligence.delivery-recovery/v1',requestId:id,recoveryId:state!.recoveryId,recoveryToken:token,...extra});};
  try {await run({store,deps,counters,id,request,prepare,recover});} finally {await new Promise<void>(r=>server.close(()=>r()));}
}
test('live card explicitly advertises live HTTP and fixture-only MCP',()=>{const card=getServiceCardForConfig(config);assert.equal(card.version,'1.2.0');assert.equal(card.determinism.guaranteedForSameVersionAndInput,false);assert.equal(getServiceCardForConfig({...config,liveEnabled:false}).version,'1.0.0');});
test('concurrent signed retries settle once, reuse snapshot, and recover same bytes',async()=>harness(async a=>{
  const payment=await a.prepare(), prepared=(await a.store.get(a.id)).result;
  const responses=await Promise.all(Array.from({length:8},()=>a.request(payment)));
  assert(responses.some((r:any)=>r.status===200)); assert.equal(a.counters.settle,1); assert.equal(a.counters.audit,1);
  const recovered=await a.recover();assert.equal(recovered.status,200);assert.deepEqual((await recovered.json()).result,prepared);
  assert.equal((await a.request(payment)).status,200);assert.equal(a.counters.settle,1);
  assert.equal((await a.request()).status,403, 'the public recovery proof cannot read a paid delivery');
  assert.equal((await a.recover({recoveryToken:randomBytes(32).toString('base64url')})).status,403);
  const state=await a.store.get(a.id);await a.store.replace(state,{...state,revision:state.revision+1,expiresAt:'2020-01-01T00:00:00.000Z'});
  assert.equal((await a.recover()).status,410);assert.equal(a.counters.settle,1);
}));
test('failed analysis and unsafe destinations never settle',async()=>harness(async a=>{
  assert.equal((await a.request(undefined,{...body,url:'http://127.0.0.1'})).status,503);
  assert.equal((await a.request()).status,422);assert.equal(a.counters.settle,0);
},deps=>{deps.liveAudit=async()=>{throw Error('offline');};}));
test('failure persisting prepared report prevents settlement',async()=>harness(async a=>{
  assert.equal((await a.request()).status,422);assert.equal(a.counters.settle,0);
},deps=>{ const base=deps.liveStore!;deps.liveStore={...base,replace:async(prev,next)=>{if(next.phase==='prepared')throw Error('offline');return base.replace(prev,next);}};}));
test('lost final response/state commit is recovered without another settlement',async()=>harness(async a=>{
  const payment=await a.prepare();assert.equal((await a.request(payment)).status,503);
  assert.equal((await a.recover()).status,200);assert.equal(a.counters.settle,1);assert.equal(a.counters.audit,1);
},deps=>{const base=deps.liveStore!;let fail=true;deps.liveStore={...base,replace:async(prev,next)=>{if(next.phase==='delivered'&&fail){fail=false;throw Error('offline');}return base.replace(prev,next);}};}));
test('ambiguous settlement never permits another attempt; known evidence recovers it',async()=>harness(async a=>{
  const payment=await a.prepare();assert.equal((await a.request(payment)).status,409);
  assert.equal((await a.request(payment)).status,409);assert.equal((await a.recover()).status,409);
  a.counters.confirmed=true;assert.equal((await a.recover({transactionHash:'b'.repeat(64)})).status,200);assert.equal(a.counters.settle,1);
},(deps,counters)=>{deps.facilitator.settle=async()=>{counters.settle++;throw Error('lost response');};}));
test('durable marker survives interruption before broadcast and forbids retry',async()=>harness(async a=>{
  const payment=await a.prepare();assert.equal((await a.request(payment)).status,503);assert.equal(a.counters.settle,0);
  assert.equal((await a.request(payment)).status,409);assert.equal((await a.recover()).status,409);assert.equal(a.counters.settle,0);
},deps=>{const base=deps.liveStore!;deps.liveStore={...base,replace:async(prev,next)=>{const saved=await base.replace(prev,next);if(next.phase==='attempted')throw Error('process interrupted');return saved;}};}));
test('altered input cannot reuse an existing request; preparing lease can be resumed before payment',async()=>harness(async a=>{
  await a.prepare();assert.equal((await a.request(undefined,{...body,url:'https://example.org/'})).status,409);
  const state=await a.store.get(a.id);await a.store.replace(state,{...state,revision:state.revision+1,phase:'preparing',result:undefined,resultHash:undefined,preparationExpiresAt:0});
  assert.equal((await a.request()).status,402);assert.equal(a.counters.settle,0);
}));
