# The NEW Pocket modules, inside the 0.1.1 APK's own runtime (host NIF substituted).
{:ok, _} = Application.ensure_all_started(:beam_lisp)
:ok = BeamLisp.init()
home = BeamLisp.Ns.Pocket.Home
att = BeamLisp.Ns.Pocket.Attention
http = BeamLisp.Ns.Pocket.Http
for m <- [home, att, http], do: m.__bl_init__()
core = BeamLisp.Ns.Core
lst = fn v -> Enum.to_list(v) end
ok = fn c, msg -> unless c, do: raise("FAIL " <> msg); IO.puts("PASS " <> msg) end
r = apply(home, :connect, [%{origin: "https://work.tailcb5318.ts.net:18001"}])
ok.(r[:connected] == "https://work.tailcb5318.ts.net:18001", "connect accepts Work :18001")
ok.(apply(home, :connect, [%{origin: "http://evil.example"}])[:error] != nil, "connect rejects non-tailnet HTTP")
ui = apply(home, :render, [%{connected: "https://h.ts.net:8443"}])
ok.(Enum.count(ui[:children]) == 2, "one header: the web view is the page")
doc = apply(att, :parse, [%{status: 200, body: File.read!("live-workspace.json")}])
items = apply(att, :items, [doc])
ok.(Enum.count(items) > 0, "attention reads the live workspace document (#{Enum.count(items)} sessions)")
a1 = apply(home, :attend, [%{}, items])
ok.(lst.(a1[:effects]) |> Enum.all?(fn e -> Enum.at(e, 0) in [:post, :cancel] end), "first poll primes silently or posts only your-turn")
item = apply(att, :"task-item", [%{"type" => "omega/task", "key" => "t-1", "title" => "Ship", "ask" => "Rebuild?", "ask-id" => "m-9", "status" => "idle", "place-name" => "omega", "proposals" => [%{"label" => "Rebuild APK", "text" => "go"}]}])
n = apply(att, :notification, [item])
ok.(n[:title] == "Your turn · Ship" and Enum.map(lst.(n[:actions]), & &1[:id]) == ["p0", "reply"], "notification carries next step and reply")
ri = apply(att, :"reply-intent", [item, "p0", nil]); IO.inspect(ri, label: "reply-intent"); ok.(ri[:intent] == "msg/answer" and ri[:args][:msg] == "m-9" and ri[:args][:text] == "go", "action answers the question")
resp = apply(http, :"request!", [%{method: :get, url: "https://work.tailcb5318.ts.net:18001/api/doc?path=desk:welcome", "timeout-ms": 15000}])
ok.(resp[:status] in [200, 403], "pocket.http reaches Work over verified TLS (HTTP #{resp[:status]})")
bad = apply(http, :"request!", [%{method: :get, url: "https://self-signed.badssl.com/", "timeout-ms": 15000}])
ok.(bad[:status] == 0, "pocket.http refuses an unverified certificate")
IO.puts("Packaged modules loaded from: #{:code.which(home)}")
