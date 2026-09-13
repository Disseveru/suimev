import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';

async function main() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk() as any;
  const query = await sdk.createScallopQuery();
  console.log('Scallop query methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(query)));
}

main().catch(console.error);
