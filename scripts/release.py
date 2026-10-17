#!/usr/bin/env python3
"""Archive a committed revision as matching source and supplemental evidence."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def evidence(path):
    return "/proof/" in path or path.startswith("!tasks/reports/")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", default="HEAD", help="Committed revision; working files are never read")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/releases")
    args = parser.parse_args()
    commit = git("rev-parse", "--verify", "--end-of-options", args.revision + "^{commit}").decode().strip()
    timestamp = int(git("show", "-s", "--format=%ct", commit))
    stem = "omega-" + commit[:12]
    prefix = stem + "/"
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    receipts = []

    def publish(kind, write):
        target = output / (stem + "-" + kind + ".tar.gz")
        stage = target.with_suffix(target.suffix + ".tmp")
        try:
            with stage.open("wb") as raw:
                with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
                    write(compressed)
            stage.replace(target)
        finally:
            stage.unlink(missing_ok=True)
        receipts.append({"file": target.name, "bytes": target.stat().st_size,
                         "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
        print(target)

    publish("source", lambda stream: stream.write(git("archive", "--format=tar", "--prefix=" + prefix, commit)))

    rows = []
    for record in git("ls-tree", "-rz", "--full-tree", commit).split(b"\0"):
        if not record:
            continue
        metadata, name = record.split(b"\t", 1)
        mode, kind, oid = metadata.decode().split()
        path = name.decode()
        if evidence(path) or path in {"LICENSE", "THIRD_PARTY.md", "README.md", "docs/releasing.md"}:
            if kind != "blob" or mode not in {"100644", "100755"}:
                raise RuntimeError("Unsupported evidence entry: " + path)
            rows.append((path, mode, oid))

    def write_evidence(stream):
        with subprocess.Popen(["git", "cat-file", "--batch"], cwd=ROOT,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE) as objects:
            try:
                with tarfile.open(fileobj=stream, mode="w|") as archive:
                    for path, mode, oid in rows:
                        objects.stdin.write((oid + "\n").encode())
                        objects.stdin.flush()
                        returned_oid, kind, size = objects.stdout.readline().split()
                        if returned_oid.decode() != oid or kind != b"blob":
                            raise RuntimeError("Unexpected Git object for " + path)
                        data = objects.stdout.read(int(size))
                        if len(data) != int(size) or objects.stdout.read(1) != b"\n":
                            raise RuntimeError("Truncated Git object for " + path)
                        info = tarfile.TarInfo(prefix + path)
                        info.size, info.mtime, info.mode = len(data), timestamp, int(mode[-3:], 8)
                        archive.addfile(info, io.BytesIO(data))
            finally:
                objects.stdin.close()
            if objects.wait() != 0:
                raise RuntimeError("Could not read evidence from Git")

    publish("evidence", write_evidence)
    manifest = output / (stem + "-manifest.json")
    manifest.write_text(json.dumps({"commit": commit, "prefix": prefix,
                                    "evidence_entries": len(rows), "archives": receipts}, indent=2) + "\n")
    print(manifest)


if __name__ == "__main__":
    main()
