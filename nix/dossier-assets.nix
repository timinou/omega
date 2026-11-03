# Private asset refresh over the graph built by .#frontend. No BL compilation
# and no managed-release marker: this is a disposable prototype, not a release.
{ baseFrontend }:
let
  omega = builtins.getFlake ("git+file://" + toString ../.);
  pkgs = omega.inputs.nixpkgs.legacyPackages.x86_64-linux;
  base = builtins.storePath baseFrontend;
  host = ../spikes/mobile/host/host.mjs;
in pkgs.runCommand "omega-dossier-trial-assets" {} ''
  cp -r ${base} $out
  chmod -R u+w $out
  cp ${host} $out/pkg/mobile/host.mjs
  rm -f $out/.omega-managed $out/.inputs $out/pelagic-build.json
  echo 'Private trial; compiled frontend ${base}; reader asset ${host}' > $out/.omega-prototype
''
