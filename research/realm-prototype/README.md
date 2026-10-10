# What current Beam Lisp realms actually do

Tested upstream `48db743504ad40b56cd1458c03b7554c9383203a` on 2026-10-10.
`git fetch origin` completed; this checkout was already 1,125 commits ahead of
`origin/main`. The actual cached release `04805c33` has that exact clean source
revision in `BUILD_INFO.bl`. Omega's production compiler pin was not changed.

These are backend/runtime prototypes, not editor packages or a replacement
PELAGIC application. Every endpoint and world was private or offline/in-memory;
no request went to the user's world on port 8790. Owned VMs were memory-capped
and stopped after the experiments.

## Experiments

| Experiment | What ran | Result |
|---|---|---|
| [Socket dispatch](run.bl) | Current source, real session socket, two temporary projects, synthetic release endpoint identity | Separate implementations of the same namespace and separate atoms; shared OS VM; disconnect cancels the command; close/reopen resets only that project's state. |
| [Real launcher](release.py) | Exact current release, explicitly started shared daemon, 30 warm CLI invocations and eight concurrent clients | All attached to the same OS PID. Standard `System/get_env` kept both project and client values isolated. Closing A left B intact. |
| [First-ever service task](first-service.py) | Exact release, default shared auto-start policy, no daemon prestarted | First command created a service in a cold VM, which exited when the command returned. The next command ran in a different, warm VM. |
| [Real Omega](host.bl) | Two offline worlds with real Omega task systems and HTTP/editor serving, existing PELAGIC frontend | Task returns while its service remains live. Repeated acquisition reuses the service. Closing A stops its listener and task supervisor; B still serves. |
| [Routes](routes.bl) | Private claim directory; no gateway started or contacted | Same OS PID incorrectly authorized another root's pinned claim. Duplicate hostnames were accepted. Closing a realm left its claim live while the shared OS VM survived. |
| [Shared code](sharing.bl) | Actual project `:uses` declarations through the shared socket | Wrong content hash was accepted when source was independently on `:paths`. With only `:uses`'s path declaration, the namespace failed to resolve. |

The source socket probes intentionally use a synthetic build ID to select the
shared endpoint path; they do not prove release launcher behavior. `release.py`
provides that separate proof against the actual release.

The real Omega prototype uses [service.bl.in](service.bl.in), a deliberately
small acquisition wrapper. It binds a document root explicitly, serializes
acquisition, starts a `vm.manager/serve` member, waits for readiness and retains
its identity in a project namespace atom. This is a successful vertical slice,
**not** a production service manager: caller death during startup, concurrent
close/acquire, startup reservations, durable-world shutdown and lease cleanup
still need explicit tests and implementation.

## Observed costs

| Measurement | Result | Scope |
|---|---:|---|
| Warm release task median | 117 ms | 30 samples, real launcher end to end |
| Warm release task P95 | 200 ms | Sorted sample at floor(0.95 × (n−1)); one run |
| First release task in A | 25.27 s | Deferred first-use runtime loading included |
| First release task in B | 366 ms | Same VM after A warmed common infrastructure |
| Reopen A then run task | 511 ms | Fresh project state, common runtime already warm |
| Release `realm stop` for A | 7.40 s | One sample, CLI end to end |
| First source-mode Omega host | 80.46 s | No frontend compilation; application code loading/startup |
| Second source-mode Omega host | 29.88 s | Different project realm, same sources and VM |
| Omega A close-and-verify | 14.37 s | Retired 264 modules; includes 500 ms wait and HTTP checks |

These compare different workloads, not two interchangeable ways to run the
same program. The machine was shared. There is no cold/warm confidence interval
and no audio/video latency claim. VM reuse removes repeated startup from hot
commands; it does not automatically make first application load or code
retirement cheap.

## The ownership model, with evidence

One **OS VM** can host several **project realms**. A project realm contains its
namespace/Env identity, index and owned process members. `vm.manager/serve`
starts a member; it is a spawning primitive, not an idempotent service lookup.

