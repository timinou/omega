# BEAM in charge: sandboxing the agent from the VM

*A design proposal (2026-10-04). It answers: how could simple, zero-cost systems let BEAM be in
charge of the whole sandboxing of the agent, so that even the syscalls of python run through `sh`
are caught transparently and the model sees them? It surveys the earlier attempts on this
machine, reports a working probe, and proposes a layered design. Claims from runs are marked
OBSERVED; the runnable version is `spikes/beam-jail.bl.md`.*

---

## 0. The bold claim

> **The agent never touches the OS directly. Every process it starts runs under a kernel-enforced
> floor that BEAM configured, and every effect that matters (a write, an exec, a connect) is an
> Erlang message to the agent's own supervisor before it happens.**

The pieces this needs are all in the stock Linux kernel and OTP, as of today:
- **Landlock**, which enforces the filesystem floor;
- **seccomp user notification**, which turns a syscall into a question;
- **user and network namespaces**, which take the network away;
- **OTP ports and `peer`**, which bring all of it under supervision.

The only non-BEAM part is one ~200-line C exec wrapper: no daemon, no FUSE, no root, no
container runtime. The probe in §3 does all of it. Measured overhead is ~100 µs per *mediated*
syscall and nothing measurable for reads and compute (OBSERVED).

---

## 1. What exists already (the earlier attempts)

| where | what it is | what it catches | who decides | state |
|---|---|---|---|---|
| `~/code/ora/relay` `src/relay/sandbox.bl`, `bash-shell.bl`, `wayland-shell.bl` | an **OS floor as data**: profiles render to a `systemd-run --user --pipe --wait -p …` argv prefix (cgroup MemoryMax / CPUQuota / TasksMax / RuntimeMaxSec, a `TemporaryFileSystem=/` jail with read-only binds, seccomp `SystemCallFilter=@system-service` minus deny groups, NoNewPrivileges, RestrictNamespaces). bwrap as an opt-in hard profile. A Biscuit capability gate decides *who* may shell. One audit datom per command. | nothing per syscall: it **denies** a static set and returns merged stdout. The model sees text. | BEAM decides *whether* a line runs; the kernel denies a fixed syscall-group list | built, adversarially tested (seccomp blocks unshare and ptrace; OOM and timeout kill; `/home` hidden) |
| `~/code/ora/spell` `!tasks/plans/PLAN-305` (pi-edit-broker-fs) | a **FUSE mount over the repo** (mount-over-self) so every write by bash-launched tools becomes an intent/commit to the edit broker. 9 phases, crash journal, conformance tests for python, sed, go, git, npm. | every fs syscall in the repo, from anything | the broker (Rust) | **plan only**: no crate was ever written. The plan's own estimate is 25–40 subagent-days |
| `~/code/undefine/spell` | no OS sandbox. A "fence" (spawn_monitor + 5 s kill) bounds model code; `interface/run.bl` says it is *"NOT a capability boundary — the model's code runs in the operator's VM by design"*. `os/cmd` is raw. | nothing | — | by design |
| omega today | `codemode`: `(sh …)` is a plain function; *"No OS sandbox — full rights by default (D10)"*. `omega.reap` tags every child with `OMEGA_TASK_TAG`/`OMEGA_CELL_TAG` and kills the tree by tag. `fs-capture` (spike): `erlang:trace` on the cell catches BEAM-side writes exactly; a stat scan after `sh` catches the rest *after the fact*. | BEAM-side writes exactly; OS-side writes as a diff, with no writer and no veto | nobody (observe only) | reap built; fs-capture spiked |

**What the attempts teach.**
1. **relay proved the floor-as-data shape.** A profile is a value and a renderer turns it into a
   launcher. That shape is right, and this design keeps it. Relay rejected Landlock for one
   reason: *"requires `landlock_restrict_self()` IN the child between fork and exec; BEAM's
   `open_port` gives NO such hook, and no Erlang binding exists."* True of the bare port. The fix
   is the obvious one: put the hook in a tiny exec wrapper that *is* the port program. Then
   Landlock becomes the cheapest, most precise layer, not the least seamless one.
2. **PLAN-305 wanted the right thing** (every write, from every tool, mediated) **at the wrong
   cost.**
   - FUSE puts a userspace daemon on *every* read and write, including `cargo build`'s thousands.
   - It needs mount-over-self tricks, a crash journal of its own, and a 4-filesystem conformance
     matrix.
   - The kernel already has a mediation hook that fires only on the syscalls you choose:
     seccomp user notification.
