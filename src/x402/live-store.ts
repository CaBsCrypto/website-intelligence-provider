import { canonicalJson } from './canonical.js';
import type { FacilitatorRequest, PaymentDeliveryRecord, PaymentRequirements, SettlementResponse } from './types.js';
export type LiveState = {
  requestId: string; proof: string; inputHash: string; cardHash: string;
  recoveryId: string; expiresAt: string; revision: number;
  phase: 'preparing' | 'prepared' | 'analysis-failed' | 'attempted' | 'uncertain' | 'settled' | 'delivered';
  requirements: PaymentRequirements;
  preparationExpiresAt?: number;
  result?: unknown; resultHash?: string; error?: string;
  payment?: FacilitatorRequest; candidateHash?: string;
  settlement?: SettlementResponse; delivery?: PaymentDeliveryRecord;
};
export interface LiveStore {
  get(id: string): Promise<LiveState | null>;
  create(state: LiveState): Promise<boolean>;
  replace(previous: LiveState, next: LiveState): Promise<boolean>;
}
export function memoryLiveStore(): LiveStore {
  const rows = new Map<string, LiveState>();
  return {
    async get(id) { return structuredClone(rows.get(id) ?? null); },
    async create(state) { if (rows.has(state.requestId)) return false; rows.set(state.requestId, structuredClone(state)); return true; },
    async replace(previous, next) { if (canonicalJson(rows.get(previous.requestId)) !== canonicalJson(previous)) return false; rows.set(next.requestId, structuredClone(next)); return true; },
  };
}
// No expiration: a stale client must never regain permission to settle the same intent.
// Delivery access expires independently; there is no automatic deletion in this pilot.
export class RedisLiveStore implements LiveStore {
  constructor(private url: string, private token: string, private prefix = 'website-intelligence:x402:live:v1', private fetcher: typeof fetch = fetch) {
    if (!/^https:\/\//.test(url) || !token || !/^[a-zA-Z0-9:_-]+$/.test(prefix)) throw Error('LIVE_STORE_CONFIG_INVALID');
  }
  private key(id: string) { if (!/^[a-f0-9]{32}$/.test(id)) throw Error('LIVE_REQUEST_ID_INVALID'); return `${this.prefix}:${id}`; }
  private async command(args: string[]) {
    const response = await this.fetcher(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args), redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('LIVE_STORE_UNAVAILABLE');
    const result = await response.json() as { result?: unknown; error?: unknown };
    if (result.error || !('result' in result)) throw Error('LIVE_STORE_UNAVAILABLE');
    return result.result;
  }
  async get(id: string): Promise<LiveState | null> {
    const value = await this.command(['GET', this.key(id)]);
    if (value === null) return null;
    if (typeof value !== 'string') throw Error('LIVE_STORE_CORRUPT');
    return JSON.parse(value);
  }
  async create(state: LiveState) { return await this.command(['SET', this.key(state.requestId), canonicalJson(state), 'NX']) === 'OK'; }
  async replace(previous: LiveState, next: LiveState) {
    if (next.requestId !== previous.requestId || next.revision !== previous.revision + 1) throw Error('LIVE_STATE_INVALID');
    return await this.command(['EVAL', "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1", '1', this.key(previous.requestId), canonicalJson(previous), canonicalJson(next)]) === 1;
  }
}
