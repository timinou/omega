# spike: catching file changes that are not `prelude/write`/`edit`

> Run: `bin/bl run spikes/fs-capture.bl.md`

**Question (from the user).** `omega.history` today learns only about files written through `prelude/write` and
`edit`. An eval cell can change files in other ways: `(sh "sed -i …")`, `git checkout`, `cargo fmt`, `mv`
(OS subprocesses, including backgrounded ones), direct BEAM calls (`File/write!`, `File/rm!`, `File/rename!`,
`:file.write_file`, raw file handles), and beam-lisp code a cell calls. Every file change of a step must land in
that step's history change, attributed to the task and cell. Which is the lightest mechanism that catches
everything that matters? Candidates, each prototyped and measured below on a 2,000-file / 30 MB tree and on a
20-file tree:

1. tree snapshot diff per eval (stat cache, content hash for what changed);
2. an OS watcher (inotify through the `file_system` library that beam-lisp ships);
3. wrapping the BEAM file calls (call tracing of the cell process);
4. subprocess-level capture (`strace -f`, an overlayfs sandbox);
5. the hybrid: exact claims + trace + scans only for cells that ran an OS process, with window attribution.

Nothing under `src/` is touched. Scratch trees live in `/tmp`. Times are wall-clock milliseconds on this host
(tmpfs `/tmp`, 4 online schedulers, one dirty-IO scheduler).

## 0. Helpers and fixtures

```beam-lisp
(ns omega.spike.fs-capture)

(defn now-us [] (erlang/monotonic_time :microsecond))
(defn ms-since [t0] (/ (Float/round (/ (- (now-us) t0) 100.0)) 10.0))
(defn timed [f] (let [t0 (now-us) r (f)] [(ms-since t0) r]))
(defn median [xs] (let [s (vec (sort xs))] (nth s (quot (count s) 2))))
(defn sh! [cmd] (let [r (System/cmd "sh" (list "-c" cmd) (list (tuple :stderr_to_stdout true)))]
                  {:out (erlang/element 1 r) :exit (erlang/element 2 r)}))
(defn sh-in! [dir cmd] (let [r (System/cmd "sh" (list "-c" cmd) (list (tuple :stderr_to_stdout true) (tuple :cd dir)))]
                         {:out (erlang/element 1 r) :exit (erlang/element 2 r)}))
(defn rel-of [root p] (if (clojure.string/starts-with? p (str root "/")) (subs p (inc (count root))) p))

(def BODY (clojure.string/join "" (map (fn [i] (str "line " i " of some realistic source text here\n")) (range 350))))

(defn make-tree!
  "`dirs` directories of `per` files each under root/src, each ~15 KB, plus a few top-level files."
  [root dirs per]
  (sh! (str "rm -rf " root "; mkdir -p " root))
  (doseq [d (range dirs)]
    (File/mkdir_p! (str root "/src/d" d))
    (doseq [f (range per)] (File/write! (str root "/src/d" d "/f" f ".txt") (str BODY d "-" f))))
  (File/write! (str root "/README.md") "# project\n")
  (File/write! (str root "/Makefile") "all:\n\ttrue\n")
  root)

(def BIG "/tmp/omega-fs-capture-big")
(def TINY "/tmp/omega-fs-capture-tiny")

(let [[t1 _] (timed (fn [] (make-tree! BIG 200 10)))
      [t2 _] (timed (fn [] (make-tree! TINY 2 10)))
      du (sh! (str "du -sk " BIG " | cut -f1"))]
  (println "OBSERVED fixtures: BIG" (str (count (clojure.string/split (:out (sh! (str "find " BIG " -type f"))) "\n")) "") "files,"
           (quot (clojure.edn/read-string (clojure.string/trim (:out du))) 1024) "MB, built in" t1 "ms; TINY 22 files, built in" t2 "ms"))
;; a git repo in BIG, for the strace measurements later (`.git` is excluded from every scan)
(let [[t _] (timed (fn [] (sh-in! BIG "git init -q && git add -A && git -c user.email=a@b -c user.name=n commit -qm init")))]
  (println "OBSERVED git init+add+commit of BIG:" t "ms"))
```

## 1. Candidate 1: tree snapshot diff per eval

The scanner stats every file (never follows symlinks, `:raw` so it skips the file-server round trip), records
`[size mtime inode]` per relative path, and skips `.git .omega _build node_modules target`. A scan is a map.
`diff` of two scans gives added / modified / deleted, and pairs a deleted and an added path with the same inode
as a rename (`mv` keeps the inode; `sed -i` and `cargo fmt` write a new file and rename it over the old one, so
they appear as a modification with a new inode, not as a rename). Only changed files are hashed (SHA-256),
and only when the caller asks.

Erlang's `file_info` carries mtime in whole **seconds** (`{:time :native}` is rejected by this pin, observed:
`{:error, :badarg}`), so same-second same-size rewrites are the correctness problem. Git's fix is the "racy"
rule: an entry whose mtime is not strictly older than the scan time cannot be trusted, so keep a content hash for
it and re-hash it next time. `scan` takes the previous state and does exactly that, with a one second margin
because the kernel's coarse clock can lag `system_time`.

```beam-lisp
(def SKIP #{".git" ".omega" "_build" "node_modules" "target"})

(defn stat-of
  "[size mtime inode type] of `p` without following symlinks, or nil if it vanished."
  [p]
  (let [r (file/read_link_info p (to-list [:raw (tuple :time :posix)]))]
    (if (= :ok (erlang/element 1 r))
      (let [i (erlang/element 2 r)] [(erlang/element 2 i) (erlang/element 6 i) (erlang/element 12 i) (erlang/element 3 i)])
      nil)))

(defn list-dir [dir]
  (try (filter (fn [n] (not (contains? SKIP n))) (File/ls! dir)) (catch e [])))

(defn walk
  "Sequentially: {rel [size mtime inode]} of every non-directory under `dir` (rel is dir's own relative path)."
  [dir rel acc]
  (reduce (fn [acc n]
            (let [p (str dir "/" n) r (if (= rel "") n (str rel "/" n)) s (stat-of p)]
              (cond (nil? s) acc
                    (= (nth s 3) :directory) (walk p r acc)
                    :else (assoc acc r (subvec s 0 3)))))
          acc (list-dir dir)))

(defn expand
  "Breadth-first until there are at least `want` directories to hand out: [files-found frontier]."
  [root want]
  (loop [frontier [[root ""]] files {}]
    (if (or (>= (count frontier) want) (empty? frontier)) [files frontier]
      (let [step (reduce (fn [[fs next] [dir rel]]
                           (reduce (fn [[fs next] n]
                                     (let [p (str dir "/" n) r (if (= rel "") n (str rel "/" n)) s (stat-of p)]
                                       (cond (nil? s) [fs next]
                                             (= (nth s 3) :directory) [fs (conj next [p r])]
                                             :else [(assoc fs r (subvec s 0 3)) next])))
                                   [fs next] (list-dir dir)))
                         [files []] frontier)]
        (if (empty? (second step)) [(first step) []] (recur (second step) (first step)))))))

(defn stat-tree
  "Every file under root: sequential when `par` is 1, else `par` concurrent walkers over the directory frontier."
  [root par]
  (if (<= par 1) (walk root "" {})
    (let [[files frontier] (expand root (* 4 par))
          parts (Enum/map (Enum/to_list (Task/async_stream frontier (fn [[d r]] (walk d r {}))
                                                           (to-list [(tuple :max_concurrency par) (tuple :ordered false) (tuple :timeout 60000)])))
                          (fn [x] (erlang/element 2 x)))]
      (reduce merge files parts))))

(defn hash-file [p] (try (crypto/hash :sha256 (File/read! p)) (catch e nil)))

(defn scan
  "New scan state {:m stats :racy {rel hash} :t second} from `prev` (or nil). Entries whose mtime is within a
   second of the scan start are RACY: hashed now, re-hashed by the next `changes`."
  [root par]
  (let [t (erlang/system_time :second)
        m (stat-tree root par)
        racy (into {} (map (fn [[p [_ mt _]]] [p (hash-file (str root "/" p))]) (filter (fn [[_ [_ mt _]]] (>= mt (dec t))) m)))]
    {:m m :racy racy :t t}))

(defn changes
  "Diff two scan states under `root` → {:added :modified :deleted :renamed [[from to]] :racy-hits n}. `modified`
   = stat differs OR (was racy and its content hash differs now). Uses the Erlang `maps` functions on purpose:
   a beam-lisp `filter` over 2,000 keys cost 15-25 ms here, `maps/filter` and `maps/without` 0.5-6 ms."
  [root prev cur]
  (let [pm (:m prev) cm (:m cur)
        added (maps/without (maps/keys pm) cm)
        deleted (maps/without (maps/keys cm) pm)
        stat-mod (maps/keys (maps/filter (fn [k v] (let [o (maps/get k pm nil)] (and (some? o) (not= o v)))) cm))
        racy-mod (filter (fn [p] (and (contains? cm p) (= (get pm p) (get cm p))
                                      (not= (get (:racy prev) p) (hash-file (str root "/" p)))))
                         (keys (:racy prev)))
        by-inode (into {} (map (fn [[p v]] [(nth v 2) p]) deleted))
        renamed (vec (filter some? (map (fn [[a v]] (let [d (get by-inode (nth v 2))] (when d [d a]))) added)))
        r-from (set (map first renamed)) r-to (set (map second renamed))]
    {:added (vec (filter (fn [p] (not (contains? r-to p))) (keys added)))
     :deleted (vec (filter (fn [p] (not (contains? r-from p))) (keys deleted)))
     :modified (vec (sort (concat stat-mod racy-mod)))
     :renamed renamed
     :racy-hits (count racy-mod)}))

(defn changed-paths [c] (vec (sort (concat (:added c) (:modified c) (:deleted c) (map second (:renamed c)) (map first (:renamed c))))))
```

