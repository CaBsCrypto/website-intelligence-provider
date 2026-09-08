import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { auditLiveWebsite } from '../live-audit.js';
import { publicUrl, LiveAuditError } from '../live-fetch.js';
import { sendJson } from '../http.js';
import { canonicalJson, sha256 } from './canonical.js';
import { createPaymentRequired } from './provider.js';
import { createRecoveryBinding, recoveryProofForToken, RECOVERY_VERSION } from './recovery.js';
import { createReceipt } from './receipt.js';
import { decodeX402Header, encodeX402Header } from './encoding.js';
import type { LiveState } from './live-store.js';
import type { X402Dependencies, PaymentPayload, SettlementResponse } from './types.js';
import { X402_BINDING_EXTENSION } from './types.js';

const fail = (res: ServerResponse, status: number, code: string) => sendJson(res, status, { error: { code, message: code }, paymentRetriable: false });
const innerHash = (xdr: string) => {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  return ('innerTransaction' in tx ? tx.innerTransaction : tx).hash().toString('hex');
};
export async function advanceLive(deps: X402Dependencies, state: LiveState, changes: Partial<LiveState>) {
  const next = { ...state, ...changes, revision: state.revision + 1 };
  if (!await deps.liveStore!.replace(state, next)) throw Error('LIVE_STATE_BUSY');
  return next;
}
export async function finalizeLive(deps: X402Dependencies, state: LiveState, candidateHash?: string): Promise<LiveState> {
  if (state.phase === 'delivered') return state;
  if (!['attempted', 'uncertain', 'settled'].includes(state.phase) || !state.payment || !state.result || sha256(state.result) !== state.resultHash) throw Error('LIVE_NOT_RECOVERABLE');
  const hash = state.settlement?.transaction ?? candidateHash ?? state.candidateHash;
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !deps.settlementEvidenceVerifier) throw Error('LIVE_PAYMENT_UNCERTAIN');
  const proposed: SettlementResponse = state.settlement ?? { success: true, transaction: hash, network: state.requirements.network };
  const confirmed = await deps.settlementEvidenceVerifier.reconcile(state.payment, proposed);
  if (!confirmed.success || confirmed.transaction !== hash || confirmed.network !== state.requirements.network || confirmed.amount !== state.requirements.amount || !confirmed.ledger) throw Error('LIVE_EVIDENCE_MISMATCH');
  const receipt = createReceipt({ requestHash: state.inputHash, cardHash: state.cardHash, output: state.result, requirements: state.requirements, settlement: { ...confirmed, success: true } });
  const delivery = { result: state.result, resultHash: state.resultHash!, receipt, paymentResponse: encodeX402Header(confirmed), recovery: { recoveryId: state.recoveryId, requestId: state.requestId, proof: state.proof, expiresAt: state.expiresAt } };
  return advanceLive(deps, state, { phase: 'delivered', settlement: confirmed, delivery });
}
function delivered(response: ServerResponse, state: LiveState) {
  const d = state.delivery!;
  sendJson(response, 200, { result: d.result, resultHash: d.resultHash, receipt: d.receipt, recovery: { available: true, recoveryId: state.recoveryId, requestId: state.requestId, expiresAt: state.expiresAt } }, { 'payment-response': d.paymentResponse });
}
export async function handleLivePurchase(request: IncomingMessage, response: ServerResponse, deps: X402Dependencies, body: any) {
  if (!deps.config.liveEnabled || !deps.config.enabled || !deps.config.settlementEnabled || !deps.liveStore || !deps.settlementEvidenceVerifier) return fail(response, 503, 'LIVE_PAYMENT_NOT_ENABLED');
  let state: LiveState | null = null;
  try {
    if (!body || body.mode !== 'live' || typeof body.url !== 'string' || body.url.length > 2048 || (body.language !== undefined && !['es','en'].includes(body.language))) return fail(response, 400, 'INVALID_LIVE_INPUT');
    publicUrl(body.url);
    const id = request.headers['x-bazaar-request-id'], proof = request.headers['x-bazaar-recovery-proof'];
    if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id) || typeof proof !== 'string' || !/^[a-f0-9]{64}$/.test(proof)) return fail(response, 400, 'LIVE_RECOVERY_REQUIRED');
    const required = await createPaymentRequired(deps.config, body, undefined, { requestId: id, proof });
    const binding = required.extensions[X402_BINDING_EXTENSION].info;
    // The extension's public name is shared with the existing fixture route.
    const cardHash = String(binding.cardHash), inputHash = sha256(body);
    state = await deps.liveStore.get(id);
    if (state && (state.proof !== proof || state.inputHash !== inputHash || state.cardHash !== cardHash)) return fail(response, 409, 'LIVE_INTENT_CONFLICT');
    let preparationClaim = false;
    if (!state) {
      const recovery = createRecoveryBinding({ requestId: id, proof, inputHash, cardHash });
      const initial: LiveState = { requestId: id, proof, inputHash, cardHash, recoveryId: recovery.recoveryId, expiresAt: recovery.expiresAt, revision: 0, phase: 'preparing', preparationExpiresAt: Date.now() + 30_000, requirements: required.accepts[0] };
      if (!await deps.liveStore.create(initial)) return fail(response, 409, 'LIVE_PREPARATION_BUSY');
      state = initial;
      preparationClaim = true;
    } else if (state.phase === 'preparing' && (state.preparationExpiresAt ?? Infinity) < Date.now()) {
      state = await advanceLive(deps, state, { preparationExpiresAt: Date.now() + 30_000 });
      preparationClaim = true;
    }
    if (preparationClaim) {
      try {
        const result = await (deps.liveAudit ?? auditLiveWebsite)(body);
        state = await advanceLive(deps, state, { phase: 'prepared', result, resultHash: sha256(result) });
      } catch (error) {
        // If the state write is unavailable, the durable preparation marker still forbids a payment.
        try { state = await advanceLive(deps, state, { phase: 'analysis-failed', error: error instanceof LiveAuditError ? error.code : 'LIVE_PREPARATION_FAILED' }); } catch {}
        return fail(response, 422, error instanceof LiveAuditError ? error.code : 'LIVE_PREPARATION_FAILED');
      }
    }
    if (Date.parse(state.expiresAt) <= Date.now()) return fail(response, 410, 'LIVE_ACCESS_EXPIRED');
    if (state.phase === 'delivered') {
      // A public proof commits to a secret; it is not itself an access credential.
      try {
        const header = request.headers['payment-signature'];
        if (typeof header !== 'string' || !state.payment || canonicalJson(decodeX402Header(header)) !== canonicalJson(state.payment.paymentPayload)) return fail(response, 403, 'LIVE_RECOVERY_TOKEN_REQUIRED');
      } catch { return fail(response, 403, 'LIVE_RECOVERY_TOKEN_REQUIRED'); }
      return delivered(response, state);
    }
    if (state.phase !== 'prepared') return fail(response, 409, state.phase === 'analysis-failed' ? state.error! : 'LIVE_RECOVER_ONLY');
    const header = request.headers['payment-signature'];
    if (typeof header !== 'string') return sendJson(response, 402, { error: 'Payment required; live report prepared.' }, { 'payment-required': encodeX402Header(required) });
    let payload: PaymentPayload;
    try {
      payload = decodeX402Header<PaymentPayload>(header);
      if (payload.x402Version !== 2 || canonicalJson(payload.resource) !== canonicalJson(required.resource) || canonicalJson(payload.accepted) !== canonicalJson(required.accepts[0]) || canonicalJson(payload.extensions?.[X402_BINDING_EXTENSION]?.info) !== canonicalJson(required.extensions[X402_BINDING_EXTENSION].info)) throw Error();
      state.candidateHash = innerHash(payload.payload.transaction);
    } catch { return fail(response, 400, 'INVALID_LIVE_PAYMENT'); }
    const supported = await deps.facilitator.supported();
    if (!supported.kinds.some(k => k.x402Version === 2 && k.scheme === 'exact' && k.network === state!.requirements.network && k.extra?.areFeesSponsored === true)) return fail(response, 502, 'FACILITATOR_UNSUPPORTED');
    const payment = { x402Version: 2 as const, paymentPayload: payload, paymentRequirements: state.requirements };
    if (!(await deps.facilitator.verify(payment)).isValid) return fail(response, 402, 'PAYMENT_INVALID');
    // Do not mutate the previous CAS value before acquiring the durable settlement claim.
    const previous = await deps.liveStore.get(id);
    if (!previous || previous.phase !== 'prepared') return fail(response, 409, 'LIVE_RECOVER_ONLY');
    state = await advanceLive(deps, previous, { phase: 'attempted', payment, candidateHash: state.candidateHash });
    let settlement: SettlementResponse;
    try { settlement = await deps.facilitator.settle(payment); }
    catch {
      try { state = await advanceLive(deps, state, { phase: 'uncertain' }); } catch {}
      return fail(response, 409, 'LIVE_PAYMENT_UNCERTAIN');
    }
    if (!settlement.success) {
      state = await advanceLive(deps, state, { phase: 'uncertain' });
      return fail(response, 409, 'LIVE_PAYMENT_UNCERTAIN');
    }
    state = await advanceLive(deps, state, { phase: 'settled', settlement });
    state = await finalizeLive(deps, state);
    return delivered(response, state);
  } catch (error) {
    return fail(response, 503, error instanceof LiveAuditError ? error.code : 'LIVE_RECOVER_ONLY');
  }
}
export async function tryLiveRecovery(response: ServerResponse, deps: X402Dependencies, body: any): Promise<boolean> {
  if (!deps.liveStore || typeof body?.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(body.requestId)) return false;
  let state: LiveState | null;
  try { state = await deps.liveStore.get(body.requestId); } catch { fail(response, 503, 'LIVE_STORE_UNAVAILABLE'); return true; }
  if (!state) return false;
  if (!/^[a-f0-9]{64}$/.test(state.proof) || !Number.isFinite(Date.parse(state.expiresAt))) { fail(response, 422, 'RECOVERY_RECORD_INVALID'); return true; }
  if (body.version !== RECOVERY_VERSION || typeof body.recoveryToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.recoveryToken) || body.recoveryId !== state.recoveryId || !timingSafeEqual(Buffer.from(state.proof,'hex'), Buffer.from(recoveryProofForToken(body.recoveryToken),'hex'))) { fail(response, 403, 'RECOVERY_UNAUTHORIZED'); return true; }
  if (Date.parse(state.expiresAt) <= Date.now()) { fail(response, 410, 'RECOVERY_EXPIRED'); return true; }
  try {
    state = await finalizeLive(deps, state, body.transactionHash);
    const d = state.delivery!;
    sendJson(response, 200, { version: 'website-intelligence.recovered-delivery/v1', recovery: { recoveryId: state.recoveryId, requestId: state.requestId, status: 'recovered' }, result: d.result, resultHash: d.resultHash, receipt: d.receipt });
  } catch { fail(response, 409, 'LIVE_PAYMENT_UNCERTAIN'); }
  return true;
}
