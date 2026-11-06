"""Personal Omega ingress: authenticate the Serve identity, then relay HTTP/WS.

The raw application stays on loopback for the account's CLI. Serve strips incoming
identity headers and supplies its own; other local users remain trusted, as for
the workstation's existing shared network namespace.
"""
import argparse
import os
import select
import socket
import socketserver
import threading


def head(connection):
    data = b''
    while b'\r\n\r\n' not in data:
        if len(data) > 65536:
            raise ValueError('HTTP head exceeds limit')
        part = connection.recv(8192)
        if not part:
            raise EOFError()
        data += part
    return data.split(b'\r\n\r\n', 1)


def close_header(raw):
    lines = raw.split(b'\r\n')
    return b'\r\n'.join([lines[0], *[line for line in lines[1:] if not line.lower().startswith(b'connection:')], b'Connection: close'])


class Handler(socketserver.BaseRequestHandler):
    def reply(self, status, message):
        body = (message + '\n').encode()
        self.request.sendall(f'HTTP/1.1 {status}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: {len(body)}\r\n\r\n'.encode() + body)

    def handle(self):
        self.request.settimeout(15)
        try:
            raw, rest = head(self.request)
            lines = raw.split(b'\r\n')
            headers = [line.split(b':', 1) for line in lines[1:] if b':' in line]
            logins = [value.strip().decode().casefold() for key, value in headers if key.lower() == b'tailscale-user-login']
            try:
                upstream = socket.create_connection(('127.0.0.1', self.server.backend), timeout=2)
            except OSError:
                self.reply('503 Service Unavailable', 'Omega is starting; retry shortly')
                return
            with upstream:
                if logins != [self.server.owner.casefold()]:
                    self.reply('403 Forbidden', 'This Omega belongs to another tailnet identity')
                    return
                upgrade = any(key.lower() == b'upgrade' and value.strip().lower() == b'websocket' for key, value in headers)
                upstream.sendall((raw if upgrade else close_header(raw)) + b'\r\n\r\n' + rest)
                # Request bodies may arrive after the head (including chunked
                # uploads). Relay them while waiting for the response head.
                pending = b''
                while b'\r\n\r\n' not in pending:
                    readable, _, _ = select.select([self.request, upstream], [], [], 60)
                    if not readable:
                        return
                    for source in readable:
                        data = source.recv(65536)
                        if not data:
                            return
                        if source is self.request:
                            upstream.sendall(data)
                        else:
                            pending += data
                    if len(pending) > 65536 and b'\r\n\r\n' not in pending:
                        return
                response, initial = pending.split(b'\r\n\r\n', 1)
                self.request.sendall((response if upgrade else close_header(response)) + b'\r\n\r\n' + initial)
                self.request.settimeout(None)
                upstream.settimeout(None)
                while True:
                    readable, _, _ = select.select([self.request, upstream], [], [], 90)
                    if not readable:
                        return
                    for source in readable:
                        data = source.recv(65536)
                        if not data:
                            return
                        (upstream if source is self.request else self.request).sendall(data)
        except (OSError, EOFError, ValueError):
            return


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--backend', type=int, default=8812)
    parser.add_argument('--owner', required=True)
    parser.add_argument('--child', type=int, required=True)
    args = parser.parse_args()

    def monitor():
        try:
            os.waitpid(args.child, 0)
        finally:
            os._exit(1)  # systemd restarts the whole application process group.

    threading.Thread(target=monitor, daemon=True).start()
    with Server(('127.0.0.1', args.port), Handler) as server:
        server.backend, server.owner = args.backend, args.owner
        server.serve_forever()


if __name__ == '__main__':
    main()
