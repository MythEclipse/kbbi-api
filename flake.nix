{
  description = "kbbi-api — Indonesian dictionary REST API (Bun + TypeScript, zero runtime deps)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachSystem [ "x86_64-linux" ] (system:
      let
        pkgs = import nixpkgs { inherit system; };

        bun = pkgs.bun;

        # `builtins.path` copies only git-TRACKED files, so a dataset that .gitignore
        # excludes is invisible here no matter that it sits in the working tree
        # (a plain `path:` literal would copy it, but would also drag in
        # kv-data/, node_modules/ and .git — ~1GB of pure build artifacts).
        #
        # The dataset is therefore NOT vendored in this repo. It lives in
        # upstream baguskto/kbbi-api (kbbi-dataset-kbbi-v-main/json/), which is
        # where the original author bundled it — the similarly-named
        # damzaky/... repo has no json/ directory at all, only legacy/ and
        # word lists. Fetching from upstream keeps the data provenance clear.
        source = builtins.path {
          path = ./.;
          name = "source";
          filter = (path: type:
            let base = baseNameOf path;
            in !(base == "kv-data"
              || base == "node_modules"
              || base == ".git"
              || base == "result"
              || base == "kbbi-dataset-kbbi-v-main"));
        };

        # Pinned to a commit rather than tracking a branch: a moving branch head
        # would change this derivation's hash without any change in this repo,
        # so the store would silently serve a stale dictionary.
        dataset = pkgs.fetchFromGitHub {
          owner = "baguskto";
          repo = "kbbi-api";
          rev = "13fd4ea6f50baec4b756fb473d402f55307e0e71";
          sha256 = "sha256-YEKg5vfGEnBTg+Za0B2CHszNxUp85naEvYm2jb513Es=";
        };

        # The dictionary is ~74MB of JSON, too large to keep in the Nix store on
        # every rebuild but far too slow to regenerate per boot. It ships as a
        # derivation that the package wrapper depends on, so one `nix build`
        # produces both together and the two can never drift apart.
        dictionary = pkgs.stdenv.mkDerivation {
          pname = "kbbi-api-dictionary";
          version = "1.0.0";

          src = source;

          nativeBuildInputs = [ bun pkgs.cacert ];

          dontConfigure = true;
          dontFixup = true;

          buildPhase = ''
            runHook preBuild

            # The dataset is not vendored (see `source`), so stage the fetched
            # copy where scripts/prepare-data.ts expects it. Pointing the script
            # at the store path via env is cheaper than a 143MB copy into the
            # build tree, and leaves the script itself path-agnostic.
            echo "dataset: ${dataset}"

            echo "=== Preparing dictionary dump ==="
            KBBI_DATASET_DIR=${dataset}/kbbi-dataset-kbbi-v-main/json \
            KBBI_OUTPUT_DIR=kv-data \
            bun run scripts/prepare-data.ts

            echo "=== Verifying the dump is self-consistent ==="
            # Guard the failure this service is most exposed to: a truncated dump
            # that still parses would boot "successfully" and then answer
            # {"exists": false} for every word. Check the count, not just that
            # the file exists.
            WORDS=$(bun -e 'const i = await Bun.file("kv-data/__index_words__.json").json(); console.log(i.length)')
            FORMS=$(bun -e 'const n = await Bun.file("kv-data/__index_non_standard__.json").json(); console.log(Object.keys(n).length)')
            echo "dictionary: $WORDS words, $FORMS non-standard forms"
            [ "$WORDS" -gt 100000 ] || { echo "FAIL: only $WORDS words — dump is truncated"; exit 1; }
            [ "$FORMS" -gt 1000 ] || { echo "FAIL: only $FORMS non-standard forms — dump is truncated"; exit 1; }
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r kv-data $out/kv-data
            runHook postInstall
          '';

          meta = {
            description = "kbbi-api dictionary dump — 112,645 headwords";
            platforms = pkgs.lib.platforms.linux;
          };
        };

        # Bun is the runtime: `bun run` executes the TypeScript sources directly,
        # so there is no compile step and no dist/ to keep in sync. nodejs stays
        # only for `tsc`, which is what the typecheck script invokes.
        server = pkgs.stdenv.mkDerivation {
          pname = "kbbi-api";
          version = "1.0.0";

          src = source;

          nativeBuildInputs = [ bun pkgs.nodejs_22 pkgs.cacert pkgs.makeWrapper ];

          # No node-gyp or native addons: the service has zero runtime
          # dependencies, so the default stdenv configure phase has nothing to do.
          dontConfigure = true;
          dontFixup = true;

          buildPhase = ''
            runHook preBuild
            export HOME=$TMPDIR/home
            mkdir -p $HOME

            echo "=== Installing dev dependencies (tsc only) ==="
            bun install --frozen-lockfile

            echo "=== Type checking ==="
            ./node_modules/.bin/tsc --noEmit

            echo "=== Running tests ==="
            bun test
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/kbbi-api
            # Only what the runtime needs: the TypeScript sources plus bun.lock
            # so `bun run` resolves deterministically. No node_modules — bun
            # executes the sources without resolving any runtime import (the
            # service imports only node: builtins), so nothing there is read.
            cp -r src scripts package.json bun.lock tsconfig.json $out/lib/kbbi-api/

            mkdir -p $out/bin
            # The systemd unit's ExecStart target. KBBI_DATA_DIR points at the
            # dictionary derivation's store path rather than shipping the 74MB
            # dump inside this closure, so the dictionary's hash tracks the
            # upstream dataset alone and an unchanged service is not rebuilt
            # every time the data is regenerated.
            #
            # makeWrapper, not a hand-written heredoc: a `<< WRAPPER` heredoc
            # has its body expanded by the BUILD shell after Nix's own
            # interpolation, so a runtime default like `${PORT:-8080}` gets
            # baked in as the build machine's value and the operator's override
            # is silently ignored. --set-default is evaluated at wrapper-run
            # time, which is the only place the answer is correct.
            #
            # `--add-flags` (not a bare `-- run ...`) is how the wrapped command
            # gets its arguments: makeWrapper has no `--` separator, and dies
            # with "doesn't understand the arg" on any unknown token.
            makeWrapper ${bun}/bin/bun $out/bin/kbbi-api \
              --chdir $out/lib/kbbi-api \
              --set-default KBBI_DATA_DIR ${dictionary}/kv-data \
              --set-default PORT 8080 \
              --add-flags "run src/server.ts"
            chmod +x $out/bin/kbbi-api

            runHook postInstall
          '';

          meta = {
            description = "kbbi-api — Indonesian dictionary REST API";
            platforms = pkgs.lib.platforms.linux;
          };
        };

      in {
        packages = {
          inherit server dictionary;
          default = server;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [ bun pkgs.nodejs_22 pkgs.cacert ];

          shellHook = ''
            echo "kbbi-api dev shell — bun $(bun --version), node $(node --version)"
            if [ ! -d kv-data ]; then
              echo "  kv-data/ missing — run: bun run prepare-data"
            else
              echo "  dictionary ready: $PWD/kv-data"
            fi
          '';
        };
      });
}