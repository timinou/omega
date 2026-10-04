# spike: beam-jail — BEAM as the authority over every write, exec and connect of an agent's OS processes

> Run: `bin/bl run spikes/beam-jail.bl.md` (needs `gcc` and `python3`; Linux with Landlock + seccomp user-notify; no root, no daemon)

**Question.** `fs-capture` found that BEAM tracing sees what a cell does *except* OS processes (`sh`, `python`,
`sed -i`, `git`…). Can BEAM be the **authority** over every file write, exec and connect made by those processes,
with one tiny exec wrapper, zero daemons and no root?

**Mechanism under test.** One ~190-line C wrapper, `notify`, started by a BEAM port:

- `--rw DIR` (repeatable) installs **Landlock**: the whole process tree may *write* only beneath those paths. The
  kernel enforces it, race-free; reads and compute are untouched.
- A **seccomp** filter (`SECCOMP_FILTER_FLAG_NEW_LISTENER`) sends write-ish `openat`, `unlink*`, `rename*`, `mkdir*`,
  `execve` and `connect` to user space (`SECCOMP_RET_USER_NOTIF`); everything else stays in-kernel. The wrapper
  keeps the listener and loops: it prints `"<id> <pid> <syscall> <detail>"` on stdout (detail read from
  `/proc/<pid>/mem`) and reads `"<id> allow|deny"` from stdin. BEAM is the other end of that pipe: the verdict is a
  beam-lisp fn.
- `JAIL_ONLY=1` = Landlock, then `exec` in place (no notify loop): how a whole jailed BEAM node is started.

Nothing under `src/` is touched. The C source below is the single copy: section 0 extracts it **from this
document**, compiles it into a fresh temp dir with `gcc -O2`, and every section drives that binary from beam-lisp.
Relative to the scratch probe the filter also returns `EPERM` for `io_uring_setup` (section 6).

## The C source (notify.c)