### 1a. What a scan costs

Warm = the kernel dentry/inode cache is hot (it is, right after the fixture was written). The first sequential
scan below is that warm figure too; a truly cold cache cannot be produced without root, so the cold number is
from a one-off shell `find` run noted in the findings, not from this run.

```beam-lisp
(defn bench-scan [root par n]
  (let [ts (vec (map (fn [_] (first (timed (fn [] (scan root par))))) (range n)))]
    {:min (apply min ts) :p50 (median ts) :max (apply max ts)}))

(let [seq1 (bench-scan BIG 1 5)
      par2 (bench-scan BIG 2 5)
      par4 (bench-scan BIG 4 5)
      par8 (bench-scan BIG 8 5)
      tiny (bench-scan TINY 1 20)
      st (scan BIG 1)
      [t-hash h] (timed (fn [] (doall (map (fn [p] (hash-file (str BIG "/" p))) (take 20 (sort (keys (:m st))))))))
      [t-read _] (timed (fn [] (doall (map (fn [p] (File/read! (str BIG "/" p))) (take 20 (sort (keys (:m st))))))))]
  (println "OBSERVED scan of BIG (" (count (:m st)) "files; racy-hashed" (count (:racy st)) "), ms {min p50 max}:")
  (println "  sequential" seq1)
  (println "  2 walkers " par2)
  (println "  4 walkers " par4)
  (println "  8 walkers " par8)
  (println "OBSERVED scan of TINY (22 files):" tiny)
  (println "OBSERVED read+sha256 of 20 files (15 KB each):" t-hash "ms (read alone" t-read "ms)")
  (println "OBSERVED an identical re-scan reports zero changes:" (changed-paths (changes BIG st (scan BIG 1)))))
```

### 1b. Same-second rewrites, the racy rule

Write a file, scan, rewrite it **in place with the same size** immediately (same millisecond window, so the
same second and same mtime), scan again. Naive stat comparison cannot see it; the racy-aware `changes` can. Also
`sed -i` with the same size (new inode through rename) and a delete + recreate with the same name.

```beam-lisp
(defn naive-changes [prev cur]
  (vec (sort (filter (fn [p] (not= (get (:m prev) p) (get (:m cur) p))) (set (concat (keys (:m prev)) (keys (:m cur))))))))

(let [f (str TINY "/racy.txt")
      _ (File/write! f "aaaaaaaa")
      s0 (scan TINY 1)
      _ (File/write! f "bbbbbbbb")
      s1 (scan TINY 1)]
  (println "OBSERVED same-ms in-place rewrite, same size: stat-only sees" (naive-changes s0 s1)
           "| racy-aware sees" (changed-paths (changes TINY s0 s1)) "(racy hits:" (:racy-hits (changes TINY s0 s1)) ")")
  (File/write! f "cccccccc")
  (sh-in! TINY "sed -i s/c/d/ racy.txt")
  (let [s2 (scan TINY 1)]
    (println "OBSERVED same-second `sed -i` (same size, new inode): stat-only sees" (naive-changes s1 s2)
             "| racy-aware sees" (changed-paths (changes TINY s1 s2))))
  (let [s2 (scan TINY 1)
        _ (File/rm! f)
        _ (File/write! f "dddddddd")
        s3 (scan TINY 1)]
    (println "OBSERVED delete + recreate, same size, same second: stat-only sees" (naive-changes s2 s3)
             "| racy-aware sees" (changed-paths (changes TINY s2 s3))
             "(the recreated file got a new inode, which the stat tuple carries)"))
  ;; once the clock has moved on, an old entry is not racy any more: no hashing for it
  (let [old (str TINY "/old.txt") _ (File/write! old "x") _ (Process/sleep 2300) s (scan TINY 1)]
    (println "OBSERVED a file older than the scan second is not hashed (racy set after 2.3 s):" (sort (keys (:racy s))) "- stable files cost only a stat")))
```

### 1c. Deletes, renames, a realistic mixed eval

A `git checkout`-like churn on BIG: modify 5 files, delete 3, rename 2 (same inode), add 3, a directory
removed with its files. The diff must classify all of it.

```beam-lisp
(let [s0 (scan BIG 1)
      _ (sh-in! BIG "echo more >> src/d5/f5.txt; echo more >> src/d9/f1.txt; sed -i s/line/LINE/ src/d12/f2.txt; echo x >> README.md; echo y >> Makefile;
                     rm src/d7/f2.txt src/d7/f3.txt src/d8/f0.txt; mv src/d6/f1.txt src/d6/f1b.txt; mv src/d20/f4.txt src/d21/f4moved.txt;
                     echo a > new1.txt; echo b > src/d1/new2.txt; mkdir src/dnew && echo c > src/dnew/new3.txt; rm -r src/d30")
      [t s1] (timed (fn [] (scan BIG 1)))
      [td c] (timed (fn [] (changes BIG s0 s1)))]
  (println "OBSERVED mixed churn, scan" t "ms, diff" td "ms:")
  (println "  added   " (:added c))
  (println "  modified" (:modified c))
  (println "  deleted " (count (:deleted c)) "(3 rm'd + the 10 files of the removed src/d30):" (take 4 (:deleted c)) "…")
  (println "  renamed " (:renamed c)))
```

### 1d. Keeping the stat map in a process (the git-index trick)

