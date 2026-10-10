# Harness corrections

These intermediate failures belong to the prototype harness, not runtime findings:

- `discarded-pinned-launch.log`: initial systemd invocation resolved the caller's Omega `bin/bl`, rather than the upstream executable. Stopped; all reported source results use the absolute upstream executable.
- `ports-test-initial-reader-error.log`: missing closing parenthesis in the new test, corrected before the successful regression run and upstream commit.
- `route-result-json-tuple-error.log`: the fixed runtime correctly returned an error containing a native tuple. Report now projects its error tag. The final probe passes.
