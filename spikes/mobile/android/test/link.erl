-module(link).
-export([main/1]).
main([NewDir, RtDir]) ->
  Rt = filelib:wildcard(RtDir ++ "/otp/lib/*/ebin/*.beam") ++ filelib:wildcard(RtDir ++ "/otp/lib/*/*/ebin/*.beam"),
  New = filelib:wildcard(NewDir ++ "/*.beam"),
  Exp = lists:foldl(fun(F, Acc) ->
      case beam_lib:chunks(F, [exports]) of
        {ok, {M, [{exports, Es}]}} -> lists:foldl(fun({Fn, A}, S) -> sets:add_element({M, Fn, A}, S) end, Acc, Es);
        _ -> Acc end end, sets:new(), Rt ++ New),
  Bifs = fun(M, F, A) -> erlang:function_exported(M, F, A) orelse erlang:is_builtin(M, F, A) end,
  Missing = lists:usort(lists:flatmap(fun(F) ->
      {ok, {_, [{imports, Is}]}} = beam_lib:chunks(F, [imports]),
      [{filename:basename(F), I} || {M, Fn, A} = I <- Is, not sets:is_element(I, Exp), not Bifs(M, Fn, A)] end, New)),
  io:format("~p exports scanned; ~p new modules; missing: ~p~n", [sets:size(Exp), length(New), Missing]),
  halt(case Missing of [] -> 0; _ -> 1 end).