The scan cost above is the cost of re-stat'ing 2,000 files that did not change. Git pays the same cost for
`git status` and has no way around it except a watcher (fsmonitor). What the stat cache buys is not a cheaper
scan, only that the *before* snapshot of eval N+1 is the *after* snapshot of eval N: one scan per eval, not two,
and the scan is a plain stat walk with no hashing. Section 5 keeps the state in one server and measures the
whole before/after cost. Parallel walkers are not a win on this host (observed above: 2-8 walkers are several
times *slower* than the sequential walk; the file server is one process), so the scanner stays sequential.

## 2. Candidate 2: an OS watcher (inotify)

`beam-lisp` already depends on the `file_system` library (`FileSystem/start_link`, used by
`BeamLisp.ReloadWatcher`, `priv/host/reload_watcher.bl`). On Linux its backend runs the `inotifywait` binary
(`/usr/bin/inotifywait` is installed here) as a port and forwards `{:file_event, pid, {path, events}}` messages
to the subscriber. So: available, no install, Linux/BSD only (macOS uses fsevents, Windows its own backend) and it
needs an `inotifywait` executable on `PATH`. Questions: setup cost, event latency, what it reports, whether it
loses events in a freshly created directory, and who did it.

```beam-lisp
(defn drain
  "All {:path :ev} events that arrive until `quiet` ms pass without one."
  [quiet]
  (loop [acc []]
    (receive [:file_event _ [p ev]] (recur (conj acc {:path p :ev ev}))
             (after quiet acc))))

(defn watch-start!
  "Start a watcher on `dir` and wait until it is really armed (inotifywait is slow to establish watches):
   probe by writing until an event arrives. → [pid armed-ms]"
  [dir]
  (let [t0 (now-us)
        pid (erlang/element 2 (FileSystem/start_link (to-list [(tuple :dirs (to-list [dir]))])))
        _ (FileSystem/subscribe pid)
        probe (str dir "/.probe")
        armed (loop [n 0]
                (File/write! probe (str n))
                (let [m (receive [:file_event _ _] :ok (after 25 nil))]
                  (cond (some? m) (ms-since t0) (> n 400) :never :else (recur (inc n)))))]
    (drain 200)
    (File/rm! probe)
    (drain 200)
    [pid armed]))

(def W-TINY (watch-start! TINY))
(def W-BIG (watch-start! BIG))
(println "OBSERVED watcher armed after (ms): TINY (22 files)" (second W-TINY) "| BIG (2,002 files, 232 dirs)" (second W-BIG))
```

Events per operation, latency from the write returning to the event arriving. Events are not tagged with a
writer.

```beam-lisp
(let [t0 (now-us)
      _ (File/write! (str BIG "/lat.txt") "x")
      e (receive [:file_event _ [p ev]] [p ev (ms-since t0)] (after 2000 nil))]
  (println "OBSERVED latency, write returned -> first event:" (nth e 2) "ms; event" (take 2 e))
  (drain 150))
(let [lat (vec (map (fn [i] (let [t0 (now-us) _ (File/write! (str BIG "/lat.txt") (str i))
                                  e (receive [:file_event _ _] (ms-since t0) (after 2000 nil))]
                              (drain 5) e))
                    (range 30)))]
  (println "OBSERVED event latency over 30 writes (ms): p50" (median lat) "max" (apply max lat)))
(drain 100)
(sh-in! BIG "echo a > ev1; echo b >> ev1; mv ev1 ev2; rm ev2; sed -i s/line/LINE/ README.md; mkdir -p nd/a/b && echo 1 > nd/a/b/f1 && echo 2 > nd/f2")
(let [evs (drain 400)]
  (println "OBSERVED events for create/append/mv/rm/sed -i/mkdir -p+2 files (" (count evs) "events):")
  (doseq [e (take 24 evs)] (println "   " (rel-of BIG (:path e)) (:ev e))))
```

New-directory race. inotify watches are per directory; a recursive watcher adds a watch for a new directory only
after it sees the directory's creation event, so a file written into `a/b/` an instant later can be missed (a
known inotify limitation). Test: 60 iterations of `mkdir -p d/x/y && echo > d/x/y/f`, count files the watcher
never reported.

```beam-lisp
(let [n 60
      _ (sh-in! BIG "rm -rf burst; mkdir burst")
      _ (drain 300)
      _ (sh-in! BIG (str "for i in $(seq 1 " n "); do mkdir -p burst/d$i/x/y && echo hi > burst/d$i/x/y/f; done"))
      evs (drain 600)
      seen (set (map (fn [e] (rel-of BIG (:path e))) (filter (fn [e] (not (contains? (set (:ev e)) :created))) evs)))
      reported (count (filter (fn [i] (contains? seen (str "burst/d" i "/x/y/f"))) (range 1 (inc n))))]
  (println "OBSERVED new-directory race: files created inside just-created directories" n
           "| reported by the watcher" reported "| missed" (- n reported)))
```

The attribution race, concretely. Two cells (processes) run at once in one working copy. Cell A writes
`cell-a.txt`, cell B writes `cell-b.txt` a millisecond later, both through plain `File/write!` (an `sh` would look
the same to the kernel). The watcher sees both events and no cell id.

```beam-lisp
(let [me (erlang/self)
      _ (drain 100)
      run-cell (fn [name path delay]
                 (erlang/spawn (fn []
                                 (let [t0 (now-us)]
                                   (Process/sleep delay)
                                   (File/write! path "x")
                                   (Process/sleep 20)
                                   (erlang/send me [:cell-done name t0 (now-us)])))))
      _ (run-cell :A (str TINY "/cell-a.txt") 5)
      _ (run-cell :B (str TINY "/cell-b.txt") 6)
      done (loop [acc {}] (if (= 2 (count acc)) acc (receive [:cell-done n a b] (recur (assoc acc n [a b])) (after 2000 acc))))
      evs (drain 200)]
  (println "OBSERVED two concurrent cells, events seen:" (vec (map (fn [e] [(rel-of TINY (:path e)) (first (:ev e))]) evs)))
  (println "         an event has no writer field, keys =" (keys (first evs)) "| the cells' windows overlap:"
           (let [[a0 a1] (:A done) [b0 b1] (:B done)] (and (< a0 b1) (< b0 a1))))
  (sh! (str "rm -f " TINY "/cell-a.txt " TINY "/cell-b.txt"))
  (drain 200))
```

A watcher is also a standing cost: one `inotifywait` OS process, one inotify watch per directory
(`max_user_watches` is 524,288 here), and every `.git`/`target`/`node_modules` event reaches the beam-lisp side
because the library has no exclude list (the filter has to be in lisp). The flood a `git status`+`add`+`commit`
in BIG causes:

```beam-lisp
(let [_ (drain 100)
      _ (sh-in! BIG "git status --porcelain >/dev/null; git add -A; git -c user.email=a@b -c user.name=n commit -qm x --allow-empty")
      evs (drain 400)
      in-git (count (filter (fn [e] (clojure.string/includes? (:path e) "/.git/")) evs))]
  (println "OBSERVED `git status; git add -A; git commit` produced" (count evs) "watcher events,"
           in-git "under .git (the library cannot exclude them)"))
```

## 3. Candidate 3: wrapping the BEAM file calls (call tracing of the cell)

What can intercept a BEAM-level file call?

- **Redefine `File/write!` etc.** Elixir's `File` is a compiled module. Redefining it with `eval_string` would
  catch only callers that go through *that* function, not `:file.write_file`, not `:prim_file`, and it patches
  every process, not the cell. Rejected: leaky and global.