3. **fs-capture was the right instinct, on the wrong side of the syscall.** A post-hoc scan
   cannot say *who* wrote and cannot say *no*. Moving the question into the syscall path gives
   both, and the writer arrives as a pid.

---

## 2. The kernel pieces, and what each is for

| mechanism | what it does | cost | enforces? | gives BEAM |
|---|---|---|---|---|
| **Landlock** (ABI 8 on this kernel, OBSERVED) | unprivileged, per-process-tree allowlist: "this tree may write only beneath these dirs"; also TCP bind/connect ports (ABI ≥ 4), scoped signals and abstract unix sockets (ABI ≥ 6) | ~0 at runtime; set up once per exec | **yes**, race-free, in the kernel; inherited by every descendant; cannot be undone by the child | the *floor*: a rule list rendered from a policy value |
| **seccomp user notification** (`SECCOMP_RET_USER_NOTIF`) | a BPF filter picks syscalls; the kernel *pauses* the caller and sends the call (nr, args, pid) to a listener fd; the listener answers *continue* or an errno | ~100 µs per notified call through a BEAM round trip (OBSERVED); 0 for unfiltered calls | **no** for path-based policy (TOCTOU: the man page says it *"is explicitly not intended as a method implementing security policy"*); **yes** for "this syscall may not happen at all" (deny is safe) | the *question*: an Erlang message per effect, with the writer's pid |
| **user + net namespaces** (`unshare -Urn`, userns enabled, OBSERVED) | an empty network namespace has only `lo`: `connect` to anything fails (OBSERVED: errno 101) | ~100–170 ms per spawn under load (OBSERVED) | **yes** | *no network* as a property, not a rule |
| **pasta** (installed) / slirp4netns | user-mode networking into a namespace; can be pointed at a proxy | a process per sandbox | yes (only what it forwards) | network *through* BEAM: an allowlisting proxy written in Erlang |
| **cgroups via systemd-run --user** (relay, OBSERVED working) | memory, CPU, task and runtime caps | ~a unit start | yes | resource limits as profile data |
| **overlayfs in a userns** (OBSERVED: rootless, 145 ms, the upper dir is the exact diff incl. whiteouts for deletes) | the tree sees writes; the real tree does not until BEAM merges the upper dir | one mount per sandbox | yes | *speculative execution*: run a step, look at its whole diff, then commit or drop it |
| `ptrace`/`strace -f` | sees every syscall | 3–31× slower (OBSERVED in fs-capture) | — | rejected as primary |
| `LD_PRELOAD` shims | intercept libc calls | ~0 | **no**: static binaries and Go skip libc | rejected |
| FUSE (PLAN-305) | mediate every fs op | a daemon on every op | yes | rejected: same result as the above for a fraction of the cost |

### 2.1 The split that makes it work: Landlock enforces, notify observes

The single most important design choice. **Never use seccomp-notify to enforce a path rule.**
- A notified `openat("a.txt")` pauses the caller, BEAM reads the path from `/proc/pid/mem`, and
  says *continue*.
- Between the read and the *continue*, another thread of the target can rewrite that memory. The
  kernel then opens whatever path is there now. This is the documented TOCTOU of
  `SECCOMP_USER_NOTIF_FLAG_CONTINUE`.

**This is measured, not hypothetical** (`spikes/beam-jail.bl.md` §8, OBSERVED twice).
- The setup: one thread flips a path buffer between an inside path and an outside path, while
  another thread opens it.
- Notify alone: BEAM denied every outside spelling it saw, and still **724–747 of 3,000 opens
  wrote outside**.
- With the Landlock floor added: **0 of 3,000**.

So:
- **Landlock is the wall.** "Writes only under the project, `/dev`, and the task's temp dir"
  holds in the kernel no matter what the notify answer was. OBSERVED: with BEAM answering
  *allow* to everything, Landlock still refused an absolute path outside, a symlink inside the
  project pointing out, python's `open()`, and a write after `cd /tmp`.
- **Notify is the voice.** It makes each effect a message: BEAM records it, shows it to the
  model, and may *deny* it.
  - Deny is always safe: refusing can't be raced into allowing.
  - Allow is only as strong as the Landlock floor under it.