```c
// notify.c — probe: a tiny exec wrapper that hands chosen syscalls of a whole
// process tree to its parent (a BEAM port) for a verdict.
//   notify -- cmd args...      protocol on stdin/stdout (line based):
//   out: "<id> <pid> <syscall> <detail>\n"   in: "<id> allow|deny\n"
// Only write-ish opens, unlink/rename/mkdir, execve and connect are filtered;
// everything else (reads, compute) never leaves the kernel.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

#include <linux/landlock.h>
// Landlock: the kernel ENFORCES "writes only beneath these dirs" (race-free);
// seccomp-notify only OBSERVES/ASKS. --rw DIR may repeat.
static int landlock(char **rw, int n) {
  if (n == 0) return 0;
  __u64 w = LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR |
            LANDLOCK_ACCESS_FS_REMOVE_FILE | LANDLOCK_ACCESS_FS_MAKE_CHAR |
            LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |
            LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO |
            LANDLOCK_ACCESS_FS_MAKE_BLOCK | LANDLOCK_ACCESS_FS_MAKE_SYM |
            LANDLOCK_ACCESS_FS_REFER | LANDLOCK_ACCESS_FS_TRUNCATE;
  struct landlock_ruleset_attr ra = {.handled_access_fs = w};
  int rs = syscall(SYS_landlock_create_ruleset, &ra, sizeof ra, 0);
  if (rs < 0) return -1;
  for (int i = 0; i < n; i++) {
    struct stat st; int isdir = stat(rw[i], &st) == 0 && S_ISDIR(st.st_mode);
    __u64 file_w = LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_TRUNCATE;
    struct landlock_path_beneath_attr pb = {.allowed_access = isdir ? w : file_w, .parent_fd = open(rw[i], O_PATH | O_CLOEXEC)};
    if (pb.parent_fd < 0 || syscall(SYS_landlock_add_rule, rs, LANDLOCK_RULE_PATH_BENEATH, &pb, 0)) return -1;
    close(pb.parent_fd);
  }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) return -1;
  int r = syscall(SYS_landlock_restrict_self, rs, 0); close(rs); return r;
}

#define NOTIF(nr) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, nr, 0, 1), \
                  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF)
#define WFLAGS (O_WRONLY | O_RDWR | O_CREAT | O_TRUNC | O_APPEND)

static int install(void) {
  struct sock_filter f[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_io_uring_setup, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),   // io_uring would bypass the notify filter
    // openat(dfd, path, flags): notify only when flags ask for writing
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_openat, 0, 4),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[2])),
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, WFLAGS, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_USER_NOTIF),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    NOTIF(SYS_unlinkat), NOTIF(SYS_unlink), NOTIF(SYS_renameat2), NOTIF(SYS_renameat),
    NOTIF(SYS_rename), NOTIF(SYS_mkdirat), NOTIF(SYS_mkdir), NOTIF(SYS_execve),
    NOTIF(SYS_connect),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = {sizeof f / sizeof f[0], f};
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) return -1;
  return syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_NEW_LISTENER, &prog);
}

static void send_fd(int sock, int fd) {
  char c = 0; struct iovec io = {&c, 1};
  char buf[CMSG_SPACE(sizeof(int))]; memset(buf, 0, sizeof buf);
  struct msghdr m = {.msg_iov = &io, .msg_iovlen = 1, .msg_control = buf, .msg_controllen = sizeof buf};
  struct cmsghdr *h = CMSG_FIRSTHDR(&m);
  h->cmsg_level = SOL_SOCKET; h->cmsg_type = SCM_RIGHTS; h->cmsg_len = CMSG_LEN(sizeof(int));
  memcpy(CMSG_DATA(h), &fd, sizeof(int));
  sendmsg(sock, &m, 0);
}

static int recv_fd(int sock) {
  char c; struct iovec io = {&c, 1};
  char buf[CMSG_SPACE(sizeof(int))];
  struct msghdr m = {.msg_iov = &io, .msg_iovlen = 1, .msg_control = buf, .msg_controllen = sizeof buf};
  if (recvmsg(sock, &m, 0) <= 0) return -1;
  int fd; memcpy(&fd, CMSG_DATA(CMSG_FIRSTHDR(&m)), sizeof(int));
  return fd;
}

// read a NUL-terminated string from the stopped task's memory
static void peek_str(pid_t pid, unsigned long addr, char *out, size_t n) {
  char p[64]; snprintf(p, sizeof p, "/proc/%d/mem", pid);
  int fd = open(p, O_RDONLY); out[0] = 0;
  if (fd < 0) return;
  ssize_t r = pread(fd, out, n - 1, addr); close(fd);
  out[r > 0 ? r : 0] = 0; out[n - 1] = 0;
}

static void peek_addr(pid_t pid, unsigned long addr, char *out, size_t n) {
  struct sockaddr_storage ss; char p[64]; snprintf(p, sizeof p, "/proc/%d/mem", pid);
  int fd = open(p, O_RDONLY); snprintf(out, n, "?");
  if (fd < 0) return;
  if (pread(fd, &ss, sizeof ss, addr) > 0) {
    if (ss.ss_family == AF_INET) {
      struct sockaddr_in *a = (void *)&ss; char ip[32];
      inet_ntop(AF_INET, &a->sin_addr, ip, sizeof ip);
      snprintf(out, n, "%s:%d", ip, ntohs(a->sin_port));
    } else if (ss.ss_family == AF_INET6) {
      struct sockaddr_in6 *a = (void *)&ss; char ip[64];
      inet_ntop(AF_INET6, &a->sin6_addr, ip, sizeof ip);
      snprintf(out, n, "[%s]:%d", ip, ntohs(a->sin6_port));
    } else if (ss.ss_family == AF_UNIX) {
      snprintf(out, n, "unix:%s", ((struct sockaddr_un *)&ss)->sun_path);
    } else snprintf(out, n, "family:%d", ss.ss_family);
  }
  close(fd);
}

static const char *name(int nr) {
  switch (nr) {
    case SYS_openat: return "open-w"; case SYS_unlinkat: case SYS_unlink: return "unlink";
    case SYS_renameat2: case SYS_renameat: case SYS_rename: return "rename";
    case SYS_mkdirat: case SYS_mkdir: return "mkdir"; case SYS_execve: return "exec";
    case SYS_connect: return "connect"; default: return "?";
  }
}

int main(int argc, char **argv) {
  int i = 1; char *rw[16]; int nrw = 0;
  while (i + 1 < argc && !strcmp(argv[i], "--rw") && nrw < 16) { rw[nrw++] = argv[i + 1]; i += 2; }
  if (i < argc && !strcmp(argv[i], "--")) i++;
  if (i >= argc) { fprintf(stderr, "usage: notify -- cmd...\n"); return 2; }
  if (getenv("JAIL_ONLY")) {           // Landlock only, exec in place (no notify loop)
    if (landlock(rw, nrw)) { perror("landlock"); return 127; }
    execvp(argv[i], argv + i); perror("exec"); return 127;
  }
  int sp[2]; socketpair(AF_UNIX, SOCK_STREAM, 0, sp);
  pid_t child = fork();
  if (child == 0) {
    close(sp[0]);
    dup2(2, 1);                       // the child's stdout must not mix with the protocol
    if (landlock(rw, nrw)) { perror("landlock"); _exit(127); }
    int lfd = install();
    if (lfd < 0) { perror("seccomp"); _exit(127); }
    send_fd(sp[1], lfd); close(lfd); close(sp[1]);
    execvp(argv[i], argv + i); perror("exec"); _exit(127);
  }
  close(sp[1]);
  int lfd = recv_fd(sp[0]); close(sp[0]);
  setvbuf(stdout, NULL, _IOLBF, 0);
  struct seccomp_notif req; struct seccomp_notif_resp resp; char d[512], line[64];
  for (;;) {
    memset(&req, 0, sizeof req);
    if (ioctl(lfd, SECCOMP_IOCTL_NOTIF_RECV, &req) < 0) {
      if (errno == EINTR) continue;
      break;                          // ENOENT etc: every filtered task is gone
    }
    int nr = req.data.nr; unsigned long *a = (unsigned long *)req.data.args;
    if (nr == SYS_connect) peek_addr(req.pid, a[1], d, sizeof d);
    else if (nr == SYS_openat || nr == SYS_unlinkat || nr == SYS_mkdirat || nr == SYS_renameat2 || nr == SYS_renameat)
      peek_str(req.pid, a[1], d, sizeof d);
    else peek_str(req.pid, a[0], d, sizeof d);
    if (nr == SYS_renameat2 || nr == SYS_renameat || nr == SYS_rename) {
      char to[256]; peek_str(req.pid, nr == SYS_rename ? a[1] : a[3], to, sizeof to);
      strncat(d, " -> ", sizeof d - strlen(d) - 1); strncat(d, to, sizeof d - strlen(d) - 1);
    }
    printf("%llu %d %s %s\n", (unsigned long long)req.id, req.pid, name(nr), d);
    int allow = 1;
    if (!fgets(line, sizeof line, stdin)) allow = 0;
    else allow = strstr(line, "allow") != NULL;
    memset(&resp, 0, sizeof resp);
    resp.id = req.id;
    if (allow) resp.flags = SECCOMP_USER_NOTIF_FLAG_CONTINUE;
    else resp.error = -EACCES;
    ioctl(lfd, SECCOMP_IOCTL_NOTIF_SEND, &resp);
  }
  int st; waitpid(child, &st, 0);
  fprintf(stderr, "[notify] child exit %d\n", WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st));
  return WIFEXITED(st) ? WEXITSTATUS(st) : 1;
}
```

