# Run with code paths extracted from the APK runtime, without app source paths.
{:ok, _} = Application.ensure_all_started(:beam_lisp)
:ok = BeamLisp.init()
home = BeamLisp.Ns.Pocket.Home
home.__bl_init__()

for origin <- ["https://work.tailcb5318.ts.net:18001", "https://work.tail123.ts.net", "https://work.tail123.ts.net:8443", "https://work.tail123.ts.net:65535"] do
  result = apply(home, :connect, [%{origin: origin}])
  unless result[:connected] == origin and result[:error] == nil do
    raise "Packaged connection rejected #{origin}"
  end
end

for origin <- ["http://work.tail123.ts.net", "https://evil.example", "https://work.tail123.ts.net:0", "https://work.tail123.ts.net:99999"] do
  result = apply(home, :connect, [%{origin: origin}])
  unless result[:error] && result[:connected] == nil do
    raise "Packaged connection admitted #{origin}"
  end
end

IO.puts("PASS packaged modules: Work port 18001, default/8443/65535 ports; reject HTTP, external host and invalid ports")
IO.puts("Packaged Home module: #{:code.which(home)}")
