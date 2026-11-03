{
  description = "Omega: the shared world, its editor packages and their compiled frontend";

  # The compiler is exactly env.bl's `:bl "commit:…"` pin. Change both together.
  inputs = {
    beam-lisp.url = "git+ssh://git@github.com/timinou/beam-lisp?rev=65c25b33c90766829334033d77a30c0c5f33938a";
    nixpkgs.follows = "beam-lisp/nixpkgs";
  };

  outputs = { self, nixpkgs, beam-lisp }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      inherit (pkgs) lib;
      bl = beam-lisp.packages.${system}.bl-drop;

      # The drop's programs target the FHS loader (/lib64), which hosts provide through
      # nix-ld but a build sandbox does not. Same payload, retargeted at this nixpkgs'
      # glibc, repacked with beam-lisp's own (Nix-linked) launcher. Identical bytes otherwise.
      dropNix = import "${beam-lisp}/nix/bl-drop.nix" {
        inherit pkgs;
        rustPkgs = beam-lisp.inputs.nixpkgs-rust.legacyPackages.${system};
        inherit (import "${beam-lisp}/nix/beam.nix" {
          inherit pkgs; inherit (beam-lisp.inputs) otp-src elixir-src;
        }) erlang elixir;
      };
      blSandbox = pkgs.runCommand "bl-drop-sandbox" { nativeBuildInputs = [ pkgs.patchelf ]; } ''
        tools=${dropNix.drop-tools}/bin
        $tools/drop unpack ${bl}/bl.drop --dir payload
        chmod -R u+w payload
        libs=${lib.makeLibraryPath (with pkgs; [ glibc stdenv.cc.cc.lib openssl zlib ncurses ])}
        find payload -type f | while read -r f; do
          if [ "$(head -c4 "$f" | od -An -c | tr -d ' ')" = '177ELF' ]; then
            if patchelf --print-interpreter "$f" >/dev/null 2>&1; then
              patchelf --set-interpreter ${pkgs.glibc}/lib/ld-linux-x86-64.so.2 --set-rpath "$libs" "$f"
            else
              patchelf --set-rpath "$libs" "$f" 2>/dev/null || true
            fi
          fi
        done
        mkdir -p $out
        $tools/drop pack --release payload --launcher $tools/drop-launcher --out $out/bl.drop
        # The payload is compressed, so Nix cannot see these paths inside it; naming
        # them in plain text makes them runtime references of this output.
        echo "$libs" > $out/runtime-libraries
      '';

      # Tracked sources only (flakes see the git index), minus evidence and mockups,
      # so a screenshot or a review edit never invalidates the compiled frontend.
      source = lib.fileset.toSource {
        root = ./.;
        fileset = lib.fileset.difference (lib.fileset.gitTracked ./.)
          (lib.fileset.unions (map (p: lib.fileset.maybeMissing p) [
            ./spikes/mobile/design-review
            ./spikes/mobile/proof ./spikes/home/proof ./spikes/pelagic/proof
            ./spikes/workspace/proof ./spikes/workspace/dossier/proof ./spikes/dwim/proof ./spikes/atlas/proof
            ./research ./docs (./. + "/!tasks") (./. + "/!sessions")
          ]));
      };

      # The same `pelagic.build/frontend-into!` the development cache uses, run once,
      # offline, in the sandbox. Nix places it on Build; the result is immutable.
      # bl js asks node for the JS runtime's exported names; nothing else is external.
      frontend = pkgs.runCommand "omega-frontend" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
        export HOME=$TMPDIR/home BL_DAEMON=off BL_GATEWAY=off LANG=C.UTF-8 ELIXIR_ERL_OPTIONS="+fnu"
        mkdir -p $HOME
        cp ${blSandbox}/bl.drop $TMPDIR/bl && chmod +x $TMPDIR/bl
        cp -r ${source} $TMPDIR/omega && chmod -R u+w $TMPDIR/omega
        cd $TMPDIR/omega
        $TMPDIR/bl --cold run -p src -p vendor/bl-ed/src -p spikes/workspace \
          -p spikes/pelagic -p spikes/mobile spikes/pelagic/nix-frontend.bl -- $out
        test -f $out/.omega-managed && test -f $out/.inputs
      '';
    in
    {
      packages.${system} = { inherit frontend; default = frontend; };
    };
}