## 0. Build and helpers

```beam-lisp
(ns omega.spike.beam-jail)

(defn bin [s] (if (erlang/is_binary s) s (erlang/list_to_binary s)))
(defn cl [s] (erlang/binary_to_list s))
(defn now-us [] (erlang/monotonic_time :microsecond))
(defn exists? [p] (File/exists? p))
(defn rd [p] (let [r (file/read_file p)] (if (= :ok (erlang/element 1 r)) (erlang/element 2 r) nil)))
(defn med [xs] (nth (vec (sort xs)) (quot (count xs) 2)))
(defn rel [root p] (if (string? p) (clojure.string/replace p root ".") p))
(defn line [& xs] (println (clojure.string/join " " (map str xs))))
(defn which [name] (bin (erlang/apply :os :find_executable (to-list [(cl name)]))))
(defn ls [d] (let [r (file/list_dir d)] (if (= :ok (erlang/element 1 r)) (vec (sort (map bin (erlang/element 2 r)))) [])))

;; extract the c fence from this very document (the marker is built so it does not occur literally in the code)
(def doc (rd "spikes/beam-jail.bl.md"))
(def c-src
  (let [open (str "``" "`c\n")
        i (clojure.string/index-of doc open)
        tail (subs doc (+ i (count open)))
        j (clojure.string/index-of tail "\n``")]
    (subs tail 0 (inc j))))

(def base (str (System/tmp_dir!) "/omega-spike-beam-jail-" (erlang/unique_integer (to-list [:positive]))))
(def root (str base "/proj"))      ; the "project": the only place the agent may write
(def out (str base "/outside"))    ; a sibling dir the agent must not touch
(def pys (str base "/py"))
(File/mkdir_p! root) (File/mkdir_p! out) (File/mkdir_p! pys) (File/mkdir_p! (str root "/wh"))
(File/write! (str base "/notify.c") c-src)
(def notify (str base "/notify"))
(def cc (System/cmd "gcc" (list "-O2" "-Wall" "-o" notify (str base "/notify.c")) (list (tuple :stderr_to_stdout true))))
(def sh (which "sh"))
(line "C source" (count c-src) "bytes; gcc exit" (erlang/element 2 cc) "-> binary exists:" (exists? notify))
(line "tmp base:" base)

(defn pyfile! [name lines] (File/write! (str pys "/" name) (clojure.string/join "\n" lines)))
(pyfile! "net.py" ["import socket"
                   "s = socket.socket()"
                   "print('inet connect_ex 1.1.1.1:80 ->', s.connect_ex(('1.1.1.1', 80)))"
                   "u = socket.socket(socket.AF_UNIX)"
                   "print('unix connect_ex /nonexistent.sock ->', u.connect_ex('/nonexistent.sock'))"])
(pyfile! "wr.py" ["import sys"
                  "try:"
                  "    open(sys.argv[1], 'w').write('x'); print('python wrote', sys.argv[1])"
                  "except OSError as e:"
                  "    print('python write', sys.argv[1], 'errno', e.errno)"])
(pyfile! "wh.py" ["for i in range(300):" "    open('wh/%d.txt' % i, 'w').write('x' * 100)"])
(pyfile! "rh.py" ["import hashlib"
                  "d = open('/etc/passwd','rb').read() * 50"
                  "h = b''"
                  "for i in range(300): h = hashlib.sha256(h + d).digest()"
                  "s = 0"
                  "for i in range(400000): s += i * i"])
(pyfile! "iou.py" ["import ctypes"
                   "l = ctypes.CDLL(None, use_errno=True)"
                   "r = l.syscall(425, 4, ctypes.create_string_buffer(120))   # io_uring_setup(4 entries, params)"
                   "print('io_uring_setup ->', r, 'errno', ctypes.get_errno())"])
