import sys

with open('incentive_account.mv', 'rb') as f:
    data = f.read()

print("File size:", len(data))
print("Magic header:", data[:4].hex())

# Let's search for error constant 2 or strings
# In Move bytecode, u64 constants are stored in the constant table.
# Let's search for strings in data
import re
strings = re.findall(b'[\x20-\x7e]{3,}', data)
print("Found strings (sample):")
for s in strings[:40]:
    print(" ", s.decode('ascii', errors='ignore'))
