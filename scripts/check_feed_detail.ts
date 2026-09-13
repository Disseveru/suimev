import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const ethFeed = await client.getDynamicFieldObject({
    parentId: '0xf5d0a43dcc96aa33cbe48d86155ede120377d25863389a75634364a5c8e054a7',
    name: {
      type: '0x1::type_name::TypeName',
      value: { name: 'd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH' }
    }
  });
  console.log('ethFeed:', JSON.stringify(ethFeed.data?.content, null, 2));

  const scaFeed = await client.getDynamicFieldObject({
    parentId: '0xf5d0a43dcc96aa33cbe48d86155ede120377d25863389a75634364a5c8e054a7',
    name: {
      type: '0x1::type_name::TypeName',
      value: { name: '7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA' }
    }
  });
  console.log('scaFeed:', JSON.stringify(scaFeed.data?.content, null, 2));
}

main().catch(console.error);
