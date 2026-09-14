# Security policy

Report vulnerabilities privately to **hola@cubo.lat**. Do not open a public issue for a secret leak, auth bypass, or anything that can harm students.

Please include:

- the affected path (`apps/server`, `apps/mobile`, a package)
- reproduction that you ran against your own clone
- impact

Do not send production tokens, student emails, or PDF contents of other people's material.

## What this repo actually ships

- Session JWTs: `JWT_SECRET` has a documented development default. `readEnv` rejects that default when `BUXO_ENV` is `staging` or `prod`. Set a long random value before any shared deploy.
- Account deletion: `DELETE /v1/account` deletes that user's sessions, exchanges, materials, fuentes, courses, and subjects, then keeps consent rows only as salted pseudonyms. A later request with the same JWT is 401.
- PDF ingest: server-side pdf.js sets `isEvalSupported: false` and `enableScripting: false`.
- Safety: production boot wires `RuleBasedSafetyClassifier`, a public regex stub. `BUXO_SAFETY_CHAIN` is unused. The stub is bypassable. Do not treat it as a model-backed filter. Replacing it is a later program, not a silent README claim.

Closed Play testing can continue on the private remote. Public source does not imply a public production host.