- **Replace the group leader / the `:file_server_2` process.** The file server really is a single named process
  (`:file_server_2`; observed in the pilot: a `receive` trace on it shows `{:open, path, modes}`,
  `{:rename, a, b}`, `{:delete, p}`, `{:make_dir, d}` as ordinary `$gen_call` messages), so a tracer on it sees
  every *non-raw* file operation of every process, in order. But it cannot tell which cell sent it (the `from` is
  a pid, mappable), and it is blind to `raw` files and to `prim_file` called directly, which are NIF calls from
  the caller's own process and never touch the server. The server also receives the beam-lisp loader's reads.
- **`erlang:trace` with call tracing on the cell process** (`:call` flag + `:set_on_spawn`), with trace patterns
  on the `file` and `prim_file` exports. Calls happen in the *calling* process, so raw and NIF-backed calls are
  caught as the `prim_file` call, and the message is tagged with the traced pid, which is exactly the cell (and
  any process it spawned, through `set_on_spawn`). This is the one prototyped here.

Hook point: the cell's own preamble (`codemode/preamble`) calls `(trace-self! task cell)` once, before the user
code, since the cell process is created inside `harness/eval-cell` where the caller cannot reach it. The trace
messages go to a collector process; `erlang:trace_delivered/1` is the settle barrier after the cell ends. The
patterns are installed once at boot.

```beam-lisp
(def WRITE-MODES #{:write :append :exclusive :read_write})

(defn ->str [p] (cond (erlang/is_binary p) p (erlang/is_list p) (try (unicode/characters_to_binary p) (catch e (str p))) :else (str p)))

(defn classify
  "One call-trace message payload {m f args} → [kind path…] or nil when it does not change the filesystem.
   Directories are [:dir p] (the history tracks files)."
  [m f args]
  (let [a1 (first args) a2 (second args)]
    (cond
      (contains? #{:write_file :write_file_info :make_symlink :make_link :truncate} f) [:write (->str a1)]
      (contains? #{:make_dir :del_dir} f) [:dir (->str a1)]
      (= f :open) (when (some (fn [x] (contains? WRITE-MODES x)) (if (list? a2) a2 [])) [:write (->str a1)])
      (= f :delete) [:delete (->str a1)]
      (= f :rename) [:rename (->str a1) (->str a2)]
      ;; file:copy(Src, Dest) where either may be {Path, Modes}
      (= f :copy) (when (not (erlang/is_pid a1)) [:write (->str (if (erlang/is_tuple a2) (erlang/element 1 a2) a2))])
      :else nil)))

(defn collector
  "Process that collects classified trace events per cell until told to take them."
  []
  (erlang/spawn
    (fn []
      (loop [evs [] procs 0]
        (receive
          [:trace pid :call [m f args]]
            (let [c (if (and (= m :erlang) (= f :open_port)) [:os-process] (classify m f args))]
              (recur (if c (conj evs c) evs) procs))
          [:take from] (do (erlang/send from [:taken evs]) (recur [] procs)))))))

(defn install-patterns!
  "Enable call tracing for the file-changing exports, once, VM-wide. Only processes that opted in with
   `trace-self!` produce messages."
  []
  (doseq [[m f a] [[:file :write_file 2] [:file :write_file 3] [:file :open 2] [:file :delete 1] [:file :rename 2]
                   [:file :make_dir 1] [:file :del_dir 1] [:file :copy 2] [:file :make_symlink 2] [:file :write_file_info 2]
                   [:file :truncate 1]
                   [:prim_file :write_file 2] [:prim_file :open 2] [:prim_file :delete 1] [:prim_file :rename 2]
                   [:prim_file :make_dir 1] [:prim_file :del_dir 1] [:prim_file :write_file_info 3]
                   [:erlang :open_port 2]]]
    (erlang/trace_pattern (tuple m f a) true (to-list [:global]))))

(defn trace-self!
  "Called from inside the cell: its calls, and those of every process it spawns, go to `col`."
  [col]
  (erlang/trace (erlang/self) true (to-list [:call :set_on_spawn (tuple :tracer col)])))

(defn settle!
  "Barrier: every trace message of finished/ongoing processes has reached the collector, then take them."
  [col]
  (erlang/trace_delivered :all)
  (receive [:trace_delivered _ _] :ok (after 2000 :timeout))
  (erlang/send col [:take (erlang/self)])
  (receive [:taken evs] evs (after 2000 :no-collector)))

(defn run-cell
  "Run `f` in a fresh process (like harness/eval-cell does), traced → [events value]."
  [col f]
  (let [me (erlang/self)
        _ (erlang/spawn (fn [] (trace-self! col) (erlang/send me [:cell-result (try (f) (catch e [:threw e]))])))
        v (receive [:cell-result v] v (after 10000 :timeout))]
    [(settle! col) v]))

(install-patterns!)
(def COL (collector))
```

What it sees, one cell calling everything a cell might call. `child` is a process the cell spawns that writes too.

```beam-lisp
(def T3 "/tmp/omega-fs-capture-t3")
(sh! (str "rm -rf " T3 "; mkdir -p " T3 "; echo seed > " T3 "/seed.txt; echo seed2 > " T3 "/seed2.txt"))

(let [[evs v] (run-cell COL
  (fn []
    (File/write! (str T3 "/a1.txt") "x")                                    ; Elixir File
    (file/write_file (str T3 "/a2.txt") "x")                                ; Erlang :file
    (file/write_file (str T3 "/a3.txt") "x" (to-list [:raw]))               ; raw flag
    (let [fd (file/open (str T3 "/a4.txt") (to-list [:write :raw])) _ (file/write (erlang/element 2 fd) "abc") _ (file/close (erlang/element 2 fd))] :ok)
    (prim_file/write_file (str T3 "/a5.txt") "x")                           ; NIF layer directly
    (File/rename! (str T3 "/seed.txt") (str T3 "/seed-moved.txt"))
    (File/rm! (str T3 "/seed2.txt"))
    (File/mkdir_p! (str T3 "/sub/dir"))
    (File/cp! (str T3 "/a1.txt") (str T3 "/a6.txt"))
    (File/rm_rf! (str T3 "/sub"))
    (let [me (erlang/self) _ (erlang/spawn (fn [] (File/write! (str T3 "/from-child.txt") "x") (erlang/send me :child-done)))]
      (receive :child-done :ok (after 2000 :no-child)))
    (File/read! (str T3 "/a1.txt"))                                          ; a read: must not appear
    (file/open (str T3 "/a1.txt") (to-list [:read]))                         ; a read-mode open: must not appear
    (System/cmd "sh" (list "-c" (str "echo hi > " T3 "/from-sh.txt")))      ; an OS process: invisible except as :os-process
    :done))
      paths (sort (distinct (map (fn [p] (rel-of T3 p))
                                 (mapcat rest (filter (fn [e] (contains? #{:write :delete :rename} (first e))) evs)))))
      real (sort (map (fn [p] (rel-of T3 p)) (clojure.string/split (clojure.string/trim (:out (sh! (str "find " T3 " -type f")))) "\n")))]
  (println "OBSERVED cell returned" v "; trace saw" (count evs) "events")
  (println "OBSERVED paths the trace attributes to the cell (writes/deletes/renames/dirs):" (vec paths))
  (println "OBSERVED an OS process was seen as an opaque event:" (boolean (some (fn [e] (= [:os-process] e)) evs)))
  (println "OBSERVED files on disk afterwards:" (vec real))
  (println "OBSERVED on disk but NOT in the trace (what BEAM wrapping cannot see):"
           (vec (filter (fn [p] (not (contains? (set paths) p))) real))))
```

