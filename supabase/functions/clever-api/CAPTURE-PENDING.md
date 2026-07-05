# index.ts is deliberately absent

The canonical `clever-api` source lands here ONLY via a mechanical download of
the deployed function, so the bytes are provably identical to production:

    supabase functions download clever-api --project-ref qksstlqzbhesadrrofgn

Full procedure and verification: `docs/runbooks/BYTE-CHECK.md`, item 1.
A hand-pasted or reconstructed copy must never be placed here — that is the
exact failure mode this repo layout exists to prevent
(`docs/adr/0001-canonical-clever-api-source.md`).

Delete this file in the same commit that adds `index.ts`.