(pyfile! "race.py" ["import ctypes, os, sys, threading"
                    "inside, outside, n = sys.argv[1], sys.argv[2], int(sys.argv[3])"
                    "libc = ctypes.CDLL(None, use_errno=True)"
                    "buf = ctypes.create_string_buffer(512)"
                    "A = inside.encode() + b'\\0'; B = outside.encode() + b'\\0'"
                    "stop = []"
                    "def flip():"
                    "    while not stop:"
                    "        ctypes.memmove(buf, A, len(A)); ctypes.memmove(buf, B, len(B))"
                    "t = threading.Thread(target=flip); t.start()"
                    "leaks = 0"
                    "for i in range(n):"
                    "    fd = libc.open(buf, os.O_WRONLY | os.O_CREAT, 0o644)"
                    "    if fd >= 0: os.close(fd)"
                    "    if os.path.exists(outside):"
                    "        leaks += 1; os.unlink(outside)"
                    "stop.append(1); t.join()"
                    "print('race: %d attempts, %d wrote OUTSIDE' % (n, leaks))"])

;; ── the port driver ───────────────────────────────────────────────────────
;; notify prints "<id> <pid> <op> <detail>"; anything else on the line stream is the jailed command's own
;; output (its stdout is redirected to stderr, which the port merges). Relative paths are resolved
;; against /proc/<pid>/cwd while the task is stopped in its syscall, so the policy always sees absolute paths.
(defn norm [p]
  (str "/" (clojure.string/join "/"
    (reduce (fn [acc s] (cond (or (= s "") (= s ".")) acc
                              (= s "..") (if (empty? acc) acc (pop acc))
                              :else (conj acc s)))
            [] (clojure.string/split p "/")))))

(defn abs-path [pid p]
  (if (clojure.string/starts-with? p "/") (norm p)
    (let [r (file/read_link (str "/proc/" pid "/cwd"))
          cwd (if (= :ok (erlang/element 1 r)) (bin (erlang/element 2 r)) "/")]
      (norm (str cwd "/" p)))))

(def ops {"open-w" :write "unlink" :unlink "rename" :rename "mkdir" :mkdir "exec" :exec "connect" :connect})
(def ev-re (re-pattern "^(\\d+) (\\d+) (open-w|unlink|rename|mkdir|exec|connect) (.*)$"))

(defn parse-ev [l]
  (let [m (re-find ev-re l)]
    (when m
      (let [op (get ops (nth m 3)) pid (nth m 2) d (nth m 4)]
        (cond
          (= op :connect) {:id (nth m 1) :pid pid :op op :path d :net (if (clojure.string/starts-with? d "unix:") :unix :inet)}
          (= op :rename) (let [ft (clojure.string/split d " -> ")]
                           {:id (nth m 1) :pid pid :op op :path (abs-path pid (first ft)) :to (abs-path pid (second ft))})
          :else {:id (nth m 1) :pid pid :op op :path (abs-path pid d)})))))

(defn run-jail
  "Run `exe args` in a port (cwd `cd`); answer each notify event with (policy ev) → [:allow|:deny why]."
  [exe args cd policy]
  (let [p (erlang/open_port (tuple :spawn_executable exe)
            (to-list [(tuple :args (to-list args)) (tuple :cd cd) (tuple :line 4096) :binary :exit_status :use_stdio :stderr_to_stdout]))]
    (loop [evs [] outl [] decs []]
      (receive
        [_ [:data [_ l]]]
          (let [ev (parse-ev l)]
            (if ev
              (let [v (policy ev)]
                (erlang/port_command p (str (:id ev) " " (if (= :allow (first v)) "allow" "deny") "\n"))
                (recur (conj evs ev) outl (conj decs {:ev ev :verdict (first v) :why (second v)})))
              (recur evs (conj outl l) decs)))
        [_ [:exit_status s]] {:status s :events evs :out outl :decs decs}
        (after 60000 {:status :timeout :events evs :out outl :decs decs})))))

