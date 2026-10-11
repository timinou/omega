#!/usr/bin/env python3
"""A shell view of the shared Omega world. It never opens storage or starts tasks locally."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.error import URLError, HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = Path(__file__).resolve().parents[1]


def request(base, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = Request(base.rstrip('/') + path, data=data, headers={'Content-Type': 'application/json'})
    with urlopen(req, timeout=35) as response:
        result = json.load(response)
    if not result.get('ok', False):
        raise RuntimeError(result.get('message', 'Host rejected the operation'))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default=os.environ.get('OMEGA_URL', 'http://127.0.0.1:8812'))
    parser.add_argument('--root', default=os.getcwd(), help='Working directory for new tasks')
    parser.add_argument('--offline', action='store_true', help='Start an offline shared host if absent')
    parser.add_argument('--no-start', action='store_true', help='Require a running shared host')
    parser.add_argument('--json', action='store_true')
    parser.add_argument('words', nargs='*', help='Goal, or: list | read ADDRESS | answer MSG TEXT | say TASK TEXT | steer TASK TEXT | cancel TASK | attach DIR')
    args = parser.parse_args()
    if not args.words:
        parser.print_help()
        return 0
    # Explicit URLs are existing hosts. Default local launches use the one BL
    # entry and its mode/admission checks; a browser is never the task owner.
    try:
        request(args.url, '/api/doc?path=launch:identity')
    except (URLError, HTTPError, RuntimeError):
        if args.no_start or args.url != 'http://127.0.0.1:8812':
            raise RuntimeError('Start the shared host with bin/bl pocket, or supply --url')
        command = [str(REPO / 'bin/bl'), 'pocket']
        if not args.offline:
            command += ['--', '--live']
        subprocess.run(command, cwd=REPO, check=True, stdout=sys.stderr)
    identity = json.loads(request(args.url, '/api/doc?path=launch:identity')['text'])
    if args.offline and identity.get('live'):
        raise RuntimeError('The shared host is live; --offline cannot use it')
    if not args.offline and not identity.get('live'):
        raise RuntimeError('The shared host is scripted; use --offline or launch a live world')
    def intent(name, **kw):
        return request(args.url, '/api/intent', {'intent': name, 'args': kw})
    words = args.words
    op = words[0]
    arities = {'list': (1, 1), 'read': (2, 2), 'attach': (2, 2), 'answer': (3, None),
               'say': (3, None), 'steer': (3, None), 'cancel': (2, 2)}
    if op in arities:
        minimum, maximum = arities[op]
        if len(words) < minimum or (maximum is not None and len(words) > maximum):
            raise RuntimeError('Invalid ' + op + ' arguments; see bin/omega --help')
    if op == 'list':
        result = request(args.url, '/api/doc?path=workspace:all')
    elif op == 'read' and len(words) == 2:
        result = request(args.url, '/api/doc?path=' + quote(words[1], safe=''))
    elif op == 'attach' and len(words) == 2:
        directory = str(Path(words[1]).expanduser().resolve(strict=True))
        if not Path(directory).is_dir():
            raise RuntimeError('Attach a directory')
        ident = Path(directory).name + '-' + hashlib.sha256(directory.encode()).hexdigest()[:8]
        # JSON string syntax is an EDN string; no shell/code interpolation.
        text = '{:id ' + json.dumps(ident) + ' :name ' + json.dumps(Path(directory).name) + ' :root ' + json.dumps(directory) + '}'
        result = intent('place/put', text=text)
    elif op == 'answer' and len(words) >= 3:
        result = intent('msg/answer', msg=words[1], text=' '.join(words[2:]))
    elif op in ('say', 'steer') and len(words) >= 3:
        result = intent('task/' + op, id=words[1], text=' '.join(words[2:]))
    elif op == 'cancel' and len(words) == 2:
        result = intent('task/cancel', id=words[1])
    else:
        cwd = str(Path(args.root).expanduser().resolve(strict=True))
        # Attach the caller's directory before opening. Task cwd is frozen;
        # selecting another place on a phone cannot change it.
        ident = Path(cwd).name + '-' + hashlib.sha256(cwd.encode()).hexdigest()[:8]
        intent('place/put', text='{:id ' + json.dumps(ident) + ' :name ' + json.dumps(Path(cwd).name) + ' :root ' + json.dumps(cwd) + '}')
        goal = ' '.join(words).strip()
        result = intent('task/open', goal=goal, title=goal.split('\n')[0], path='place:' + ident, cwd=cwd)
    print(json.dumps(result, ensure_ascii=False) if args.json else result.get('text', result.get('path', json.dumps(result))))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print('omega: ' + str(error), file=sys.stderr)
        sys.exit(2)
