# Compiled by the tested APK's own portable BEAM Lisp compiler, on Build.
{:ok, _} = Application.ensure_all_started(:beam_lisp)
:ok = BeamLisp.init()
[source, out] = :init.get_plain_arguments() |> Enum.map(&List.to_string/1)
build = BeamLisp.Ns.Build
build.__bl_init__()
sources = Path.wildcard(Path.join(source, "**/*.bl"))
opts = %{sources: sources, out: out, "force?": true, jobs: 1}
result = apply(build, :run, [opts])
IO.inspect(result, label: "Pocket app compilation", limit: 8)
unless Enum.empty?(result[:errors] || []), do: raise("Pocket app compilation failed")
unless Path.wildcard(Path.join(out, "Elixir.BeamLisp.Ns.*.beam")) != [], do: raise("No app modules produced")
