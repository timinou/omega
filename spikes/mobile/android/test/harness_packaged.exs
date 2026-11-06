# Run on Build with the APK's SDK and the freshly compiled app modules.
{:ok, _} = Application.ensure_all_started(:beam_lisp)
:ok = BeamLisp.init()
for m <- [BeamLisp.Ns.Pocket.Config, BeamLisp.Ns.Pocket.Home, BeamLisp.Ns.Pocket.Attention], do: m.__bl_init__()
config = BeamLisp.Ns.Pocket.Config
home = BeamLisp.Ns.Pocket.Home
attention = BeamLisp.Ns.Pocket.Attention
origin = BeamLisp.Env.fetch!("pocket.config", "origin")
unless Regex.match?(~r/^https:\/\/[a-zA-Z0-9.-]+\.ts\.net:[0-9]+$/, origin), do: raise("Wrong default account server")
unless BeamLisp.Env.fetch!("pocket.config", "origin-file") == "pocket-harness-origin", do: raise("Account preference would be reused")
query = BeamLisp.Env.fetch!("pocket.home", "query")
unless String.contains?(query, ",live&"), do: raise("Live package is absent")
unless apply(home, :connect, [%{origin: origin}])[:connected] == origin, do: raise("Cannot connect to harness origin")
unless apply(home, :connect, [%{origin: "http://invalid.example"}])[:error], do: raise("Invalid origin admitted")
url = apply(home, :"start-url", [%{connected: origin}])
unless url == origin <> query, do: raise("Wrong Pocket entry URL")
item = apply(attention, :"task-item", [%{"type" => "omega/task", "key" => "t-1", "status" => "idle", "ask" => "Review this proposal",
  "ask-id" => "msg-10", "proposals" => [%{"label" => "Apply", "text" => "apply change-8"}]}])
intent = apply(attention, :"reply-intent", [item, "p0", nil])
unless intent[:intent] == "msg/answer" and intent[:args][:msg] == "msg-10" and intent[:args][:text] == "apply change-8",
 do: raise("Notification action lost the exact proposal identity")
IO.puts("PASS packaged app: harness default, separate preference, Live package, HTTPS validation, exact proposal action")

# The command core runs without Android. Code needs both opt-ins; load/rollback
# preserve exact versions, and navigation cannot escape the connected origin.
dev = BeamLisp.Ns.Pocket.Dev
dev.__bl_init__()
history = nil
fx = %{dev?: false, "host-code?": true, history: history, state: fn -> %{screen: "home"} end,
       eval: fn src, _ns -> src end, changed: fn _ -> nil end, open: fn p -> p end}
denied = apply(dev, :"run-command", [fx, %{"id" => "c1", "op" => "eval", "args" => %{"src" => "(+ 1 2)"}}])
unless denied["error"], do: raise("Code ran without phone opt-in")
for path <- ["//evil.test", "/\\evil.test", "/\n/evil.test"] do
  if apply(dev, :"path-ok?", [path]), do: raise("Unsafe device navigation")
end
IO.puts("PASS packaged device core: phone code gate and same-origin navigation")

for legacy <- Tuple.to_list(Map.fetch!(BeamLisp.Env.fetch!("pocket.config", "legacy-origins"), :items)) do
 unless apply(home, :"preferred-origin", [legacy]) == origin, do: raise("Retired preview origin was not migrated")
end
custom = "https://other.tail123.ts.net:18009"
unless apply(home, :"preferred-origin", [custom]) == custom, do: raise("Custom origin was replaced")
IO.puts("PASS packaged origin migration: retired preview moves to account; custom servers stay selected")
