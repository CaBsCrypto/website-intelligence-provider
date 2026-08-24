import { Account, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import { serviceCard } from "./service-card.js";
import { canonicalJson } from "./x402/canonical.js";

/** A short, versioned Stellar Manage Data key; its value is a 32-byte SHA-256. */
export const SERVICE_CARD_ATTESTATION_KEY = "bazaar:service-card:v1";
export const STELLAR_TESTNET_PASSPHRASE = Networks.TESTNET;

export interface UnsignedListingAttestationInput {
  /** Seller public G-address. A secret key is deliberately never accepted. */
  sellerPublicKey: string;
  /** Current seller account sequence fetched by a caller during a later preflight. */
  sequence: string;
  /** Base fee in stroops; defaults to Stellar's minimum base fee. */
  baseFee?: string;
}

export interface UnsignedListingAttestation {
  network: "stellar:testnet";
  dataKey: typeof SERVICE_CARD_ATTESTATION_KEY;
  serviceCardHash: string;
  /** Base64 transaction XDR, unsigned and intentionally not submitted. */
  unsignedTransactionXdr: string;
}

export function serviceCardSha256(): string {
  return createHash("sha256").update(canonicalJson(serviceCard), "utf8").digest("hex");
}

/**
 * Builds an unsigned Testnet Manage Data transaction that commits only the
 * Service Card hash. Signing and submission remain separate, gated actions.
 */
export function buildUnsignedListingAttestation(input: UnsignedListingAttestationInput): UnsignedListingAttestation {
  if (!/^G[A-Z2-7]{55}$/.test(input.sellerPublicKey)) {
    throw new Error("sellerPublicKey must be a Stellar G-address");
  }
  if (!/^\d+$/.test(input.sequence)) {
    throw new Error("sequence must be a non-negative integer string");
  }
  const hash = serviceCardSha256();
  const transaction = new TransactionBuilder(new Account(input.sellerPublicKey, input.sequence), {
    fee: input.baseFee ?? "100",
    networkPassphrase: STELLAR_TESTNET_PASSPHRASE
  })
    .addOperation(Operation.manageData({
      name: SERVICE_CARD_ATTESTATION_KEY,
      value: Buffer.from(hash, "hex")
    }))
    .setTimeout(0)
    .build();

  return {
    network: "stellar:testnet",
    dataKey: SERVICE_CARD_ATTESTATION_KEY,
    serviceCardHash: `sha256:${hash}`,
    unsignedTransactionXdr: transaction.toXDR()
  };
}
