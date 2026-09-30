## Code Change Philosophy
- Prefer editing existing code over writing new functions/files/abstractions.
- Only add something new if the existing code truly can't be adapted — and say why in one line first.
- Match diff size to task size: small task = small change, not a new module.
- Don't duplicate logic that already exists — search and reuse first.
- No speculative/future-proofing code unless explicitly asked.
## Comments
- For any complex/non-obvious function, add a single-line comment above it explaining what it does and why.
- Skip comments on simple, self-explanatory code — don't over-comment.