import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, TransactionBuilder, Keypair, Networks, Operation, Address, nativeToScVal, rpc } from '@stellar/stellar-sdk';
import { StellarSettlementEvidenceVerifier } from '../src/x402/stellar-settlement-evidence.js';
const payer=Keypair.random(), recipient=Keypair.random().publicKey(), asset='CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const build=(sequence:string)=>new TransactionBuilder(new Account(payer.publicKey(),sequence),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.invokeContractFunction({contract:asset,function:'transfer',args:[new Address(payer.publicKey()).toScVal(),new Address(recipient).toScVal(),nativeToScVal(10000n,{type:'i128'})]})).setTimeout(60).build();
test('recovery rejects an equal transfer with another signed transaction identity',async()=>{
  const signed=build('1'), other=build('2');
  const request:any={paymentRequirements:{asset,payTo:recipient,amount:'10000',network:'stellar:testnet'},paymentPayload:{payload:{transaction:signed.toXDR()}}};
  const verify=(transaction: typeof signed)=>new StellarSettlementEvidenceVerifier({getTransaction:async()=>({status:'SUCCESS',envelopeXdr:transaction.toEnvelope(),ledger:123})} as unknown as rpc.Server);
  const settlement:any={success:true,transaction:signed.hash().toString('hex'),network:'stellar:testnet'};
  assert.equal((await verify(signed).reconcile(request,settlement)).payer,payer.publicKey());
  await assert.rejects(verify(other).reconcile(request,settlement),/SIGNED_TRANSACTION_MISMATCH/);
});
