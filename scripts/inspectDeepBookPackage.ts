import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const pkg1 = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';
  const pkg2 = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809';

  try {
    const fn1 = await suiClient.getNormalizedMoveFunction({
      package: pkg1,
      module: 'pool',
      function: 'swap_exact_base_for_quote',
    });
    console.log('pkg1 has swap_exact_base_for_quote! parameters:', fn1.parameters.length);
  } catch (e: any) {
    console.log('pkg1 err:', e.message);
  }

  try {
    const fn2 = await suiClient.getNormalizedMoveFunction({
      package: pkg2,
      module: 'pool',
      function: 'swap_exact_base_for_quote',
    });
    console.log('pkg2 has swap_exact_base_for_quote! parameters:', fn2.parameters.length);
  } catch (e: any) {
    console.log('pkg2 err:', e.message);
  }
}

main().catch(console.error);