(defn jail-args [& rws] (vec (mapcat (fn [d] ["--rw" d]) rws)))
(defn allow-all [_] [:allow "all"])
(defn show-ev [e] (into {} (filter (fn [[_ v]] (some? v)) (select-keys e [:op :path :to :net]))))
(defn show-outs [r] (doseq [l (:out r)] (println "   out |" (rel base l))))
```

## 1. Transparent capture: one `sh -c`, everything its children do arrives as data

```beam-lisp
(def cmd1 (str "python3 " pys "/wr.py " root "/py.txt; echo a > e.txt; sed -i s/a/b/ e.txt; mv e.txt m.txt; rm m.txt; mkdir sub; echo ok > sub/n.txt"))
(def r1 (run-jail notify ["--" "sh" "-c" cmd1] root allow-all))
(def r1-exec (filter #(= :exec (:op %)) (:events r1)))
(def r1-rest (remove #(= :exec (:op %)) (:events r1)))
(line "exit" (:status r1) "| events" (count (:events r1)) "| exec events" (count r1-exec) "| other" (count r1-rest))
(line "exec summary (program → count; sh's PATH search makes failed attempts show too):"
      (into (sorted-map) (frequencies (map #(last (clojure.string/split (:path %) "/")) r1-exec))))
(doseq [e r1-rest] (println "  " (-> (show-ev e) (update :path #(rel root %)) (update :to #(rel root %)))))
(line "files left in project:" (ls root))
```

Every syscall made by every descendant is reported, in order. `sed -i` appears as temp-file create + rename and `mv` as
a rename, so BEAM sees the real file operations, not the command line.

## 2. Policy in BEAM

The policy is a **data table**; the first matching rule wins. `[:deny :write-outside root]` matches any write-ish op
whose path (or rename target) is not under `root`. No Landlock here (`notify -- cmd`): BEAM's verdict is the only barrier.

```beam-lisp
(defn under? [p d] (or (= p d) (clojure.string/starts-with? p (str d "/"))))
(def writeish #{:write :unlink :rename :mkdir})

(defn rules-for [root]
  [[:allow :write-under "/dev"]
   [:deny  :write-outside root "outside project"]
   [:deny  :connect :inet "network is off"]
   [:allow :connect :unix]
   [:allow :any]])

(defn hit? [rule ev]
  (let [kind (nth rule 1) arg (get rule 2)
        paths (remove nil? [(:path ev) (:to ev)])]
    (cond
      (= kind :write-under)   (and (contains? writeish (:op ev)) (every? #(under? % arg) paths))
      (= kind :write-outside) (and (contains? writeish (:op ev)) (not (every? #(under? % arg) paths)))
      (= kind :connect)       (and (= :connect (:op ev)) (= arg (:net ev)))
      (= kind :any)           true
      :else false)))

(defn decide [rules ev]
  (loop [rs rules]
    (cond (empty? rs) [:deny "no rule"]
          (hit? (first rs) ev) [(first (first rs)) (get (first rs) 3 "")]
          :else (recur (rest rs)))))

(def op-word {:write "write" :unlink "delete" :rename "rename" :mkdir "mkdir" :connect "connect" :exec "exec"})
(defn summary
  "The one-line string the model would receive for a decided event."
  [d]
  (let [e (:ev d)]
    (str (if (= :deny (:verdict d)) "denied: " "allowed: ") (op-word (:op e)) " " (rel base (:path e))
         (when (:to e) (str " -> " (rel base (:to e)))) " (" (:why d) ")")))

(def policy (fn [ev] (decide (rules-for root) ev)))
(println "rule table:" (rules-for "<root>"))

(def r2 (run-jail notify ["--" "sh" "-c"
                          (str "echo in > ok.txt; echo x > " out "/x.txt || echo \"sh: write outside failed rc=$?\"; "
                               "python3 " pys "/wr.py " out "/y.txt; python3 " pys "/net.py")]
                  root policy))
(show-outs r2)
(line "exit" (:status r2) "| outside files exist? x.txt:" (exists? (str out "/x.txt")) "y.txt:" (exists? (str out "/y.txt"))
      "| inside ok.txt:" (exists? (str root "/ok.txt")))
(println "model-facing summaries of the DENIED events:")
(doseq [d (filter #(= :deny (:verdict %)) (:decs r2))] (println "  " (summary d)))
(line "verdict counts:" (frequencies (map :verdict (:decs r2))))
```

## 3. Kernel floor: Landlock enforces even when the BEAM policy says *allow*

Same escapes, but now the BEAM policy is `allow-all` (so every notified syscall is told to CONTINUE) and the only
barrier is `--rw root`. Landlock runs inside the syscall after seccomp, so each write is still *reported*, BEAM answers
`allow`, and the kernel returns `EACCES` anyway: enforcement does not depend on the notify answer.

```beam-lisp
(erlang/apply :file :make_symlink (to-list [(str out "/sym.txt") (str root "/link.txt")]))
(def cmd3 (str "echo a > in.txt && echo ok-inside; "
               "echo b > " out "/abs.txt || echo denied-absolute-path; "
               "echo c > link.txt || echo denied-symlink-escape; "
               "python3 " pys "/wr.py " out "/py.txt; "
               "cd " base " && { touch esc.txt || echo denied-cd-escape; }"))
(def r3 (run-jail notify (concat (jail-args root "/dev") ["--" "sh" "-c" cmd3]) root allow-all))
(show-outs r3)
(line "exit" (:status r3) "| BEAM answered" (frequencies (map :verdict (:decs r3))) "for" (count (:decs r3)) "events")
(line "outside dir:" (ls out) "| base dir has esc.txt:" (exists? (str base "/esc.txt")) "| inside in.txt:" (exists? (str root "/in.txt")))
```

## 4. Overhead: interleaved bare vs notify

Same VM, same load, alternating runs (so drift hits both). The notify side answers `allow` with the leanest possible
loop (no path resolution) so the number is the mechanism's cost, not the policy's. Write-heavy: one python writing
300 files (≈312 notified events); read/compute-heavy: hashing + arithmetic; plus `git status` on a tiny repo.

```beam-lisp
(def lead-re (re-pattern "^(\\d+) "))
(defn fast-loop [p n]
  (receive
    [_ [:data [_ l]]] (let [m (re-find lead-re l)]
                        (when m (erlang/port_command p (str (nth m 1) " allow\n")))
                        (recur p (if m (inc n) n)))
    [_ [:exit_status _]] n
    (after 60000 n)))

(defn timed [exe args]
  (let [t0 (now-us)
        p (erlang/open_port (tuple :spawn_executable exe)
            (to-list [(tuple :args (to-list args)) (tuple :cd root) (tuple :line 4096) :binary :exit_status :use_stdio :stderr_to_stdout]))
        n (fast-loop p 0)]
    [(/ (- (now-us) t0) 1000.0) n]))

(defn loadavg [] (first (clojure.string/split (bin (rd "/proc/loadavg")) " ")))
(defn rnd [x] (/ (erlang/round (* 10 x)) 10.0))
(defn bench [label cmd rounds]
  (let [rs (vec (map (fn [_] [(timed sh ["-c" cmd]) (timed notify ["--" "sh" "-c" cmd])]) (range rounds)))
        bare (map #(first (first %)) rs)
        nt (map #(first (second %)) rs)
        ev (second (second (first rs)))
        mb (med bare) mn (med nt)]
    (line label "| rounds" rounds "| events/run" ev)
    (line "   bare ms  " (vec (map erlang/round bare)))
    (line "   notify ms" (vec (map erlang/round nt)))
    (line "   median bare" (rnd mb) "ms | notify" (rnd mn) "ms | delta"
          (rnd (- mn mb)) "ms | per event"
          (if (> ev 0) (str (rnd (/ (* 1000 (- mn mb)) ev)) " µs") "n/a"))))

(def load0 (loadavg))
(bench "write-heavy (python, 300 files)" (str "python3 " pys "/wh.py") 9)
(bench "read/compute-heavy (python)" (str "python3 " pys "/rh.py") 9)
(File/write! (str root "/g.txt") "x")
(System/cmd "git" (list "init" "-q" root) (list (tuple :stderr_to_stdout true)))
(bench "git status (tiny repo)" "git status --short >/dev/null" 9)
(line "load average (1 min) before:" load0 "after:" (loadavg) "| cores:" (erlang/system_info :logical_processors))
```

## 5. A jailed agent node (`peer` + `JAIL_ONLY=1`)

The supervising node starts an **agent** node under Landlock through `peer`'s `exec` wrapper (`notify --rw … -- erl`,
`JAIL_ONLY=1` ⇒ no notify loop, just the kernel jail). The authority stays outside. `--rw` also lists `/dev` and the
cookie file (a file rule gets file-only rights). Distribution must be up on the host first.

```beam-lisp
(defn attempt [f] (try (f) (catch e [:raised e])))
(defn bw [s] (erlang/binary_to_list s))
(defn ap [m f args] (erlang/apply m f (to-list args)))
(def home (bin (ap :os :getenv [(bw "HOME")])))
(def cookie-file (str home "/.erlang.cookie"))
(def dist (attempt #(ap :net_kernel :start [(keyword (str "spkjail" (erlang/unique_integer (to-list [:positive])))) {:name_domain :shortnames}])))
(line "net_kernel:start →" dist "| host node" (erlang/node))
;; the VM's cookie differs from ~/.erlang.cookie unless set: without this the agent's handshake is rejected
;; ("Invalid challenge reply") and peer:start exits with :timeout (OBSERVED while building this spike)
(ap :erlang :set_cookie [(erlang/binary_to_atom (clojure.string/trim (bin (rd cookie-file))))])
(ap :os :putenv [(bw "JAIL_ONLY") (bw "1")])
(def peer-res
  (attempt #(ap :peer :start
            [{:name (keyword (str "agent" (erlang/unique_integer (to-list [:positive]))))
              :wait_boot 30000
              :exec (tuple (bw "/tmp/bj/w2.sh")
                           (to-list (map bw [notify "--rw" root "--rw" "/dev" "--rw" cookie-file "--" "/usr/bin/erl"])))}])))
(ap :os :unsetenv [(bw "JAIL_ONLY")])
(line "peer:start →" peer-res)

(def agent (when (= :ok (erlang/element 1 peer-res)) (erlang/element 3 peer-res)))
(defn on-agent [m f args] (attempt #(ap :erpc :call [agent m f (to-list args)])))
(def peer-pid (when agent (erlang/element 2 peer-res)))
(when agent
  (let [inside (str root "/peer-inside.txt") outside (str out "/peer-outside.txt") raw (str out "/peer-raw.txt")
        os-out (str out "/peer-os.txt")]
    (line "agent node:" agent)
    (line " write_file inside :" (on-agent :file :write_file [inside "x"]))
    (line " write_file outside:" (on-agent :file :write_file [outside "x"]))
    (line " raw open outside  :" (let [r (on-agent :file :open [raw (to-list [:write :raw])])] (if (and (tuple? r) (= :ok (erlang/element 1 r))) :ok r)))
    (line " os:cmd outside    :" (clojure.string/trim (bin (on-agent :os :cmd [(bw (str "echo y > " os-out " 2>&1 || echo denied"))]))))
    (line " files outside now :" (ls out) "| inside has peer-inside.txt:" (exists? inside))
    (File/write! (str out "/host-ok.txt") "h")
    (line " host writes outside, same moment: host-ok.txt exists:" (exists? (str out "/host-ok.txt")))
    (line " agent's own view of the jail, python via os:cmd:"
          (clojure.string/trim (bin (on-agent :os :cmd [(bw (str "python3 " pys "/wr.py " out "/peer-py.txt"))]))))))
(when peer-pid (line "peer:stop →" (attempt #(ap :peer :stop [peer-pid]))))
```

## 6. What it misses, and attacks tried

```beam-lisp
;; (a) fd opened BEFORE the jail: the write goes through an already-open descriptor, so no open/openat is ever
;; issued inside the jail. The launching shell opens fd 3 on a file OUTSIDE the project, then starts notify with --rw root.
;; (stdin of the script is `yes`, standing in for BEAM's "allow" answers)
(File/write! (str out "/pre.txt") "pre\n")
(File/write! (str base "/fd.sh")
  (str "exec 3>>" out "/pre.txt\n"
       "yes '0 allow' | " notify " --rw " root " --rw /dev -- sh -c 'echo late-write >&3 && echo fd3-write-succeeded; echo new > " out "/new.txt || echo new-file-denied' 2>&1 | grep -v '^[0-9]* '\n"))
(def r6a (System/cmd "sh" (list (str base "/fd.sh")) (list (tuple :stderr_to_stdout true))))
(line "(a) inherited fd, output:" (clojure.string/replace (clojure.string/trim (bin (erlang/element 1 r6a))) "\n" " | "))
(line "    pre.txt now:" (clojure.string/replace (clojure.string/trim (bin (rd (str out "/pre.txt")))) "\n" "+") "| new.txt created outside:" (exists? (str out "/new.txt")))

;; (b) io_uring: submissions bypass seccomp's per-syscall filter (the ops run in kernel workers)
(def r6b (run-jail notify (concat (jail-args root "/dev") ["--" "python3" (str pys "/iou.py")]) root allow-all))
(show-outs r6b)
(def r6b0 (System/cmd "python3" (list (str pys "/iou.py")) (list (tuple :stderr_to_stdout true))))
(line "(b) io_uring_setup bare (no jail):" (clojure.string/trim (bin (erlang/element 1 r6b0))) "| kernel.io_uring_disabled =" (clojure.string/trim (bin (rd "/proc/sys/kernel/io_uring_disabled"))))

;; (c) TOCTOU: seccomp_unotify(2) says CONTINUE "is not intended as a method of implementing security policy":
;; the path BEAM reads from /proc/pid/mem can be changed by another thread before the kernel re-reads it.
;; race.py flips one buffer between an inside and an OUTSIDE path while opening it. BEAM allows the inside
;; spelling and denies the outside one — by looking at the path it read. Two runs: notify ALONE, and notify + Landlock.
(def inside-t (str root "/race-in.txt"))
(def outside-t (str out "/race-out.txt"))
(defn race-policy [ev] (if (and (= :write (:op ev)) (not (under? (:path ev) root)) (not (under? (:path ev) "/dev")))
                         [:deny "outside"] [:allow "ok"]))
(def r6c1 (run-jail notify ["--" "python3" (str pys "/race.py") inside-t outside-t "3000"] root race-policy))
(show-outs r6c1)
(def r6c2 (run-jail notify (concat (jail-args root "/dev") ["--" "python3" (str pys "/race.py") inside-t outside-t "3000"]) root race-policy))
(show-outs r6c2)
(line "(c) events BEAM judged (notify alone):" (count (:events r6c1)) "| denied" (count (filter #(= :deny (:verdict %)) (:decs r6c1))))
```

## Findings

Cleanup first (temp tree and any node), then the list.

```beam-lisp
(File/rm_rf! base)
(line "temp tree removed:" (not (exists? base)))
(line "epmd names (agent node must be gone):" (clojure.string/trim (bin (erlang/element 1 (System/cmd "sh" (list "-c" "epmd -names | grep -c 'name agent' || true"))))))
```

1. **OBSERVED — transparent capture works across a whole `sh` tree.** One `sh -c` running python, `sed -i`, `mv`, `rm`,
   `mkdir` produced 24 events (15 `exec`, 9 file ops) as `{:op :path :to}` data with absolute paths: `sed -i` = write
   `sedXXXX` + rename onto `e.txt`; `mv` = rename; `rm` = unlink; `mkdir`; redirect = write. Exec events include sh's failed
   PATH-search attempts, so "exec" counts overcount programs (dedupe by the first successful one if it matters).
2. **OBSERVED — policy in BEAM is a data table + a ~15-line fn.** Outside writes from `sh` and python were refused
   (files did not exist afterwards; sh printed `Permission denied`, python errno 13), inet connect refused (python
   `connect_ex` = 13), unix connect allowed (python got 2 = ENOENT from the kernel, i.e. it reached the real syscall).
   Summaries such as `denied: write ./outside/x.txt (outside project)` and `denied: connect 1.1.1.1:80 (network is off)` come
   straight from the decision record (the first path component is the temp dir, shown as `.`).
3. **OBSERVED — Landlock is the floor, independent of the verdict.** With BEAM answering `allow` to all 18 events,
   absolute-path, symlink-escape (link inside root → outside), python and `cd`-escape writes all failed with EACCES;
   nothing appeared outside; the in-project write succeeded.
4. **OBSERVED — overhead is per notified event, not per process.** Interleaved 9-round medians under load average 20–40
   on 16 cores: write-heavy (312 events) bare 35.8–66.8 ms vs notify 66.2–108.6 ms, i.e. roughly **100–135 µs per
   notified event** (absolute numbers move with load, the per-event cost was 97–134 µs in two runs here and 100 µs in
   scratch). Read/compute-heavy python (12 events) and `git status` (15 events): differences within the noise
   (−17…+29 ms and −0.1…+8 ms across runs, either sign). Cost ≈ 2 context switches (BEAM↔wrapper) + a `/proc/pid/mem` read.
5. **OBSERVED — a whole BEAM node can be jailed with zero daemons.** `peer:start` with `exec => {notify, [--rw …, --, erl]}`
   and `JAIL_ONLY=1`: the agent's `file:write_file` inside = ok, outside = `{error,eacces}`, raw `file:open(.., [write, raw])`
   outside = `{error,eacces}`, `os:cmd` and python outside = Permission denied / errno 13; the supervising node wrote outside
   at the same moment. Two quirks, both OBSERVED: (a) the cookie file must be a `--rw` file entry or the jailed node cannot
   read it; (b) from the bl VM, `peer:start` exits `:timeout` unless the host VM's cookie is first set to
   `~/.erlang.cookie` (`erlang:set_cookie`) — the agent logs `Invalid challenge reply`. Distribution itself starts fine
   (`net_kernel:start(Name, #{name_domain => shortnames})`; the 1-arity form with a list fails `function_clause`).
   Also: `exec` must name `/usr/bin/erl` — the `erl` found through the bl VM's PATH (an `erts` under `~/.local/share/drop`)
   made the peer time out.
6. **OBSERVED — io_uring.** On this host `kernel.io_uring_disabled = 0` and bare `io_uring_setup` succeeds (fd 3): ring
   operations execute in the kernel and would bypass the per-syscall seccomp filter. The wrapper's filter now returns
   `EPERM` for `io_uring_setup` (observed: `-1 errno 1` inside the jail). Landlock itself does mediate io_uring file
   opens/writes in kernels this recent, so the filter closes the *observation* gap; INFERRED that the enforcement stays
   intact either way (not tested with a ring).
7. **OBSERVED — a descriptor opened before the jail is not re-checked for writes.** fd 3 (opened by the launching shell on
   a file outside the project) stayed writable inside the jail (`late-write` landed in `pre.txt`) while creating a new
   file outside was denied. Landlock restricts path *opens*, not already-open files. Mitigation (INFERRED, standard):
   the launcher must not leak descriptors (`O_CLOEXEC`/close-range before exec); a port started by BEAM inherits only 0/1/2.
8. **OBSERVED — notify alone is NOT enforcement (TOCTOU).** `seccomp_unotify(2)` says `SECCOMP_USER_NOTIF_FLAG_CONTINUE`
   is not a way to implement security policy: the path read from `/proc/pid/mem` can change before the kernel re-reads it.
   A thread flipping one buffer between an inside and an outside path while a second thread opens it: under notify
   **alone** 747 of 3000 opens wrote OUTSIDE although BEAM denied every outside spelling it saw; with `--rw root` as well,
   0 of 3000. Design rule: **Landlock = enforce, notify = observe/ask** (audit trail, model-facing summaries, network
   and exec decisions where there is no filesystem floor).
9. **INFERRED — what the filter does not see.** `connect` is notified but `sendto` on an unconnected UDP socket, `bind`,
   reads, `chmod`/`truncate`/`symlink`/`link` (Landlock covers truncate/symlink creation under `--rw` but they are not
   reported), and writes through `mmap` of an already-open fd are not events. Exec decisions are `CONTINUE`-based and
   share the TOCTOU caveat; network has no kernel floor here (Landlock ABI ≥ 4 `NET_CONNECT_TCP` would add one; the
   wrapper does not use it yet). Only x86-64 is handled (other arch → `KILL_PROCESS`).
10. **INFERRED — integration shape.** The unit of use is one port per cell: `notify --rw <root> -- sh -c <cmd>`, events
    become the claim/checkpoint stream `fs-capture` could not get for OS processes, and a long-lived jailed agent node is
    one `peer` per task. Cost model: nothing for reads/compute, ≈ 0.1 ms per write/exec/connect, which a `git checkout`
    of thousands of files would pay thousands of times (cap or switch that command to Landlock-only).
