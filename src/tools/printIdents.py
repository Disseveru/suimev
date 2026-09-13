with open('incentive_account.mv', 'rb') as f:
    data = f.read()

off = 1727
count = 2099
chunk = data[off:off+count]

cur = 0
idents = []
while cur < len(chunk):
    l = 0
    shift = 0
    while True:
        b = chunk[cur]
        cur += 1
        l |= (b & 0x7f) << shift
        if (b & 0x80) == 0:
            break
        shift += 7
    s = chunk[cur:cur+l].decode('utf-8', errors='ignore')
    cur += l
    idents.append(s)

print(f"Parsed {len(idents)} identifiers:")
for i, name in enumerate(idents):
    print(f"  {i}: {name}")
