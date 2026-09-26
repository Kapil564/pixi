## Code Change Philosophy

- Prefer editing existing code over writing new functions/files/abstractions.
- Only add something new if the existing code truly can't be adapted — and say why in one line first.
- Match diff size to task size: small task = small change, not a new module.
- Don't duplicate logic that already exists — search and reuse first.
- No speculative/future-proofing code unless explicitly asked.
