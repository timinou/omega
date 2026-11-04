{
  description = "Omega: the shared world, its editor packages and their compiled frontend";

  # Keep the public release and env.bl's :bl pin together.
  inputs = {
    beam-lisp.url = "github:undefine-org/enchant/v2026.9";
    nixpkgs.follows = "beam-lisp/nixpkgs";
  };

  outputs = { self, nixpkgs, beam-lisp }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      inherit (pkgs) lib;
      # Use the unchanged public distribution for both host and frontend.
      bl = (pkgs.fetchurl {
        url = "https://github.com/undefine-org/enchant/releases/download/v2026.9/bl-linux-x86_64";
        sha256 = "eef9d661ba0883e3190904319cf683cac7e069b929c3d4ddedae49d28fc25544";
      }).overrideAttrs (_: { unsafeDiscardReferences.out = true; });
      libraries = lib.makeLibraryPath (with pkgs; [ stdenv.cc.cc.lib openssl zlib ncurses brotli zstd ]);

      # Tracked sources only (flakes see the git index), minus evidence and mockups,
      # so a screenshot or a review edit never invalidates the compiled frontend.
      source = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.difference (lib.fileset.gitTracked ./.)
          (lib.fileset.unions (map (p: lib.fileset.maybeMissing p) [
            ./spikes/mobile/design-review
            ./spikes/mobile/proof ./spikes/home/proof ./spikes/pelagic/proof
            ./spikes/workspace/proof ./spikes/dwim/proof ./spikes/atlas/proof
            ./research ./docs (./. + "/!tasks") (./. + "/!sessions")
          ]));
      };

      # The same `pelagic.build/frontend-into!` the development cache uses, run once,
      # offline, in the sandbox. Nix places it on Build; the result is immutable.
      # bl js asks node for the JS runtime's exported names; nothing else is external.
      frontend = pkgs.runCommand "omega-frontend-v2026.9" {
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
        printf '%s\n' 'v2026.9' > "$out/share/omega/beam-lisp-release"
      '';
    in
    {
      packages.${system} = { inherit frontend; default = frontend; };
    };
}
