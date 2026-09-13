import { SuiClientManager } from '../client/suiClient.js';

async function run() {
  const client = SuiClientManager.getInstance().getClient();
  const pkg = await client.getObject({
    id: '0x74922703605ba0548a55188098d6ebc8fdeb9fe16993986f1b7c9a49036c7c9c',
    options: { showBcs: true }
  });
  console.log('Got package object:', !!pkg.data);
  const raw = pkg.data?.bcs as any;
  if (raw && raw.dataType === 'package') {
    const bytecodeBase64 = raw.moduleMap['incentive_account'];
    console.log('incentive_account bytecode length:', bytecodeBase64?.length);
    // Write raw bytecode to file so we can inspect or disassemble
    import('fs').then(fs => {
      fs.writeFileSync('incentive_account.mv', Buffer.from(bytecodeBase64, 'base64'));
      console.log('Wrote incentive_account.mv');
    });
  }
}

run().catch(console.error);