- **Namespaces remove whole capabilities** (network, other users' processes) when a task should
  not have them at all.

---

## 3. The probe (OBSERVED; reproducible as `spikes/beam-jail.bl.md`, `bin/bl run`, ~10 s)

One C file, `notify.c`, used as the port program:

```text
notify [--rw DIR]... -- cmd args…
  1. fork
  2. child:  Landlock(--rw dirs) → seccomp filter (NEW_LISTENER) → send the listener fd to parent → exec cmd
  3. parent: loop  ioctl(NOTIF_RECV) → print "<id> <pid> <syscall> <detail>" → read "<id> allow|deny" → NOTIF_SEND
     filtered: write-opens (O_WRONLY|O_RDWR|O_CREAT|O_TRUNC|O_APPEND), unlink(at), rename(at,at2),
               mkdir(at), execve, connect.   Reads, stat, compute: never leave the kernel.
```

BEAM drives it with `open_port({spawn_executable, notify}, [{line, …}, exit_status, …])`. Each
syscall arrives as `{Port, {data, {eol, Line}}}`; the answer is `port_command/2`.

**What BEAM saw** for `sh -c 'python3 -c "open(\"a.txt\",\"w\")…"; sed -i s/x/y/ a.txt; mv a.txt
b.txt; rm -f b.txt; mkdir -p d; echo hi > /tmp/h/jail/outside.txt; python3 -c "socket.connect((\"1.1.1.1\",80))"'`
(exec lines trimmed):

```text
allow    exec   /usr/bin/sh
allow    open-w a.txt                          ← python
allow    exec   /usr/bin/sed
allow    open-w ./sed1n6gQw                    ← sed -i writes a temp file …
allow    rename ./sed1n6gQw -> a.txt           ← … and renames it over the original (*)
allow    rename a.txt -> b.txt                 ← mv
allow    unlink b.txt                          ← rm
allow    mkdir  d
deny     open-w /tmp/h/jail/outside.txt        ← policy: outside the project → sh: Permission denied
deny     connec 1.1.1.1:80                     ← policy: no inet → python: connect_ex 13 (EACCES)
events=26 exit=0 wall_ms=82
```

(*) The first run printed `rename(2)` without its target. After the decoder was fixed, a second run
printed `rename ./sedMYSoUV -> s.txt` for the same pattern. The line above shows the decoded form.

Every effect of the python script, of `sed -i`'s temp-and-rename, and of each subprocess arrived
in BEAM **before it happened**, with the writer's pid. fs-capture's whole scan step, its
`:ambiguous` attribution and its "create-then-delete is missed" hole all disappear.

**Overhead** (OBSERVED, interleaved bare/notify ports in one VM, 9 rounds, load average 25–36, so
treat the numbers as rough):

| workload | bare median | notify median | notified events |
|---|---|---|---|
| python writes 300 files | 73 ms | 104 ms | 312 (≈100 µs each) |
| python reads and hashes `/usr/share/doc` | 1024 ms | 980 ms | 12 (no measurable cost) |
| `git status` in omega | 31 ms | 23 ms | 15 (no measurable cost) |

The cost scales with *effects*, not with work. A build that writes 10,000 objects would pay about
a second. That is why the filter shape matters (§4.3): write-opens under `_build/`, `target/`
and `node_modules` can be *allowed in the BPF filter itself*, at 0 cost, and summarised by
fs-capture's scan instead.

**A whole BEAM node can be jailed the same way** (OBSERVED, `peer.escript`):
- `peer:start(#{exec => {notify, ["--rw", Project, "--rw", "/dev", "--rw", Cookie, "--", erl]}})`
  with `JAIL_ONLY=1` starts an agent node under Landlock, in ~1.2 s.
- Through `erpc`:
  - `file:write_file` inside → `ok`;
  - outside → `{error,eacces}`;
  - a raw `file:open` outside → `{error,eacces}`;
  - `os:cmd("echo > outside")` → `Permission denied`.
- The supervising node, outside the jail, still writes anywhere.

**This is the important result.** It means *eval cells* (beam-lisp code the model writes), not
just `sh`, can run under the same floor, in a node that the harness supervises over
distribution.

---

## 4. The design

### 4.1 Shape

```text
 harness node (bl-ed · omega · historian)                       never jailed
   │
   │  omega.jail  (a gen_server per task)
   │    · profile  = data (floor rules + mediation rules)   ← like relay's profiles
   │    · renders  → notify argv  (--rw …, filter set)
   │    · owns     the port; each line = a syscall event; answers allow/deny/ask
   │    · emits    effect facts → historian (:source :syscall, exact pid → cell → task)
   │    · reports  denied/notable effects into the tool result the model reads
   │
   ├── port: notify → sh -c "python …"           (shell cells: one jail per sh call)
   └── peer: notify → erl  = the task's EVAL NODE (eval cells: one jailed node per task)
             codemode evaluates cells there via erpc; its own sh calls nest another notify
```

Every effect becomes a fact, in the same shape for both paths:

```text
{:effect/op :write   :effect/path "src/a.py"   :effect/pid 4123 :effect/cell "t-7/14/toolu_…"
 :effect/verdict :allow :effect/rule [:allow :write :project] :effect/at …}
```

### 4.2 Policy is data, like the edit RULES

The same idea as `omega.edit/RULES`: one table, overridable per project, readable by a human.

```clojure
(def JAIL
  {:floor   {:write   [:project :task-tmp "/dev"]      ; Landlock: kernel-enforced
             :net     :proxy                           ; :none (empty netns) | :proxy | :host
             :limits  {:mem "4G" :tasks 512 :runtime-s 600}}   ; cgroup via systemd-run (relay)
   :mediate [[:exec    :any                 :record]   ; every exec becomes a fact
             [:write   :project             :record]   ; the history's exact writer
             [:write   ["_build" "target" "node_modules" ".git/objects"] :pass] ; in-BPF allow, 0 cost
             [:unlink  :project             :record]
             [:connect :unix                :allow]
             [:connect :inet                :ask]      ; the human (or a rule) decides, see §4.4
             [:write   :outside             :deny]]    ; already impossible (floor); recorded as a refusal
   :report  {:to-model [:deny :ask] :summary-max 20}})
```

- **`:floor`** renders to Landlock rules, namespace flags and the systemd unit. It is the
  *security* part. When the kernel lacks a feature, a refused floor fails closed.
- **`:mediate`** renders to the BPF filter (which syscalls are notified at all) plus the
  Erlang-side decision. It is the *awareness* part.
- `:pass` rules compile into the BPF program, so a `cargo build` that writes 10,000 files
  into `target/` costs nothing extra. One fs-capture scan of `target/` afterwards records it.
- **D10 gets its sandbox.**
  - The open lean said: *"Bash in plan mode stays the honest weak point until we choose a
    sandbox."*
  - Plan mode is the profile `{:floor {:write [:task-tmp]}}`: read anywhere, write nowhere in
    the project, enforced by the kernel for python, sed and git alike.

### 4.3 What the model sees

Transparency is the point, but a model drowning in 300 `open-w` lines is worse off. So the tool
result gets a **summary**, and the facts go to the store:

```text
(sh "python gen.py && sed -i s/a/b/ cfg.toml")
→ {:out "…" :exit 0
   :effects "wrote 3 files (data/a.json, data/b.json, cfg.toml), ran python3, sed;
             DENIED: connect 93.184.216.34:443 (no network for this task — ask to enable)"}
```

- Denied and asked effects are always shown. Writes are listed up to a cap. Execs are named once.
- The full list is a query away: `(effects :cell "t-7/14/…")`.
- **This closes fs-capture's open holes:**

| fs-capture hole | with the jail |
|---|---|
| attribution | exact (a pid, then the cell) |
| overlapping `sh` cells | no longer `:ambiguous` |
| a file created and deleted within one command | seen, because both syscalls arrive |
| writes outside the root | denied and reported |

### 4.4 `:ask`: the human in the loop, at syscall granularity

Because the target is *paused in the kernel* while BEAM thinks, `:ask` is real.
- The jail server sends the question to bl-ed: "t-7 wants to connect to pypi.org:443 (pip
  install)".
