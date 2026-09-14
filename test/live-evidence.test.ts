import test from 'node:test';
import assert from 'node:assert/strict';
import { Account, TransactionBuilder, Keypair, Networks, Operation, Address, nativeToScVal, rpc, xdr } from '@stellar/stellar-sdk';
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

test('sponsored envelope must preserve the exact signed Soroban authorization',async()=>{
 const invocation=new xdr.SorobanAuthorizedInvocation({function:xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({contractAddress:new Address(asset).toScVal().address(),functionName:Buffer.from('transfer'),args:[new Address(payer.publicKey()).toScVal(),new Address(recipient).toScVal(),nativeToScVal(10000n,{type:'i128'})]})),subInvocations:[]});
 const auth=(nonce:string)=>new xdr.SorobanAuthorizationEntry({credentials:xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({address:new Address(payer.publicKey()).toScVal().address(),nonce:xdr.Int64.fromString(nonce),signatureExpirationLedger:200,signature:nativeToScVal(['synthetic-signature'])})),rootInvocation:invocation});
 const tx=(sequence:string,nonce:string)=>new TransactionBuilder(new Account(payer.publicKey(),sequence),{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.invokeContractFunction({contract:asset,function:'transfer',args:[new Address(payer.publicKey()).toScVal(),new Address(recipient).toScVal(),nativeToScVal(10000n,{type:'i128'})],auth:[auth(nonce)]})).setTimeout(60).build();
 const signed=tx('1','1');const request:any={paymentRequirements:{asset,payTo:recipient,amount:'10000',network:'stellar:testnet'},paymentPayload:{payload:{transaction:signed.toXDR()}}};
 const verify=(actual:typeof signed)=>new StellarSettlementEvidenceVerifier({getTransaction:async()=>({status:'SUCCESS',envelopeXdr:actual.toEnvelope(),ledger:123})} as unknown as rpc.Server).reconcile(request,{success:true,transaction:actual.hash().toString('hex'),network:'stellar:testnet'});
 assert.equal((await verify(tx('2','1'))).amount,'10000');
 await assert.rejects(verify(tx('2','2')),/SIGNED_TRANSACTION_MISMATCH/);
});
