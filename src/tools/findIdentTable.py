with open('incentive_account.mv', 'rb') as f:
    data = f.read()

# Let's search each table for readable ascii strings
# Table kind: 0x01..
tables = [
  (0x01, 0, 67),
  (0x02, 67, 132),
  (0x03, 199, 532),
  (0x04, 731, 78),
  (0x05, 809, 918),
  (0x07, 1727, 2099),
  (0x08, 3826, 256),
  (0x06, 4082, 50),
  (0x0a, 4132, 113),
  (0x0c, 4245, 2704),
  (0x0d, 6949, 26),
  (0x0f, 6975, 5),
]

for kind, off, count in tables:
    chunk = data[off:off+count]
    printable = sum(1 for b in chunk if 32 <= b <= 126)
    ratio = printable / len(chunk) if len(chunk) > 0 else 0
    print(f"Table 0x{kind:02x}: len={count}, printable={printable} ({ratio:.2f})")
    if ratio > 0.4:
        import re
        strs = re.findall(b'[\x20-\x7e]{3,}', chunk)
        print("  Strings:", [s.decode('ascii') for s in strs[:15]])