- The human answers. The syscall then continues or fails with `EACCES`.
- The paused process holds nothing but itself.
- A timeout (say 60 s) answers `deny`.
- The answer can be remembered as a rule ("allow pypi.org for this task"). That is a new
  `:mediate` row.

Network asks need a name, not just an IP. With `:net :proxy`:
- the sandbox's only route out is a proxy, either pasta forwarding to an Erlang listener or
  `HTTPS_PROXY`;
- BEAM sees the hostname from CONNECT/SNI and decides per domain.

This is the same domain-allowlist shape that Claude Code's sandbox runtime and Codex use. Here
the allowlist *is a BEAM process*: queryable, and shown live in bl-ed.

### 4.5 Eval cells: jail the node, not the process

`sh` is the easy half. The model's beam-lisp code (`File/write!`, `:file`, `os:cmd`, NIFs) runs
*in the harness VM* today. Two answers:

1. **The eval node** (the bold one).
   - Each task, or each world, gets a peer node started through `notify` (OBSERVED working).
     codemode evaluates cells there with `erpc`.
   - The floor applies to *everything* the model's code does, including NIFs and raw handles,
     because it is the kernel.
   - The harness keeps the store, the historian and the UI; the eval node holds only the cell's
     work.
   - Crash isolation is a bonus: a cell that blows up the node costs a restart (~1 s warm,
     OBSERVED 1.2 s), not bl-ed.
   - This is the same move the checkpoint document makes for beam-lisp projects (a target VM):
     one mechanism, two reasons.
