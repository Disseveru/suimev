import struct

with open('incentive_account.mv', 'rb') as f:
    data = f.read()

pos = 0
magic, version = struct.unpack('<II', data[:8])
pos = 8
print(f"Magic: {hex(magic)}, Version: {version}")

def read_uleb():
    global pos
    res = 0
    shift = 0
    while True:
        b = data[pos]
        pos += 1
        res |= (b & 0x7f) << shift
        if (b & 0x80) == 0:
            break
        shift += 7
    return res

num_tables = read_uleb()
print(f"Num tables: {num_tables}")

tables = []
for i in range(num_tables):
    kind = data[pos]
    pos += 1
    offset = read_uleb()
    count = read_uleb()
    tables.append((kind, offset, count))

for kind, offset, count in tables:
    print(f"Table kind: 0x{kind:02x}, offset: {offset}, count: {count}")

ident_table = next((t for t in tables if t[0] == 0x0b), None)
if ident_table:
    _, off, count = ident_table
    cur = off
    idents = []
    end = off + count
    while cur < end:
        l = 0
        shift = 0
        while True:
            b = data[cur]
            cur += 1
            l |= (b & 0x7f) << shift
            if (b & 0x80) == 0:
                break
            shift += 7
        s = data[cur:cur+l].decode('utf-8', errors='ignore')
        cur += l
        idents.append(s)
    print(f"\nIdentifiers ({len(idents)}):")
    for idx, name in enumerate(idents):
        print(f"  {idx}: {name}")

const_table = next((t for t in tables if t[0] == 0x0d), None)
if const_table:
    _, off, count = const_table
    print(f"\nConstants table offset: {off}, size: {count}")
    pos = off
    num_consts = read_uleb()
    print(f"Num constants: {num_consts}")
    for i in range(num_consts):
        type_tag = data[pos]
        pos += 1
        data_len = read_uleb()
        cdata = data[pos:pos+data_len]
        pos += data_len
        val = None
        if len(cdata) == 8:
            val = int.from_bytes(cdata, 'little')
        elif len(cdata) == 1:
            val = cdata[0]
        print(f"  Const {i}: type={type_tag}, len={data_len}, val={val}, hex={cdata.hex()}")
