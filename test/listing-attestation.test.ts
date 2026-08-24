import test from "node:test";
import assert from "node:assert/strict";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import {
  buildUnsignedListingAttestation,
  SERVICE_CARD_ATTESTATION_KEY,
  serviceCardSha256,
  STELLAR_TESTNET_PASSPHRASE
} from "../src/listing-attestation.js";

// Public Testnet-format address used only as an unsigned XDR fixture.
const SELLER = "GC3CK5A4KCNE44LGMU6PYPEAAZVQOFATJCEMBAASGCXK5EKECTB2VDL4";

test("builds an unsigned Testnet Manage Data listing attestation with only the Service Card hash", () => {
  const attestation = buildUnsignedListingAttestation({ sellerPublicKey: SELLER, sequence: "123" });
  assert.equal(attestation.network, "stellar:testnet");
  assert.equal(attestation.dataKey, SERVICE_CARD_ATTESTATION_KEY);
  assert.equal(attestation.serviceCardHash, `sha256:${serviceCardSha256()}`);
  const transaction = TransactionBuilder.fromXDR(attestation.unsignedTransactionXdr, STELLAR_TESTNET_PASSPHRASE);
  assert.equal(transaction.signatures.length, 0);
  assert.equal(transaction.operations.length, 1);
  const operation = transaction.operations[0] as { type: string; name?: string; value?: Buffer };
  assert.equal(operation.type, "manageData");
  assert.equal(operation.name, SERVICE_CARD_ATTESTATION_KEY);
  assert.equal(operation.value?.toString("hex"), serviceCardSha256());
});

test("refuses a non-Stellar seller address before producing an attestation", () => {
  assert.throws(() => buildUnsignedListingAttestation({ sellerPublicKey: "0xnotstellar", sequence: "1" }));
});