Cost, three ways: a traced cell doing 300 `File/write!`; the same untraced after the patterns are installed
(patterns are VM-wide: does an *untraced* process pay?); and with the patterns removed.

```beam-lisp
(defn burst [n] (fn [] (doseq [i (range n)] (File/write! (str T3 "/b" (rem i 10) ".txt") "x")) :ok))
(let [col (collector)
      traced (vec (map (fn [_] (first (timed (fn [] (run-cell col (burst 300)))))) (range 5)))
      untraced-with (vec (map (fn [_] (first (timed (burst 300)))) (range 5)))
      _ (doseq [[m f a] [[:file :write_file 2] [:file :write_file 3] [:file :open 2] [:prim_file :write_file 2] [:prim_file :open 2]]]
          (erlang/trace_pattern (tuple m f a) false (to-list [:global])))
      untraced-without (vec (map (fn [_] (first (timed (burst 300)))) (range 5)))]
  (install-patterns!)
  (println "OBSERVED 300 File/write! (ms): traced cell p50" (median traced) "| untraced, patterns on p50" (median untraced-with)
           "| untraced, patterns off p50" (median untraced-without)))
```

## 4. Candidate 4: subprocess-level capture

The BEAM-level wrap is blind to `sh` (observed above). What is installed here: `strace` (yes), `inotifywait` (yes),
`bwrap` (no), `gcc` (yes, so an `LD_PRELOAD` shim *could* be compiled, but statically linked tools such as many Go
and Rust binaries bypass libc, and nothing may be installed), `unshare` with user namespaces (works unprivileged:
`unshare -Urm` mounted an overlayfs). Options:

| mechanism | sees | misses | cost |
|---|---|---|---|
| `strace -f -e trace=…` | every syscall of the process tree, by absolute path (`-y` resolves fds) | needs `ptrace` (Yama scope 1 allows child tracing: works); processes that detach (`setsid`, double fork) are still followed by `-f`; `strace -f` waits for backgrounded children that inherit its pipe | per-syscall ptrace stop: see below |
| `LD_PRELOAD` shim | libc `open/rename/unlink` calls | static binaries, direct syscalls (Go), `io_uring`; needs a C compiler or a shipped `.so` | tiny per call, but a build step and a platform dependency |
| overlayfs in a user namespace (`unshare -Urm`, `mount -t overlay`) | everything, by construction: the upper dir IS the change set (new files, modified files, whiteouts for deletes) | needs unprivileged userns + overlayfs (works here; common distros disable it, macOS has none); the agent's `sh` would see the *overlay path*, not the real tree, which changes `pwd`, absolute paths, and breaks watchers and `git` worktrees pointing at the real path; copy-up of a file on first write | one mount per command |
| per-command stat snapshot of the cwd only | changes under the cwd | writes outside the cwd; no better than candidate 1 | same as candidate 1 |
| inotify around the command | everything under the root | attribution (section 2) | a standing watcher |

Measure strace and the overlay on a `sed -i` loop and on `git status` over BIG:

```beam-lisp
(defn wall [dir cmd n]
  (median (vec (map (fn [_] (first (timed (fn [] (sh-in! dir cmd))))) (range n)))))

(let [loop-cmd "for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do sed -i s/line/LINE/ src/d2/f$((i%10)).txt; sed -i s/LINE/line/ src/d2/f$((i%10)).txt; done"
      FILE-SYS "openat,open,creat,rename,renameat,renameat2,unlink,unlinkat,mkdir,mkdirat,rmdir,truncate,symlink,symlinkat,link,linkat"
      st (fn [c] (str "strace -f -qq -y -o /tmp/omega-fs-capture-strace.out -e trace=" FILE-SYS " sh -c '" c "'"))
      plain-sed (wall BIG loop-cmd 5)
      strace-sed (wall BIG (st loop-cmd) 5)
      plain-git (wall BIG "git status --porcelain" 5)
      strace-git (wall BIG (st "git status --porcelain") 5)]
  (println "OBSERVED 40 `sed -i` runs: plain" plain-sed "ms | under strace -f" strace-sed "ms (x" (/ (Float/round (* 10.0 (/ strace-sed plain-sed))) 10.0) ")")
  (println "OBSERVED `git status` over 2,002 files: plain" plain-git "ms | under strace -f" strace-git "ms (x" (/ (Float/round (* 10.0 (/ strace-git plain-git))) 10.0) ")")
  (println "OBSERVED strace log of the git status, lines:" (clojure.string/trim (:out (sh! "wc -l < /tmp/omega-fs-capture-strace.out"))))
  (let [bg-plain (first (timed (fn [] (sh-in! BIG "sleep 2 & echo hi"))))
        bg-strace (first (timed (fn [] (sh-in! BIG (st "sleep 2 & echo hi")))))
        bg-strace-d (first (timed (fn [] (sh-in! BIG (str "strace -D -f -qq -o /tmp/omega-fs-capture-strace.out -e trace=openat sh -c 'sleep 2 & echo hi'")))))]
    (println "OBSERVED a backgrounded `sleep 2 &` : plain" bg-plain "ms | strace -f" bg-strace "ms (waits for the child) | strace -D -f" bg-strace-d "ms (detaches the tracer, still follows)")))
```

What strace output looks like for a realistic mutation, and the parse the hook would run: `sed -i` is
`openat(O_CREAT|O_EXCL) x/sedXXXX` then `rename(x/sedXXXX, x/f)`, so the changed path is the rename *target*; the
temp name must be dropped when it no longer exists. Relative paths resolve against the process cwd that `-y` shows
in `AT_FDCWD</dir>`.

```beam-lisp
(def T4 "/tmp/omega-fs-capture-t4")
(sh! (str "rm -rf " T4 "; mkdir -p " T4 "/x; echo a > " T4 "/x/f; echo b > " T4 "/x/g"))
(let [log "/tmp/omega-fs-capture-t4.strace"
      _ (sh-in! T4 (str "strace -f -qq -y -o " log " -e trace=openat,rename,renameat2,unlink,unlinkat,mkdir,symlinkat sh -c "
                        "'sed -i s/a/A/ x/f; mv x/g x/h; rm x/h; echo q > x/q; mkdir -p x/d/e; cp x/f x/f2; ln -s f x/l; cd x && echo r > rel'"))
      lines (clojure.string/split (:out (sh! (str "cat " log))) "\n")
      ;; a successful mutation: openat with a write flag, or rename/unlink/mkdir/symlink, result >= 0 (not = -1)
      writes (filter (fn [l] (and (not (re-find #"= -1 " l))
                                  (or (re-find #"openat\(.*O_(WRONLY|RDWR)" l) (re-find #" (rename|renameat2|unlinkat|unlink|mkdir|symlinkat)\(" l))))
                     lines)
      pick (fn [l] (or (nth (re-find #"= \d+<(/[^>]*)>$" l) 1 nil)
                       (when (re-find #"unlink|rename|mkdir|symlink" l) (nth (re-find #"\"([^\"]+)\"[^\"]*(?:, \d+)?\)\s+= 0" l) 1 nil))))]
  (println "OBSERVED mutating syscalls strace saw (" (count writes) "of" (count lines) "lines):")
  (doseq [l writes] (println "   " (subs l 0 (min 150 (count l))))))
```

Overlayfs, for completeness. The same `sed`/`rm`/`mv` churn inside a user-namespace overlay; the upper directory
is the exact change set, whiteout character devices mark deletes.

