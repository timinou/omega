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

# Exercise the cold entry, rather than only pure URL/command helpers. A missing
# import or native dependency during mount otherwise leaves Compose with no root.
BeamLisp.Ns.Pocket.App.__bl_init__()
ids = for _ <- 1..100, do: apply(dev, :"new-device-id", [])
unless length(Enum.uniq(ids)) == 100 and Enum.all?(ids, &Regex.match?(~r/^d-[a-z0-9]{8,32}$/, &1)),
  do: raise("Invalid or repeated startup device id")
{:ok, socket} = apply(home, :mount, [%{}, %{}, struct(Mob.Socket, assigns: %{})])
unless socket.assigns[:connected] == origin, do: raise("Cold mount lost account origin")
tree = apply(home, :render, [socket.assigns])
unless tree[:type] == :column and Enum.at(tree[:children], 1)[:type] == :web_view,
  do: raise("Cold mount did not render the Pocket WebView")
IO.puts("PASS packaged cold entry: app initialization, unique device IDs, mount and first WebView render")

# Reproduce the physical phone's actual failing callback. Pure mount/render
# checks missed the immediate :start message and its device-report call.
for {value, expected} <- [{false, false}, {nil, false}, {"true", false}, {true, true}] do
  unless apply(home, :developer?, [%{developer: value}]) == expected,
    do: raise("Wrong developer gate for #{inspect(value)}")
  unless apply(home, :"device-report", [%{developer: value}])[:dev] == expected,
    do: raise("Device report failed before the first poll")
end
IO.puts("PASS packaged startup report: phone developer gate and first device report")

# Replace only the HTTPS edge inside this disposable test VM. Exercise the real
# :start callback/poller without any request reaching the live account.
Process.register(self(), :pocket_startup_contract)
Code.compiler_options(ignore_module_conflict: true)
Code.compile_string("""
defmodule BeamLisp.Ns.Body.Pocket.Http do
  def request!(req) do
    send(:pocket_startup_contract, {:offline_request, req})
    %{status: 0, error: :offline_contract}
  end
end
""")
{:noreply, started} = apply(home, :handle_info, [:start, socket])
poller = started.assigns[:"dev-poller"]
unless is_pid(poller) and Process.alive?(poller), do: raise("Startup poller did not survive")
receive do
  {:offline_request, %{method: :post, body: body}} ->
    unless body[:intent] == "device/poll" and body[:args][:report][:dev] == false,
      do: raise("Wrong first native device poll")
after
  2000 -> raise("Startup never reached the first device poll")
end
{:noreply, toggled} = apply(home, :handle_info, [{:tap, :"toggle-developer"}, started])
unless apply(home, :developer?, [toggled.assigns]), do: raise("Developer switch did not enable")
{:noreply, toggled} = apply(home, :handle_info, [{:tap, :"toggle-developer"}, toggled])
if apply(home, :developer?, [toggled.assigns]), do: raise("Developer switch did not disable")
apply(home, :render, [Map.put(toggled.assigns, :panel, true)])
Process.exit(poller, :kill)
IO.puts("PASS packaged :start callback: first device poll, developer toggle and connection panel; HTTP stubbed")
