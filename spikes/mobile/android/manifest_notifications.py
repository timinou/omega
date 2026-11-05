"""Enable Pocket's existing notification receiver in an app-only APK update.

Preserve every existing binary XML string index and resource id. Only append
strings and the permission/private receiver nodes; DEX and resources stay intact.
"""
import struct

NONE = 0xffffffff
PERMISSION = 'android.permission.POST_NOTIFICATIONS'
RECEIVER = 'io.beamlisp.android.BlNotifyReceiver'


def chunks(xml):
    offset = 8
    while offset < len(xml):
        kind, header, size = struct.unpack_from('<HHI', xml, offset)
        assert size >= header and size % 4 == 0
        yield kind, xml[offset:offset + size]
        offset += size
    assert offset == len(xml)


def strings(pool):
    kind, header, size, count, styles, flags, start, style_start = struct.unpack_from('<HH6I', pool)
    assert kind == 1 and header == 28 and not styles and not flags & 0x100
    values = []
    for i in range(count):
        offset = start + struct.unpack_from('<I', pool, header + 4 * i)[0]
        length = struct.unpack_from('<H', pool, offset)[0]
        assert length < 0x8000
        values.append(pool[offset + 2:offset + 2 + length * 2].decode('utf-16-le'))
    return values


def append_strings(pool, additions):
    values = strings(pool)
    extra = [s for s in additions if s not in values]
    count, start = len(values), struct.unpack_from('<I', pool, 20)[0]
    data = bytearray(pool[start:])
    offsets = [struct.unpack_from('<I', pool, 28 + 4 * i)[0] for i in range(count)]
    for s in extra:
        encoded = s.encode('utf-16-le')
        offsets.append(len(data))
        data.extend(struct.pack('<H', len(encoded) // 2) + encoded + b'\0\0')
    data.extend(b'\0' * (-len(data) % 4))
    new_start = 28 + 4 * len(offsets)
    header = bytearray(pool[:28])
    struct.pack_into('<I', header, 4, new_start + len(data))
    struct.pack_into('<I', header, 8, len(offsets))
    struct.pack_into('<I', header, 20, new_start)
    return bytes(header) + struct.pack('<' + 'I' * len(offsets), *offsets) + data, values + extra


def start_node(name, attributes):
    return (struct.pack('<HHIII', 0x102, 16, 36 + 20 * len(attributes), 1, NONE)
            + struct.pack('<II6H', NONE, name, 20, 20, len(attributes), 0, 0, 0)
            + b''.join(attributes))


def end_node(name):
    return struct.pack('<HHIIIII', 0x103, 16, 24, 1, NONE, NONE, name)


def enable(xml):
    parts = list(chunks(xml))
    pool = next(p for kind, p in parts if kind == 1)
    pool, values = append_strings(pool, [PERMISSION, RECEIVER])
    resource_map = next(p for kind, p in parts if kind == 0x180)
    ids = struct.unpack('<' + 'I' * ((len(resource_map) - 8) // 4), resource_map[8:])
    name_attribute, exported_attribute = ids.index(0x01010003), ids.index(0x01010010)
    namespace = values.index('http://schemas.android.com/apk/res/android')

    def attribute(name, data, kind=3):
        return struct.pack('<IIIHBBI', namespace, name, data if kind == 3 else NONE, 8, 0, kind, data)

    existing = set()
    for kind, p in parts:
        if kind != 0x102:
            continue
        tag = values[struct.unpack_from('<I', p, 20)[0]]
        count = struct.unpack_from('<H', p, 28)[0]
        for i in range(count):
            ns, name, raw, size, zero, typ, data = struct.unpack_from('<IIIHBBI', p, 36 + 20 * i)
            if name == name_attribute and typ == 3:
                existing.add((tag, values[data]))
    permission = b'' if ('uses-permission', PERMISSION) in existing else (
        start_node(values.index('uses-permission'), [attribute(name_attribute, values.index(PERMISSION))])
        + end_node(values.index('uses-permission')))
    receiver = b'' if ('receiver', RECEIVER) in existing else (
        start_node(values.index('receiver'), [attribute(name_attribute, values.index(RECEIVER)),
                                             attribute(exported_attribute, 0, 0x12)])
        + end_node(values.index('receiver')))
    result = bytearray()
    for kind, p in parts:
        if kind == 1:
            p = pool
        if kind in (0x102, 0x103) and values[struct.unpack_from('<I', p, 20)[0]] == 'application':
            result.extend(permission if kind == 0x102 else receiver)
        result.extend(p)
    return struct.pack('<HHI', 3, 8, 8 + len(result)) + result
