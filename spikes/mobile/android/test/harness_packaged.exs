# Run on Build with the APK's SDK and the freshly compiled app modules.
{:ok, _} = Application.ensure_all_started(:beam_lisp)
:ok = BeamLisp.init()
for m <- [BeamLisp.Ns.Pocket.Config, BeamLisp.Ns.Pocket.Home, BeamLisp.Ns.Pocket.Attention], do: m.__bl_init__()
config = BeamLisp.Ns.Pocket.Config
home = BeamLisp.Ns.Pocket.Home
attention = BeamLisp.Ns.Pocket.Attention
origin = BeamLisp.Env.fetch!("pocket.config", "origin")
unless String.ends_with?(origin, ".ts.net:18079"), do: raise("Wrong default harness server")
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