2. **In-VM capability gates** (cheap, partial). beam-lisp's env capabilities (relay's
   `env/allowed? "Elixir.System"`) can refuse `System/cmd` or `File/*` per env. Useful as a
   first line, but not a floor: anything that reaches `:erlang`/`:prim_file` directly bypasses
   it. fs-capture's call trace keeps observing these.

The eval node is the recommended end state. The in-VM gate plus trace is the step on the way.

### 4.6 Speculative steps (optional, the boldest part)

With overlayfs in the jail's mount namespace (rootless, OBSERVED):
- the step's process tree writes into an upper dir;
- the real tree is untouched until BEAM decides.

The upper dir *is* the step's diff, deletes included (OBSERVED: a whiteout char device for
`b.txt`). That gives:
- **"Try it, then show me."** Run the agent's `sh` step, show the diff and the gate verdict, then
  merge the upper dir into the tree (one history change) or drop it. Nothing half-applied ever
  reaches the shared working copy.
- **Test isolation (E17 b) for free.** Task B's tests run on *its* overlay and never see task A's
  broken file. That was the one thing per-path gating could not give (§15.2).
- **The cost:** the path the agent sees stays the same (overlay-mounted at the project path
  inside its own namespace). That was fs-capture's objection to overlayfs. Here it is solved:
  the mount exists only in the sandbox's namespace, so the human's editor and the other agents
  still see the real tree.

This is a separate decision (§6, Q4). Mediation works without it.

---

## 5. Limits, stated plainly

- **Linux only.** Landlock and seccomp-notify have no macOS equivalent. Seatbelt
  (`sandbox-exec`) gives a floor but no per-syscall question. On macOS this degrades to relay's
  shape plus fs-capture.
- **Notify is not a security boundary for paths** (§2.1). Landlock is. Deny is safe; allow
  trusts the floor.
- **io_uring** can perform file ops without the syscalls seccomp sees.
  - On this host it is enabled (`kernel.io_uring_disabled = 0`), and a bare `io_uring_setup`
    succeeds (OBSERVED).
  - The wrapper's filter now returns EPERM for it (OBSERVED inside the jail); most tools fall
    back.
  - Landlock should still enforce ring opens on this kernel (INFERRED, not tested with a ring).
- **An fd opened before the jail** stays writable. OBSERVED: a pre-opened fd 3 to a file outside
  the project still accepted writes, while creating a new file outside was denied.
  - Landlock checks *opens*, not already-open files.
  - A port started by BEAM inherits only 0/1/2, but `notify` should `close_range(3, ~0)` before
    exec anyway. This is the same discipline as the direnv fd-3 trap in this host's notes.
- **Not every effect is an event** (INFERRED from the filter):
  - `sendto` on an unconnected UDP socket, `bind`, `chmod`, `link`/`symlink`, and writes
    through an mmap of an already-open fd are not reported;
  - Landlock still enforces symlink creation and truncate under the floor.
  - Network has no kernel floor in the probe. Landlock ABI ≥ 4 `NET_CONNECT_TCP`, or an empty
    netns with a proxy, adds one.
- **Distribution quirks for the jailed node** (OBSERVED from the bl VM):
  - the host VM must `erlang:set_cookie` to the cookie file's value, or `peer:start` times out
    with "Invalid challenge reply";
  - the cookie file must be a `--rw` entry;
  - `exec` must name `/usr/bin/erl`, not the drop's `erts` found on the VM's PATH.
