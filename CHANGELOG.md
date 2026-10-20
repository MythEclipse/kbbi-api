## [1.0.16](https://github.com/asepharyana/kbbi-api/compare/v1.0.15...v1.0.16) (2026-10-20)

## [1.0.15](https://github.com/asepharyana/kbbi-api/compare/v1.0.14...v1.0.15) (2026-10-20)


### Bug Fixes

* auto-fix code quality [skip ci] ([7d7124d](https://github.com/asepharyana/kbbi-api/commit/7d7124d227247b7d6b80703e7dc3cc67842a533e))

## [1.0.14](https://github.com/asepharyana/kbbi-api/compare/v1.0.13...v1.0.14) (2026-10-17)


### Bug Fixes

* **ci:** gate the deploy job on the ref, not the event ([89d7306](https://github.com/asepharyana/kbbi-api/commit/89d7306ba99b352a70df6802b5084ca778620ef6))

## [1.0.13](https://github.com/asepharyana/kbbi-api/compare/v1.0.12...v1.0.13) (2026-10-17)

## [1.0.12](https://github.com/asepharyana/kbbi-api/compare/v1.0.11...v1.0.12) (2026-10-14)

## [1.0.11](https://github.com/asepharyana/kbbi-api/compare/v1.0.10...v1.0.11) (2026-10-14)

## [1.0.10](https://github.com/asepharyana/kbbi-api/compare/v1.0.9...v1.0.10) (2026-10-14)

## [1.0.9](https://github.com/asepharyana/kbbi-api/compare/v1.0.8...v1.0.9) (2026-10-14)

## [1.0.8](https://github.com/asepharyana/kbbi-api/compare/v1.0.7...v1.0.8) (2026-10-14)

## [1.0.7](https://github.com/asepharyana/kbbi-api/compare/v1.0.6...v1.0.7) (2026-10-14)

## [1.0.6](https://github.com/asepharyana/kbbi-api/compare/v1.0.5...v1.0.6) (2026-10-14)


### Bug Fixes

* **ci:** actually attach the repo-supplied image labels ([16d21a3](https://github.com/asepharyana/kbbi-api/commit/16d21a3ba205345507adaa9a9f59f6b300f99c9f))

## [1.0.5](https://github.com/asepharyana/kbbi-api/compare/v1.0.4...v1.0.5) (2026-10-14)


### Bug Fixes

* **ci:** pin the KBBI dataset revision instead of tracking main ([3709cb8](https://github.com/asepharyana/kbbi-api/commit/3709cb8072c4ddc66e57670d3fd1a9d1fa783822))

## [1.0.4](https://github.com/asepharyana/kbbi-api/compare/v1.0.3...v1.0.4) (2026-10-14)


### Bug Fixes

* **ci:** cap the release body, which GitHub limits to 125,000 chars ([503828b](https://github.com/asepharyana/kbbi-api/commit/503828b1d142a68c31a08fd762bed74ae0038b89))

## [1.0.3](https://github.com/asepharyana/kbbi-api/compare/v1.0.2...v1.0.3) (2026-10-14)


### Bug Fixes

* **ci:** stop embedding the release notes in the release commit ([a0e88fe](https://github.com/asepharyana/kbbi-api/commit/a0e88feb16f425b518ff9a4479c5652b84dc67e0))

## [1.0.2](https://github.com/asepharyana/kbbi-api/compare/v1.0.1...v1.0.2) (2026-10-14)

## [1.0.1](https://github.com/asepharyana/kbbi-api/compare/v1.0.0...v1.0.1) (2026-10-14)

# 1.0.0 (2026-10-14)


### Bug Fixes

* **ci:** fetch the dataset so json/ lands where the build expects it ([b2955ec](https://github.com/asepharyana/kbbi-api/commit/b2955ecc8d8a1b716aee6f7a124e507a97a9e901))
* **ci:** pin bun to 1.4.2, the version that wrote bun.lock ([ab3c2df](https://github.com/asepharyana/kbbi-api/commit/ab3c2df2941ed04b6453cceef279c626a59f90eb))
* **docker:** copy tests/ into the builder and assert the test count ([a4800a1](https://github.com/asepharyana/kbbi-api/commit/a4800a145dae646b0e2a3deb044d135c7be947fa))
* **docker:** point the ENTRYPOINT at Debian's tini path ([4cd9428](https://github.com/asepharyana/kbbi-api/commit/4cd942829ccfaf1b2b7e99dddaa66d9225fe8019))


### Features

* add POST-free batch lookup, and bind to Tailscale ([a3195ea](https://github.com/asepharyana/kbbi-api/commit/a3195eae6a98deee3671b7e1e009218d717d3273))
* index multi-word phrase headwords for phrase-aware lookup ([c694d94](https://github.com/asepharyana/kbbi-api/commit/c694d94680eac5914983f6d257789ed179d04356))

# Changelog

All notable changes to kbbi-api are documented here.
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
and are derived automatically from
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
