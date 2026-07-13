# Trust known-answer fixtures

These fixtures are deterministic inputs for feature 028. Each scenario owns a
minimal read-only repository and a `provider-responses.json` sequence.

Provider response records use the normalized chat-client shape:

- `stage` names the runtime stage that consumes the response.
- `result.message.content` is a JSON value that a fixture client serializes
  before returning it to the runtime.
- `result.message.toolCalls` uses the normalized `{id, function}` shape.
- Object-valued `function.arguments` are serialized by the fixture client in
  the same way as model-provided JSON tool arguments.
- `error` asks the fixture client to throw the described provider error.
- `waitForAbort` asks the fixture client to remain pending until its abort
  signal fires.

Fixture hashes are computed from repository-relative paths and LF-normalized
file bytes. No provider-generated output is an oracle; expected goals, claims,
boundaries, and states live in `benchmarks/trust-known-answer.json`.
