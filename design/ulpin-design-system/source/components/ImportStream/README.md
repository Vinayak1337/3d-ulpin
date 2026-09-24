# ImportStream

The live list of an import in progress: one row per file with what was detected, what the agent mapped, and what needs a decision, updated as results are saved.

- Rows turn from progress to result as each chunk is saved; the map updates without resetting the camera.
- Only rows that need a person show an action ("Review 1 mapping"); everything else is a quiet status line.
- A file the agent cannot read says which reader is missing; it never fails silently.
- The consumer provides the job events (file, stage, counts, exceptions) from the server stream.
