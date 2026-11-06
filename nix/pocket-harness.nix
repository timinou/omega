# App-only compilation against the tested APK's OWN compiler and mobile SDK.
# Signing happens on Work, never in this derivation. baseApk is a store input.
{ pkgs, baseApk, erlang, lazyNif, origin, legacyOrigins ? [] }:
assert builtins.match "https://[a-zA-Z0-9.-]+\\.ts\\.net:[0-9]+" origin != null;
pkgs.runCommand "omega-pocket-harness-modules" {
  nativeBuildInputs = [ pkgs.python3 ];
} ''
  export HOME=$TMPDIR/home
  export ERL_FLAGS="+S 2:2 +SDcpu 1:1 +SDio 1"
  export LANG=C.UTF-8 ELIXIR_ERL_OPTIONS="+fnu"
  mkdir -p "$HOME" app "$out"
  cp -r ${../spikes/mobile/android/src}/. app/
  chmod -R u+w app
  cat > app/pocket/config.bl <<'BL'
  (ns pocket.config)
  (def origin "${origin}")
  (def origin-file "pocket-harness-origin")
  (def extra-use ",live")
  (def developer? false)
  (def legacy-origins ${builtins.toJSON legacyOrigins})
  BL
  python3 - ${baseApk} <<'PY'
  import io,sys,zipfile
  with zipfile.ZipFile(sys.argv[1]) as apk:
      with zipfile.ZipFile(io.BytesIO(apk.read('assets/bl-runtime.zip'))) as runtime:
          for info in runtime.infolist():
              if info.filename.startswith('otp/lib/'):
                  runtime.extract(info, '.')
  PY
  # Android's lazy-memo NIF cannot run on Build. This host NIF is used only by
  # the compiler; the app-only overlay never ships it or changes the APK SDK.
  cp ${lazyNif} otp/lib/beam_lisp-0.1.0/priv/native/lazy_memo.so
  ${erlang}/bin/erl -noshell -noinput \
    -pa "$PWD/otp/lib/elixir/ebin" "$PWD/otp/lib/logger/ebin" \
        "$PWD/otp/lib/beam_lisp-0.1.0/ebin" "$PWD/otp/lib/mob-0.9.3/ebin" \
        "$PWD/otp/lib/nimble_parsec-1.4.2/ebin" \
    -eval "io:format(\"Starting packaged compiler~n\"), try application:ensure_all_started(elixir), 'Elixir.Code':eval_file(list_to_binary(\"${../spikes/mobile/android/test/build_app.exs}\")), halt() catch C:E:S -> io:format(\"Compiler error ~tp:~tp ~tp~n\",[C,E,S]), halt(1) end." \
    -extra "$PWD/app" "$out"
  if ! ${erlang}/bin/erl -noshell -noinput \
    -pa "$PWD/otp/lib/elixir/ebin" "$PWD/otp/lib/logger/ebin" \
        "$PWD/otp/lib/beam_lisp-0.1.0/ebin" "$PWD/otp/lib/mob-0.9.3/ebin" \
        "$PWD/otp/lib/nimble_parsec-1.4.2/ebin" "$out" \
    -eval "try application:ensure_all_started(elixir), 'Elixir.Code':eval_file(list_to_binary(\"${../spikes/mobile/android/test/harness_packaged.exs}\")), halt() catch C:E:S -> io:format(\"Contract error ~tp:~tp ~tp~n\",[C,E,S]), halt(1) end." \
    > "$out/contract.log" 2>&1; then cat "$out/contract.log"; exit 1; fi
  cat "$out/contract.log"
''
