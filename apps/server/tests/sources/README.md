# Source tests

One folder per provider family, matching `src/modules/data-platform/sources/`. Each source is
tested against captures in `tests/fixtures/`: the real capture is accepted with its data time and
coverage, survives a JSON round trip through its `dataSchema`, and every failure in its catalogue
that can be reproduced is refused with its code.
