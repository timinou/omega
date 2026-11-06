{
  description = "Omega: the shared world, its editor packages and their compiled frontend";

  # Keep the public release and env.bl's :bl pin together.
  inputs = {
    beam-lisp.url = "github:undefine-org/enchant/v2026.10";
    nixpkgs.follows = "beam-lisp/nixpkgs";
  };

  outputs = { self, nixpkgs, beam-lisp }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      inherit (pkgs) lib;
      # Use the unchanged public distribution for both host and frontend.
      bl = (pkgs.fetchurl {
        url = "https://github.com/undefine-org/enchant/releases/download/v2026.10/bl-linux-x86_64";
        sha256 = "271d3b5628149413474ee3cffa86592635453d899ec61fe8b1f2809ed52989af";
      }).overrideAttrs (_: { unsafeDiscardReferences.out = true; });
      libraries = lib.makeLibraryPath (with pkgs; [ stdenv.cc.cc.lib openssl zlib ncurses brotli zstd ]);

      runtime = pkgs.runCommand "omega-beam-lisp-v2026.10" {
        nativeBuildInputs = [ pkgs.makeWrapper ];
      } ''
        mkdir -p $out/bin $out/libexec
        cp ${bl} $out/libexec/bl
        chmod +x $out/libexec/bl
        makeWrapper $out/libexec/bl $out/bin/bl --prefix LD_LIBRARY_PATH : ${libraries}
      '';

      # The public binary targets the FHS loader (/lib64), which a build sandbox lacks.
      # `bl-sandbox ARGS…` runs it under the same proot adapter `frontend` uses, for
      # other build-only derivations (nix/document-task-assets.nix). Needs $TMPDIR.
      sandboxRunner = pkgs.writeShellScriptBin "bl-sandbox" ''
        set -euo pipefail
        fhs=$(mktemp -d "$TMPDIR/fhs.XXXXXX")
        mkdir -p "$fhs/lib64" "$fhs/bin" "$fhs/usr/bin"
        ln -s ${pkgs.glibc}/lib/ld-linux-x86-64.so.2 "$fhs/lib64/ld-linux-x86-64.so.2"
        ln -s ${pkgs.bash}/bin/sh "$fhs/bin/sh"
        ln -s ${pkgs.bash}/bin/bash "$fhs/bin/bash"
        ln -s ${pkgs.coreutils}/bin/cat "$fhs/bin/cat"
        ln -s ${pkgs.coreutils}/bin/env "$fhs/usr/bin/env"
        cp ${bl} "$fhs/bl" && chmod +x "$fhs/bl"
        export HOME=''${HOME:-$TMPDIR/home} LANG=C.UTF-8
        export ELIXIR_ERL_OPTIONS="+fnu +S 2:2 +SDcpu 1:1 +SDio 1"
        mkdir -p "$HOME"
        unset BL_USE
        PROOT_NO_SECCOMP=1 exec ${pkgs.proot}/bin/proot -r "$fhs" \
          -b /nix/store -b "$TMPDIR" -b /dev -b /proc -w "$PWD" \
          ${pkgs.coreutils}/bin/env LD_LIBRARY_PATH=${libraries} /bl "$@"
      '';

      # Tracked sources only (flakes see the git index), minus evidence and mockups,
      # so a screenshot or a review edit never invalidates the compiled frontend.
      source = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.difference (lib.fileset.gitTracked ./.)
          (lib.fileset.unions (map (p: lib.fileset.maybeMissing p) [
            ./spikes/mobile/design-review
            ./spikes/mobile/proof ./spikes/home/proof ./spikes/pelagic/proof ./spikes/live/proof
            ./spikes/workspace/proof ./spikes/workspace/dossier/proof ./spikes/dwim/proof ./spikes/atlas/proof
            ./research ./docs (./. + "/!tasks") (./. + "/!sessions")
          ]));
      };

      # The same `pelagic.build/frontend-into!` the development cache uses, run once,
      # offline, in the sandbox. Nix places it on Build; the result is immutable.
      # bl js asks node for the JS runtime's exported names; nothing else is external.
      frontend = pkgs.runCommand "omega-frontend-v2026.10" {
        nativeBuildInputs = [ pkgs.nodejs pkgs.proot ];
      } ''
        export HOME=$TMPDIR/home LANG=C.UTF-8
        export ELIXIR_ERL_OPTIONS="+fnu +S 2:2 +SDcpu 1:1 +SDio 1"
        unset BL_USE
        mkdir -p "$HOME" "$TMPDIR/fhs/lib64" "$TMPDIR/fhs/bin" "$TMPDIR/fhs/usr/bin"
        ln -s ${pkgs.glibc}/lib/ld-linux-x86-64.so.2 "$TMPDIR/fhs/lib64/ld-linux-x86-64.so.2"
        ln -s ${pkgs.bash}/bin/sh "$TMPDIR/fhs/bin/sh"
        ln -s ${pkgs.bash}/bin/bash "$TMPDIR/fhs/bin/bash"
        ln -s ${pkgs.coreutils}/bin/cat "$TMPDIR/fhs/bin/cat"
        ln -s ${pkgs.coreutils}/bin/env "$TMPDIR/fhs/usr/bin/env"
        cp ${bl} "$TMPDIR/bl" && chmod +x "$TMPDIR/bl"
        cp -r ${source} "$TMPDIR/omega" && chmod -R u+w "$TMPDIR/omega"
        cd "$TMPDIR/omega"
        # The producer uses the same pinned FHS adapter in drop-runs.nix.
        PROOT_NO_SECCOMP=1 proot -r "$TMPDIR/fhs" \
          -b /nix/store -b "$TMPDIR" -b /dev -b /proc -w "$PWD" \
          ${pkgs.coreutils}/bin/env LD_LIBRARY_PATH=${libraries} \
          "$TMPDIR/bl" --cold run -p src -p vendor/bl-ed/src -p spikes/workspace \
          -p spikes/pelagic -p spikes/mobile spikes/pelagic/nix-frontend.bl -- "$out"
        test -f "$out/.omega-managed" && test -f "$out/.inputs"
        mkdir -p "$out/share/omega"
        printf '%s\n' 'v2026.10' > "$out/share/omega/beam-lisp-release"
      '';
    in
    {
      packages.${system} = { inherit frontend; frontend-compiler = runtime; frontend-sandbox = sandboxRunner; default = frontend; };
    };
}