- **Landlock rules are fixed at exec.** A task that later needs a new writable dir needs a new
  process. That is fine for `sh` cells (one jail each); an eval node restarts.
- **Paths in events are as the process wrote them** (relative to its cwd). The jail server
  resolves them with `/proc/<pid>/cwd` at event time. That is best effort for the record; the
  floor does not depend on it.
- **Event cost scales with effects.** Hence `:pass` rules in BPF for build directories and
  caches.
- **The agent can still read anything the user can read** unless the floor says otherwise.
  - Landlock can restrict reads too (`LANDLOCK_ACCESS_FS_READ_FILE`); relay's jail hides
    `/home`.
  - A good default profile denies reads of `~/.ssh`, `~/.config/*/credentials`, `.env*` outside
    the project, and browser profiles. That is a new floor row, `:read-deny`.
- **Root-requiring tools** (docker, sudo) are out by construction: NoNewPrivileges plus
  Landlock. A task that needs them runs unjailed, by an explicit human grant.

---

## 6. Decisions for you

| # | question | options | lean |
|---|---|---|---|
| **Q1** | Default floor for agent `sh` | none (today, D10) · Landlock project-write + no inet · + read-deny of secrets | **Landlock project-write + task tmp, net via proxy, secrets read-denied**. A per-project override goes in the policy table |
| **Q2** | Mediation default | off · record writes/execs/connects · record + ask for inet | **record + ask for inet**, build directories `:pass` |
| **Q3** | Eval cells | stay in the harness VM (trace + capability gate) · a jailed eval node per world · per task | **a jailed eval node per world first**, per task when E17 (b) needs it |
| **Q4** | Speculative overlay steps | no · opt-in per task · default | **opt-in** (`:speculative true`), because it also answers test isolation |
| **Q5** | Where `notify` lives | omega (`priv/jail/notify.c`, built with the project) · beam-lisp std (a `System/jail` primitive next to `System/cmd`) | **beam-lisp std**: relay, spell and omega all spawn processes; one floor primitive for all three. Prototype in omega first |
| **Q6** | relay's systemd-run floor | replace · compose (systemd-run outside for cgroups, notify inside for Landlock and mediation) | **compose**: relay's cgroup caps stay; notify replaces its seccomp deny-list with Landlock + mediation |

## 7. Relation to the other decisions

- **fs-capture (FEAT-005):**
  - the trace of BEAM file calls stays: it covers in-VM writes until eval cells move to a jailed
    node;
  - the post-`sh` scan shrinks to `:pass` directories only;
  - `:source :syscall` joins `:trace`/`:scan`/`:external`.
- **Checkpoints and the live image** (`../interface/checkpoints-and-the-live-image.bl.md`):
  - the target VM there and the eval node here are the same mechanism (a supervised peer node);
  - one jailed node per project can be both.
- **D10:** the "honest weak point" closes. Plan mode becomes a profile the kernel enforces.
- **relay:** profiles-as-data and the systemd floor carry over unchanged. Landlock's "no hook"
  objection is answered by the exec wrapper.
- **PLAN-305 (spell):** superseded in approach. The same coverage costs one C file instead of a
  FUSE daemon, and only on the syscalls chosen.

## 8. Sources

- Probe: `spikes/beam-jail.bl.md`. It embeds `notify.c` (~190 lines), compiles it, drives it from
  beam-lisp through `open_port`, and covers:
  - capture;
  - policy;
  - the Landlock floor;
  - overhead (≈70–135 µs per notified event across runs; reads and compute in the noise);
  - the jailed peer node;
  - io_uring, inherited fds, and the TOCTOU race.
  The first scratch version used escripts and is not kept.
- Earlier attempts:
  - `~/code/ora/relay/src/relay/sandbox.bl`, `docs/tailnet-executors.md` §5d–5e, PLAN-044,
    FEAT-001;
  - `~/code/ora/spell/!tasks/plans/PLAN-305-*`;
  - `~/code/undefine/spell/apps/interface/src/interface/run.bl`.
- Kernel: `seccomp_unotify(2)` (the "not intended as a method implementing security policy" note
  and the TOCTOU discussion), `landlock(7)`.
- Prior art: OpenAI Codex CLI and Anthropic's sandbox runtime both use OS floors (Landlock,
  bwrap, Seatbelt) plus a domain-allowlist proxy. Neither turns syscalls into messages for the
  agent.
