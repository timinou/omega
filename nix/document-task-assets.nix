# Build-only package/asset refresh over the full pinned frontend. Both derivations
# run on Build; this private output has no managed-release marker.
{ baseFrontend }:
let
  omega = builtins.getFlake ("git+file://" + toString ../.);
  pkgs = omega.inputs.nixpkgs.legacyPackages.x86_64-linux;
  base = builtins.storePath baseFrontend;
  compiler = omega.packages.x86_64-linux.frontend-compiler;
  source = pkgs.lib.fileset.toSource {
    root = ../.;
    fileset = pkgs.lib.fileset.unions [ ../vendor/bl-ed/ed ../spikes/workspace/document_tasks ];
  };
  taskModule = pkgs.runCommand "omega-document-task-module" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
    export DROP_STORE_ROOT=$TMPDIR/drop
    cp ${compiler}/bl.drop $TMPDIR/bl
    chmod +x $TMPDIR/bl
    cp -r ${source} $TMPDIR/source
    chmod -R u+w $TMPDIR/source
    cd $TMPDIR/source
    $TMPDIR/bl --cold run -p vendor/bl-ed -p spikes/workspace \
      spikes/workspace/document_tasks/build-module.bl -- $out
  '';
  host = ../spikes/mobile/host/host.mjs;
  style = ../spikes/mobile/host/style.css;
in pkgs.runCommand "omega-document-task-trial-assets" {} ''
  cp -r ${base} $out
  chmod -R u+w $out
  cp ${taskModule}/ns/document-tasks.main.mjs $out/out/ns/document-tasks.main.mjs
  cp ${host} $out/pkg/mobile/host.mjs
  cp ${style} $out/pkg/mobile/style.css
  rm -f $out/.omega-managed $out/.inputs $out/pelagic-build.json
  echo 'Private trial; base ${base}; compiled package ${taskModule}; assets ${host} ${style}' > $out/.omega-prototype
''
