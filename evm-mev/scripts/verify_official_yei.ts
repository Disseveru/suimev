import { createPublicClient, http } from 'viem';

const client = createPublicClient({
  transport: http('https://evm-rpc.sei-apis.com')
});

async function verifyOfficialAddresses() {
  const addresses: [string, `0x${string}`][] = [
    ['Yei Pool-Proxy', '0x4a4d9abD36F923cBA0Af62A39C01dEC2944fb638'],
    ['Yei AddressesProvider', '0x5C57266688A4aD1d3aB61209ebcb967B84227642'],
    ['Yei Oracle', '0xA1ce28cEbaB91d8dF346D19970E4Ee69A6989734'],
    ['Yei PoolDataProvider', '0x60c82A40C57736a9c692C42e87A8849Fb407F0d6'],
    ['Yei LiquidationLogic', '0x5d1c6e0D69e962851b315BC9eff92D5189189c6b'],
    ['Yei FlashLoanLogic', '0xA4bFc89476eA68A0a649612BB259aac8E2f2Bb19'],
  ];

  for (const [name, addr] of addresses) {
    const code = await client.getBytecode({ address: addr });
    const hasBytecode = code && code.length > 2;
    console.log(`${hasBytecode ? '[PASS]' : '[FAIL]'} ${name} (${addr}): ${hasBytecode ? `Bytecode length ${code!.length}` : 'NO BYTECODE'}`);
  }
  process.exit(0);
}

verifyOfficialAddresses().catch(console.error);
