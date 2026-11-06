# Reassemble only the launcher's DEX. The Android runtime, native libraries,
# resources and other DEX entries remain byte-identical to the installed base.
{ pkgs, baseApk, apktool, androidJar, buildTools }:
pkgs.runCommand "omega-pocket-startup-shell" {
  nativeBuildInputs = [ pkgs.python3 pkgs.jdk21 apktool ];
  JAVA_OPTS = "-Xmx768m";
} ''
  export HOME=$TMPDIR/home
  mkdir -p "$HOME" "$out" classes dex
  python3 - ${baseApk} <<'PY'
  import zipfile,sys,hashlib
  with zipfile.ZipFile(sys.argv[1]) as base, zipfile.ZipFile('launcher.apk', 'w') as small:
      small.writestr('classes.dex', base.read('classes3.dex'))
      small.writestr('AndroidManifest.xml', base.read('AndroidManifest.xml'))
      open('base-classes3.sha256', 'w').write(hashlib.sha256(base.read('classes3.dex')).hexdigest())
  PY
  apktool d --no-res --no-assets --no-debug-info -j 2 -o decoded launcher.apk
  python3 ${../spikes/mobile/android/startup/patch_launcher.py} \
    decoded/smali/org/beamlisp/omega/pocket/MainActivity.smali
  apktool b --no-apk -j 2 decoded
  cp decoded/build/apk/classes.dex "$out/classes3.dex"
  cp ${../spikes/mobile/android/startup/StartupStatus.java} StartupStatus.java
  javac -source 8 -target 8 -classpath ${androidJar} -d classes StartupStatus.java
  ${buildTools}/d8 --min-api 29 --lib ${androidJar} --output dex classes/org/beamlisp/omega/pocket/*.class
  cp dex/classes.dex "$out/classes4.dex"
  cp base-classes3.sha256 "$out/"
''