```beam-lisp
(let [ov "/tmp/omega-fs-capture-ov"
      _ (sh! (str "rm -rf " ov "; mkdir -p " ov "/l " ov "/u " ov "/w " ov "/m; cp -r " BIG "/src " ov "/l/"))
      [t r] (timed (fn [] (sh! (str "unshare -Urm sh -c 'mount -t overlay overlay -o lowerdir=" ov "/l,upperdir=" ov "/u,workdir=" ov "/w " ov "/m && cd " ov "/m && "
                                    "sed -i s/line/LINE/ src/d2/f3.txt && echo n > src/new && rm src/d3/f1.txt && mv src/d4/f2.txt src/d4/f2b.txt'"))))
      up (sh! (str "cd " ov "/u && find . \\( -type f -o -type c \\) | sort"))]
  (println "OBSERVED overlay-in-userns run:" t "ms, exit" (:exit r) "| upper dir holds exactly:" (vec (clojure.string/split (clojure.string/trim (:out up)) "\n")))
  (println "         (f1.txt and f2.txt appear as whiteout devices = deletes; f2b.txt is the rename target)"))
```

## 5. The hybrid: trace claims + scan only when a cell ran an OS process, windows decide ambiguity

Design, from sections 1-4:

- Exact for everything BEAM-level: the trace of section 3 (also covers `prelude/write` and `edit`, which end in
  `File/write!`, so the existing recorder of `async-checkpoint` becomes redundant).
- The trace also reports `:os-process` (an `open_port` of the cell, which is every `sh`). Only such a cell is
  scanned: one stat walk before, one after. A pure-BEAM cell costs the trace only, no walk.
- Concurrency: a **window server** gives every cell a begin and an end on one logical clock; at the end it
  answers which other cells' windows overlapped. Attribution of a changed path `p` seen in cell `c`'s diff:
  candidates are `c` and every window-overlapping cell that either *claimed* `p` through its trace or ran an OS
  process; if any candidate claimed `p` the claimers own it exactly, else the OS-process candidates share it and it
  is marked `:ambiguous`; if there is no candidate at all, nobody in omega touched it: `:external`.

```beam-lisp
(defserver windows
  (init [_] (ok {:seq 0 :open {} :closed {}}))
  (handle-call [:begin id task] [_from st]
    (let [n (inc (:seq st))]
      (reply n (-> st (assoc :seq n) (assoc-in [:open id] {:task task :b n})))))
  (handle-call [:end id] [_from st]
    (let [n (inc (:seq st))
          w (assoc (get-in st [:open id]) :e n)
          others (concat (map (fn [[k v]] k) (filter (fn [[k v]] (not= k id)) (:open st)))
                         (map (fn [[k v]] k) (filter (fn [[k v]] (> (:e v) (:b w))) (:closed st))))]
      (reply {:overlaps (vec others) :b (:b w) :e n}
             (-> st (assoc :seq n) (update :open dissoc id) (assoc-in [:closed id] w))))))

(defn attribute
  "cells: [{:id :task :overlaps [ids] :claims #{rel} :os? bool :changed [rel…]}] → {rel {:owners [task…] :how}}.
   :how is :trace (exact), :scan (an OS-process cell is the only candidate), :ambiguous (several OS-process
   candidates, or an OS-process cell that cannot rule out a writer outside omega), or :external."
  [cells]
  (let [by-id (into {} (map (fn [c] [(:id c) c]) cells))
        views (mapcat (fn [c]
                        (let [pool (cons c (map (fn [i] (get by-id i)) (:overlaps c)))]
                          (map (fn [p]
                                 (let [claimers (filter (fn [x] (contains? (:claims x) p)) pool)
                                       os (filter (fn [x] (:os? x)) pool)]
                                   [p (cond (seq claimers) {:owners (map :task claimers) :how :trace}
                                            (empty? os) {:owners [] :how :external}
                                            (= 1 (count (distinct (map :task os)))) {:owners [(:task (first os))] :how :scan :alone? (= 1 (count pool))}
                                            :else {:owners (map :task os) :how :ambiguous})]))
                               (:changed c))))
                      cells)]
    (reduce (fn [acc [p v]]
              (update acc p (fn [old] (if (nil? old) v {:owners (vec (distinct (concat (:owners old) (:owners v))))
                                                       :how (if (= (:how old) :trace) :trace (:how v))}))))
            {} views)))
```