Ordinary spawned children are not automatically members. The socket probe
explicitly verified that an unadopted child survives realm close, whereas a
child registered with `vm.owner/adopt` dies. Omega's task supervisor and HTTP
listener did stop through their existing linked/monitored lifetimes in the
real-host probe. That is evidence for those resources, not every possible
package child, external process or durable storage handle.

An Omega **world** and a browser **editor session** are additional lifetimes.
They are not project realms. Loading PELAGIC in another tab should reuse the
Omega host and application realm, while creating that editor's own package and
audio resources. Closing a tab must not invoke backend realm retirement.

Different compiler builds still require different OS VMs. A source checkout
deliberately cannot masquerade as a shared release build. Realm namespace
isolation works, but is not an OS sandbox or an aggregate memory quota.

## Upstream repair and remaining blockers

The pinned-claim bug is repaired upstream in `e8ffb744`: idempotent claim reuse
now requires both the OS PID and the owning root. The existing port suite plus
a cross-root regression passes (6 cases / 19 assertions). The before/after probe also records
the behavior. This does **not** fix duplicate hostname admission or service/
realm lifetime of claims; those require a broader lease contract.

Current `:uses` metadata is not sufficient to promise verified shared package
code. Its current successful-load and failed-path results are recorded rather
than inferred from older design documentation. Verify closure hashes, resolution
and initializer ownership before relying on it for Omega libraries.

The default shared auto-start policy is also insufficient for persistent tasks:
the first command runs cold while a warm VM starts in the background. The
first-service probe recorded two different OS PIDs and verified that the first
was already dead after command return. A persistent service task must ensure
and attach to its owner VM before acquisition. This is a missing task/lifetime
contract, not a failure of the already-warm realm dispatch demonstrated above.

Some realm documentation still describes project environment and namespace
isolation as unfinished. Those statements are stale for this revision: the
actual release tests demonstrate both. Conversely, comments promising checked
shared-source hashes are ahead of the behavior observed here.

## Reproduce

From the upstream checkout, inspect `scripts/bl-mem` first and run one BL VM job
at a time. Use the absolute checkout executable when launching through
`systemd-run`; its command lookup can otherwise select the caller's `bin/bl`
before applying `--working-directory`.

```sh
/home/user/code/undefine/beam-lisp/bin/bl --cold run \
  /home/user/code/undefine/omega/research/realm-prototype/run.bl

REALM_PROBE_LIBRARY=1 /home/user/code/undefine/beam-lisp/bin/bl --cold run \
  -p /home/user/code/undefine/omega/research \
  /home/user/code/undefine/omega/research/realm-prototype/host.bl

python3 /home/user/code/undefine/omega/research/realm-prototype/release.py
```

The host experiment currently names an existing content-addressed frontend;
change `web` in `host.bl` if that local generation is unavailable. It verifies
HTTP serving and backend lifecycle, not browser playback with a newly compiled
upstream JS graph. Release probes require the recorded release in the local
store and isolate their daemon/runtime directories themselves. Long runs should
use an 8 GB memory / 2 GB swap systemd cap, as in the proof logs.

## Evidence

- [Real release results](proof/release.json), [launcher log](proof/release.log).
- [First-ever service results](proof/first-service.json), [raw log](proof/first-service.log).
- [Socket results](proof/source-prototype.json), [raw log](proof/source-prototype.log).
- [Omega host results](proof/host.json), [raw log](proof/host.log).
- [Claims before repair](proof/routes-before.json), [after repair](proof/routes-after.json).
- [Shared-code results](proof/sharing.json), [raw log](proof/sharing.log).
- [Four upstream realm test files, 146 assertions](proof/upstream-tests.log).
- [Port regression suite](proof/ports-tests-final.log).

The refined implementation order is in
[PLAN-016](../../!tasks/plans/PLAN-016-shared-package-development.org).
