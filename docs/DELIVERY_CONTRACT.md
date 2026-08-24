# Delivery contract

Website Intelligence is a synchronous fixture provider. A successful request
returns its JSON audit in the same response; there is no job URL or callback.

Its Service Card is the source of truth for the required delivery fields:
estimated duration, result schema, canonical SHA-256 result hash requirement,
zero durable retention, `Idempotency-Key` handling, retry policy, and terminal
failure semantics. The current fixture endpoint does not claim paid execution,
external fetching, durable storage, or Mainnet settlement.
