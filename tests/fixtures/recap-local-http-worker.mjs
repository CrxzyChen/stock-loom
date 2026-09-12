// Test-only bootstrap. Production worker has no endpoint override.
const endpoint=process.env.STOCK_RECAP_TEST_ENDPOINT;
if(!/^http:\/\/127\.0\.0\.1:\d+\/responses$/.test(endpoint??''))throw Error('Local test endpoint required');
const localFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>{
  if(url!=='https://api.openai.com/v1/responses'||options.headers.Authorization!=='Bearer synthetic-recap-test-key')throw Error('Unexpected test request');
  return localFetch(endpoint,{...options,headers:{'Content-Type':'application/json'}});
};
await import('../../dist/agent/recap-worker.mjs');