A cell runner: begin → (scan if the cell will run an OS process; we cannot know in advance, so the *before* scan
is taken lazily: the first `:os-process` trace event triggers it, and from then on `sh` sees it) ... that is too
clever for the hook point, because the scan must precede the command. A simpler honest rule is used here: take the
before-scan at cell start from the **stat cache** (the previous eval's after-scan, kept in the server) and take
only the after-scan, and only if the trace saw an `open_port`. Cost per OS-process eval is then one walk. The
price: whatever changed between the previous eval's after-scan and this cell's start (a human, a daemon, another
task's pure-BEAM write) is also in the diff; that is the same `:external` question as before and the claims rule
handles it for BEAM writes.

```beam-lisp
(defserver cache
  (init [root] (ok {:scan nil :root root}))
  (handle-call [:get] [_from st] (reply (:scan st) st))
  (handle-call [:put sc] [_from st] (reply :ok (assoc st :scan sc))))

(defn run-window
  "One simulated cell of `task` with its OWN collector (one shared collector merges the cells' events, which
   the first draft of this spike did, and attributed everything to one cell): window begin, run `f` traced, scan after iff it ran an OS process, window end."
  [wsrv csrv root task f]
  (let [col (collector)
        id (str task "-" (erlang/unique_integer (to-list [:positive])))
        _ (call wsrv [:begin id task])
        before (call csrv [:get])
        [evs v] (run-cell col f)
        os? (boolean (some (fn [e] (= [:os-process] e)) evs))
        claims (set (map (fn [p] (rel-of root p)) (mapcat rest (filter (fn [e] (contains? #{:write :delete :rename} (first e))) evs))))
        after (when os? (scan root 1))
        changed (if os? (changed-paths (changes root before after)) [])
        _ (when os? (call csrv [:put after]))
        w (call wsrv [:end id])]
    {:id id :task task :overlaps (:overlaps w) :claims claims :os? os? :changed changed :us 0}))

(def T5 "/tmp/omega-fs-capture-t5")
(make-tree! T5 4 5)

(let [wsrv (start windows nil {})
      csrv (start cache T5 {})
      _ (call csrv [:put (scan T5 1)])
      me (erlang/self)
      go (fn [task f delay]
           (erlang/spawn (fn [] (Process/sleep delay) (erlang/send me [:cell (run-window wsrv csrv T5 task f)]))))
      slow (fn [ms] (Process/sleep ms))
      ;; A: BEAM write + sh (sed -i, new file), lasts ~300 ms
      _ (go "t-A" (fn [] (File/write! (str T5 "/a-trace.txt") "a") (slow 100)
                    (sh-in! T5 "echo a > a-sh.txt; sed -i s/line/LINE/ src/d1/f1.txt") (slow 200) :ok) 0)
      ;; B: sh rm + sh new file + BEAM write; overlaps A
      _ (go "t-B" (fn [] (slow 50) (sh-in! T5 "echo b > b-sh.txt; rm src/d2/f2.txt") (File/write! (str T5 "/b-trace.txt") "b") (slow 150) :ok) 20)
      ;; D: pure BEAM, overlaps A, no OS process → never scanned
      _ (go "t-D" (fn [] (File/write! (str T5 "/d-trace.txt") "d") (slow 50) :ok) 120)
      ;; human: a plain OS write from outside omega, inside A's window
      _ (erlang/spawn (fn [] (Process/sleep 150) (sh-in! T5 "echo h > human.txt")))
      ;; C: alone, later; sh mv
      _ (go "t-C" (fn [] (sh-in! T5 "mv src/d3/f3.txt src/d3/f3m.txt") :ok) 1200)
      cells (vec (map (fn [_] (receive [:cell c] c (after 10000 nil))) (range 4)))
      res (attribute cells)]
  (println "OBSERVED cells (id, window overlaps, ran OS process?, trace claims, scan diff):")
  (doseq [c (sort-by :task cells)]
    (println "  " (:task c) "overlaps" (vec (map (fn [i] (first (clojure.string/split i "-"))) (:overlaps c))) "os?" (:os? c)
             "claims" (vec (sort (:claims c))) "scan-changed" (:changed c)))
  (println "OBSERVED attribution per path (truth: a-trace,a-sh,src/d1/f1 = A; b-trace,b-sh,d2/f2 = B; d-trace = D; human = outside; d3 mv = C):")
  (doseq [[p v] (sort-by first res)]
    (println "  " p "->" (vec (:owners v)) (:how v))))
```

### 5b. What each eval costs in the hybrid (BIG tree)

```beam-lisp
(let [col (collector)
      pure (vec (map (fn [_] (first (timed (fn [] (run-cell col (fn [] (File/write! (str BIG "/h.txt") "x") (File/write! (str BIG "/h2.txt") "y") :ok)))))) (range 20)))
      bare (vec (map (fn [_] (first (timed (fn [] (File/write! (str BIG "/h.txt") "x") (File/write! (str BIG "/h2.txt") "y"))))) (range 20)))
      _ (call (start cache BIG {}) [:put (scan BIG 1)])
      sh-only (vec (map (fn [_] (first (timed (fn [] (sh-in! BIG "echo hi > sh.txt"))))) (range 5)))
      sh-scan (vec (map (fn [_] (first (timed (fn [] (let [b (scan BIG 1) _ (sh-in! BIG "echo hi > sh.txt") a (scan BIG 1)] (changes BIG b a)))))) (range 5)))
      sh-cache (vec (map (fn [_] (first (timed (fn [] (let [_ (sh-in! BIG "echo hi > sh.txt") a (scan BIG 1)] a))))) (range 5)))]
  (println "OBSERVED pure-BEAM cell with 2 writes: traced" (median pure) "ms vs bare" (median bare) "ms")
  (println "OBSERVED `sh` eval on BIG: bare" (median sh-only) "ms | before+after scan + diff" (median sh-scan) "ms | stat cache (after scan only)" (median sh-cache) "ms")
  (sh! (str "rm -f " BIG "/h.txt " BIG "/h2.txt " BIG "/sh.txt")))
```

Last: how large does the checkpoint's share get? The async checkpoint of `spikes/async-checkpoint.bl.md` has a
5 ms budget on the task side and commits in a historian server. A scan of ~80 ms (BIG) cannot be on that path:
it has to run in the **cell's own process after `eval-cell` returns and before the `tool/after` hook** (the cell
already took 100 ms-seconds), or in the historian. The diff-and-hash of the changed paths goes to the historian
with the exact snapshot, like any step.

## Findings

Run: `bin/bl run spikes/fs-capture.bl.md` (exit 0; 3 consecutive executions, ranges below). Host: tmpfs `/tmp`, 4 online
schedulers, `strace` and `inotifywait` installed, no `bwrap`. BIG = 2,002 files / 31 MB / 232 dirs, TINY = 22 files.

### Tradeoff table

| | 1. snapshot diff | 2. inotify watcher | 3. trace the cell's BEAM calls | 4a. `strace -f` on `sh` | 4b. overlayfs in a userns | 5. hybrid (3 + scan only after `sh`) |
|---|---|---|---|---|---|---|
| precision | every change that survives to the end of the eval; same-second rewrites need the racy-hash rule (works); a create-then-delete inside one eval is invisible | every event, but a just-created directory can lose files (53-60 of 60 reported, 0-7 missed) | every `file`/`prim_file` write, delete, rename, incl. raw handles, NIF calls and spawned child processes | every syscall of the process tree, incl. temp files and reads | exact change set (upper dir), deletes as whiteouts | trace-exact for BEAM; scan-exact (end state) for `sh` |
| attribution under concurrency | none by itself (a window diff) | none: an event has no writer; two overlapping cells' events are indistinguishable | exact: the trace message carries the traced pid = the cell | exact per command | exact per command | exact for BEAM; `sh` paths in overlapping windows are `:ambiguous` between the OS-process cells |
| cost per eval (BIG) | 49-91 ms warm sequential scan (stat 2,000 files), 1 ms on TINY; whole before+after+diff 165-250 ms | 0 per eval after ~30 ms arm; ~0.3-2 ms event latency; a `git commit` is 320-410 events, all under `.git` | 0.1-0.6 ms for a 2-write cell; 300 writes 14-29 ms vs 15-20 untraced | `sed -i` loop x3-4.7, `git status` x9-31 (8 ms to 75-364 ms) | ~13 ms mount per command | pure-BEAM cell: trace only (<1 ms); `sh` cell: one 75-140 ms scan |
| misses | renames that are not inode-preserving (reported as delete+add); transient files; writes outside the root | the new-dir race, overflow (`max_queued_events` 16,384), `.git` flood | everything an OS process does | processes that escape ptrace (`setuid`), needs ptrace scope 1 (works here) | needs unprivileged userns + overlayfs; the agent sees `/tmp/.../m`, not the real path | writes by `sh` outside the root; a human editing during a cell |
| implementation size | ~60 lines (scan + diff + racy) | ~25 lines for the subscription + a debounce | ~45 lines (patterns, collector, classify) | ~30 lines + a strace parser | ~15 lines but changes the cell's world | ~150 lines on top (window server, attribute, cache) |
| platform deps | none (stat) | `inotifywait` on PATH, Linux/BSD only | none (BEAM) | `strace`, Linux, ptrace allowed | Linux userns + overlayfs | none |

### OBSERVED

1. **Scan cost.** Sequential stat walk of BIG: p50 61-79 ms, min 49-56, max 92-521 ms (the max is a noisy first scan); TINY 0.7-1.0 ms. Parallel walkers are 5-8x *slower* (386-602 ms for 2-8 walkers; the file server is a single process). Hashing is not the bottleneck: read+sha256 of 20 files (15 KB) = 16-21 ms, of which 14-20 ms is the read. The diff must use the Erlang `maps` functions (`maps/filter`, `maps/without`): a beam-lisp `filter` over 2,000 map keys took 15-25 ms, `(= m1 m2)` on two different 2,000-entry maps 1.8 s (!) (pilot measurement, not printed by this run), `maps/without` 0.5 ms. A cold-cache walk is a one-off: a shell `find -printf` over BIG took 501 ms cold and 65-127 ms warm in the pilot (not reproducible in-run without root).
2. **Racy rule works.** A same-millisecond, same-size in-place rewrite: stat-only comparison sees `[]` (mtime has one-second granularity here: `file_info` times are POSIX seconds; `{:time :native}` is rejected, `{:error, :badarg}`), the racy-aware diff sees `["racy.txt"]`. `sed -i` (new inode through rename) and delete+recreate are seen by the stat tuple alone because the inode changes. After the clock moves on, a file is no longer racy and costs a stat only.
3. **Deletes and renames.** Mixed churn on BIG (5 modified, 3 `rm`, 2 `mv`, 3 added, a 10-file directory removed): 3 added, 5 modified, 13 deleted, and both `mv`s found as `[from to]` renames by inode. `sed -i` shows as a modification (new inode on the same name), not a rename.
4. **Watcher is available** (`FileSystem/start_link` from beam-lisp's own `file_system` 1.1.1; backend = the `inotifywait` binary): armed in 27-40 ms, event latency 0.3-2.3 ms, events carry `[path, flags]` (`:created :modified :closed :moved_from :moved_to :deleted :isdir`) with **no writer**. Two cells overlapping 1 ms produced six events, `cell-a`/`cell-b` in order, indistinguishable by anything but timing. The library has no exclude list: `git status; add; commit` = 320-410 events, all under `.git`. The just-created-directory race is real but intermittent: 60 files created in new `d/x/y/` directories, 0 / 1 / 7 / 9 missed across executions.
5. **BEAM tracing sees what a cell does except OS processes.** With `erlang:trace(self, true, [call, set_on_spawn, {tracer, Col}])` and VM-wide patterns on `file`/`prim_file` exports, one cell calling `File/write!`, `:file.write_file`, a raw-flag write, a raw `file:open`+`write`, `:prim_file.write_file` directly, `File/rename!`, `File/rm!`, `File/mkdir_p!`, `File/cp!`, `File/rm_rf!` and a spawned child's `File/write!`, produced 18 events covering every path; reads and read-mode opens produced no event; `open_port` showed as `[:os-process]`. The only file on disk the trace did not account for was `from-sh.txt`, the one written by `sh`. `trace_delivered` is the settle barrier. Cost: 14-29 ms for 300 writes traced vs 15-20 ms untraced; patterns on or off did not move untraced processes (14.8 vs 19.6 and 12.6 vs 14.3, noise).
6. **Wrapping by redefinition does not work for the cell alone**: `File/write!` is a global compiled module; `file_server_2` is one named process (a `receive` trace on it shows `{:open ..}`, `{:rename ..}`, `{:delete ..}` for ALL processes incl. beam-lisp's own loader reading `file.bl`, `file.bl.md`, ...) and raw / `prim_file` calls never reach it. Process-level call tracing is the only per-cell hook.
7. **strace.** `strace -f -qq -y -e trace=openat,rename*,unlink*,mkdir*,symlink*` is accurate: a `sed -i; mv; rm; echo >; mkdir -p; cp; ln -s` script gives 10 mutating lines, `sed -i` as `openat(O_CREAT|O_EXCL) x/sedXXXX` + `rename(x/sedXXXX, x/f)`, `-y` prints cwd-relative resolution (`AT_FDCWD</dir>`). Overhead: 40 `sed -i` runs 50-57 ms -> 152-267 ms (x3-4.7); `git status` over BIG 8-12 ms -> 76-364 ms (x9-31). A backgrounded `sleep 2 &` made `strace -f` wait for the child (2.0 s either way: the pipe is inherited), `-D` made no difference for the wall time here.
8. **overlayfs works unprivileged** (`unshare -Urm` + `mount -t overlay`): 13-17 ms for a command that did `sed -i`, create, `rm`, `mv`; the upper dir held exactly `src/d2/f3.txt`, `src/d3/f1.txt` (whiteout), `src/d4/f2b.txt`, `src/d4/f2.txt` (whiteout), `src/new`.
9. **Hybrid attribution** (cells A, B overlap, both run `sh`; D overlaps and is pure BEAM; a human writes from outside; C is later and alone): A's and B's BEAM writes `a-trace`, `b-trace` and D's `d-trace` are `:trace`-exact for their owners; D, never scanned, is correct with zero scan. C's `mv` is `:scan` for `t-C` alone, both the old and new name. `a-sh.txt`, `b-sh.txt`, `src/d1/f1.txt`, `src/d2/f2.txt` and the human's `human.txt` are all `:ambiguous [t-A t-B]` (the history cannot tell which of two overlapping `sh` cells wrote what, nor that `human.txt` came from outside). Per-cell cost: pure-BEAM 0.2-0.6 ms traced vs 0.1-0.2 bare; `sh` eval on BIG: bare 3-5 ms, scan before+after+diff 166-251 ms, with the stat cache (after-scan only) 76-137 ms.
10. A first draft of the hybrid used one shared trace collector and wrongly gave every path to one cell. A collector per cell fixed it (kept in `run-window`): trace events carry the pid but a shared collector loses the cell boundary.

### INFERRED

- A real task's `.git`, `node_modules`, `target`, `_build` are excluded, so a real tree is usually smaller than BIG; an Elixir/Rust project with 20k source files would scan in ~0.5-1 s. Past a few thousand files the scan must run in the historian or the cell process (not the 5 ms task-side budget), and large trees need the watcher as a *trigger*, not as truth.
- The watcher would be the right substitute for the scan only if two things hold: attribution can be ignored (single task, or "any cell in the window") and the 0-12% new-directory miss can be backed by a scan at a settle point. Since both are required, it adds machinery without removing the scan.
- `erlang:trace` allows one tracer per process, so a debugger or `dbg` on a cell would conflict; acceptable in a harness, but the trace must also be switched off at the cell's end (the cell process dies, which does it).
- Reads are not recorded anywhere here; if history ever wants "what did this cell read" (for blame of a bad edit), the trace is the place and costs nothing extra.

### Recommendation

Lightest design that catches everything that matters: **trace the cell for BEAM calls, scan only after cells that ran an OS process, window-attribute the scan results.**

1. **Hook point.** In `codemode/run-eval`: (a) `preamble` gains one line `(omega.fs/trace-self! <collector-pid>)` so the cell process (created inside `harness/eval-cell`) traces itself and its children; a collector per cell; (b) after `harness/eval-cell` returns, `trace_delivered`, take the events: `claims` = every written/deleted/renamed path (this also replaces the `prelude/write`/`edit` recorder of `async-checkpoint`, which ends in `File/write!`); `os?` = an `open_port` event. (c) if `os?`: one `stat` scan of the root (skip `.git .omega _build node_modules target` + `.gitignore` as a later nicety), diff against the stat map the previous scan left in a cache server, hash only the changed paths (racy-aware). The result `{:claims :changed :window}` rides on the `tool/result` data; the `:tool/after` hook casts it with the snapshot to the historian, as in `async-checkpoint`.
2. **What a history change records per path.** `:source :trace` (exact, the claiming task owns it), `:source :scan` (an `sh` cell was the only candidate in its window), `:source :scan :ambiguous [t-A t-B]` (overlapping `sh` cells), `:source :external` (changed, but no omega cell with an OS process was running: a human or a daemon; committed as `by "external"` or kept uncommitted per policy). Renames carry `[from to]` from the inode, deletes are a path with `nil` text.
3. **Cost.** Pure-BEAM evals (the majority: `read write edit ls glob` + pure logic): <1 ms. `sh` evals: one ~60-140 ms scan on 2,000 files, off the 5 ms task-side path (run it in the cell process before returning, since the cell already waited seconds on a command, or in the historian from the cached before-state). No standing process, no binary, no platform dep.
4. **Not worth it:** a standing inotify watcher (no attribution, a `.git` flood, the new-directory race, `inotifywait` dependency) as the primary mechanism; `strace` (x3-31 overhead, a platform dep, only attribution gain); overlayfs (changes the paths the agent sees). Keep `strace -f -e trace=%file` in the back pocket as an opt-in "exact `sh` attribution" mode for the ambiguous case, and the watcher as a future optimization for trees > 20k files, as a *dirty-trigger* for which directories to scan.
5. **Risk list for the implementation.** The `maps/*` diff and `:raw` stats are mandatory for speed (see 1). The `set_on_spawn` flag does not follow `System/cmd`'s OS children, which is exactly why the scan exists. An `sh` cell that runs `git checkout` can change thousands of files: the hook should cap per-step changed paths (say 500) and record `:truncated`.
